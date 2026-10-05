/**
 * Model-provider abstraction. The rest of the Worker only talks to `ModelProvider`,
 * so adding another provider (or routing per task) never touches the assistant logic.
 *
 * Tiers keep cost in check: "main" for the conversational assistant, "fast" for
 * background work (brain-dump sorting, briefings) where a small model is plenty.
 */
import OpenAI from "openai";
import type { Env } from "./env";
import { now, run, uid } from "./db";

export type Tier = "main" | "fast";

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentRequest {
  tier: Tier;
  purpose: string;
  /** Stable instructions (cached). */
  system: string;
  /** Per-request context: date, memories, open items. */
  context: string;
  history: Turn[];
  tools: ToolDef[];
  maxToolRounds?: number;
}

export interface AgentResult {
  text: string;
  toolCalls: { name: string; input: Record<string, unknown>; result: unknown; error?: string }[];
}

export interface ModelProvider {
  readonly name: string;
  /** Multi-step tool-using turn. */
  runAgent(req: AgentRequest): Promise<AgentResult>;
  /** Single prompt -> text (no tools). */
  complete(req: { tier: Tier; purpose: string; system: string; prompt: string; maxTokens?: number }): Promise<string>;
  /** Research with live web search; returns the report text and how many searches it used. */
  research(req: { purpose: string; system: string; prompt: string; maxSearches: number; maxTokens?: number }): Promise<{ text: string; searches: number; sources: string[] }>;
  startBackground(req: { system: string; prompt: string; maxTokens?: number; maxSearches?: number; tier?: Tier }): Promise<string>;
  checkBackground(id: string, purpose: string): Promise<{ done: false } | { done: true; failed: string } | { done: true; text: string; searches: number; sources: string[]; failed?: undefined }>;
}

export class ProviderUnavailable extends Error {}

export function getProvider(env: Env): ModelProvider {
  if (env.OPENAI_API_KEY) return new OpenAIProvider(env);
  throw new ProviderUnavailable("No model provider configured. Set the OPENAI_API_KEY secret.");
}

type Effort = OpenAI.Chat.ChatCompletionCreateParams["reasoning_effort"];

class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(private env: Env) {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || undefined });
  }

  private model(tier: Tier) {
    return tier === "main" ? this.env.MODEL_MAIN || "gpt-6-luna" : this.env.MODEL_FAST || "gpt-6-luna";
  }

  /** Reasoning depth per tier: a little for conversation, none for background sorting/briefings. */
  private effort(tier: Tier): Effort {
    return (tier === "main" ? this.env.EFFORT_MAIN || "low" : this.env.EFFORT_FAST || "none") as Effort;
  }

  private async logUsage(model: string, purpose: string, usage?: OpenAI.CompletionUsage) {
    try {
      await run(
        this.env,
        "INSERT INTO usage_log (id, model, purpose, input_tokens, output_tokens, cached_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        uid(), model, purpose, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, usage?.prompt_tokens_details?.cached_tokens ?? 0, now(),
      );
    } catch {
      /* usage logging must never break a turn */
    }
  }

  async runAgent(req: AgentRequest): Promise<AgentResult> {
    const model = this.model(req.tier);
    const toolSpecs = (): OpenAI.Chat.ChatCompletionTool[] => req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    let tools = toolSpecs();
    // Stable instructions first so OpenAI's automatic prefix caching can reuse them.
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "developer", content: req.system },
      { role: "developer", content: req.context },
      ...normaliseHistory(req.history),
    ];
    const result: AgentResult = { text: "", toolCalls: [] };
    const maxRounds = req.maxToolRounds ?? 6;

    for (let round = 0; round <= maxRounds; round++) {
      tools = toolSpecs(); // load_tools may have added some
      const response = await this.client.chat.completions.create({
        model,
        messages,
        tools,
        // gpt-6-luna on chat/completions only accepts tools with reasoning_effort "none".
        reasoning_effort: (tools.length ? "none" : this.effort(req.tier)) as Effort,
        max_completion_tokens: 8192,
      });
      await this.logUsage(model, req.purpose, response.usage);

      const msg = response.choices[0]?.message;
      if (!msg) break;
      if (msg.refusal) {
        result.text = msg.refusal;
        return result;
      }
      if (msg.content?.trim()) result.text = msg.content.trim();

      const calls = (msg.tool_calls ?? []).filter(
        (c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function",
      );
      if (calls.length === 0) return result;
      if (round === maxRounds) break;

      messages.push(msg);
      for (const call of calls) {
        const def = req.tools.find((t) => t.name === call.function.name);
        let input: Record<string, unknown> = {};
        let content: string;
        try {
          input = JSON.parse(call.function.arguments || "{}");
          if (!def) throw new Error(`unknown tool ${call.function.name}`);
          const out = await def.handler(input);
          result.toolCalls.push({ name: def.name, input, result: out });
          content = JSON.stringify(out ?? { ok: true });
        } catch (e) {
          const msgText = e instanceof Error ? e.message : String(e);
          result.toolCalls.push({ name: call.function.name, input, result: null, error: msgText });
          content = JSON.stringify({ error: msgText });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    if (!result.text) result.text = "Done.";
    return result;
  }

  async research(req: { purpose: string; system: string; prompt: string; maxSearches: number; maxTokens?: number }) {
    const model = this.model("main");
    // max_tool_calls caps paid web searches; the API accepts it though this SDK version doesn't type it.
    const params = {
      model,
      instructions: req.system,
      input: req.prompt,
      tools: [{ type: "web_search" }],
      max_tool_calls: Math.max(1, req.maxSearches),
      max_output_tokens: req.maxTokens ?? 4000,
    } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
    const response = await this.client.responses.create(params);
    const usage = response.usage;
    await this.logUsage(model, req.purpose, usage ? { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.total_tokens, prompt_tokens_details: { cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0 } } as OpenAI.CompletionUsage : undefined);
    const searches = response.output.filter((o) => o.type === "web_search_call").length;
    // Source links the model cited.
    const sources = new Set<string>();
    for (const o of response.output) {
      if (o.type !== "message") continue;
      for (const c of o.content) {
        if (c.type === "output_text") for (const a of c.annotations ?? []) if (a.type === "url_citation") sources.add(a.url);
      }
    }
    return { text: response.output_text.trim(), searches, sources: [...sources].slice(0, 15) };
  }

  /** Start a long job on OpenAI's side (background mode) and return its id right away. */
  async startBackground(req: { system: string; prompt: string; maxTokens?: number; maxSearches?: number; tier?: Tier }) {
    const params = {
      model: this.model(req.tier ?? "main"),
      instructions: req.system,
      input: req.prompt,
      ...(req.maxSearches ? { tools: [{ type: "web_search" }], max_tool_calls: Math.max(1, req.maxSearches) } : {}),
      max_output_tokens: req.maxTokens ?? 4000,
      background: true,
    } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
    const r = await this.client.responses.create(params);
    return r.id;
  }

  /** Check a background job: still working, failed, or done with its text, search count and sources. */
  async checkBackground(id: string, purpose: string) {
    const r = await this.client.responses.retrieve(id);
    const status = (r as unknown as { status: string }).status;
    if (status === "queued" || status === "in_progress") return { done: false as const };
    if (status !== "completed") {
      const err = (r as unknown as { error?: { message?: string }; incomplete_details?: { reason?: string } });
      // "incomplete" (e.g. hit the length limit) still has usable text.
      if (status !== "incomplete" || !r.output_text) return { done: true as const, failed: err.error?.message ?? err.incomplete_details?.reason ?? status };
    }
    const usage = r.usage;
    await this.logUsage(r.model, purpose, usage ? { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.total_tokens, prompt_tokens_details: { cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0 } } as OpenAI.CompletionUsage : undefined);
    const sources = new Set<string>();
    for (const o of r.output) {
      if (o.type !== "message") continue;
      for (const c of o.content) if (c.type === "output_text") for (const a of c.annotations ?? []) if (a.type === "url_citation") sources.add(a.url);
    }
    return { done: true as const, text: r.output_text.trim(), searches: r.output.filter((o) => o.type === "web_search_call").length, sources: [...sources].slice(0, 15) };
  }

  async complete(req: { tier: Tier; purpose: string; system: string; prompt: string; maxTokens?: number }) {
    const model = this.model(req.tier);
    const response = await this.client.chat.completions.create({
      model,
      messages: [
        { role: "developer", content: req.system },
        { role: "user", content: req.prompt },
      ],
      reasoning_effort: this.effort(req.tier),
      max_completion_tokens: req.maxTokens ?? 2048,
    });
    await this.logUsage(model, req.purpose, response.usage);
    return response.choices[0]?.message?.content?.trim() ?? "";
  }
}

/** Merge consecutive same-role turns and start with a user turn. */
function normaliseHistory(history: Turn[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: Turn[] = [];
  for (const t of history) {
    if (!t.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content}\n\n${t.content}`;
    else out.push({ ...t });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/** Pull the first JSON object out of a model reply. */
export function extractJson<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

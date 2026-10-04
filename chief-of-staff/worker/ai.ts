/**
 * Model-provider abstraction. The rest of the Worker only talks to `ModelProvider`,
 * so adding another provider (or routing per task) never touches the assistant logic.
 *
 * Tiers keep cost in check: "main" for the conversational assistant, "fast" for
 * background work (brain-dump sorting, briefings) where a small model is plenty.
 */
import Anthropic from "@anthropic-ai/sdk";
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
}

export class ProviderUnavailable extends Error {}

export function getProvider(env: Env): ModelProvider {
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider(env);
  throw new ProviderUnavailable("No model provider configured. Set the ANTHROPIC_API_KEY secret.");
}

class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(private env: Env) {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
  }

  private model(tier: Tier) {
    return tier === "main" ? this.env.MODEL_MAIN || "claude-opus-5-5" : this.env.MODEL_FAST || "claude-haiku-4-5";
  }

  /**
   * Request options that depend on the model family. Effort is not accepted by Haiku 4.5;
   * low effort keeps chat fast and cheap. Current Opus/Sonnet/Fable models get the
   * server-side refusal fallback so a false-positive decline is retried transparently.
   */
  private modelOptions(model: string) {
    const opts: Partial<Anthropic.Beta.MessageCreateParamsNonStreaming> = {};
    if (!model.startsWith("claude-haiku")) opts.output_config = { effort: "low" };
    if (/^claude-(opus-5|sonnet-5-5|fable-5)/.test(model)) {
      opts.betas = ["server-side-fallback-2026-07-01"];
      opts.fallbacks = "default";
    }
    return opts;
  }

  private async logUsage(model: string, purpose: string, usage: { input_tokens: number; output_tokens: number }) {
    try {
      await run(
        this.env,
        "INSERT INTO usage_log (id, model, purpose, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        uid(), model, purpose, usage.input_tokens ?? 0, usage.output_tokens ?? 0, now(),
      );
    } catch {
      /* usage logging must never break a turn */
    }
  }

  async runAgent(req: AgentRequest): Promise<AgentResult> {
    const model = this.model(req.tier);
    const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
      { type: "text", text: req.context },
    ];
    const messages: Anthropic.Beta.BetaMessageParam[] = normaliseHistory(req.history);
    const result: AgentResult = { text: "", toolCalls: [] };
    const maxRounds = req.maxToolRounds ?? 6;

    for (let round = 0; round <= maxRounds; round++) {
      const response = await this.client.beta.messages.create({
        model,
        max_tokens: 4096,
        system,
        tools,
        messages,
        ...this.modelOptions(model),
      });
      await this.logUsage(model, req.purpose, response.usage);

      if (response.stop_reason === "refusal") {
        result.text = "I can't help with that one.";
        return result;
      }

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) result.text = text;

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) return result;
      if (round === maxRounds) break;

      // Keep the assistant content exactly as returned (thinking blocks included).
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const def = req.tools.find((t) => t.name === use.name);
        const input = (use.input ?? {}) as Record<string, unknown>;
        try {
          if (!def) throw new Error(`unknown tool ${use.name}`);
          const out = await def.handler(input);
          result.toolCalls.push({ name: use.name, input, result: out });
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out ?? { ok: true }) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          result.toolCalls.push({ name: use.name, input, result: null, error: msg });
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
    if (!result.text) result.text = "Done.";
    return result;
  }

  async complete(req: { tier: Tier; purpose: string; system: string; prompt: string; maxTokens?: number }) {
    const model = this.model(req.tier);
    const response = await this.client.beta.messages.create({
      model,
      max_tokens: req.maxTokens ?? 2048,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      ...this.modelOptions(model),
    });
    await this.logUsage(model, req.purpose, response.usage);
    return response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
}

/** The API needs alternating roles starting with a user turn. */
function normaliseHistory(history: Turn[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of history) {
    if (!t.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content = `${last.content}\n\n${t.content}`;
    else out.push({ role: t.role, content: t.content });
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

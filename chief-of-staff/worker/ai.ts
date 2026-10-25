import {CHAT_REPLY_POLICY,boundChatReply,routineConfirmation} from '../shared/chat-replies';
/**
 * Model-provider abstraction. The rest of the Worker only talks to `ModelProvider`,
 * so adding another provider (or routing per task) never touches the assistant logic.
 *
 * Sol owns judgment and tool use. Luna only phrases already-decided replies.
 * Legacy main/fast labels do not route triage to the wording model.
 */
import OpenAI from "openai";
import type { Env } from "./env";
import { first, now, run, uid } from "./db";

/**
 * Prompt-cache lifetime. OpenAI keeps a cached prompt prefix only ~5-10 minutes by default; the extended
 * option ("24h") keeps it for a day, and cached input costs 5% of the normal price. The Worker tries the
 * extended option once and remembers the answer ('ok' | 'no') in settings.cache_retention, so it never
 * keeps retrying something the model doesn't accept. Callers can ask which it is (true / false / unknown).
 */
let retentionState: "ok" | "no" | undefined;
export async function extendedCache(env: Env): Promise<boolean | undefined> {
  if (!retentionState) {
    try {
      const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'cache_retention'");
      if (row) retentionState = row.value === "ok" ? "ok" : "no";
    } catch { /* unknown yet */ }
  }
  return retentionState ? retentionState === "ok" : undefined;
}
async function rememberRetention(env: Env, state: "ok" | "no") {
  retentionState = state;
  try { await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('cache_retention', ?)", state); } catch { /* try again next time */ }
}

import { modelRoute, BRAIN_HANDOFF, WRITER_SYSTEM, type Tier } from "./ai-routing";
export type { Tier } from "./ai-routing";

export interface ToolDef {
  name: string;
  /** Pure lookups can run concurrently and share results until the next mutation. */
  readOnly?: boolean;
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
  /** Sol decides and executes; Luna phrases only the compact final handoff. */
  renderReply?: boolean;
  /** Sol returns the final concise chat reply directly. */
  directReply?: boolean;
  /** Submit saves and their final confirmation together; lookups still require reading results. */
  batchReply?:boolean;
  defer?: (work:Promise<unknown>)=>void;
  /** Stable key for automatic prefix caching. */
  cacheKey?: string;
  /** Tools that only save/change things: if the model already wrote its reply alongside them, skip the extra round trip. */
  noFollowUp?: string[];
}

export interface AgentResult {
  text: string;
  metrics?:{rounds:number;modelMs:number;toolMs:number};
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
  checkBackground(id: string, purpose: string): Promise<{ done: false; status?: string } | { done: true; failed: string } | { done: true; text: string; searches: number; sources: string[]; failed?: undefined }>;
}

export class ProviderUnavailable extends Error {}

export function getProvider(env: Env): ModelProvider {
  if (env.OPENAI_API_KEY) return new OpenAIProvider(env);
  throw new ProviderUnavailable("No model provider configured. Set the OPENAI_API_KEY secret.");
}

class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(private env: Env) {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || undefined });
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

  /** A Responses call with the 24-hour prompt cache when the model accepts it, plain otherwise. */
  private async respond(params: Record<string, unknown>): Promise<OpenAI.Responses.Response> {
    const state = await extendedCache(this.env);
    if (state !== false) {
      try {
        const r = await this.client.responses.create({ ...params, prompt_cache_retention: "24h" } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming);
        if (state === undefined) await rememberRetention(this.env, "ok");
        return r as OpenAI.Responses.Response;
      } catch (e) {
        if (!/retention/i.test(String((e as Error).message))) throw e;
        await rememberRetention(this.env, "no"); // this model doesn't take it: normal short caching still applies
      }
    }
    return await this.client.responses.create(params as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming) as OpenAI.Responses.Response;
  }

  private async logResponse(model: string, purpose: string, response: OpenAI.Responses.Response) {
    const u = response.usage;
    await this.logUsage(model, purpose, u ? {
      prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: u.total_tokens,
      prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens ?? 0 },
    } as OpenAI.CompletionUsage : undefined);
  }

  async runAgent(req: AgentRequest): Promise<AgentResult> {
    const route = modelRoute(this.env, req.purpose, "brain");
    if(req.batchReply)req.tools.push({name:'finish_reply',description:'For save-only work, call alongside ALL requested writes in the SAME batch with the short intended confirmation. The server releases it only after successful writes. For questions needing lookup results, read them first. Never use this instead of the actual save tools.',input_schema:{type:'object',properties:{reply:{type:'string'}},required:['reply']},handler:async input=>({reply:String(input.reply||'')})});
    const input: OpenAI.Responses.ResponseInput = [
      { role: "developer", content: req.system + (req.directReply ? "\n\n"+CHAT_REPLY_POLICY : req.renderReply ? "\n\n" + BRAIN_HANDOFF : "") },
      { role: "developer", content: req.context },
      ...normaliseHistory(req.history),
    ];
    const result: AgentResult = { text: "", toolCalls: [] };
    const executed = new Map<string, string>();
    const reads=new Map<string,Promise<{output:string;receipt:AgentResult["toolCalls"][number]}>>();
    const metrics={rounds:0,modelMs:0,toolMs:0};
    const maxRounds = req.maxToolRounds ?? 6;
    let refusal = false;
    for (let round = 0; round <= maxRounds; round++) {
      // Rebuild: load_tools can extend the list between rounds. Preserve optional fields.
      const tools: OpenAI.Responses.Tool[] = req.tools.map(t => ({
        type: "function", name: t.name, description: t.description, parameters: t.input_schema, strict: false,
      }));
      const modelStart=Date.now();
      const response = await this.respond({
        model: route.model, input, tools,
        reasoning: { effort: route.effort },
        max_output_tokens: 4096,
        ...(req.directReply?{text:{verbosity:"low" as const},parallel_tool_calls:true}:{}),
        tool_choice: round === maxRounds ? "none" : "auto",
        ...(req.cacheKey ? { prompt_cache_key: req.cacheKey } : {}),
      });
      metrics.rounds++;metrics.modelMs+=Date.now()-modelStart;
      const usageLog=this.logResponse(route.model, `${req.purpose}:brain`, response);if(req.defer)req.defer(usageLog);else await usageLog;
      if (response.status !== "completed") throw new Error("The decision could not finish. Check the saved actions before trying again.");
      const refused = response.output.flatMap(o => o.type === "message" ? o.content.filter(c => c.type === "refusal") : []);
      if (refused.length) { result.text = refused.map(c => c.refusal).join("\n"); refusal = true; break; }
      if (response.output_text?.trim()) result.text = response.output_text.trim();
      const calls = response.output.filter(o => o.type === "function_call");
      if (!calls.length) break;
      if (round === maxRounds) { result.text = "Some requested work could not finish within this turn. Check the saved actions; do not assume the remaining work was completed."; break; }
      // Carry reasoning and function-call items intact, as required by Responses.
      input.push(...response.output as unknown as OpenAI.Responses.ResponseInputItem[]);
      const toolStart=Date.now();
      const invoke=async(call:typeof calls[number]):Promise<{output:string;receipt?:AgentResult["toolCalls"][number]}>=>{
        if(executed.has(call.call_id))return {output:executed.get(call.call_id)!};
        let args:Record<string,unknown>={};
        try{
          const parsed=JSON.parse(call.arguments||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error('Tool arguments must be an object');args=parsed;
          const tool=req.tools.find(t=>t.name===call.name);if(!tool)throw Error(`unknown tool ${call.name}`);
          const normalize=(v:any):any=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
          const key=call.name+'|'+JSON.stringify(normalize(args));
          let promise=tool.readOnly?reads.get(key):undefined;
          if(!promise){
            promise=(async()=>{const value=await tool.handler(args);return {output:JSON.stringify(value??{ok:true}),receipt:{name:call.name,input:args,result:value}};})();
            if(tool.readOnly)reads.set(key,promise);else reads.clear();
          }
          const value=await promise;executed.set(call.call_id,value.output);return value;
        }catch(e){const error=e instanceof Error?e.message:String(e),output=JSON.stringify({error});executed.set(call.call_id,output);return {output,receipt:{name:call.name,input:args,result:null,error}};}
      };
      // Only contiguous pure lookups run together. Writes stay ordered and invalidate reads.
      for(let index=0;index<calls.length;){
        let end=index+1;
        if(req.tools.find(t=>t.name===calls[index].name)?.readOnly)while(end<calls.length&&req.tools.find(t=>t.name===calls[end].name)?.readOnly)end++;
        const batch=calls.slice(index,end),outputs=await Promise.all(batch.map(invoke));
        outputs.forEach((value,i)=>{if(value.receipt)result.toolCalls.push(value.receipt);input.push({type:'function_call_output',call_id:batch[i].call_id,output:value.output});});index=end;
      }
      metrics.toolMs+=Date.now()-toolStart;
      const last = result.toolCalls.slice(-calls.length);
      if(req.batchReply){
        const finish=calls.find(c=>c.name==='finish_reply');
        const operations=last.filter(t=>t.name!=='finish_reply');
        if(finish&&operations.length&&operations.every(t=>req.noFollowUp?.includes(t.name))){
          const failed=operations.filter(t=>t.error||(t.result as any)?.error||(t.result as any)?.ok===false);
          const review=operations.some(t=>{const v=t.result as any;return v?.status==='pending_approval'||v?.status==='pending'||v?.requires_approval||v?.question||v?.clarification||v?.now_do_this;});
          if(failed.length){result.text='Some changes could not be saved. Check the saved actions before retrying.';break;}
          if(!review){const final=last.find(t=>t.name==='finish_reply');result.text=String((final?.result as any)?.reply||'Saved.');break;}
        }
      }
      const pending=last.some(t=>{const v=t.result as any;return v?.status==='pending_approval'||v?.status==='pending'||v?.requires_approval===true||!!v?.now_do_this||!!v?.clarification||!!v?.question||!!v?.error||v?.ok===false;});
      if(req.directReply&&!response.output_text?.includes('?')){
        const short=routineConfirmation(req.history.filter(t=>t.role==='user').at(-1)?.content||'',result.toolCalls);
        if(short){result.text=short;break;}
      }
      if ((!req.directReply||!pending) && response.output_text?.trim() && req.noFollowUp && calls.every(c => req.noFollowUp!.includes(c.name)) && last.every(t => !t.error)) break;
      // A pre-tool handoff may no longer describe the outcome after an error.
      result.text = "";
    }
    if (!result.text) result.text = "The actions shown in the execution receipts were processed. Do not assume any other requested work was completed.";
    if (req.renderReply && !req.directReply && !refusal) {
      const handoff = result.text;
      try {
        const text = await this.complete({
          tier: "writer", purpose: "chat_wording", maxTokens: 1600, system: WRITER_SYSTEM,
          prompt: JSON.stringify({
            user_request: req.history.filter(t => t.role === "user").slice(-1)[0]?.content,
            decision_handoff: handoff,
            // No full history, memory catalog or tool schemas are sent to Luna.
            execution_receipts: result.toolCalls.map(t => ({ name: t.name, error: t.error, result: t.result })),
          }),
        });
        if (text.trim()) result.text = text.trim();
      } catch {
        // Wording failure must not replay mutations or hide completed work.
        result.text = handoff;
      }
    }
    if(req.directReply){
      const notes=[result.toolCalls.some(t=>t.error)?'Some actions failed.':null,result.toolCalls.some(t=>(t.result as any)?.status==='pending_approval')?'Approval is still required.':null].filter(Boolean).join(' ');
      const limited=boundChatReply(result.text,notes?165:180,notes?1450:1600);
      result.text=limited+(limited!==result.text.trim()&&notes?'\n'+notes:'');
    }
    result.metrics=metrics;
    return result;
  }

  async research(req: { purpose: string; system: string; prompt: string; maxSearches: number; maxTokens?: number }) {
    const model = modelRoute(this.env, req.purpose, "brain").model;
    // max_tool_calls caps paid web searches; the API accepts it though this SDK version doesn't type it.
    const params = {
      model,
      instructions: req.system,
      input: req.prompt,
      tools: [{ type: "web_search" }],
      max_tool_calls: Math.max(1, req.maxSearches),
      max_output_tokens: req.maxTokens ?? 4000,
      reasoning: { effort: "low" },
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
      model: modelRoute(this.env, "background_research", "brain").model,
      instructions: req.system,
      input: req.prompt,
      ...(req.maxSearches ? { tools: [{ type: "web_search" }], max_tool_calls: Math.max(1, req.maxSearches) } : {}),
      max_output_tokens: req.maxTokens ?? 4000,
      reasoning: { effort: "low" }, // research is search-and-summarize: long deliberation only makes it slow
      background: true,
    } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
    const r = await this.client.responses.create(params);
    return r.id;
  }

  /** Check a background job: still working, failed, or done with its text, search count and sources. */
  async checkBackground(id: string, purpose: string) {
    const r = await this.client.responses.retrieve(id);
    const status = (r as unknown as { status: string }).status;
    if (status === "queued" || status === "in_progress") return { done: false as const, status };
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
    const route = modelRoute(this.env, req.purpose, req.tier);
    if (route.role === "brain") {
      const response = await this.respond({
        model: route.model, instructions: req.system, input: req.prompt,
        reasoning: { effort: route.effort },
        // The token allowance includes reasoning as well as the requested JSON/text.
        max_output_tokens: Math.max(2048, (req.maxTokens ?? 2048) + 1024),
        prompt_cache_key: `cos:${req.purpose}`,
      });
      await this.logResponse(route.model, req.purpose, response);
      if (response.status !== "completed" || !response.output_text?.trim()) throw new Error("The decision could not finish. No classification was applied.");
      return response.output_text.trim();
    }
    const response = await this.client.chat.completions.create({
      model: route.model,
      messages: [{ role: "developer", content: req.system }, { role: "user", content: req.prompt }],
      reasoning_effort: route.effort,
      max_completion_tokens: req.maxTokens ?? 2048,
    });
    await this.logUsage(route.model, req.purpose, response.usage);
    return response.choices[0]?.message?.content?.trim() ?? "";
  }
}

/** Merge consecutive same-role turns and start with a user turn. */
function normaliseHistory(history: Turn[]): Turn[] {
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

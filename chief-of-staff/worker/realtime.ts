/**
 * Live voice via OpenAI Realtime (WebRTC). The Worker mints a short-lived client secret
 * with the assistant's instructions, context and tools baked in; the browser streams audio
 * straight to OpenAI. Tool calls come back through /api/realtime/tool so they run here,
 * against the same data and approval rules as text chat, and transcripts are written to
 * the shared conversation.
 */
import OpenAI from "openai";
import type { ActionNote } from "../shared/types";
import type { Env } from "./env";
import { assistantTools, buildContext, resolveConversation, SYSTEM_PROMPT, titleConversation } from "./assistant";
import { getProvider, ProviderUnavailable } from "./ai";
import { HttpError, getSettings, now, run, uid } from "./db";

export const REALTIME_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

export async function createRealtimeSession(env: Env) {
  if (!env.OPENAI_API_KEY) throw new ProviderUnavailable("Set the OPENAI_API_KEY secret to use live voice.");
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || undefined });
  const settings = await getSettings(env);
  const tools = [{ type: 'function' as const, name: 'consult_chief',
    description: 'Ask the Chief of Staff brain to interpret a request, consult personal context, decide what matters, or perform actions. Include the user’s exact request and relevant conversational context.',
    parameters: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'] },
  }];
  const model = env.REALTIME_MODEL || "gpt-realtime-2.1-mini";
  const secret = await client.realtime.clientSecrets.create({
    expires_after: { anchor: "created_at", seconds: 120 },
    session: {
      type: "realtime",
      model,
      instructions: `You are the spoken interface to Chief of Staff. Speak warmly and briefly in the user's language. For any personal question, classification, prioritization, reminder, planning, advice or action, call consult_chief with the user's request and relevant conversational context. The brain owns all decisions and actions; relay its answer faithfully without adding conclusions. Never claim an action succeeded unless the brain confirms it, and preserve pending approvals. Small talk and reading an answer aloud need no tool. Do not call again for the same request merely to rephrase the answer.`,
      tools,
      audio: {
        input: { transcription: { model: env.REALTIME_TRANSCRIBE_MODEL || "gpt-transcribe" } },
        output: { voice: REALTIME_VOICES.includes(settings.voice_name) ? settings.voice_name : "marin" },
      },
    },
  });
  return { client_secret: secret.value, expires_at: secret.expires_at, model };
}

export async function runRealtimeTool(env: Env, name: string, args: string) {
  const notes: ActionNote[] = [];
  if (name !== 'consult_chief') throw new HttpError(400, 'Reconnect live voice to use the Chief of Staff brain.');
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(args || "{}");
  } catch {
    return { output: { error: "arguments were not valid JSON" }, actions: notes };
  }
  const request = typeof input.request === 'string' ? input.request.trim() : '';
  if (!request || request.length > 12000) return { output: { error: 'Supply the user request, up to 12000 characters.' }, actions: notes };
  try {
    const result = await getProvider(env).runAgent({
      tier: 'brain', purpose: 'voice_decision', system: SYSTEM_PROMPT,
      context: await buildContext(env, 'voice'), history: [{ role: 'user', content: request }],
      tools: assistantTools(env, 'voice', notes), cacheKey: 'cos-voice-brain',
    });
    return { output: { answer: result.text }, actions: notes };
  } catch (e) {
    return { output: { error: e instanceof Error ? e.message : String(e) }, actions: notes };
  }
}

export async function logRealtimeMessage(env: Env, role: string, content: string, actions: ActionNote[] = [], conversationId?: string | null) {
  if (role !== "user" && role !== "assistant") throw new HttpError(400, "bad role");
  const text = content.trim();
  if (!text) return { ok: true, conversation_id: conversationId ?? null };
  const convo = await resolveConversation(env, conversationId);
  const t = now();
  await run(env, "INSERT INTO messages (id, role, content, mode, meta, created_at, conversation_id) VALUES (?, ?, ?, 'voice', ?, ?, ?)",
    uid(), role, text.slice(0, 20000), actions.length ? JSON.stringify(actions) : null, t, convo.id);
  await run(env, "UPDATE conversations SET last_message_at = ? WHERE id = ?", t, convo.id);
  if (!convo.title && role === "user") await titleConversation(env, convo, text);
  return { ok: true, conversation_id: convo.id };
}

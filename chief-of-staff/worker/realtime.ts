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
import { ProviderUnavailable } from "./ai";
import { HttpError, getSettings, now, run, uid } from "./db";

export const REALTIME_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

export async function createRealtimeSession(env: Env) {
  if (!env.OPENAI_API_KEY) throw new ProviderUnavailable("Set the OPENAI_API_KEY secret to use live voice.");
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || undefined });
  const settings = await getSettings(env);
  const tools = assistantTools(env, "voice", []).map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
  const model = env.REALTIME_MODEL || "gpt-realtime-2.1-mini";
  const secret = await client.realtime.clientSecrets.create({
    expires_after: { anchor: "created_at", seconds: 120 },
    session: {
      type: "realtime",
      model,
      instructions: `${SYSTEM_PROMPT}\n\n${await buildContext(env, "voice")}`,
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
  const tool = assistantTools(env, "voice", notes).find((t) => t.name === name);
  if (!tool) throw new HttpError(400, `unknown tool ${name}`);
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(args || "{}");
  } catch {
    return { output: { error: "arguments were not valid JSON" }, actions: notes };
  }
  try {
    return { output: (await tool.handler(input)) ?? { ok: true }, actions: notes };
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

import type { Env } from "./env";

/** Audio in, text out: Groq (Whisper, very fast) when its key is set, otherwise OpenAI; OpenAI again if Groq fails. */
export async function transcribeAudio(env: Env, audio: Blob, name = "dictation.webm") {
  const groq = !!env.GROQ_API_KEY;
  const send = (useGroq: boolean) => {
    const form = new FormData();
    form.append("file", audio, name);
    form.append("model", useGroq ? "whisper-large-v3-turbo" : env.TRANSCRIBE_MODEL || "gpt-transcribe");
    return fetch(useGroq ? "https://api.groq.com/openai/v1/audio/transcriptions" : `${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/audio/transcriptions`, {
      method: "POST", headers: { authorization: `Bearer ${useGroq ? env.GROQ_API_KEY : env.OPENAI_API_KEY}` }, body: form,
    });
  };
  let r = await send(groq);
  if (!r.ok && groq && env.OPENAI_API_KEY) r = await send(false);
  if (!r.ok) throw new Error(`transcription failed (${r.status})`);
  return { text: ((await r.json()) as { text: string }).text, via: groq && r.url.includes("groq") ? "groq" : "openai" };
}

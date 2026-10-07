/**
 * Browser side of live voice: a WebRTC call to OpenAI Realtime (gpt-realtime-2.1-mini).
 * The ephemeral key comes from our Worker; tool calls are executed by the Worker; transcripts
 * are written back so voice shares one conversation with text.
 */
import type { ActionNote } from "../shared/types";
import { getToken } from "./api";
import { meter, type Meter } from "./audioLevel";
import { holdAudioFocus } from "./audioFocus";

export type LiveStatus = "connecting" | "listening" | "thinking" | "speaking" | "ended";

export interface LiveCallbacks {
  /** Conversation the voice transcript belongs to; null starts a new one. */
  getConversation: () => string | null;
  onConversation: (id: string) => void;
  onStatus: (s: LiveStatus) => void;
  onTranscript: (role: "user" | "assistant", text: string) => void;
  onActions: (actions: ActionNote[]) => void;
  onError: (msg: string) => void;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { authorization: `Bearer ${getToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
  return data as T;
}

export async function startLiveCall(cb: LiveCallbacks): Promise<{ hangUp: () => void; setMuted: (m: boolean) => void; levels: () => { input: number; output: number } }> {
  cb.onStatus("connecting");
  const release = holdAudioFocus();
  let client_secret: string;
  try { ({ client_secret } = await post<{ client_secret: string }>("/api/realtime/session", {})); } catch (e) { release(); throw e; }

  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  let outMeter: Meter | null = null;
  pc.ontrack = (e) => { audio.srcObject = e.streams[0]; outMeter?.close(); outMeter = meter(e.streams[0]); };

  let mic: MediaStream;
  try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { pc.close(); release(); throw e; }
  mic.getTracks().forEach((t) => pc.addTrack(t, mic));
  const inMeter = meter(mic);

  const dc = pc.createDataChannel("oai-events");
  const send = (event: unknown) => dc.readyState === "open" && dc.send(JSON.stringify(event));
  let pendingActions: ActionNote[] = [];
  let responseActive = false, pendingCalls = 0, haveToolOutputs = false;
  const maybeContinue = () => {
    if (responseActive || pendingCalls > 0 || !haveToolOutputs) return;
    haveToolOutputs = false;
    responseActive = true;
    send({ type: "response.create" });
  };
  const log = (role: string, content: string, actions: ActionNote[] = []) =>
    post<{ conversation_id: string | null }>("/api/realtime/log", { role, content, actions, conversation_id: cb.getConversation() })
      .then((r) => { if (r.conversation_id) cb.onConversation(r.conversation_id); })
      .catch(() => {});

  dc.onmessage = async (msg) => {
    const ev = JSON.parse(msg.data);
    switch (ev.type) {
      case "input_audio_buffer.speech_started":
        cb.onStatus("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        cb.onStatus("thinking");
        break;
      case "output_audio_buffer.started":
        cb.onStatus("speaking");
        break;
      case "output_audio_buffer.stopped":
        cb.onStatus("listening");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript?.trim()) {
          cb.onTranscript("user", ev.transcript.trim());
          await log("user", ev.transcript);
        }
        break;
      case "response.output_audio_transcript.done":
        if (ev.transcript?.trim()) {
          cb.onTranscript("assistant", ev.transcript.trim());
          await log("assistant", ev.transcript, pendingActions);
          pendingActions = [];
        }
        break;
      case "response.created":
        responseActive = true;
        break;
      case "response.function_call_arguments.done": {
        // A response can contain several tool calls. Run them all, then ask for ONE follow-up
        // response once the current response has finished (asking earlier is rejected).
        cb.onStatus("thinking");
        pendingCalls++;
        let output: unknown;
        try {
          const res = await post<{ output: unknown; actions: ActionNote[] }>("/api/realtime/tool", { name: ev.name, arguments: ev.arguments });
          output = res.output;
          if (res.actions.length) { pendingActions.push(...res.actions); cb.onActions(res.actions); }
        } catch (e) {
          output = { error: (e as Error).message };
        }
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(output) } });
        pendingCalls--;
        haveToolOutputs = true;
        maybeContinue();
        break;
      }
      case "response.done":
        responseActive = false;
        maybeContinue();
        break;
      case "error":
        cb.onError(ev.error?.message ?? "Voice error");
        break;
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: { authorization: `Bearer ${client_secret}`, "content-type": "application/sdp" },
  });
  if (!answer.ok) {
    hangUpAll();
    throw new Error(`Couldn't connect live voice (${answer.status})`);
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
  cb.onStatus("listening");

  function hangUpAll() {
    try { dc.close(); } catch { /* noop */ }
    pc.getSenders().forEach((s) => s.track?.stop());
    mic.getTracks().forEach((t) => t.stop());
    pc.close();
    audio.srcObject = null;
    release();
  }

  return {
    setMuted: (m: boolean) => mic.getAudioTracks().forEach((t) => { t.enabled = !m; }),
    hangUp: () => { inMeter.close(); outMeter?.close(); hangUpAll(); cb.onStatus("ended"); },
    levels: () => ({ input: inMeter.level(), output: outMeter?.level() ?? 0 }),
  };
}

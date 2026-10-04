/**
 * Browser side of live voice: a WebRTC call to OpenAI Realtime (gpt-realtime-2.1-mini).
 * The ephemeral key comes from our Worker; tool calls are executed by the Worker; transcripts
 * are written back so voice shares one conversation with text.
 */
import type { ActionNote } from "../shared/types";
import { getToken } from "./api";

export type LiveStatus = "connecting" | "listening" | "thinking" | "speaking" | "ended";

export interface LiveCallbacks {
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

export async function startLiveCall(cb: LiveCallbacks): Promise<{ hangUp: () => void }> {
  cb.onStatus("connecting");
  const { client_secret } = await post<{ client_secret: string }>("/api/realtime/session", {});

  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => { audio.srcObject = e.streams[0]; };

  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  mic.getTracks().forEach((t) => pc.addTrack(t, mic));

  const dc = pc.createDataChannel("oai-events");
  const send = (event: unknown) => dc.readyState === "open" && dc.send(JSON.stringify(event));
  let pendingActions: ActionNote[] = [];

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
          post("/api/realtime/log", { role: "user", content: ev.transcript }).catch(() => {});
        }
        break;
      case "response.output_audio_transcript.done":
        if (ev.transcript?.trim()) {
          cb.onTranscript("assistant", ev.transcript.trim());
          post("/api/realtime/log", { role: "assistant", content: ev.transcript, actions: pendingActions }).catch(() => {});
          pendingActions = [];
        }
        break;
      case "response.function_call_arguments.done": {
        cb.onStatus("thinking");
        let output: unknown;
        try {
          const res = await post<{ output: unknown; actions: ActionNote[] }>("/api/realtime/tool", { name: ev.name, arguments: ev.arguments });
          output = res.output;
          if (res.actions.length) { pendingActions.push(...res.actions); cb.onActions(res.actions); }
        } catch (e) {
          output = { error: (e as Error).message };
        }
        send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(output) } });
        send({ type: "response.create" });
        break;
      }
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
  }

  return {
    hangUp: () => { hangUpAll(); cb.onStatus("ended"); },
  };
}

import { meter } from "./audioLevel";
import { holdAudioFocus } from "./audioFocus";
/**
 * Dictation helpers. Dictation records audio and sends it to the Worker for transcription
 * (OpenAI gpt-transcribe), falling back to on-device recognition when that isn't configured.
 * Live voice lives in realtime.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any;

export function speechRecognitionAvailable(): boolean {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function createRecognizer(opts: {
  continuous: boolean;
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd?: () => void;
  onError?: (err: string) => void;
}): SR | null {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec: SR = new Ctor();
  rec.lang = navigator.language || "en-US";
  rec.continuous = opts.continuous;
  rec.interimResults = true;
  rec.onresult = (e: any) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) opts.onFinal(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    if (interim) opts.onInterim?.(interim);
  };
  rec.onerror = (e: any) => opts.onError?.(e.error ?? "speech error");
  rec.onend = () => opts.onEnd?.();
  return rec;
}

export async function startRecording(): Promise<{ stop: () => Promise<Blob>; level: () => number }> {
  const release = holdAudioFocus(); // pause the user's music while they speak
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { release(); throw e; }
  const m = meter(stream);
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    level: m.level,
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          m.close();
          stream.getTracks().forEach((t) => t.stop());
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        rec.stop();
      }),
  };
}

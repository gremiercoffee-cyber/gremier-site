/**
 * Voice helpers. Live voice uses the browser's on-device speech recognition and
 * synthesis (no audio leaves the device, no per-minute cost). Batch dictation records
 * audio and sends it to the Worker for transcription, falling back to on-device
 * recognition when server transcription is not configured.
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

/** Strip markdown so replies read naturally aloud. */
function speakable(text: string) {
  return text.replace(/[*_`#>]/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1").replace(/^\s*[-•]\s*/gm, "");
}

export function speak(text: string, voiceName?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(text));
    const voice = window.speechSynthesis.getVoices().find((v) => v.name === voiceName);
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export async function startRecording(): Promise<{ stop: () => Promise<Blob> }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        rec.stop();
      }),
  };
}

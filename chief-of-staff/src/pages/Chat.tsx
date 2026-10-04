import { useEffect, useRef, useState } from "react";
import type { ActionNote, Message } from "../../shared/types";
import { api } from "../api";
import { Button, DictateButton, Markdown, MicIcon } from "../components/ui";
import { createRecognizer, speak, speechRecognitionAvailable, stopSpeaking } from "../voice";

type LiveState = "off" | "listening" | "thinking" | "speaking";

export default function Chat({ initialPrompt, startVoice, voiceName, serverTranscription, onDataChanged }: {
  initialPrompt?: string; startVoice?: boolean; voiceName: string; serverTranscription: boolean; onDataChanged: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<LiveState>("off");
  const [interim, setInterim] = useState("");
  const liveRef = useRef<LiveState>("off");
  const recRef = useRef<{ start: () => void; stop: () => void; abort: () => void } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.messages().then(setMessages).catch((e) => setError(e.message)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, interim, sending]);
  useEffect(() => () => stopLive(), []);
  useEffect(() => { if (startVoice) startLive(); }, [startVoice]);

  const setLiveState = (s: LiveState) => { liveRef.current = s; setLive(s); };
  // Read through a function so TypeScript doesn't narrow the ref across awaits.
  const liveNow = (): LiveState => liveRef.current;

  async function send(text: string, mode: "text" | "voice" | "dictation" = "text") {
    const t = text.trim();
    if (!t) return null;
    setError("");
    setSending(true);
    const optimistic: Message = { id: `tmp-${Date.now()}`, role: "user", content: t, mode, meta: null, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api.chat(t, mode);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), res.user, res.reply]);
      if (res.actions.length) onDataChanged();
      return res.reply.content;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setSending(false);
    }
  }

  // ---- Live voice: listen → send → speak → listen again ----
  function listen() {
    const rec = createRecognizer({
      continuous: false,
      onInterim: setInterim,
      onFinal: async (text) => {
        setInterim("");
        if (!text || liveRef.current !== "listening") return;
        setLiveState("thinking");
        const reply = await send(text, "voice");
        if (liveNow() === "off") return;
        if (reply) {
          setLiveState("speaking");
          await speak(reply, voiceName);
        }
        if (liveNow() !== "off") { setLiveState("listening"); listen(); }
      },
      onEnd: () => {
        // Recognition stops after silence; keep listening while in listening state.
        if (liveRef.current === "listening") setTimeout(() => liveRef.current === "listening" && listen(), 250);
      },
      onError: (err) => {
        if (err === "not-allowed") { setError("Microphone permission denied."); stopLive(); }
      },
    });
    recRef.current = rec;
    try { rec?.start(); } catch { /* already started */ }
  }

  function startLive() {
    if (!speechRecognitionAvailable()) {
      setError("Live voice needs a browser with speech recognition (Chrome, Edge or Safari).");
      return;
    }
    setLiveState("listening");
    listen();
  }

  function stopLive() {
    liveRef.current = "off";
    setLive("off");
    setInterim("");
    try { recRef.current?.abort(); } catch { /* noop */ }
    stopSpeaking();
  }

  const liveLabel = { off: "", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" }[live];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pb-4">
        {messages.length === 0 && !sending && (
          <div className="text-center text-muted text-sm pt-16 space-y-2">
            <p className="text-ink font-medium text-base">What's on your mind?</p>
            <p>Tell me what you need to do, who you're waiting on, or ask what to focus on.</p>
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        {interim && <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-accent/30 italic">{interim}</div></div>}
        {sending && <div className="text-muted text-sm px-1 flex gap-1 items-center"><Dots /> </div>}
        {error && <p className="text-danger text-sm">{error}</p>}
        <div ref={endRef} />
      </div>

      {live !== "off" ? (
        <div className="rounded-2xl bg-surface border border-line p-4 flex items-center gap-4">
          <div className="relative h-12 w-12 shrink-0">
            {live === "listening" && <span className="pulse-ring absolute inset-0" />}
            <div className="relative h-12 w-12 rounded-full bg-accent text-accent-ink grid place-items-center"><MicIcon className="h-5 w-5" /></div>
          </div>
          <div className="flex-1">
            <p className="font-medium">{liveLabel}</p>
            <p className="text-xs text-muted">Live conversation — just talk.</p>
          </div>
          {live === "speaking" && <Button variant="soft" onClick={() => { stopSpeaking(); }}>Skip</Button>}
          <Button variant="soft" onClick={stopLive}>End</Button>
        </div>
      ) : (
        <form className="rounded-2xl bg-surface border border-line p-2" onSubmit={(e) => { e.preventDefault(); const t = input; setInput(""); send(t); }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); const t = input; setInput(""); send(t); }
            }}
            rows={Math.min(5, Math.max(1, input.split("\n").length))}
            placeholder="Message your Chief of Staff"
            className="w-full resize-none bg-transparent px-2 py-1.5 outline-none text-[15px]"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <DictateButton serverTranscription={serverTranscription} onText={(t) => setInput((v) => (v ? v + " " : "") + t)} />
              <Button variant="soft" onClick={startLive} title="Live voice conversation">Talk</Button>
            </div>
            <Button type="submit" disabled={!input.trim() || sending}>Send</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const mine = m.role === "user";
  const actions: ActionNote[] = m.meta ? safeParse(m.meta) : [];
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[88%] space-y-1.5">
        <div className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${mine ? "bg-accent text-accent-ink rounded-br-md" : "bg-surface border border-line rounded-bl-md"}`}>
          {mine ? <p className="whitespace-pre-wrap">{m.content}</p> : <Markdown text={m.content} />}
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a, i) => (
              <span key={i} className="text-xs rounded-full bg-sunken text-muted px-2.5 py-1">✓ {a.summary}</span>
            ))}
          </div>
        )}
        {m.mode !== "text" && <p className={`text-[10px] text-muted ${mine ? "text-right" : ""}`}>{m.mode}</p>}
      </div>
    </div>
  );
}

function safeParse(s: string) { try { return JSON.parse(s); } catch { return []; } }

const Dots = () => (
  <span className="inline-flex gap-1 px-4 py-3 rounded-2xl bg-surface border border-line">
    {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}
  </span>
);

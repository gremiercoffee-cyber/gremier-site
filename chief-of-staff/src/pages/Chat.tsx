import { useEffect, useRef, useState } from "react";
import type { ActionNote, Message } from "../../shared/types";
import { api } from "../api";
import { Button, DictateButton, Markdown, MicIcon } from "../components/ui";
import { startLiveCall, type LiveStatus } from "../realtime";

type LiveState = "off" | LiveStatus;

export default function Chat({ initialPrompt, startVoice, serverTranscription, onDataChanged }: {
  initialPrompt?: string; startVoice?: boolean; serverTranscription: boolean; onDataChanged: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<LiveState>("off");
  const callRef = useRef<{ hangUp: () => void } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.messages().then(setMessages).catch((e) => setError(e.message)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  useEffect(() => () => callRef.current?.hangUp(), []);
  useEffect(() => { if (startVoice) startLive(); }, [startVoice]);

  async function send(text: string) {
    const t = text.trim();
    if (!t) return;
    setError("");
    setSending(true);
    const optimistic: Message = { id: `tmp-${Date.now()}`, role: "user", content: t, mode: "text", meta: null, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api.chat(t, "text");
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), res.user, res.reply]);
      if (res.actions.length) onDataChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  // ---- Live voice: OpenAI Realtime over WebRTC ----
  async function startLive() {
    if (callRef.current) return;
    setError("");
    try {
      callRef.current = await startLiveCall({
        onStatus: (s) => setLive(s === "ended" ? "off" : s),
        onTranscript: (role, content) =>
          setMessages((m) => [...m, { id: `live-${Date.now()}-${role}`, role, content, mode: "voice", meta: null, created_at: new Date().toISOString() }]),
        onActions: (actions) => {
          onDataChanged();
          setMessages((m) => [...m, { id: `act-${Date.now()}`, role: "assistant", content: "", mode: "voice", meta: JSON.stringify(actions), created_at: new Date().toISOString() }]);
        },
        onError: setError,
      });
    } catch (e) {
      setError((e as Error).message.includes("Permission") ? "Microphone permission denied." : (e as Error).message);
      callRef.current = null;
      setLive("off");
    }
  }

  function stopLive() {
    callRef.current?.hangUp();
    callRef.current = null;
    setLive("off");
  }

  const LIVE_LABELS: Record<LiveState, string> = { off: "", connecting: "Connecting…", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…", ended: "" };
  const liveLabel = LIVE_LABELS[live];

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
            <p className="text-xs text-muted">Live conversation — just talk. You can interrupt any time.</p>
          </div>
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
        {m.content && <div className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${mine ? "bg-accent text-accent-ink rounded-br-md" : "bg-surface border border-line rounded-bl-md"}`}>
          {mine ? <p className="whitespace-pre-wrap">{m.content}</p> : <Markdown text={m.content} />}
        </div>}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {actions.map((a, i) => (
              <span key={i} className="text-xs rounded-full bg-sunken text-muted px-2.5 py-1">✓ {a.summary}</span>
            ))}
          </div>
        )}
        {m.mode !== "text" && m.content && <p className={`text-[10px] text-muted ${mine ? "text-right" : ""}`}>{m.mode}</p>}
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

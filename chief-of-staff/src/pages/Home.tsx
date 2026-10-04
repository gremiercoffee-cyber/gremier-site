import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionNote, Dashboard, Message, Nudge } from "../../shared/types";
import { api } from "../api";
import { DictateButton, Markdown, MicIcon, timeAgo } from "../components/ui";
import { startLiveCall, type LiveStatus } from "../realtime";

type LiveState = "off" | LiveStatus;

/**
 * The main screen: your Chief of Staff. With no conversation open it is a calm "I'm here" presence
 * with whatever needs you; once you talk or type it becomes the conversation.
 */
export default function Home({ name, conversationId, onConversation, initialAsk, startVoice, startTyping, draft, onDraftUsed, serverTranscription, onDataChanged, refreshKey }: {
  name: string;
  conversationId: string | null;
  onConversation: (id: string | null) => void;
  initialAsk?: string;
  startVoice?: boolean;
  startTyping?: boolean;
  draft?: string;
  onDraftUsed?: () => void;
  serverTranscription: boolean;
  onDataChanged: () => void;
  refreshKey: number;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(!!startTyping);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState<LiveState>("off");
  const [dash, setDash] = useState<Dashboard | null>(null);
  const callRef = useRef<{ hangUp: () => void } | null>(null);
  const convoRef = useRef<string | null>(conversationId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    convoRef.current = conversationId;
    if (!conversationId) { setMessages([]); return; }
    api.conversationMessages(conversationId).then(setMessages).catch((e) => setError(e.message));
  }, [conversationId]);
  useEffect(() => { api.dashboard().then(setDash).catch(() => {}); }, [refreshKey]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  useEffect(() => () => callRef.current?.hangUp(), []);
  useEffect(() => { if (startVoice) startLive(); }, [startVoice]);
  useEffect(() => { if (initialAsk) send(initialAsk); }, [initialAsk]);
  useEffect(() => { if (draft) { setTyping(true); setInput(draft); onDraftUsed?.(); } }, [draft]);

  async function send(text: string, mode: "text" | "dictation" = "text") {
    const t = text.trim();
    if (!t) return;
    setError("");
    setSending(true);
    const optimistic: Message = { id: `tmp-${Date.now()}`, role: "user", content: t, mode, meta: null, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api.chat(t, mode, convoRef.current);
      if (res.conversation.id !== convoRef.current) {
        // New or switched topic: show just this exchange in the fresh conversation.
        convoRef.current = res.conversation.id;
        onConversation(res.conversation.id);
        setMessages([res.user, res.reply]);
      } else {
        setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), res.user, res.reply]);
      }
      if (res.actions.length) onDataChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function startLive() {
    if (callRef.current) return;
    setError("");
    try {
      callRef.current = await startLiveCall({
        getConversation: () => convoRef.current,
        onConversation: (id) => { if (id !== convoRef.current) { convoRef.current = id; onConversation(id); } },
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
  function stopLive() { callRef.current?.hangUp(); callRef.current = null; setLive("off"); }

  const act = async (n: Nudge, action: string) => {
    const r = await api.actNudge(n.id, action);
    if (r.open?.includes("reschedule=1") && n.item_id) {
      window.dispatchEvent(new CustomEvent("cos:reschedule", { detail: n.item_id }));
    } else if (r.open) {
      const ask = new URLSearchParams(r.open.split("?")[1] ?? "").get("ask");
      if (ask) { onConversation(null); convoRef.current = null; setMessages([]); send(ask); }
    }
    api.dashboard().then(setDash).catch(() => {});
    onDataChanged();
  };

  const inConversation = messages.length > 0 || sending;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pb-4">
        {!inConversation ? (
          <Presence greeting={`${greeting}${name ? `, ${name}` : ""}.`} live={live} dash={dash} onAct={act}
            onNudge={(ask) => { onConversation(null); convoRef.current = null; setMessages([]); send(ask); }}
            onChanged={() => { api.dashboard().then(setDash).catch(() => {}); onDataChanged(); }}
            onReply={(n) => { onConversation(null); convoRef.current = null; setTyping(true); setInput(`About "${n.title}": `); }} />
        ) : (
          <div className="space-y-3 pt-2">
            {messages.map((m) => <Bubble key={m.id} m={m} />)}
            {sending && <Thinking />}
          </div>
        )}
        {error && <p className="text-danger text-sm mt-2">{error}</p>}
        <div ref={endRef} />
      </div>

      <Composer
        live={live} typing={typing} setTyping={setTyping} input={input} setInput={setInput} sending={sending}
        serverTranscription={serverTranscription} onSend={(t, mode) => { setInput(""); send(t, mode); }}
        onTalk={startLive} onEnd={stopLive}
      />
    </div>
  );
}

function Presence({ greeting, live, dash, onAct, onReply, onNudge, onChanged }: {
  greeting: string; live: LiveState; dash: Dashboard | null;
  onAct: (n: Nudge, a: string) => void; onReply: (n: Nudge) => void; onNudge: (ask: string) => void; onChanged: () => void;
}) {
  const next = dash?.events.find((e) => !e.all_day && new Date(e.start_at).getTime() > Date.now());
  const overdue = dash?.overdue.length ?? 0;
  const waiting = dash?.waiting.length ?? 0;
  const lines = [
    next && `Next up: ${next.summary} at ${new Date(next.start_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
    overdue > 0 && `${overdue} thing${overdue > 1 ? "s are" : " is"} overdue.`,

  ].filter(Boolean) as string[];
  const nudges = (dash?.nudges ?? []).filter((n) => n.type !== "briefing").slice(0, 6);
  const briefing = dash?.nudges.find((n) => n.type === "briefing");

  return (
    <div className="pt-6 space-y-6">
      <div className="flex flex-col items-center text-center gap-4">
        <Orb state={live} />
        <div>
          <h1 className="font-display text-[34px] leading-tight">{greeting}</h1>
          <p className="text-muted mt-1">{live === "off" ? "I'm here. Tell me what's going on." : "I'm listening."}</p>
        </div>
      </div>

      {(dash?.waiting ?? []).slice(0, 4).map((w) => (
        <FromCos key={w.id}>
          <p>Waiting on <span className="font-medium">{w.person ?? "someone"}</span>: {w.title}</p>
          <p className="text-xs text-muted mt-0.5">{timeAgo(w.created_at)}</p>
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {[["done", "Got it ✓"], ["nudge", "Nudge them"], ["dropped", "Not needed"]].map(([a, label]) => (
              <button key={a} onClick={async () => {
                if (a === "nudge") { onNudge(`Draft a friendly follow-up to ${w.person ?? "them"} about: ${w.title}`); return; }
                await api.updateItem(w.id, { status: a as "done" | "dropped" });
                onChanged();
              }} className="rounded-full border border-line bg-bg px-3 py-1.5 text-[13px] font-medium hover:border-accent">{label}</button>
            ))}
          </div>
        </FromCos>
      ))}
      {lines.length > 0 && (
        <FromCos>
          <p>{lines.join(" ")}</p>
        </FromCos>
      )}
      {briefing && (
        <FromCos time={briefing.created_at}>
          <p className="whitespace-pre-line">{briefing.body}</p>
          <Chips n={briefing} onAct={onAct} />
        </FromCos>
      )}
      {nudges.map((n) => (
        <FromCos key={n.id} time={n.created_at}>
          <p className="font-medium">{n.title}</p>
          {n.body && <p className="text-muted mt-0.5">{n.body}</p>}
          <Chips n={n} onAct={onAct} onReply={() => onReply(n)} />
        </FromCos>
      ))}
    </div>
  );
}

function Chips({ n, onAct, onReply }: { n: Nudge; onAct: (n: Nudge, a: string) => void; onReply?: () => void }) {
  const [busy, setBusy] = useState("");
  return (
    <div className="flex flex-wrap gap-1.5 mt-2.5">
      {(n.actions ?? []).map((a) => (
        <button key={a.id} disabled={!!busy} onClick={async () => { setBusy(a.id); await onAct(n, a.id); setBusy(""); }}
          className="rounded-full border border-line bg-bg px-3 py-1.5 text-[13px] font-medium hover:border-accent disabled:opacity-50 transition">
          {busy === a.id ? "…" : a.title}
        </button>
      ))}
      {onReply && (
        <button onClick={onReply} className="rounded-full px-3 py-1.5 text-[13px] text-muted hover:text-ink">Reply</button>
      )}
    </div>
  );
}

function FromCos({ children, time }: { children: ReactNode; time?: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <span className="mt-1 h-7 w-7 shrink-0 rounded-full bg-ink text-bg inline-flex items-center justify-center font-display text-[14px] leading-none">C<span className="text-accent">s</span></span>
      <div className="flex-1 min-w-0 rounded-2xl rounded-tl-md bg-surface border border-line/70 shadow-card px-4 py-3 text-[15px] leading-relaxed">
        {children}
        {time && <p className="text-[11px] text-muted mt-1.5">{timeAgo(time)}</p>}
      </div>
    </div>
  );
}

function Orb({ state }: { state: LiveState }) {
  const active = state !== "off";
  return (
    <div className="relative h-28 w-28">
      <div className={`absolute inset-0 rounded-full orb ${active ? "orb-live" : ""}`} />
      {state === "listening" && <span className="pulse-ring absolute inset-2" />}
      <div className="absolute left-[22%] top-[16%] h-[30%] w-[38%] rounded-full bg-white/35 blur-md" />
    </div>
  );
}

function Composer({ live, typing, setTyping, input, setInput, sending, serverTranscription, onSend, onTalk, onEnd }: {
  live: LiveState; typing: boolean; setTyping: (b: boolean) => void; input: string; setInput: (s: string | ((v: string) => string)) => void;
  sending: boolean; serverTranscription: boolean; onSend: (t: string, mode: "text" | "dictation") => void; onTalk: () => void; onEnd: () => void;
}) {
  const LABELS: Record<LiveState, string> = { off: "", connecting: "Connecting…", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…", ended: "" };
  if (live !== "off") {
    return (
      <div className="pb-2 flex flex-col items-center gap-3">
        <p className="text-sm text-muted">{LABELS[live]} You can interrupt any time.</p>
        <button onClick={onEnd} className="h-16 px-10 rounded-full bg-danger text-white font-medium text-[17px] shadow-card">End conversation</button>
      </div>
    );
  }
  if (typing) {
    return (
      <form className="rounded-3xl bg-surface border border-line shadow-card p-2 mb-1"
        onSubmit={(e) => { e.preventDefault(); onSend(input, "text"); }}>
        <textarea autoFocus value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(input, "text"); } }}
          rows={Math.min(5, Math.max(1, input.split("\n").length))} placeholder="Tell me what's going on…"
          className="w-full resize-none bg-transparent px-3 py-2 outline-none text-[16px]" />
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex gap-1">
            <button type="button" onClick={onTalk} className="rounded-full bg-sunken px-3 py-2 text-sm font-medium flex items-center gap-1.5"><MicIcon /> Talk</button>
            <button type="button" onClick={() => setTyping(false)} className="rounded-full px-3 py-2 text-sm text-muted">Close</button>
          </div>
          <button type="submit" disabled={!input.trim() || sending} className="rounded-full bg-accent text-accent-ink px-5 py-2 text-sm font-medium disabled:opacity-40">Send</button>
        </div>
      </form>
    );
  }
  return (
    <div className="pb-2 flex items-center justify-center gap-5">
      <DictateButton compact serverTranscription={serverTranscription} onText={(t) => onSend(t, "dictation")} />
      <button onClick={onTalk} aria-label="Talk"
        className="h-20 w-20 rounded-full bg-accent text-accent-ink grid place-items-center shadow-card active:scale-95 transition">
        <MicIcon className="h-8 w-8" />
      </button>
      <button onClick={() => setTyping(true)} aria-label="Type" className="h-12 w-12 rounded-full bg-surface border border-line grid place-items-center text-muted">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>
      </button>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const mine = m.role === "user";
  const actions: ActionNote[] = m.meta ? safeParse(m.meta) : [];
  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent text-accent-ink px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{m.content}</div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {m.content && (
        <FromCos><Markdown text={m.content} /></FromCos>
      )}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-9">
          {actions.map((a, i) => <span key={i} className="text-xs rounded-full bg-sunken text-muted px-2.5 py-1">✓ {a.summary}</span>)}
        </div>
      )}
    </div>
  );
}

function safeParse(s: string) { try { return JSON.parse(s); } catch { return []; } }

const Thinking = () => (
  <FromCos>
    <span className="inline-flex gap-1 py-1">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}
    </span>
  </FromCos>
);

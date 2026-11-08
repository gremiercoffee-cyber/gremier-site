import HomeWork from '../components/HomeWork';
import InProgress from '../components/InProgress';
import Approvals from '../components/Approvals';
import WhatsAppsToSend from '../components/WhatsAppsToSend';
import { openTask } from '../components/TaskSheet';
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionNote, Dashboard, Message, Nudge } from "../../shared/types";
import type { FoundFile } from "../api";
import { api } from "../api";
import { DictateButton, Markdown, MicIcon, timeAgo } from "../components/ui";
import { startLiveCall, type LiveStatus } from "../realtime";
import LiveOrb from "../components/LiveOrb";
import Celebration from "../components/Celebration";
import ChatFiles from "../components/ChatFiles";
import { startRecording } from "../voice";

type LiveState = "off" | LiveStatus;

/**
 * The main screen: your Chief of Staff. With no conversation open it is a calm "I'm here" presence
 * with whatever needs you; once you talk or type it becomes the conversation.
 */
export default function Home({ name, conversationId, onConversation, initialAsk, startVoice, startTyping, draft, onDraftUsed, serverTranscription, onDataChanged, refreshKey, onOpenChat }: {
  onOpenChat: (jobId: string) => void;
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
  // Files added to the next message (📎 or paste), and the files that belong to this chat.
  const [attached, setAttached] = useState<{ id: string; filename: string; mime: string }[]>([]);
  const [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState("");
  const [chatFiles, setChatFiles] = useState<FoundFile[]>([]);
  const attachedRef = useRef(attached); attachedRef.current = attached;
  async function attach(list: File[]) {
    setTyping(true); setUploading(true); setUploadError("");
    try {
      for (const f of list.slice(0, 6)) {
        const name = f.name && f.name !== "image.png" ? f.name : `Screenshot ${new Date().toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`;
        const r = await api.uploadFile(f, name);
        setAttached((a) => [...a, { id: r.id, filename: r.filename, mime: r.mime }]);
      }
    } catch (e) { setUploadError((e as Error).message); } finally { setUploading(false); }
  }
  // Paste a screenshot (or a copied file) anywhere on this screen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => { const fs = Array.from(e.clipboardData?.files ?? []); if (fs.length) { e.preventDefault(); void attach(fs); } };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [live, setLive] = useState<LiveState>("off");
  const [dictatingNow, setDictatingNow] = useState(false);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const callRef = useRef<{ hangUp: () => void; setMuted: (m: boolean) => void; levels: () => { input: number; output: number } } | null>(null);
  const levels = useRef(() => callRef.current?.levels() ?? { input: 0, output: 0 }).current;
  const convoRef = useRef<string | null>(conversationId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    convoRef.current = conversationId;
    if (!conversationId) { setMessages([]); return; }
    api.conversationMessages(conversationId).then(setMessages).catch((e) => setError(e.message));
  }, [conversationId]);
  useEffect(() => { api.dashboard().then(setDash).catch(() => {}); }, [refreshKey]);
  useEffect(()=>{
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void api.dashboard().then(setDash).catch(()=>{});},60_000);
    return ()=>clearInterval(timer);
  },[]);
  // A project just finished: confetti once, then it's marked as celebrated.
  const [party, setParty] = useState<{ id: string; name: string; done: number } | null>(null);
  useEffect(() => {
    const list = dash?.celebrate ?? [];
    if (!list.length || party) return;
    setParty(list[0]);
    list.forEach((c) => api.projectCelebrated(c.id).catch(() => {}));
  }, [dash, party]);
  useEffect(() => { if(messages.length||sending)endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
  useEffect(() => () => callRef.current?.hangUp(), []);
  useEffect(() => { if (startVoice) startLive(); }, [startVoice]);
  useEffect(() => { if (initialAsk) send(initialAsk); }, [initialAsk]);
  useEffect(() => { if (draft) { setTyping(true); setInput(draft); onDraftUsed?.(); } }, [draft]);

  async function send(text: string, mode: "text" | "dictation" = "text") {
    const files = attachedRef.current;
    const t = text.trim() || (files.length ? "Here's a file." : "");
    if (!t) return;
    setAttached([]);
    setError("");
    setSending(true);
    const optimistic: Message = { id: `tmp-${Date.now()}`, role: "user", content: t, mode, meta: null, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await api.chat(t, mode, convoRef.current, files.map((f) => f.id));
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

  // Ending while still connecting must win: the call is hung up the moment it connects.
  const connectingRef = useRef(false);
  const cancelledRef = useRef(false);

  async function startLive() {
    if (callRef.current || connectingRef.current) return;
    setError("");
    connectingRef.current = true;
    cancelledRef.current = false;
    try {
      const call = await startLiveCall({
        getConversation: () => convoRef.current,
        onConversation: (id) => { if (id !== convoRef.current) { convoRef.current = id; onConversation(id); } },
        onStatus: (s) => { if (!cancelledRef.current) setLive(s === "ended" ? "off" : s); },
        onTranscript: (role, content) =>
          setMessages((m) => [...m, { id: `live-${Date.now()}-${role}`, role, content, mode: "voice", meta: null, created_at: new Date().toISOString() }]),
        onActions: (actions) => {
          onDataChanged();
          setMessages((m) => [...m, { id: `act-${Date.now()}`, role: "assistant", content: "", mode: "voice", meta: JSON.stringify(actions), created_at: new Date().toISOString() }]);
        },
        onError: setError,
      });
      if (cancelledRef.current) { call.hangUp(); setLive("off"); }
      else callRef.current = call;
    } catch (e) {
      if (!cancelledRef.current) setError((e as Error).message.includes("Permission") ? "Microphone permission denied." : (e as Error).message);
      callRef.current = null;
      setLive("off");
    } finally {
      connectingRef.current = false;
    }
  }
  function stopLive() {
    if (connectingRef.current) cancelledRef.current = true;
    callRef.current?.hangUp();
    callRef.current = null;
    setLive("off");
  }

  const reloadDash = () => { api.dashboard().then(setDash).catch(() => {}); onDataChanged(); };

  const inConversation = messages.length > 0 || sending;
  // Group drafts show in a chat only if this chat made one (not every pending draft in every chat).
  // Files found / signed in this chat get preview cards (only if this chat looked for or signed a file).
  const filesSince = messages.some((m) => m.meta && (safeParse(m.meta) as ActionNote[]).some?.((a) => a.tool === "find_email_files" || a.tool === "sign_document"))
    ? messages[0]?.created_at ?? null : null;
  const chatStart = messages.find((m) => !m.id.startsWith("tmp-"))?.created_at ?? null;
  const loadChatFiles = () => {
    if (!chatStart) { setChatFiles([]); return; }
    api.files(new Date(Date.parse(chatStart) - 15 * 60_000).toISOString()).then((r) => setChatFiles(r.files)).catch(() => {});
  };
  useEffect(loadChatFiles, [chatStart, messages.length, refreshKey]);
  // Each file sits under the first reply that came after it (or the last message, if it came later).
  const filesUnder = new Map<string, FoundFile[]>();
  const replies = messages.filter((m) => m.role === "assistant" && !m.id.startsWith("tmp-") && !m.id.startsWith("act-"));
  for (const f of chatFiles) {
    const at = f.created_at ?? "";
    const host = replies.find((m) => m.created_at >= at) ?? messages[messages.length - 1];
    if (host) filesUnder.set(host.id, [...(filesUnder.get(host.id) ?? []), f]);
  }
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 no-scrollbar">
        {!inConversation ? (
          <Presence greeting={`${greeting}${name ? `, ${name}` : ""}.`} live={dictatingNow ? "listening" : live} dash={dash}
            refreshKey={refreshKey} onChanged={reloadDash} onOpenChat={onOpenChat} />
        ) : (
          <div className="space-y-3 pt-2">
            {messages.map((m) => <div key={m.id}><Bubble m={m} />{filesUnder.has(m.id) && <ChatFiles files={filesUnder.get(m.id)!} onChanged={loadChatFiles} />}</div>)}
            {sending && <Thinking />}
          </div>
        )}
        {error && <p className="text-danger text-sm mt-2">{error}</p>}
        {actionMessage && <p role="status" className="text-accent text-sm mt-2">{actionMessage}</p>}
        <div ref={endRef} />
      </div>

      {party && <Celebration name={party.name} done={party.done} onClose={() => setParty(null)} />}

      <Composer
        live={live} typing={typing} setTyping={setTyping} input={input} setInput={setInput} sending={sending}
        attached={attached} uploading={uploading} uploadError={uploadError} onAttach={(fs) => void attach(fs)} onUnattach={(id) => setAttached((a) => a.filter((x) => x.id !== id))}
        serverTranscription={serverTranscription} onSend={(t, mode) => { setInput(""); send(t, mode); }}
        onTalk={startLive} onEnd={stopLive} onMute={(m) => callRef.current?.setMuted(m)} levels={levels} onDictating={setDictatingNow}
      />
    </div>
  );
}

/** What a notification is about, as an emoji, so the list reads at a glance. */
const NOTE_ICON: Record<string, string> = { overdue: "🔴", reminder: "⏰", checkin: "❓", watch: "👀", hashgacha_auto: "📚", routine: "📄", routine_alert: "📄", mission_ask: "🙋", review: "🗓️", customers: "☕", idea: "💡", tracker: "🗂️", wrapup: "🏁", project_ask: "🗂️" };
const cleanTitle = (t: string) => t.replace(/^(don't forget|coming up|still waiting|reminder|due soon|heads up|overdue)\s*:\s*/i, "");

/**
 * The home screen, top to bottom: anything that needs your OK, updates, 📅 Today, 🔄 In progress,
 * 🗂️ Your tasks and ✅ Done this week. Tap any task for Done / Change time / Cancel; tap any job for Stop.
 */
function Presence({ greeting, live, dash, refreshKey, onChanged, onOpenChat }: {
  greeting: string; live: LiveState; dash: Dashboard | null; refreshKey: number; onChanged: () => void; onOpenChat: (id: string) => void;
}) {
  const [openNote, setOpenNote] = useState<string | null>(null);
  const endToday = new Date().setHours(23, 59, 59, 999);
  const todayIds = new Set((dash?.home_tasks ?? []).filter((i) => i.due_at && Date.parse(i.due_at) <= endToday).map((i) => i.id));
  // A task already in Today doesn't get a second row; WhatsApps to send are under "Needs your OK".
  const notes = (dash?.nudges ?? []).filter((n) => n.type !== "wa_send" && !(n.item_id && todayIds.has(n.item_id)));
  const hide = async (n: Nudge) => { await api.actNudge(n.id, "ok").catch(() => {}); onChanged(); };
  const done = dash?.done_week ?? [];
  return (
    <div className="pt-3 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-semibold tracking-tight text-[23px] leading-tight">{greeting}</h1>
        {live !== "off" ? <div className="scale-50 w-16 h-16"><Orb state={live} /></div> : <ReadAloud />}
      </div>

      <Approvals refreshKey={refreshKey} onChanged={onChanged} />
      <WhatsAppsToSend refreshKey={refreshKey} />

      {notes.length > 0 && (
        <section aria-label="Updates" className="rounded-[20px] bg-surface border border-line/70 shadow-card divide-y divide-line/70 overflow-hidden">
          <h2 className="flex items-center gap-2 px-4 py-3 text-[15px] font-semibold">🔔 Updates<span className="text-[13px] font-normal text-muted">{notes.length}</span></h2>
          {notes.map((n) => {
            const expanded = openNote === n.id;
            return (
              <div key={n.id} className="flex items-start">
                <button onClick={() => n.item_id ? openTask(n.item_id) : setOpenNote(expanded ? null : n.id)} className="flex-1 min-w-0 flex items-start gap-3 pl-4 pr-2 py-3 text-left">
                  <span className="w-5 shrink-0 text-center text-[16px]" aria-hidden>{NOTE_ICON[n.type] ?? "🔔"}</span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[15px] leading-snug ${expanded ? "" : "truncate"}`} dir="auto">{cleanTitle(n.title)}</span>
                    {expanded && n.body && <span className="block mt-1 text-[13.5px] text-muted whitespace-pre-line" dir="auto">{n.body}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted mt-1">{timeAgo(n.created_at)}</span>
                </button>
                {!n.item_id && <button onClick={() => void hide(n)} aria-label="Hide" title="Hide" className="shrink-0 h-9 w-9 mt-1.5 mr-2 grid place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink">✕</button>}
              </div>
            );
          })}
        </section>
      )}

      {dash && <HomeWork part="today" tasks={dash.home_tasks ?? []} projects={dash.home_projects ?? []} onChanged={onChanged} />}
      {dash && <InProgress jobs={dash.jobs ?? []} onChanged={onChanged} onOpenChat={onOpenChat} />}
      {dash && <HomeWork part="folders" tasks={dash.home_tasks ?? []} projects={dash.home_projects ?? []} onChanged={onChanged} />}

      {done.length > 0 && (
        <details className="rounded-[20px] bg-surface border border-line/70 px-4 py-3">
          <summary className="cursor-pointer flex items-center gap-2 text-[15px] font-semibold">✅ Done this week<span className="text-[13px] font-normal text-muted">{done.length}</span></summary>
          <ul className="mt-2 divide-y divide-line/70">
            {done.map((i) => (
              <li key={i.id}><button onClick={() => openTask(i.id)} className="w-full flex items-center gap-3 py-2 text-left">
                <span className="text-ok" aria-hidden>✓</span><span className="flex-1 min-w-0 truncate text-[14px] text-muted line-through" dir="auto">{i.title}</span>
                {i.completed_at && <span className="text-[11px] text-muted">{timeAgo(i.completed_at)}</span>}
              </button></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function FromCos({ children, time }: { children: ReactNode; time?: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <img src="/logo-orb.png" alt="" width={28} height={28} className="mt-1 h-7 w-7 shrink-0" />
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

function Composer({ live, typing, setTyping, input, setInput, sending, serverTranscription, onSend, onTalk, onEnd, onMute, levels, onDictating, attached, uploading, uploadError, onAttach, onUnattach }: {
  attached: { id: string; filename: string; mime: string }[]; uploading: boolean; uploadError: string; onAttach: (f: File[]) => void; onUnattach: (id: string) => void;
  live: LiveState; typing: boolean; setTyping: (b: boolean) => void; input: string; setInput: (s: string | ((v: string) => string)) => void;
  sending: boolean; serverTranscription: boolean; onSend: (t: string, mode: "text" | "dictation") => void; onTalk: () => void; onEnd: () => void;
  levels: () => { input: number; output: number }; onDictating: (on: boolean) => void; onMute: (m: boolean) => void;
}) {
  const [dictating, setDictatingRaw] = useState<"off" | "recording" | "working">("off");
  const [dictErr, setDictErr] = useState("");
  // (Hooks must stay above the early returns below, or the screen goes blank.)
  const [muted, setMuted] = useState(false);
  useEffect(() => { if (live === "off") setMuted(false); }, [live]);
  const recRef = useRef<{ stop: () => Promise<Blob>; level: () => number } | null>(null);
  const setDictating = (v: "off" | "recording" | "working") => { setDictatingRaw(v); onDictating(v !== "off"); };
  const dictLevels = useRef(() => ({ input: recRef.current?.level() ?? 0, output: 0 })).current;
  const startDictation = async () => {
    setDictErr("");
    try { recRef.current = await startRecording(); setDictating("recording"); }
    catch { setDictErr("Microphone permission denied."); }
  };
  const finishDictation = async (send: boolean) => {
    const r = recRef.current;
    recRef.current = null;
    if (!r) { setDictating("off"); return; }
    setDictating("working");
    try {
      const blob = await r.stop();
      if (send) { const { text } = await api.transcribe(blob); if (text.trim()) onSend(text.trim(), "dictation"); }
    } catch (e) { setDictErr((e as Error).message); }
    setDictating("off");
  };
  if (dictating !== "off") {
    return (
      <div className="pb-2 flex flex-col items-center">
        <LiveOrb state={dictating === "working" ? "thinking" : "recording"} soft levels={dictLevels} size={88} />
        <p className="-mt-2 text-[15px] font-medium">{dictating === "working" ? "Writing it down…" : "Listening…"}</p>
        {dictating === "recording" && (
          <div className="mt-3 flex gap-2">
            <button onClick={() => finishDictation(false)} className="h-10 px-5 rounded-full text-muted text-sm">Cancel</button>
            <button onClick={() => finishDictation(true)} className="h-10 px-6 rounded-full bg-accent text-accent-ink font-medium text-sm">Done</button>
          </div>
        )}
      </div>
    );
  }
  const toggleMute = () => { onMute(!muted); setMuted(!muted); };
  const LABELS: Record<LiveState, string> = { off: "", connecting: "Connecting…", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…", ended: "" };
  if (live !== "off") {
    return (
      <div className="pb-2 flex flex-col items-center">
        <LiveOrb state={live === "ended" ? "connecting" : live} levels={levels} size={104} />
        <p className="-mt-3 text-[15px] font-medium">{muted ? "Muted" : LABELS[live]}</p>
        <p className="text-xs text-muted">{live === "connecting" ? "One moment" : muted ? "I can't hear you. Tap Unmute to talk." : "Just talk. You can interrupt any time."}</p>
        <div className="mt-3 flex gap-2">
          <button onClick={toggleMute} disabled={live === "connecting"} aria-pressed={muted}
            className={`h-10 px-5 rounded-full font-medium text-sm ${muted ? "bg-ink text-surface" : "bg-sunken text-ink"}`}>{muted ? "🔇 Unmute" : "🎙️ Mute"}</button>
          <button onClick={onEnd} className="h-10 px-6 rounded-full bg-danger/10 text-danger font-medium text-sm">End</button>
        </div>
      </div>
    );
  }
  if (typing) {
    return (
      <form className="rounded-3xl bg-surface border border-line shadow-card p-2 mb-1"
        onSubmit={(e) => { e.preventDefault(); onSend(input, "text"); }}>
        {(attached.length > 0 || uploading || uploadError) && (
          <div className="flex flex-wrap gap-1.5 px-2 pt-1">
            {attached.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs max-w-[220px]">
                <span className="truncate">{/^image\//.test(a.mime) ? "🖼️" : "📎"} {a.filename}</span>
                <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => onUnattach(a.id)} className="text-muted">✕</button>
              </span>
            ))}
            {uploading && <span className="text-xs text-muted px-1 py-1">Adding…</span>}
            {uploadError && <span className="text-xs text-danger px-1 py-1">{uploadError}</span>}
          </div>
        )}
        <textarea autoFocus value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(input, "text"); } }}
          rows={Math.min(5, Math.max(1, input.split("\n").length))} placeholder="Tell me what's going on…"
          className="w-full resize-none bg-transparent px-3 py-2 outline-none text-[16px]" />
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex gap-1">
            <button type="button" onClick={onTalk} className="rounded-full bg-sunken px-3 py-2 text-sm font-medium flex items-center gap-1.5"><MicIcon /> Talk</button>
            <label className="rounded-full bg-sunken px-3 py-2 text-sm font-medium cursor-pointer" title="Add a file or screenshot (you can also paste one)">
              📎<input type="file" multiple className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) onAttach(fs); }} />
            </label>
            <button type="button" onClick={() => setTyping(false)} className="rounded-full px-3 py-2 text-sm text-muted">Close</button>
          </div>
          <button type="submit" disabled={(!input.trim() && !attached.length) || sending || uploading} className="rounded-full bg-accent text-accent-ink px-5 py-2 text-sm font-medium disabled:opacity-40">Send</button>
        </div>
      </form>
    );
  }
  return (
    <div className="pb-2 flex items-end justify-center gap-8">
      <div className="flex flex-col items-center gap-1.5">
        {serverTranscription
          ? <button onClick={startDictation} aria-label="Dictate" className="h-12 w-12 rounded-full grid place-items-center border bg-surface border-line text-muted">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h10M4 12h16M4 17h7" /><circle cx="18" cy="7" r="2" /></svg>
            </button>
          : <DictateButton compact serverTranscription={serverTranscription} onText={(t) => onSend(t, "dictation")} />}
        {dictErr && <span className="sr-only">{dictErr}</span>}
        <span className="text-[11px] text-muted">Dictate</span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <button onClick={onTalk} aria-label="Talk"
          className="h-[72px] w-[72px] rounded-full bg-accent text-accent-ink grid place-items-center shadow-card active:scale-95 transition">
          <MicIcon className="h-7 w-7" />
        </button>
        <span className="text-[11px] text-muted">Talk</span>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <button onClick={() => setTyping(true)} aria-label="Type" className="h-12 w-12 rounded-full bg-surface border border-line grid place-items-center text-muted">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></svg>
        </button>
        <span className="text-[11px] text-muted">Type</span>
      </div>
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
        <FromCos>
          <Markdown text={m.content} />
          <CopyButton text={m.content} />
        </FromCos>
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

/** Copies the draft (the quoted part, if the reply has one) or the whole reply. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const quoted = text.split("\n").filter((l) => /^>\s?/.test(l)).map((l) => l.replace(/^>\s?/, "")).join("\n").trim();
  const value = (quoted || text).trim();
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* no clipboard */ } }}
      className="mt-1 text-[12px] text-muted hover:text-ink">{done ? "✓ Copied" : quoted ? "Copy draft" : "Copy"}</button>
  );
}

const Thinking = () => (
  <FromCos>
    <span className="inline-flex gap-1 py-1">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}
    </span>
  </FromCos>
);

let audioRef: HTMLAudioElement | null = null;

/** 🔊 "Brief me": a short spoken rundown of today and the next few hours. Tap again to stop. */
function ReadAloud() {
  const [state, setState] = useState<"idle" | "loading" | "speaking">("idle");
  const stop = () => { try { speechSynthesis.cancel(); audioRef?.pause(); } catch { /* fine */ } setState("idle"); };
  const go = async () => {
    if (state !== "idle") return stop();

    setState("loading");
    try {
      const { text } = await api.rundown();
      // A natural voice from the server; the phone's own voice if that's not available.
      try {
        const r = await fetch("/api/speak", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${localStorage.getItem("cos.token")}` }, body: JSON.stringify({ text }) });
        if (!r.ok) throw new Error("no voice");
        const audio = new Audio(URL.createObjectURL(await r.blob()));
        audioRef = audio;
        audio.onended = () => setState("idle"); audio.onerror = () => setState("idle");
        await audio.play(); setState("speaking");
        return;
      } catch { /* fall back below */ }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US"; u.rate = 1.02;
      const voices = speechSynthesis.getVoices();
      const v = voices.find((x) => /en[-_]US/i.test(x.lang) && /natural|google|samantha|premium/i.test(x.name)) ?? voices.find((x) => /^en/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = () => setState("idle"); u.onerror = () => setState("idle");
      speechSynthesis.cancel(); speechSynthesis.speak(u); setState("speaking");
    } catch (e) { setState("idle"); alert((e as Error).message); }
  };
  return (
    <button onClick={go} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium shadow-card border ${state === "speaking" ? "bg-accent text-white border-accent" : "bg-surface border-line/70"}`}>
      <span className="text-[18px]">{state === "speaking" ? "⏹️" : "🔊"}</span>
      {state === "loading" ? "Getting your briefing…" : state === "speaking" ? "Stop" : "Brief me"}
    </button>
  );
}

import HashgachaReports from '../components/HashgachaReports';
import GroupDraftApprovals from '../components/GroupMessage';
import MeetingPrepConfirmations from '../components/MeetingPrep';
import HomeWork from '../components/HomeWork';
import {useImmediateCompletions} from '../useImmediateCompletions';
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionNote, Dashboard, Message, Nudge } from "../../shared/types";
import type { FoundFile } from "../api";
import { api } from "../api";
import { useAreas } from "../areas";
import { BriefingView, DictateButton, Markdown, MicIcon, timeAgo } from "../components/ui";
import { startLiveCall, type LiveStatus } from "../realtime";
import LiveOrb from "../components/LiveOrb";
import Celebration from "../components/Celebration";
import ChatFiles from "../components/ChatFiles";
import Chips from "../components/NudgeActions";
import TaskActions from "../components/TaskActions";
import NowChecklist from '../components/NowChecklist';
import { startRecording } from "../voice";

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
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);
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

  const act = async (n: Nudge, action: string) => {
    const r = await api.actNudge(n.id, action);
    setActionMessage(r.message);
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
  // Group drafts show in a chat only if this chat made one (not every pending draft in every chat).
  const groupDraftSince = messages.some((m) => m.meta && (safeParse(m.meta) as ActionNote[]).some?.((a) => a.tool === "draft_group_message"))
    ? messages[0]?.created_at ?? null : null;
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
          <Presence greeting={`${greeting}${name ? `, ${name}` : ""}.`} live={dictatingNow ? "listening" : live} dash={dash} onAct={act}
            onNudge={(ask) => { onConversation(null); convoRef.current = null; setMessages([]); send(ask); }}
            onChanged={() => { api.dashboard().then(setDash).catch(() => {}); onDataChanged(); }}
            onReply={(n) => { onConversation(null); convoRef.current = null; setTyping(true); setInput(`About "${n.title}": `); }} />
        ) : (
          <div className="space-y-3 pt-2">
            {messages.map((m) => <div key={m.id}><Bubble m={m} />{filesUnder.has(m.id) && <ChatFiles files={filesUnder.get(m.id)!} onChanged={loadChatFiles} />}</div>)}
            {sending && <Thinking />}
          </div>
        )}
        {inConversation&&groupDraftSince&&<GroupDraftApprovals refreshKey={refreshKey} onChanged={onDataChanged} since={groupDraftSince}/>}
        <MeetingPrepConfirmations refreshKey={refreshKey} onChanged={onDataChanged}/>
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

function Presence({ greeting, live, dash, onAct, onReply, onNudge, onChanged }: {
  greeting: string; live: LiveState; dash: Dashboard | null;
  onAct: (n: Nudge, a: string) => Promise<void>; onReply: (n: Nudge) => void; onNudge: (ask: string) => void; onChanged: () => void;
}) {
  const [area, setAreaState] = useState<string>(() => { try { return localStorage.getItem("cos.area") || "all"; } catch { return "all"; } });
  const setArea = (a: string) => { setAreaState(a); try { localStorage.setItem("cos.area", a); } catch { /* fine */ } };
  const areas = useAreas();
  const ICON: Record<string, string> = Object.fromEntries(areas.map((a) => [a.key, a.icon]));
  // A nudge's area: its item's area, else the area icon in its title (time-block reminders).
  const nudgeArea = (n: Nudge) => n.area ?? Object.entries(ICON).find(([, i]) => n.title.includes(i))?.[0] ?? null;
  const inArea = (a: string | null | undefined) => area === "all" || a === area;
  const dismissAction = (n: Nudge) => !n.item_id && !n.items?.length && !n.actions?.some(a=>a.id==='clear_note') ? (n.actions ?? []).find(a=>a.id==='ok') : undefined;
  const dismiss = (n: Nudge) => { const a = dismissAction(n); if (a) void onAct(n, a.id).catch(()=>{}); };
  const completion=useImmediateCompletions((dash?.nudges??[]).flatMap(n=>[...(n.item_id?[n.item_id]:[]),...(n.items??[]).map(i=>i.id)]));
  const performAction=(n:Nudge,action:string)=>n.item_id&&['done','notneeded'].includes(action)?completion.complete(n.item_id,()=>onAct(n,action),()=>{}):onAct(n,action);
  const [showUpdates,setShowUpdates]=useState(false);
  const allNudges = (dash?.nudges ?? []).filter((n) => !completion.hidden.has(n.item_id??'') && n.type !== "briefing" && (n.type !== "helper" || n.title.includes("needs you")) && (area === "all" || nudgeArea(n) === area));
  const nudges=showUpdates?allNudges:allNudges.slice(0,5);
  const briefing = dash?.nudges.find((n) => n.type === "briefing");
  const [nowVisibleCount,setNowVisibleCount]=useState<number|null>(null);
  const nowBlock = dash?.now_block;
  const nowItems = (nowBlock?.items??[]).filter(i=>inArea(i.category));

  return (
    <div className="pt-4 space-y-5">
      <div className="space-y-5">
      <div className="flex flex-col items-center text-center gap-3">
        {live === "off" && <div className="scale-[0.8] -my-3"><Orb state={live} /></div>}
        <div>
          <h1 className="font-display text-[30px] leading-tight">{greeting}</h1>
          <p className="text-muted text-sm mt-0.5">{live === "off" ? "I'm here. Tell me what's going on." : "I'm listening."}</p>
        </div>
      </div>

      <div className="flex justify-center"><ReadAloud /></div>

      <div className="flex justify-center gap-1.5 flex-wrap">
        {[["all", "All"], ...areas.map((a) => [a.key, `${a.icon} ${a.label}`])].map(([k, label]) => (
          <button key={k} onClick={() => setArea(k)}
            className={`rounded-full px-3 py-1.5 text-[13px] ${area === k ? "bg-ink text-bg" : "bg-surface border border-line/70 text-muted"}`}>{label}</button>
        ))}
      </div>

      <section aria-label="Now" className="rounded-2xl bg-accent/10 px-4 py-3">
          <div className="text-[14px] flex items-center gap-2">
            <span className="text-accent font-medium">Now:</span>
            <span className="flex-1 truncate">{ICON[nowBlock?.category ?? ""] ? `${ICON[nowBlock?.category ?? ""]} ` : ""}{nowBlock?.name??"Ready to work on"}
              {nowBlock?.until && <span className="text-muted"> · until {nowBlock?.until}</span>}</span>
            {(nowVisibleCount??nowItems.length) > 0 && <span className="text-xs text-muted">{nowVisibleCount??nowItems.length} thing{(nowVisibleCount??nowItems.length) > 1 ? "s" : ""}</span>}
          </div>
          <NowChecklist items={nowItems} onChanged={onChanged} onCountChange={setNowVisibleCount}/>
          {!nowItems.length && <p className="mt-2 text-sm text-muted">{dash?"Nothing needs doing right now.":"Loading your next steps…"}</p>}
      </section>

      {completion.error&&<p role="alert" className="text-sm text-danger">{completion.error}</p>}
      {(briefing || nudges.length > 0) && (
        <div className="rounded-[20px] bg-surface border border-line/70 shadow-card divide-y divide-line/70 overflow-hidden">
          {briefing && (
            <Row icon="☀️" title="Today's briefing" time={briefing.created_at}
              onDismiss={dismissAction(briefing) ? () => dismiss(briefing) : undefined}>
              <BriefingView text={briefing.body} />
              <Chips n={briefing} onAct={performAction} />
            </Row>
          )}
          {nudges.map((n) => (
            <Row key={n.id} icon={n.type === "learn" ? "✨" : "•"} type={n.type} startOpen={n.type === "learn"} title={n.title} time={n.created_at}
              onDismiss={dismissAction(n) ? () => dismiss(n) : undefined}>
              {n.type === "review" ? <>
                <div className="text-[14px]"><Markdown text={n.body} /></div>
                <Chips n={n} onAct={performAction} />
              </> : n.type === "idea" ? <>
                <p className="text-muted text-[14px] whitespace-pre-line">{n.body}</p>
                <a href="/?tab=ideas" className="inline-block text-[14px] font-medium text-accent">Open the idea → pick next steps</a>
                <Chips n={n} onAct={performAction} />
              </> : n.type === "learn" ? <LearnReview onChanged={onChanged} /> : n.items?.length ? <>
                {n.body.split("\n").filter((l) => l.startsWith("📝")).map((l, k) => <p key={k} className="text-muted text-[14px]">{l}</p>)}
                <ul className="space-y-1">
                  {groupItems(n.items.filter(i=>!completion.hidden.has(i.id))).map(({ header, it }) => (
                    <li key={it.id} className="text-[14px] rounded-xl bg-sunken/60 px-3 py-2">
                      {header && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">🗂️ {header}</p>}
                      <p>{it.title}{it.person && <span className="text-muted"> ({it.person})</span>}</p>
                      <TaskActions id={it.id} onChanged={onChanged} onClose={status=>completion.complete(it.id,()=>api.updateItem(it.id,{status}),onChanged)} />
                    </li>
                  ))}
                </ul>
                <Chips n={n} onAct={performAction} onReply={n.type === "wrapup" ? undefined : () => onReply(n)} />
              </> : <>
                {n.body && <p className="text-muted text-[14px] whitespace-pre-line">{n.body}</p>}
                <Chips n={n} onAct={performAction} onReply={() => onReply(n)} />
              </>}
            </Row>
          ))}
          {allNudges.length>5&&<button className="w-full px-4 py-3 text-sm text-accent" onClick={()=>setShowUpdates(!showUpdates)}>{showUpdates?'Show fewer updates':`Show ${allNudges.length-5} more updates`}</button>}
        </div>
      )}

      {!!dash?.attention_cards?.length && <section aria-label="Needs your attention" className="space-y-2">
        <h2 className="px-1 text-[11px] font-medium text-muted uppercase tracking-[0.14em]">Needs your attention</h2>
        <div className="rounded-[20px] bg-surface border border-line divide-y divide-line">{dash.attention_cards.map(card=><a key={card.id} href={card.url} className="block px-4 py-3"><p className="text-[15px] font-medium">{card.title} →</p><p className="text-sm text-muted mt-1">{card.body}</p></a>)}</div>
      </section>}
      {!!dash?.hashgacha?.length&&inArea('yeshiva')&&<HashgachaReports campaigns={dash.hashgacha} onChanged={onChanged}/>}
      {dash && <HomeWork tasks={dash.home_tasks??[]} projects={dash.home_projects??[]} inArea={inArea} onChanged={onChanged}/>}
      </div>
    </div>
  );
}

/** One compact line; tap to open its details and buttons. */
/** What each kind of row is: an emoji, a short label and a color, so the list reads at a glance. */
const KIND: Record<string, { emoji: string; label: string; tone: string }> = {
  overdue: { emoji: "🔴", label: "Overdue", tone: "border-l-danger text-danger" },
  reminder: { emoji: "⏰", label: "Reminder", tone: "border-l-amber-500 text-amber-700" },
  checkin: { emoji: "❓", label: "Did you?", tone: "border-l-amber-500 text-amber-700" },
  project_ask: { emoji: "🗂️", label: "Which project?", tone: "border-l-violet-500 text-violet-700" },
  headsup: { emoji: "📅", label: "Coming up", tone: "border-l-sky-500 text-sky-700" },
  event: { emoji: "🗓️", label: "Meeting", tone: "border-l-sky-500 text-sky-700" },
  situation: { emoji: "📍", label: "Now", tone: "border-l-accent text-accent" },
  unanswered: { emoji: "💬", label: "Reply", tone: "border-l-violet-500 text-violet-700" },
  email: { emoji: "✉️", label: "Email", tone: "border-l-violet-500 text-violet-700" },
  whatsapp: { emoji: "💬", label: "WhatsApp", tone: "border-l-emerald-500 text-emerald-700" },
  waiting: { emoji: "⏳", label: "Waiting", tone: "border-l-line text-muted" },
  auto_done: { emoji: "✅", label: "Done for you", tone: "border-l-emerald-500 text-emerald-700" },
  digest: { emoji: "📋", label: "Check-in", tone: "border-l-line text-muted" },
  sweep: { emoji: "📋", label: "Check-in", tone: "border-l-line text-muted" },
  learn: { emoji: "✨", label: "To review", tone: "border-l-accent text-accent" },
  wrapup: { emoji: "🏁", label: "Wrap-up", tone: "border-l-amber-500 text-amber-700" },
  reply_batch: {emoji:"💬",label:"Replies",tone:"border-l-sky-500 text-sky-700"},
  prep: { emoji: "📋", label: "Meeting prep", tone: "border-l-sky-500 text-sky-700" },
  meeting_notes: { emoji: "📝", label: "Meeting notes", tone: "border-l-emerald-500 text-emerald-700" },
  suggest: { emoji: "📲", label: "Add this?", tone: "border-l-sky-500 text-sky-700" },
  watch: { emoji: "👀", label: "Watch", tone: "border-l-violet-500 text-violet-700" },
  meeting: { emoji: "📅", label: "Meeting", tone: "border-l-sky-500 text-sky-700" },
  review: { emoji: "🗓️", label: "Weekly review", tone: "border-l-accent text-accent" },
  customers: { emoji: "☕", label: "Customers due", tone: "border-l-emerald-500 text-emerald-700" },
  idea: { emoji: "💡", label: "Idea", tone: "border-l-amber-500 text-amber-700" },
  tracker: { emoji: "🗂️", label: "Tracker", tone: "border-l-sky-500 text-sky-700" },
  routine: { emoji: "📄", label: "Report", tone: "border-l-sky-500 text-sky-700" },
  routine_alert: { emoji: "📄", label: "Report", tone: "border-l-sky-500 text-sky-700" },
  mission_ask: { emoji: "🙋", label: "Question", tone: "border-l-amber-500 text-amber-700" },
};
const kindOf = (type: string) => KIND[type] ?? { emoji: "•", label: "", tone: "border-l-line text-muted" };
/** "Don't forget: Brew coffee" → "Brew coffee" (the label already says what it is). */
const cleanTitle = (t: string) => t.replace(/^(don't forget|coming up|still waiting|reminder|due soon|heads up|overdue)\s*:\s*/i, "");

function Row({ icon, title, time, children, startOpen, type, onDismiss }: {
  icon: string; title: string; time?: string; children: ReactNode; startOpen?: boolean; type?: string; onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(!!startOpen);
  const k = type ? kindOf(type) : null;
  return (
    <div className={k ? `border-l-4 ${k.tone.split(" ")[0]}` : ""}>
      <div className="flex items-center">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 flex items-center gap-2.5 pl-4 pr-2 py-3 text-left">
          <span className="w-5 shrink-0 text-center text-[15px]">{k ? k.emoji : icon}</span>
          <span className="flex-1 min-w-0">
            {k?.label && <span className={`block text-[11px] font-semibold uppercase tracking-wide ${k.tone.split(" ")[1]}`}>{k.label}</span>}
            <span className={`block text-[15px] leading-snug ${open ? "" : "truncate"}`}>{k ? cleanTitle(title) : title}</span>
          </span>
          {time && <span className="shrink-0 text-[11px] text-muted">{timeAgo(time)}</span>}
        </button>
        {/* One tap to clear it without opening it, so a whole pile can be cleared in one go. */}
        {onDismiss && (
          <button onClick={onDismiss} aria-label="Hide alert" title="Hide this alert; scheduled work stays open"
            className="shrink-0 h-9 w-9 mr-2 grid place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink">✕</button>
        )}
      </div>
      {open && <div className="px-4 pb-3 pl-11 space-y-2">{children}</div>}
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

/** What I picked up about your life, reviewed right here: That's right / Change / Ignore. */
function LearnReview({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.memories>> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const load = () => api.memories().then((m) => setList(m.filter((x) => x.status === "suggested"))).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  const act = async (id: string, action: "accept" | "edit" | "ignore", content?: string) => {
    setList((l) => l?.filter((m) => m.id !== id) ?? null); setEditing(null);
    await api.reviewMemory(id, action, content).catch(() => {});
    if (list && list.length <= 1) onChanged();
  };
  if (!list) return <p className="text-sm text-muted">Loading…</p>;
  if (!list.length) return <p className="text-sm text-muted">All reviewed. Thanks!</p>;
  return (
    <div className="space-y-2 -ml-6">
      {list.map((m) => (
        <div key={m.id} className="rounded-xl bg-sunken px-3 py-2.5">
          {editing === m.id
            ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} dir="auto" className="w-full rounded-lg border border-line bg-bg p-2 text-[14px]" />
            : <p className="text-[14px] leading-snug" dir="auto">{m.content}</p>}
          {m.question && editing !== m.id && <p className="text-[13px] text-muted mt-0.5">{m.question}</p>}
          <div className="flex gap-1.5 mt-2">
            {editing === m.id ? <>
              <button onClick={() => act(m.id, "edit", text)} className="rounded-full bg-accent text-white px-3 py-1 text-[13px] font-medium">Save</button>
              <button onClick={() => setEditing(null)} className="rounded-full px-3 py-1 text-[13px] text-muted">Cancel</button>
            </> : <>
              <button onClick={() => act(m.id, "accept")} className="rounded-full bg-accent text-white px-3 py-1 text-[13px] font-medium">That's right</button>
              <button onClick={() => { setEditing(m.id); setText(m.content); }} className="rounded-full border border-line bg-bg px-3 py-1 text-[13px]">Change</button>
              <button onClick={() => act(m.id, "ignore")} className="rounded-full px-3 py-1 text-[13px] text-muted">Ignore</button>
            </>}
          </div>
        </div>
      ))}
      <a href="/?tab=review" className="block text-[13px] text-accent pt-1">See everything I know →</a>
    </div>
  );
}

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
    <button onClick={go} className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-medium shadow-card border ${state === "speaking" ? "bg-accent text-white border-accent" : "bg-surface border-line/70"}`}>
      <span className="text-[18px]">{state === "speaking" ? "⏹️" : "🔊"}</span>
      {state === "loading" ? "Getting your briefing…" : state === "speaking" ? "Stop" : "Brief me"}
    </button>
  );
}

/** Steps of the same project sit together under the project's name (shown once), not scattered through the list. */
function groupItems<T extends { id: string; project_id?: string | null; project?: string | null }>(items: T[]) {
  const size = new Map<string, number>();
  for (const i of items) if (i.project_id) size.set(i.project_id, (size.get(i.project_id) ?? 0) + 1);
  const first = new Map<string, number>();
  items.forEach((i, idx) => { if (i.project_id && !first.has(i.project_id)) first.set(i.project_id, idx); });
  const key = (i: T, idx: number) => (i.project_id && (size.get(i.project_id) ?? 0) > 1 ? first.get(i.project_id)! : idx);
  return items
    .map((it, idx) => ({ it, idx, k: key(it, idx) }))
    .sort((a, b) => a.k - b.k || a.idx - b.idx)
    .map(({ it, idx }, pos, arr) => ({
      it,
      header: it.project_id && (size.get(it.project_id) ?? 0) > 1 && (pos === 0 || arr[pos - 1].it.project_id !== it.project_id) && idx >= 0 ? it.project ?? null : null,
    }));
}

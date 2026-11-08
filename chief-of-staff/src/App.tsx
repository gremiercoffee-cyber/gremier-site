import { useEffect, useState } from "react";
import type { Conversation, Item, ItemKind, Settings as S } from "../shared/types";
import { api, getToken, setToken } from "./api";
import { Button } from "./components/ui";
import ItemSheet from "./components/ItemSheet";
import TaskSheet, { toast } from "./components/TaskSheet";
import Home from "./pages/Home";
import Shopping from './pages/Shopping';
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";
import Search from "./pages/Search";
import Groups from "./pages/Groups";
import NotifBanner from "./components/NotifBanner";
import ZoomControl from "./components/ZoomControl";
import MyDetails from "./pages/MyDetails";
import Reschedule from "./components/Reschedule";
import ConversationList from "./components/ConversationList";
import { ResearchChat, ResearchList } from "./components/ResearchChats";
import type { JobChatRow } from "./api";

type View = "home" | "research" | "chats" | "projects" | "groups" | "shopping" | "details" | "settings" | "search";
const VIEW_TITLES: Record<View, string> = { home: "Chief of Staff", research: "Research", chats: "Chats", projects: "Projects", groups: "Groups", shopping: "Shopping lists", details: "My details", settings: "Settings", search: "Search" };
/** The top menu: everything that isn't the home screen. */
const MENU: [View | "health", string, string][] = [
  ["chats", "💬", "Chats"], ["projects", "📁", "Projects"], ["groups", "👥", "Groups"], ["shopping", "🛒", "Shopping lists"],
  ["details", "🪪", "My details"], ["settings", "⚙️", "Settings"], ["health", "🌿", "Health Journal"],
];

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void> }

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [health, setHealth] = useState<{ configured: boolean; model: boolean; transcription: boolean } | null>(null);
  const params = new URLSearchParams(location.search);
  const legacyTab = params.get("tab");
  const [view, setView] = useState<View>(params.get("job") ? "research" : legacyTab && legacyTab in VIEW_TITLES ? (legacyTab as View) : legacyTab === "tasks" ? "chats" : "home");
  // Shared from another app (Android share sheet): hand it to the Chief of Staff to file.
  const shared = [params.get("share_title"), params.get("share_text"), params.get("share_url")].filter(Boolean).join("\n");
  const [ask, setAsk] = useState<string | undefined>(params.get("ask") ?? (shared ? `I'm sharing this with you:\n${shared}\n\nFile it where it belongs (to-do, reminder, memory, list) and tell me in one line what you did.` : undefined));
  const [startVoice] = useState(params.get("voice") === "1");
  const [startTyping] = useState(params.get("type") === "1");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Research chats: listed under Chats; ?job= (from a notification) opens one.
  const [jobs, setJobs] = useState<JobChatRow[]>([]);
  const [jobId, setJobId] = useState<string | null>(params.get("job"));
  const loadJobs = () => api.jobs().then(setJobs).catch(() => {});
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState<S | null>(null);
  const [sheet, setSheet] = useState<{ item: Item | null; kind?: ItemKind } | null>(null);
  const [task, setTask] = useState<Item | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [rescheduling, setRescheduling] = useState<Item | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: () => Promise<unknown> | void } | null>(null);
  // Text to pre-fill in the composer, without sending it.
  const [draft, setDraft] = useState<string | undefined>();
  const setTyping = (text: string) => setDraft(text);
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);

  const refresh = () => { setRefreshKey((k) => k + 1); loadJobs(); };
  useEffect(() => {
    if (!authed) return;
    loadJobs();
    const t = setInterval(() => { if (document.visibilityState === "visible") loadJobs(); }, 60_000);
    return () => clearInterval(t);
  }, [authed]);
  const loadConversations = () => api.conversations().then(setConversations).catch(() => {});

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ configured: false, model: false, transcription: false }));
    const onUnauth = () => { setToken(""); setAuthed(false); };
    window.addEventListener("cos:unauthorised", onUnauth);
    const onInstall = (e: Event) => { e.preventDefault(); setInstall(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onInstall);
    // Links like ?ask= are one-shot; keep the address bar clean.
    if (params.get("ask") || params.get("share_text") || params.get("share_url") || params.get("share_title") || params.get("voice") || params.get("type") || params.get("item") || params.get("reschedule") || params.get("job")) history.replaceState(null, "", location.pathname + (legacyTab ? `?tab=${legacyTab}` : ""));
    return () => { window.removeEventListener("cos:unauthorised", onUnauth); window.removeEventListener("beforeinstallprompt", onInstall); };
  }, []);

  useEffect(() => { if (authed) { api.settings().then(setSettings).catch(() => {}); loadConversations(); } }, [authed]);

  // Clear phone alerts already completed, dismissed or rescheduled in the app.
  // Never infer completion from swiping a notification away.
  useEffect(() => {
    if (!authed || !("serviceWorker" in navigator)) return;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false, running = false;
    const sync = async () => {
      if (stopped || running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const reg = await navigator.serviceWorker.ready;
        const visible = (await reg.getNotifications()).filter(n => typeof n.data?.nudge_id === "string");
        for (let i=0; i<visible.length && !stopped; i+=100) {
          const batch = visible.slice(i,i+100);
          const {active_ids,updates} = await api.notificationState(batch.map(n => n.data.nudge_id));
          if (stopped) break;
          const active = new Set(active_ids);
          batch.filter(n => !active.has(n.data.nudge_id)).forEach(n => n.close());
          for (const update of updates) {
            const old=batch.find(n=>n.data.nudge_id===update.id), body=update.body.slice(0,300);
            if (!old || (old.data.revision || 0)>update.revision || (old.title===update.title && old.body===body)) continue;
            await reg.showNotification(update.title,{
              body,tag:old.tag,icon:"/icon-192.png",badge:"/badge.png",silent:true,
              data:{...old.data,title:update.title,body,revision:update.revision},
              actions:(old.data.actions || []).slice(0,3).map((a:{action:string;title:string})=>({action:a.action,title:a.title})),
            } as NotificationOptions);
          }
        }
      } catch { /* Offline or not signed in: keep notifications, never discard them speculatively. */ }
      finally { running = false; }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(sync,400); };
    schedule();
    window.addEventListener("cos:notifications-changed",schedule);
    window.addEventListener("focus",schedule);
    document.addEventListener("visibilitychange",schedule);
    navigator.serviceWorker.addEventListener("controllerchange",schedule);
    return () => {
      stopped=true; clearTimeout(timer);
      window.removeEventListener("cos:notifications-changed",schedule);
      window.removeEventListener("focus",schedule);
      document.removeEventListener("visibilitychange",schedule);
      navigator.serviceWorker.removeEventListener("controllerchange",schedule);
    };
  }, [authed,refreshKey]);

  // Self-heal notifications: whenever the app opens with permission already granted, make sure this
  // device is subscribed and the server knows it (subscriptions can be dropped by the browser or OS).
  useEffect(() => {
    if (!authed || typeof Notification === "undefined" || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
    (async () => {
      try {
        const { key } = await api.pushKey();
        if (!key) return;
        const reg = await navigator.serviceWorker.ready;
        const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw }));
        await api.subscribePush(sub.toJSON());
      } catch { /* Settings still offers the manual button */ }
    })();
  }, [authed]);
  useEffect(() => { if (view === "chats") { loadConversations(); loadJobs(); } }, [view]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onToast = (e: Event) => { const d = (e as CustomEvent<{ text: string; undo?: () => Promise<unknown> | void }>).detail; setNote(d); clearTimeout(timer); timer = setTimeout(() => setNote(null), d.undo ? 5000 : 2500); };
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      api.items({ status: "all" }).then((all) => { const it = all.find((i) => i.id === id); if (it) setTask(it); }).catch(() => {});
    };
    window.addEventListener("cos:toast", onToast);
    window.addEventListener("cos:open-item", onOpen);
    return () => { clearTimeout(timer); window.removeEventListener("cos:toast", onToast); window.removeEventListener("cos:open-item", onOpen); };
  }, []);
  // From the widget: open one item's details.
  useEffect(() => {
    const id = params.get("item");
    if (!authed || !id) return;
    const reschedule = params.get("reschedule") === "1";
    api.items({ status: "all" }).then((all) => {
      const it = all.find((i) => i.id === id);
      if (it) reschedule ? setRescheduling(it) : setTask(it);
    }).catch(() => {});
  }, [authed]);

  // Reschedule requests from cards inside the app.
  useEffect(() => {
    const onRe = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      api.items({ status: "all" }).then((all) => { const it = all.find((i) => i.id === id); if (it) setRescheduling(it); }).catch(() => {});
    };
    window.addEventListener("cos:reschedule", onRe);
    return () => window.removeEventListener("cos:reschedule", onRe);
  }, []);

  // Refresh when the app comes back to the foreground (new nudges may have arrived).
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const go = (v: View) => { setView(v); setMenu(false); };
  const openConversation = (id: string | null) => { setConversationId(id); setAsk(undefined); go("home"); };
  const [homeTick, setHomeTick] = useState(0);
  const [chatOnOpen, setChatOnOpen] = useState(false);
  const goHome = () => { openConversation(null); setHomeTick((t) => t + 1); };
  const openResearch = (id: string) => { setJobId(id); setView("research"); setMenu(false); };
  const askNew = (p: string) => { openConversation(null); setAsk(undefined); setTimeout(() => setTyping(p), 0); };
  useEffect(()=>{const url=new URL(location.href);if(view==='research'&&jobId)url.searchParams.set('job',jobId);else url.searchParams.delete('job');history.replaceState(null,'',url.pathname+url.search);},[view,jobId]);
  const current = conversations.find((c) => c.id === conversationId);
  const atHome = view === "home" && !conversationId;

  if (!authed) return <Login health={health} onDone={() => setAuthed(true)} />;

  return (
    <div className="h-full flex flex-col mx-auto w-full max-w-3xl">
      <header className="pt-safe px-2 flex items-center gap-1 h-14 shrink-0 relative">
        {atHome
          ? <button onClick={goHome} className="flex items-center gap-2 pl-2 pr-1 min-w-0"><Logo /><span className="font-semibold truncate">Chief of Staff</span></button>
          : <button onClick={goHome} aria-label="Back to home" className="flex items-center gap-1 pl-1.5 pr-3 py-2 rounded-xl text-ink hover:bg-sunken min-w-0">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
              <span className="font-medium truncate">{view === "home" ? current?.title || "Chat" : view === "research" ? jobs.find((j) => j.id === jobId)?.title || "Research" : VIEW_TITLES[view]}</span>
            </button>}
        <span className="flex-1" />
        <ZoomControl />
        <button onClick={() => go("search")} aria-label="Search" className="p-2.5 rounded-xl text-ink hover:bg-sunken text-[18px] leading-none">🔍</button>
        <button onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu} className={`p-2.5 rounded-xl text-ink ${menu ? "bg-sunken" : "hover:bg-sunken"}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        {menu && <>
          <button aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(false)} />
          <nav className="absolute right-2 top-14 z-50 w-60 rounded-2xl bg-surface border border-line shadow-card p-1.5 menu-in">
            {MENU.map(([key, icon, label]) => key === "health"
              ? <a key={key} href="/daynote/?open=standalone" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] hover:bg-sunken"><span className="text-[18px] w-6 text-center">{icon}</span>{label}</a>
              : <button key={key} onClick={() => go(key)} className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] text-left ${view === key ? "bg-sunken" : "hover:bg-sunken"}`}><span className="text-[18px] w-6 text-center">{icon}</span>{label}</button>)}
          </nav>
        </>}
      </header>

      {view!=="research"&&view!=="home"&&<NotifBanner />}
      {health && !health.model && (
        <div className="mx-4 mb-2 rounded-xl bg-sunken text-sm px-3 py-2 text-muted">
          The assistant isn't connected to a model yet. Set the <code>OPENAI_API_KEY</code> secret.
        </div>
      )}

      <main className={`flex-1 min-h-0 px-4 ${view === "home" || view === "research" ? "pb-safe" : "overflow-y-auto pb-6"}`}>
        {view === "chats" && (
          <div className="space-y-6 pt-1">
            <button onClick={() => { setChatOnOpen(true); openConversation(null); setTimeout(() => setChatOnOpen(false), 0); }} className="w-full rounded-2xl bg-accent text-accent-ink py-3 text-[15px] font-medium">✏️ New conversation</button>
            <ResearchList jobs={jobs} onOpen={openResearch} onChanged={loadJobs} onNew={() => askNew("Research ")} />
            <section>
              <ConversationList conversations={conversations} activeId={null} onOpen={(id) => openConversation(id)}
                onChanged={() => api.conversations().then((list) => { setConversations(list); if (conversationId && !list.some((c) => c.id === conversationId)) setConversationId(null); }).catch(() => {})} />
            </section>
          </div>
        )}
        {view === "research" && jobId && <ResearchChat id={jobId} onChanged={loadJobs} />}
        {view === "home" && (
          <Home name={settings?.name ?? ""} conversationId={conversationId}
            onConversation={(id) => { setConversationId(id); loadConversations(); }}
            initialAsk={ask} startVoice={startVoice} startTyping={startTyping || !!draft || chatOnOpen} draft={draft} onDraftUsed={() => setDraft(undefined)} serverTranscription={!!health?.transcription}
            onDataChanged={refresh} refreshKey={refreshKey} onOpenChat={openResearch} homeTick={homeTick} />
        )}
        {view === "projects" && <Projects onOpenJob={openResearch} onOpenItem={(i) => setTask(i)} onNew={()=>setSheet({item:null,kind:"task"})} refreshKey={refreshKey} />}
        {view === 'shopping' && <Shopping refreshKey={refreshKey} />}
        {view === 'details' && <MyDetails />}

        {view === "search" && (
          <Search query={query} onQuery={setQuery} onOpenItem={(i) => setTask(i)} onOpenConversation={(id) => openConversation(id)} />
        )}
        {view === "groups" && <Groups refreshKey={refreshKey} onAsk={askNew} />}
        {view === "settings" && settings && (
          <Settings settings={settings} onSaved={setSettings}
            installPrompt={install ? () => { install.prompt(); setInstall(null); } : null} />
        )}
      </main>

      {rescheduling && (
        <Reschedule item={rescheduling} onClose={() => setRescheduling(null)}
          onSaved={(msg) => { setRescheduling(null); refresh(); toast(`🕒 ${msg}`); }} />
      )}
      {task && <TaskSheet item={task} onClose={() => setTask(null)} onChanged={refresh} onReschedule={setRescheduling} onEdit={(i) => setSheet({ item: i })} />}
      {note && (
        <div role="status" className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-full bg-ink text-bg pl-4 pr-2 py-2 text-sm shadow-card max-w-[92vw]">
          <span className="truncate">{note.text}</span>
          {note.undo && <button onClick={async () => { const u = note.undo!; setNote(null); try { await u(); toast("↩️ Undone"); } catch (e) { toast(`⚠️ ${(e as Error).message}`); } }} className="shrink-0 rounded-full bg-bg/15 px-3 py-1 font-medium">Undo</button>}
        </div>
      )}

      {sheet && (
        <ItemSheet item={sheet.item} defaultKind={sheet.kind} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); refresh(); }} />
      )}
    </div>
  );
}

const Logo = ({ size = 28 }: { size?: number }) => (
  <img src="/logo-orb.png" alt="" width={size} height={size} className="shrink-0" />
);

function Login({ health, onDone }: { health: { configured: boolean } | null; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    setToken(code.trim());
    try {
      await api.settings();
      onDone();
    } catch (e) {
      setToken("");
      setError((e as Error).message === "unauthorised" ? "That passcode didn't work." : (e as Error).message);
    }
  };
  return (
    <div className="h-full grid place-items-center px-6">
      <form className="w-full max-w-xs space-y-4 text-center" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="flex justify-center"><Logo /></div>
        <h1 className="font-display text-[34px] leading-tight">Chief of Staff</h1>
        {health && !health.configured ? (
          <p className="text-sm text-muted">Set the <code>COS_ACCESS_TOKEN</code> secret on the Worker to finish setup.</p>
        ) : (
          <>
            <input type="password" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Passcode"
              className="w-full rounded-full bg-surface border border-line px-5 py-3 outline-none text-center focus:border-accent shadow-card" />
            {error && <p className="text-danger text-sm">{error}</p>}
            <Button type="submit" className="w-full py-3" disabled={!code}>Unlock</Button>
          </>
        )}
      </form>
    </div>
  );
}

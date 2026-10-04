import { useEffect, useState, type ReactNode } from "react";
import type { Conversation, Item, ItemKind, Settings as S } from "../shared/types";
import { api, getToken, setToken } from "./api";
import { Button, timeAgo } from "./components/ui";
import ItemSheet from "./components/ItemSheet";
import Home from "./pages/Home";
import Today from "./pages/Today";
import BrainDump from "./pages/BrainDump";
import Lists from "./pages/Lists";
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";
import Search from "./pages/Search";
import Library, { type LibraryTab } from "./pages/Library";
import Replies from "./pages/Replies";
import Tasks from "./pages/Tasks";
import ReportReader from "./components/ReportReader";
import Reschedule from "./components/Reschedule";
import ConversationList from "./components/ConversationList";

type View = "home" | "today" | "dump" | "lists" | "projects" | "settings" | "search" | "library" | "missions" | "replies" | "tasks";
const VIEW_TITLES: Record<View, string> = { home: "Chief of Staff", today: "Today", dump: "Library", lists: "Lists", projects: "Lists", settings: "Settings", search: "Search", library: "Library", missions: "Tasks", replies: "Replies", tasks: "Tasks" };

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void> }

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [health, setHealth] = useState<{ configured: boolean; model: boolean; transcription: boolean } | null>(null);
  const params = new URLSearchParams(location.search);
  const legacyTab = params.get("tab");
  const [view, setView] = useState<View>(legacyTab && legacyTab in VIEW_TITLES ? (legacyTab as View) : "home");
  const [ask, setAsk] = useState<string | undefined>(params.get("ask") ?? undefined);
  const [startVoice] = useState(params.get("voice") === "1");
  const [startTyping] = useState(params.get("type") === "1");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState<S | null>(null);
  const [sheet, setSheet] = useState<{ item: Item | null; kind?: ItemKind } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("dump");
  const [rescheduling, setRescheduling] = useState<Item | null>(null);
  const [toast, setToast] = useState("");
  // A task report opened from a notification (?report=id&mode=read|brief) or the Tasks page.
  const [report, setReport] = useState<{ id: string; mode: "read" | "brief" } | null>(() => {
    const id = params.get("report");
    return id ? { id, mode: params.get("mode") === "brief" ? "brief" : "read" } : null;
  });
  // Text to pre-fill in the composer (e.g. "About my mission …: "), without sending it.
  const [draft, setDraft] = useState<string | undefined>();
  const setTyping = (text: string) => setDraft(text);
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);
  const loadConversations = () => api.conversations().then(setConversations).catch(() => {});

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ configured: false, model: false, transcription: false }));
    const onUnauth = () => { setToken(""); setAuthed(false); };
    window.addEventListener("cos:unauthorised", onUnauth);
    const onInstall = (e: Event) => { e.preventDefault(); setInstall(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onInstall);
    // Links like ?ask= are one-shot; keep the address bar clean.
    if (params.get("ask") || params.get("voice") || params.get("type") || params.get("item") || params.get("reschedule") || params.get("report")) history.replaceState(null, "", location.pathname + (legacyTab ? `?tab=${legacyTab}` : ""));
    return () => { window.removeEventListener("cos:unauthorised", onUnauth); window.removeEventListener("beforeinstallprompt", onInstall); };
  }, []);

  useEffect(() => { if (authed) { api.settings().then(setSettings).catch(() => {}); loadConversations(); } }, [authed]);

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
  useEffect(() => { if (drawer) loadConversations(); }, [drawer]);
  // From the widget: open one item's details.
  useEffect(() => {
    const id = params.get("item");
    if (!authed || !id) return;
    const reschedule = params.get("reschedule") === "1";
    api.items({ status: "all" }).then((all) => {
      const it = all.find((i) => i.id === id);
      if (it) reschedule ? setRescheduling(it) : setSheet({ item: it });
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

  if (!authed) return <Login health={health} onDone={() => setAuthed(true)} />;

  const go = (v: View) => { setView(v === "missions" ? "tasks" : v); setDrawer(false); };
  const openConversation = (id: string | null) => { setConversationId(id); setAsk(undefined); go("home"); };
  const openItem = (item: Item) => setSheet({ item });
  const current = conversations.find((c) => c.id === conversationId);

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
      <header className="pt-safe px-2 flex items-center gap-1 h-14 shrink-0">
        <button onClick={() => setDrawer(true)} aria-label="Menu" className="p-2.5 rounded-xl text-ink hover:bg-sunken">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
        </button>
        <p className="flex-1 min-w-0 text-center font-medium truncate">
          {view === "home" ? current?.title || "Chief of Staff" : VIEW_TITLES[view]}
        </p>
        <button onClick={() => openConversation(null)} aria-label="New conversation" className="p-2.5 rounded-xl text-ink hover:bg-sunken">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" /></svg>
        </button>
      </header>

      {health && !health.model && (
        <div className="mx-4 mb-2 rounded-xl bg-sunken text-sm px-3 py-2 text-muted">
          The assistant isn't connected to a model yet. Set the <code>OPENAI_API_KEY</code> secret.
        </div>
      )}

      <main className={`flex-1 min-h-0 px-4 ${view === "home" ? "pb-safe" : "overflow-y-auto pb-6"}`}>
        {view === "home" && (
          <Home name={settings?.name ?? ""} conversationId={conversationId}
            onConversation={(id) => { setConversationId(id); loadConversations(); }}
            initialAsk={ask} startVoice={startVoice} startTyping={startTyping || !!draft} draft={draft} onDraftUsed={() => setDraft(undefined)} serverTranscription={!!health?.transcription}
            onDataChanged={refresh} refreshKey={refreshKey} />
        )}
        {view === "today" && <Today name={settings?.name ?? ""} onOpenItem={openItem} goChat={(p) => { openConversation(null); setAsk(p); }} refreshKey={refreshKey} />}
        {(view === "lists" || view === "projects") && (
          <Switch value={view} onChange={(v) => setView(v as View)} options={[["lists", "Lists"], ["projects", "Projects"]]} />
        )}
        {view === "lists" && <Lists onOpenItem={openItem} onNew={(kind) => setSheet({ item: null, kind })} refreshKey={refreshKey} />}
        {view === "projects" && <Projects onOpenItem={openItem} refreshKey={refreshKey} />}

        {view === "search" && (
          <Search query={query} onQuery={setQuery} onOpenItem={openItem} onOpenConversation={(id) => openConversation(id)} />
        )}
        {view === "tasks" && <Tasks refreshKey={refreshKey} onOpenReport={(id, mode) => setReport({ id, mode })} onAsk={(p) => { openConversation(null); setAsk(undefined); setTimeout(() => setTyping(p), 0); }} />}
        {view === "replies" && <Replies serverTranscription={!!health?.transcription} onDataChanged={refresh} refreshKey={refreshKey} />}
        {(view === "library" || view === "dump") && (
          <Library tab={view === "dump" ? "dump" : libraryTab} onTab={(t) => { setLibraryTab(t); setView("library"); }} onOpenItem={openItem} refreshKey={refreshKey}
            brainDump={<BrainDump serverTranscription={!!health?.transcription} onDataChanged={refresh} />}
            onAsk={(p) => { openConversation(null); setAsk(undefined); setTimeout(() => setTyping(p), 0); }} />
        )}
        {view === "settings" && settings && (
          <Settings settings={settings} onSaved={setSettings}
            installPrompt={install ? () => { install.prompt(); setInstall(null); } : null} />
        )}
      </main>

      {drawer && (
        <div className="fixed inset-0 z-40 flex">
          <nav className="w-[82%] max-w-80 h-full bg-surface border-r border-line shadow-card flex flex-col pt-safe pb-safe drawer-in">
            <div className="flex items-center gap-2.5 px-4 h-14 shrink-0"><Logo /><span className="font-medium">Chief of Staff</span></div>
            <form className="px-3 pb-2" onSubmit={(e) => { e.preventDefault(); go("search"); }}>
              <input value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => { if (query) go("search"); }}
                placeholder="🔍  Search everything" enterKeyHint="search"
                className="w-full rounded-full bg-sunken px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-accent/30" />
            </form>
            <div className="px-2 space-y-0.5">
              <DrawerItem onClick={() => openConversation(null)} icon={<path d="M12 5v14M5 12h14" />} label="New conversation" />
              <DrawerItem active={view === "today"} onClick={() => go("today")} icon={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>} label="Today" />
              <DrawerItem active={view === "replies"} onClick={() => go("replies")} icon={<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12zM8 11h8M8 14h5" />} label="Replies" />
              <DrawerItem active={view === "lists" || view === "projects"} onClick={() => go("lists")} icon={<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />} label="Lists & projects" />
              <DrawerItem active={view === "tasks" || view === "missions"} onClick={() => go("tasks")} icon={<path d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-3-6.7M21 4v4h-4" />} label="Tasks" />
              <DrawerItem active={view === "library" || view === "dump"} onClick={() => go("library")} icon={<path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h6" />} label="Library" />
            </div>
            <ConversationList conversations={conversations} activeId={view === "home" ? conversationId : null}
              onOpen={(id) => openConversation(id)}
              onChanged={() => api.conversations().then((list) => {
                setConversations(list);
                if (conversationId && !list.some((c) => c.id === conversationId)) setConversationId(null);
              }).catch(() => {})} />
            <div className="px-2 pt-2 border-t border-line">
              <DrawerItem active={view === "settings"} onClick={() => go("settings")}
                icon={<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>} label="Settings" />
            </div>
          </nav>
          <button aria-label="Close menu" className="flex-1 bg-black/40" onClick={() => setDrawer(false)} />
        </div>
      )}

      {report && (
        <ReportReader id={report.id} autoBrief={report.mode === "brief"} onClose={() => setReport(null)}
          onBrief={(r) => {
            setReport(null);
            openConversation(null);
            setAsk(`Tell me about my report "${r.name}" (report id ${r.id}): the key points, what changed, and what I should do about it.`);
          }} />
      )}
      {rescheduling && (
        <Reschedule item={rescheduling} onClose={() => setRescheduling(null)}
          onSaved={(msg) => { setRescheduling(null); refresh(); setToast(msg); setTimeout(() => setToast(""), 2500); }} />
      )}
      {toast && <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 rounded-full bg-ink text-bg px-4 py-2 text-sm shadow-card">{toast}</div>}

      {sheet && (
        <ItemSheet item={sheet.item} defaultKind={sheet.kind} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); refresh(); }} />
      )}
    </div>
  );
}

function DrawerItem({ active, onClick, label, icon }: { active?: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] text-left ${active ? "bg-sunken" : "hover:bg-sunken"}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      {label}
    </button>
  );
}

const Logo = () => (
  <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-ink text-bg font-display text-[17px] leading-none">
    C<span className="text-accent">s</span>
  </span>
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

/** Small two-option switch at the top of paired pages (Lists/Projects, Recurring/Missions). */
function Switch({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex gap-1 p-1 mb-4 rounded-full bg-sunken w-fit">
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`rounded-full px-4 py-1.5 text-sm ${value === k ? "bg-surface shadow-card text-ink" : "text-muted"}`}>{label}</button>
      ))}
    </div>
  );
}

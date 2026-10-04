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

type View = "home" | "today" | "dump" | "lists" | "projects" | "settings";
const VIEW_TITLES: Record<View, string> = { home: "Chief of Staff", today: "Today", dump: "Brain dump", lists: "Lists", projects: "Projects", settings: "Settings" };

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void> }

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [health, setHealth] = useState<{ configured: boolean; model: boolean; transcription: boolean } | null>(null);
  const params = new URLSearchParams(location.search);
  const legacyTab = params.get("tab");
  const [view, setView] = useState<View>(legacyTab && legacyTab in VIEW_TITLES ? (legacyTab as View) : "home");
  const [ask, setAsk] = useState<string | undefined>(params.get("ask") ?? undefined);
  const [startVoice] = useState(params.get("voice") === "1");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState<S | null>(null);
  const [sheet, setSheet] = useState<{ item: Item | null; kind?: ItemKind } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
    if (params.get("ask") || params.get("voice")) history.replaceState(null, "", location.pathname + (legacyTab ? `?tab=${legacyTab}` : ""));
    return () => { window.removeEventListener("cos:unauthorised", onUnauth); window.removeEventListener("beforeinstallprompt", onInstall); };
  }, []);

  useEffect(() => { if (authed) { api.settings().then(setSettings).catch(() => {}); loadConversations(); } }, [authed]);
  useEffect(() => { if (drawer) loadConversations(); }, [drawer]);

  // Refresh when the app comes back to the foreground (new nudges may have arrived).
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!authed) return <Login health={health} onDone={() => setAuthed(true)} />;

  const go = (v: View) => { setView(v); setDrawer(false); };
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
            initialAsk={ask} startVoice={startVoice} serverTranscription={!!health?.transcription}
            onDataChanged={refresh} refreshKey={refreshKey} />
        )}
        {view === "today" && <Today name={settings?.name ?? ""} onOpenItem={openItem} goChat={(p) => { openConversation(null); setAsk(p); }} refreshKey={refreshKey} />}
        {view === "dump" && <BrainDump serverTranscription={!!health?.transcription} onDataChanged={refresh} />}
        {view === "lists" && <Lists onOpenItem={openItem} onNew={(kind) => setSheet({ item: null, kind })} refreshKey={refreshKey} />}
        {view === "projects" && <Projects onOpenItem={openItem} refreshKey={refreshKey} />}
        {view === "settings" && settings && (
          <Settings settings={settings} onSaved={setSettings}
            installPrompt={install ? () => { install.prompt(); setInstall(null); } : null} />
        )}
      </main>

      {drawer && (
        <div className="fixed inset-0 z-40 flex">
          <nav className="w-[82%] max-w-80 h-full bg-surface border-r border-line shadow-card flex flex-col pt-safe pb-safe drawer-in">
            <div className="flex items-center gap-2.5 px-4 h-14 shrink-0"><Logo /><span className="font-medium">Chief of Staff</span></div>
            <div className="px-2 space-y-0.5">
              <DrawerItem onClick={() => openConversation(null)} icon={<path d="M12 5v14M5 12h14" />} label="New conversation" />
              <DrawerItem active={view === "today"} onClick={() => go("today")} icon={<path d="M4 6h16M4 12h16M4 18h9" />} label="Today" />
              <DrawerItem active={view === "lists"} onClick={() => go("lists")} icon={<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />} label="Lists" />
              <DrawerItem active={view === "projects"} onClick={() => go("projects")} icon={<path d="M3 7h6l2 2h10v10H3z" />} label="Projects" />
              <DrawerItem active={view === "dump"} onClick={() => go("dump")} icon={<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />} label="Brain dump" />
            </div>
            <p className="px-5 pt-5 pb-1.5 text-[11px] font-medium text-muted uppercase tracking-[0.14em]">Conversations</p>
            <div className="flex-1 overflow-y-auto px-2">
              {conversations.length === 0 && <p className="px-3 py-2 text-sm text-muted">Nothing yet. Just start talking.</p>}
              {conversations.map((c) => (
                <button key={c.id} onClick={() => openConversation(c.id)}
                  className={`w-full text-left rounded-xl px-3 py-2.5 ${c.id === conversationId && view === "home" ? "bg-sunken" : "hover:bg-sunken"}`}>
                  <p className="text-[15px] truncate">{c.title || "New conversation"}</p>
                  <p className="text-xs text-muted">{timeAgo(c.last_message_at)}</p>
                </button>
              ))}
            </div>
            <div className="px-2 pt-2 border-t border-line">
              <DrawerItem active={view === "settings"} onClick={() => go("settings")}
                icon={<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>} label="Settings" />
            </div>
          </nav>
          <button aria-label="Close menu" className="flex-1 bg-black/40" onClick={() => setDrawer(false)} />
        </div>
      )}

      {sheet && (
        <ItemSheet item={sheet.item} defaultKind={sheet.kind} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); refresh(); }} />
      )}
    </div>
  );
}

function DrawerItem({ active, onClick, label, icon }: { active?: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] ${active ? "bg-sunken" : "hover:bg-sunken"}`}>
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

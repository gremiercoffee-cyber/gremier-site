import { useEffect, useState, type ReactNode } from "react";
import type { Item, ItemKind, Settings as S } from "../shared/types";
import { api, getToken, setToken } from "./api";
import { Button } from "./components/ui";
import ItemSheet from "./components/ItemSheet";
import Today from "./pages/Today";
import Chat from "./pages/Chat";
import BrainDump from "./pages/BrainDump";
import Lists from "./pages/Lists";
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";

type Tab = "today" | "chat" | "dump" | "lists" | "projects" | "settings";

interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void> }

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [health, setHealth] = useState<{ configured: boolean; model: boolean; transcription: boolean } | null>(null);
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "today");
  const [chatPrompt, setChatPrompt] = useState<string | undefined>();
  const [startVoice] = useState(params.get("voice") === "1");
  const [settings, setSettings] = useState<S | null>(null);
  const [sheet, setSheet] = useState<{ item: Item | null; kind?: ItemKind } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ configured: false, model: false, transcription: false }));
    const onUnauth = () => { setToken(""); setAuthed(false); };
    window.addEventListener("cos:unauthorised", onUnauth);
    const onInstall = (e: Event) => { e.preventDefault(); setInstall(e as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => { window.removeEventListener("cos:unauthorised", onUnauth); window.removeEventListener("beforeinstallprompt", onInstall); };
  }, []);

  useEffect(() => { if (authed) api.settings().then(setSettings).catch(() => {}); }, [authed]);

  // Refresh data when the app comes back to the foreground (proactive nudges may have arrived).
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  if (!authed) return <Login health={health} onDone={() => setAuthed(true)} />;

  const goChat = (prompt?: string) => { setChatPrompt(prompt); setTab("chat"); };
  const openItem = (item: Item) => setSheet({ item });

  return (
    <div className="h-full flex flex-col max-w-2xl mx-auto">
      <header className="pt-safe px-4 flex items-center justify-between h-14 shrink-0">
        <button onClick={() => setTab("today")} className="flex items-center gap-2.5 font-medium tracking-tight">
          <Logo /> Chief of Staff
        </button>
        <button onClick={() => setTab("settings")} aria-label="Settings" className={`p-2 rounded-xl ${tab === "settings" ? "bg-sunken" : "text-muted"}`}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      </header>

      {health && !health.model && (
        <div className="mx-4 mb-2 rounded-xl bg-sunken text-sm px-3 py-2 text-muted">
          The assistant isn't connected to a model yet — set the <code>OPENAI_API_KEY</code> secret. Lists and projects still work.
        </div>
      )}

      <main className={`flex-1 min-h-0 px-4 ${tab === "chat" ? "pb-3" : "overflow-y-auto pb-6"}`}>
        {tab === "today" && <Today name={settings?.name ?? ""} onOpenItem={openItem} goChat={goChat} refreshKey={refreshKey} />}
        {tab === "chat" && (
          <Chat key={chatPrompt ?? "chat"} initialPrompt={chatPrompt} startVoice={startVoice} serverTranscription={!!health?.transcription} onDataChanged={refresh} />
        )}
        {tab === "dump" && <BrainDump serverTranscription={!!health?.transcription} onDataChanged={refresh} />}
        {tab === "lists" && <Lists onOpenItem={openItem} onNew={(kind) => setSheet({ item: null, kind })} refreshKey={refreshKey} />}
        {tab === "projects" && <Projects onOpenItem={openItem} refreshKey={refreshKey} />}
        {tab === "settings" && settings && (
          <Settings settings={settings} onSaved={setSettings}
            installPrompt={install ? () => { install.prompt(); setInstall(null); } : null} />
        )}
      </main>

      <nav className="shrink-0 border-t border-line/70 bg-bg/80 backdrop-blur-xl pb-safe">
        <div className="grid grid-cols-5">
          <NavButton active={tab === "today"} onClick={() => setTab("today")} label="Today" icon={<path d="M3 10.5 12 3l9 7.5V21H3z" />} />
          <NavButton active={tab === "chat"} onClick={() => goChat()} label="Chat" icon={<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />} />
          <NavButton active={tab === "dump"} onClick={() => setTab("dump")} label="Dump" icon={<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />} />
          <NavButton active={tab === "lists"} onClick={() => setTab("lists")} label="Lists" icon={<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />} />
          <NavButton active={tab === "projects"} onClick={() => setTab("projects")} label="Projects" icon={<path d="M3 7h6l2 2h10v10H3z" />} />
        </div>
      </nav>

      {sheet && (
        <ItemSheet item={sheet.item} defaultKind={sheet.kind} onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); refresh(); }} />
      )}
    </div>
  );
}

function NavButton({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: ReactNode }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "text-accent" : "text-muted"}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
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

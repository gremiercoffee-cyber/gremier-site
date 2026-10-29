import { useEffect, useRef, useState } from "react";
import { api, type JobChat, type JobChatRow } from "../api";
import { Button, Empty, Markdown, timeAgo } from "./ui";

/** Research chats pinned in the side panel: tap one to open it; the dot means new answers. */
export function PinnedResearch({ jobs, activeId, onOpen }: { jobs: JobChatRow[]; activeId: string | null; onOpen: (id: string) => void }) {
  const pinned = jobs.filter((j) => j.pinned);
  if (!pinned.length) return null;
  return (
    <div className="px-2 pt-3">
      <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Research</p>
      {pinned.map((j) => (
        <button key={j.id} onClick={() => onOpen(j.id)}
          className={`w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] text-left ${activeId === j.id ? "bg-sunken" : "hover:bg-sunken"}`}>
          <span className="text-base leading-none">{j.status === "active" ? "🔎" : j.status === "pending" ? "⏸️" : "📌"}</span>
          <span className="flex-1 min-w-0 truncate">{j.title}</span>
          {j.unread > 0 && <span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-label="New" />}
        </button>
      ))}
    </div>
  );
}

const STATUS: Record<string, string> = { pending: "Waiting for Start", active: "On", paused: "Off (unpinned)", stopped: "Stopped", done: "Done" };

/** One research chat: its answers, its questions (Start, Run it now / Skip), and a box to change it. */
export function ResearchChat({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [chat, setChat] = useState<JobChat | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const load = () => api.job(id).then((c) => { setChat(c); setError(""); }).catch((e) => setError((e as Error).message));
  useEffect(() => { setChat(null); load().then(onChanged); }, [id]);
  // New answers arrive by themselves: look every 15 seconds while it's working, every minute otherwise.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, chat?.busy ? 15_000 : 60_000);
    return () => clearInterval(t);
  }, [id, chat?.busy]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat?.messages.length, sending]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setText("");
    setChat((c) => c && { ...c, messages: [...c.messages, { id: "draft", job_id: id, role: "you", text: t, buttons: null, created_at: new Date().toISOString() }] });
    try { await api.jobMessage(id, t); } catch (e) { setError((e as Error).message); }
    await load(); setSending(false); onChanged();
  };
  const press = async (data: string) => { await api.jobButton(data).catch((e) => setError((e as Error).message)); await load(); onChanged(); };
  const pin = async (pinned: boolean) => { await api.jobPin(id, pinned).catch((e) => setError((e as Error).message)); await load(); onChanged(); };

  if (!chat) return <p className="text-sm text-muted mt-4">{error || "Loading…"}</p>;
  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 pb-2 border-b border-line">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="font-medium text-[17px] truncate">{chat.title}</h2>
            <p className="text-xs text-muted">{STATUS[chat.status] ?? chat.status} · {chat.schedule}</p>
          </div>
          <Button variant="soft" onClick={() => void pin(!chat.pinned)}>{chat.pinned ? "📌 Unpin" : "📌 Pin"}</Button>
        </div>
        {chat.pinned && chat.status === "active" && chat.kind !== "once" && <p className="text-[11px] text-muted mt-1">Unpin it when you're done: that turns it off. Pin it again any time to turn it back on.</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-3 space-y-3">
        {chat.messages.map((m) => m.role === "you" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent text-accent-ink px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap">{m.text}</div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-2.5 items-start">
            <span className="mt-1 h-7 w-7 shrink-0 grid place-items-center rounded-full bg-sunken text-sm">🔎</span>
            <div className="flex-1 min-w-0 rounded-2xl rounded-tl-md bg-surface border border-line/70 shadow-card px-4 py-3 text-[15px] leading-relaxed">
              <Markdown text={m.text} />
              {m.buttons && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {m.buttons.flat().map((b, i) => <Button key={b.data} variant={i === 0 ? undefined : "ghost"} onClick={() => void press(b.data)}>{b.text}</Button>)}
                </div>
              )}
              <p className="text-[11px] text-muted mt-1.5">{timeAgo(m.created_at)}</p>
            </div>
          </div>
        ))}
        {(sending || chat.busy) && <p className="text-xs text-muted pl-10">{sending ? "…" : "Working on it… you'll get a notification when it's ready."}</p>}
        <div ref={end} />
      </div>

      {error && <p className="text-xs text-danger pb-1">{error}</p>}
      <form className="shrink-0 flex gap-2 items-end pb-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} dir="auto"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Ask, or change it: “every 2 hours”, “use Sol”…"
          className="flex-1 resize-none rounded-2xl bg-sunken px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-accent/30 max-h-40" />
        <Button type="submit" disabled={!text.trim() || sending}>Send</Button>
      </form>
    </div>
  );
}

/** Every research chat, for the Tasks tab: pinned ones first; pin/unpin from here too. */
export function ResearchList({ jobs, onOpen, onNew, onChanged }: { jobs: JobChatRow[]; onOpen: (id: string) => void; onNew: () => void; onChanged: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="font-medium flex-1">Research chats</h3>
        <Button onClick={onNew}>+ New research</Button>
      </div>
      {!jobs.length && <Empty>No research chats yet. Tell me what to look into, once, every hour, or every week.</Empty>}
      {jobs.map((j) => (
        <div key={j.id} className="rounded-2xl bg-sunken/60 p-3 flex items-start gap-3">
          <button onClick={() => onOpen(j.id)} className="flex-1 min-w-0 text-left">
            <p className="text-[15px] font-medium truncate">{j.unread > 0 && <span className="inline-block h-2 w-2 rounded-full bg-accent mr-1.5 align-middle" />}{j.title}</p>
            <p className="text-xs text-muted">{STATUS[j.status] ?? j.status} · {j.schedule}</p>
            {j.last_text && <p className="text-xs text-muted truncate mt-0.5">{j.last_text} · {timeAgo(j.last_at)}</p>}
          </button>
          <Button variant="ghost" onClick={async () => { await api.jobPin(j.id, !j.pinned); onChanged(); }}>{j.pinned ? "Unpin" : "📌 Pin"}</Button>
        </div>
      ))}
    </div>
  );
}

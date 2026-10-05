import { useEffect, useState } from "react";
import { api, type ReplyCard } from "../api";
import { Button, DictateButton, Empty } from "../components/ui";

const AREA: Record<string, string> = { coffee: "☕", yeshiva: "📚", personal: "🏠" };
const waited = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3600_000;
  return h < 1 ? "under an hour" : h < 24 ? `${Math.round(h)}h` : `${Math.round(h / 24)} day${h >= 48 ? "s" : ""}`;
};

/**
 * Everyone you owe a reply, in one place. Nothing is drafted until you ask: type (or say) what you
 * want to answer, in any form, and tap Draft to have it written in your style; edit, Send, next.
 */
export default function Replies({ serverTranscription, onDataChanged, refreshKey }: {
  serverTranscription: boolean; onDataChanged: () => void; refreshKey: number;
}) {
  const [cards, setCards] = useState<ReplyCard[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [session, setSession] = useState(false);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [drafting, setDrafting] = useState("");

  const load = () => api.replies().then((c) => {
    setCards(c);
    setDrafts((d) => Object.fromEntries(c.map((x) => [x.id, d[x.id] ?? ""])));
  }).catch(() => setCards([]));
  useEffect(() => { load(); }, [refreshKey]);

  const open = (cards ?? []).filter((c) => !status[c.id]);

  const send = async (c: ReplyCard) => {
    setBusy(c.id);
    try {
      const r = await api.sendReply(c.id, drafts[c.id] ?? "");
      setStatus((s) => ({ ...s, [c.id]: r.message }));
      onDataChanged();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const drop = async (c: ReplyCard) => {
    await api.updateItem(c.id, { status: "dropped" });
    setStatus((s) => ({ ...s, [c.id]: "No reply needed" }));
    onDataChanged();
  };

  const draftIt = async (c: ReplyCard) => {
    setDrafting(c.id);
    try { const r = await api.draftReply(c.id, drafts[c.id] ?? ""); setDrafts((d) => ({ ...d, [c.id]: r.text })); }
    catch (e) { alert((e as Error).message); }
    setDrafting("");
  };

  if (!cards) return <p className="text-sm text-muted">Loading…</p>;
  if (cards.length === 0) return <Empty>No one is waiting for a reply. ✨</Empty>;

  // ---- Session: one person at a time ----
  if (session) {
    const c = open[Math.min(index, open.length - 1)];
    if (!c) {
      return (
        <div className="text-center pt-16 space-y-3">
          <p className="font-display text-[28px]">All caught up.</p>
          <p className="text-muted text-sm">{Object.keys(status).length} handled this session.</p>
          <Button onClick={() => { setSession(false); load(); }}>Done</Button>
        </div>
      );
    }
    return (
      <div className="space-y-4 pt-1">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{open.length} left</span>
          <button onClick={() => setSession(false)}>Exit</button>
        </div>
        <Card c={c} draft={drafts[c.id] ?? ""} setDraft={(t) => setDrafts((d) => ({ ...d, [c.id]: t }))}
          serverTranscription={serverTranscription} busy={busy === c.id} big drafting={drafting === c.id} onDraft={() => draftIt(c)}
          onSend={() => send(c)} onSkip={() => setIndex((i) => i + 1)} onDrop={() => drop(c)} />
      </div>
    );
  }

  // ---- Overview list ----
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{open.length} {open.length === 1 ? "person is" : "people are"} waiting for your reply.</p>
        {open.length > 0 && <Button onClick={() => { setIndex(0); setSession(true); }}>Start replying</Button>}
      </div>
      {cards.map((c) => status[c.id] ? (
        <div key={c.id} className="rounded-2xl border border-line px-4 py-3 text-sm text-muted">✓ {c.person ?? "Reply"}: {status[c.id]}</div>
      ) : (
        <Card key={c.id} c={c} draft={drafts[c.id] ?? ""} setDraft={(t) => setDrafts((d) => ({ ...d, [c.id]: t }))}
          serverTranscription={serverTranscription} busy={busy === c.id} drafting={drafting === c.id} onDraft={() => draftIt(c)}
          onSend={() => send(c)} onDrop={() => drop(c)} />
      ))}
    </div>
  );
}

function Card({ c, draft, setDraft, serverTranscription, busy, big, drafting, onDraft, onSend, onSkip, onDrop }: {
  c: ReplyCard; draft: string; setDraft: (t: string) => void; serverTranscription: boolean; busy: boolean; big?: boolean;
  drafting: boolean; onDraft: () => void; onSend: () => void; onSkip?: () => void; onDrop: () => void;
}) {
  return (
    <section className="rounded-[20px] bg-surface border border-line/70 shadow-card p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className={`${big ? "font-display text-[26px]" : "font-medium text-[16px]"} leading-tight`}>
          {c.category && <span className="mr-1">{AREA[c.category]}</span>}{c.person ?? "Someone"}
        </p>
        <span className="text-xs text-muted shrink-0">{c.channel === "email" ? "✉️ Email" : "💬 WhatsApp"} · {waited(c.waiting_since)}</span>
      </div>
      <blockquote className="border-l-2 border-line pl-3 text-[15px] text-ink/80 whitespace-pre-wrap" dir="auto">
        {c.subject && <span className="block text-xs text-muted mb-0.5">{c.subject}</span>}
        {c.said}
      </blockquote>
      {c.why && <p className="text-xs text-accent">Why it matters: {c.why}</p>}
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} dir="auto"
        rows={big ? 5 : 3} placeholder="Write your reply, or jot what you want to say (e.g. Tuesday works, keep it short) and tap Draft"
        className="w-full rounded-2xl bg-sunken px-4 py-3 outline-none text-[15px] resize-none focus:ring-2 focus:ring-accent/30" />
      <div className="flex flex-wrap items-center gap-2">
        <DictateButton serverTranscription={serverTranscription} onText={(t) => setDraft(t)} />
        <Button variant="soft" onClick={onDraft} disabled={drafting}>{drafting ? "Drafting…" : draft.trim() ? "✨ Draft from this" : "✨ Draft"}</Button>
        <Button onClick={onSend} disabled={busy || !draft.trim()}>
          {busy ? "Sending…" : c.channel === "email" ? "Save as draft" : "Send"}
        </Button>
        {onSkip && <Button variant="soft" onClick={onSkip}>Skip</Button>}
        <Button variant="ghost" onClick={onDrop}>No reply needed</Button>
      </div>
    </section>
  );
}

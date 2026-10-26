import { useEffect, useState } from "react";
import { api, type Collection } from "../api";
import { useOpenSet } from "../remember";
import { Button, timeAgo } from "./ui";

const SRC: Record<string, string> = { gmail: "✉️", whatsapp: "💬", manual: "✍️" };

/**
 * A group's collections: one folder per thing you're collecting ("Chanukah party plans"), with a place for each
 * person: what they've sent (by email or WhatsApp, filed automatically) and anything you write in yourself.
 */
export default function Collections({ groupId, refreshKey }: { groupId: string; refreshKey: number }) {
  const [list, setList] = useState<Collection[] | null>(null);
  const [opened, setOpened] = useOpenSet("cos.collectionsOpen");
  const load = () => api.groupCollections(groupId).then(setList).catch(() => setList([]));
  useEffect(() => { void load(); }, [groupId, refreshKey]);
  if (!list?.length) return null;
  return (
    <section className="space-y-2" aria-label="Collections">
      <p className="text-[11px] font-medium text-muted uppercase tracking-[0.14em] px-1">📁 Collecting answers</p>
      {list.map((c) => (
        <details key={c.id} open={opened.has(c.id)} onToggle={(e) => setOpened(c.id, e.currentTarget.open)} className="rounded-2xl bg-surface border border-line overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 flex items-center gap-2">
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-medium truncate">📁 {c.name}</span>
              <span className="block text-xs text-muted truncate">{c.collecting}</span>
            </span>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${c.total && c.answered === c.total ? "bg-ok/15 text-ok" : "bg-sunken text-muted"}`}>{c.answered} of {c.total}</span>
          </summary>
          <div className="px-4 pb-4 space-y-2">
            {!c.active && <p className="text-xs text-muted">Not collecting any more. New messages aren't filed here.</p>}
            {c.people.map((p) => <PersonRow key={p.name} c={c} p={p} onChanged={load} />)}
            {!!c.other.length && <div className="rounded-xl bg-sunken/60 p-3"><p className="text-xs font-medium text-muted mb-1">Other messages about this</p>{c.other.map((e) => <Answer key={e.id} e={e} />)}</div>}
            <div className="flex flex-wrap gap-2 pt-1 text-sm">
              {c.doc_link && <a href={c.doc_link} target="_blank" rel="noreferrer" className="text-accent">Open the Google Doc</a>}
              <button className="text-muted" onClick={async () => { await api.trackerActive(c.id, !c.active); await load(); }}>{c.active ? "Stop collecting" : "Start collecting again"}</button>
            </div>
          </div>
        </details>
      ))}
    </section>
  );
}

function Answer({ e }: { e: { source: string; text: string; said_at: string } }) {
  return (
    <div className="text-sm py-1">
      <span className="text-xs text-muted">{SRC[e.source] ?? "•"} {timeAgo(e.said_at)}</span>
      <p className="whitespace-pre-wrap" dir="auto">{e.text}</p>
    </div>
  );
}

function PersonRow({ c, p, onChanged }: { c: Collection; p: Collection["people"][number]; onChanged: () => void }) {
  const [writing, setWriting] = useState(false), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { await api.addAnswer(c.id, p.name, text); setText(""); setWriting(false); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={`rounded-xl p-3 ${p.answered ? "bg-ok/5 border border-ok/20" : "bg-sunken/60"}`}>
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 text-[15px] font-medium truncate">{p.answered ? "✓ " : "⏳ "}{p.name}</span>
        {!writing && <button className="text-xs text-accent shrink-0" onClick={() => setWriting(true)}>✍️ Write in an answer</button>}
      </div>
      {!p.answers.length && !writing && <p className="text-xs text-muted">Nothing yet.</p>}
      {p.answers.map((e) => <Answer key={e.id} e={e} />)}
      {writing && (
        <div className="space-y-2 mt-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} dir="auto" placeholder={`What ${p.name} told you`} className="w-full rounded-xl bg-surface px-3 py-2 text-sm" />
          <div className="flex gap-2"><Button onClick={() => void save()} disabled={busy || !text.trim()}>Save</Button><Button variant="ghost" onClick={() => setWriting(false)}>Cancel</Button></div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

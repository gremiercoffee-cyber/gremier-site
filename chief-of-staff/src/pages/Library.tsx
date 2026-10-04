import { useEffect, useState, type ReactNode } from "react";
import type { BrainDump, Item, Memory } from "../../shared/types";
import { api } from "../api";
import { Button, Card, Empty, ItemRow, timeAgo } from "../components/ui";

export type LibraryTab = "dump" | "ideas" | "trackers" | "people" | "memory" | "dumps";
const TABS: [LibraryTab, string][] = [["memory", "What I know"], ["dump", "Brain dump"], ["ideas", "Ideas"]];
const AREAS: [string, string][] = [["all", "All"], ["coffee", "☕ Coffee"], ["yeshiva", "📚 Yeshiva"], ["personal", "🏠 Personal"]];

/** Everything your Chief of Staff has organized, to browse: ideas, people, memories, past brain dumps. */
export default function Library({ tab, onTab, onOpenItem, refreshKey, brainDump, onAsk }: {
  tab: LibraryTab; onTab: (t: LibraryTab) => void; onOpenItem: (i: Item) => void; refreshKey: number; brainDump: ReactNode; onAsk: (t: string) => void;
}) {
  const [ideas, setIdeas] = useState<Item[]>([]);
  const [people, setPeople] = useState<Awaited<ReturnType<typeof api.people>>>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [dumps, setDumps] = useState<BrainDump[]>([]);
  const [area, setArea] = useState("all");

  const load = () => {
    if (tab === "ideas") api.items({ kind: "idea", status: "open" }).then(setIdeas).catch(() => {});
    if (tab === "people") api.people().then(setPeople).catch(() => {});
    if (tab === "memory") api.memories().then(setMemories).catch(() => {});
    if (tab === "dumps") api.brainDumps().then(setDumps).catch(() => {});
  };
  useEffect(load, [tab, refreshKey]);

  const shownIdeas = ideas.filter((i) => area === "all" || i.category === area);
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => onTab(k)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm ${tab === k ? "bg-ink text-bg" : "bg-sunken text-muted"}`}>{label}</button>
        ))}
      </div>

      {tab === "dump" && brainDump}

      {tab === "ideas" && (
        <Card title={`Ideas & notes (${shownIdeas.length})`}>
          <div className="flex gap-1 mb-2 flex-wrap">
            {AREAS.map(([k, label]) => (
              <button key={k} onClick={() => setArea(k)} className={`rounded-full px-2.5 py-1 text-xs ${area === k ? "bg-accent/15 text-accent" : "text-muted"}`}>{label}</button>
            ))}
          </div>
          {shownIdeas.length === 0 ? <Empty>No ideas saved yet. Say "idea: …" and I'll keep it here.</Empty> : (
            <div className="divide-y divide-line">{shownIdeas.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} />)}</div>
          )}
        </Card>
      )}

      {tab === "memory" && <MemoryReview memories={memories} reload={load} />}

      {tab === "dumps" && (
        <Card title={`Brain dumps (${dumps.length})`}>
          {dumps.length === 0 ? <Empty>No brain dumps yet.</Empty> : dumps.map((b) => (
            <details key={b.id} className="py-2 border-b border-line last:border-0">
              <summary className="text-sm cursor-pointer">{b.summary || b.raw.slice(0, 80)} <span className="text-xs text-muted">· {timeAgo(b.created_at)}</span></summary>
              <p className="text-sm text-muted whitespace-pre-wrap mt-1">{b.raw}</p>
            </details>
          ))}
        </Card>
      )}
    </div>
  );
}

/** WhatsApp trackers: topics collected continuously into one place (and a Google Doc). */
export function Trackers({ onAsk, refreshKey }: { onAsk: (t: string) => void; refreshKey: number }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.trackers>>>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<{ chat: string; sender: string; text: string; said_at: string }[]>([]);
  const load = () => api.trackers().then(setList).catch(() => {});
  useEffect(() => { load(); }, [refreshKey]);
  const show = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    setEntries((await api.trackerEntries(id)).entries ?? []);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted px-1">
        I collect every WhatsApp message on a topic into one place and a Google Doc, e.g. "track everything the rabbis say about …". Ask me to analyze it any time.
      </p>
      <Button onClick={() => onAsk("Track in WhatsApp: ")}>+ New tracker</Button>
      {list.length === 0 && <Empty>No trackers yet.</Empty>}
      {list.map((t) => (
        <Card key={t.id} title={<span>{t.active ? "Collecting" : "Paused"} · {t.n} message{t.n === 1 ? "" : "s"}{t.last ? ` · last ${timeAgo(t.last)}` : ""}</span>}>
          <p className="font-display text-[20px] leading-snug">{t.name}</p>
          <p className="text-sm text-muted mt-0.5">{t.topic}</p>
          <p className="text-xs text-muted mt-1">Watching for: {t.keywords || "—"}{t.people ? ` · from ${t.people}` : ""}{t.accounts !== "both" ? ` · ${t.accounts} WhatsApp` : ""}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button onClick={() => onAsk(`Analyze everything my tracker "${t.name}" collected: the main answers/positions, who said what, where they agree and disagree, and open questions.`)}>Analyze</Button>
            {t.doc_link && <a href={t.doc_link} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-full bg-sunken px-4 py-2 text-sm font-medium">📄 Open Doc</a>}
            <Button variant="soft" onClick={() => show(t.id)}>{open === t.id ? "Hide messages" : "See messages"}</Button>
            <Button variant="soft" onClick={async () => { await api.saveTracker({ id: t.id, active: !t.active }); load(); }}>{t.active ? "Pause" : "Resume"}</Button>
            <Button variant="danger" onClick={async () => { if (window.confirm(`Delete "${t.name}" and what it collected? (The Google Doc stays.)`)) { await api.deleteTracker(t.id); load(); } }}>Delete</Button>
          </div>
          {open === t.id && (
            <ul className="mt-3 space-y-2">
              {entries.length === 0 && <li className="text-sm text-muted">Nothing collected yet.</li>}
              {entries.slice().reverse().map((e, i) => (
                <li key={i} className="rounded-2xl bg-sunken px-3 py-2">
                  <p className="text-xs text-muted">{e.sender}{e.chat !== e.sender ? ` · ${e.chat}` : ""} · {timeAgo(e.said_at)}</p>
                  <p className="text-[14px] whitespace-pre-wrap" dir="auto">{e.text}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

/** The people I know about: who they are to you and how to reach them. */
export function People({ refreshKey }: { refreshKey: number }) {
  const [people, setPeople] = useState<Awaited<ReturnType<typeof api.people>>>([]);
  useEffect(() => { api.people().then(setPeople).catch(() => {}); }, [refreshKey]);
  return (
        <Card title={`People (${people.length})`}>
          {people.length === 0 ? <Empty>No one yet. Mention someone and I'll remember them.</Empty> : (
            <ul className="divide-y divide-line">
              {people.map((p) => (
                <li key={p.id} className="py-2.5">
                  <p className="text-[15px] font-medium">{p.name}{p.role && <span className="text-muted font-normal"> · {p.role}</span>}</p>
                  <p className="text-xs text-muted">{[p.email, p.whatsapp_name && `WhatsApp: ${p.whatsapp_name}`, p.preferred_channel && `prefers ${p.preferred_channel}`].filter(Boolean).join(" · ") || "No contact details yet"}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
  );
}

const MEM_AREAS: [string, string][] = [["coffee", "☕ Coffee"], ["yeshiva", "📚 Yeshiva"], ["personal", "🏠 Personal"], ["", "General"]];
const KIND_LABEL: Record<string, string> = { person: "Who's who", schedule: "Schedule", preference: "Preference" };

/** What I picked up (to review) and what I know (confirmed), grouped by area. */
function MemoryReview({ memories, reload }: { memories: Memory[]; reload: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = memories.filter((m) => m.status === "suggested");
  const known = memories.filter((m) => m.status !== "suggested");
  const act = async (id: string, action: "accept" | "edit" | "ignore", content?: string) => {
    await api.reviewMemory(id, action, content); setEditing(null); reload();
  };
  const learn = async () => { setBusy(true); try { await api.learnNow(); } catch { /* shown as nothing new */ } setBusy(false); reload(); };
  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between px-1 mb-1.5">
          <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted">To review{pending.length ? <span className="ml-1.5 font-normal opacity-70">{pending.length}</span> : null}</h2>
          <button onClick={learn} disabled={busy} className="text-xs text-accent">{busy ? "Looking…" : "Look for more now"}</button>
        </div>
        {pending.length === 0 ? <Empty>Nothing to review. I'll keep picking things up from your chats, WhatsApp, email and calendar.</Empty> : (
          <div className="space-y-2">
            {pending.map((m) => (
              <div key={m.id} className="rounded-2xl bg-surface border border-accent/30 p-4">
                <p className="text-[11px] uppercase tracking-wide text-accent">
                  I sensed{KIND_LABEL[m.category] ? ` · ${KIND_LABEL[m.category]}` : ""}{m.area ? ` · ${MEM_AREAS.find(([k]) => k === m.area)?.[1] ?? m.area}` : ""}
                </p>
                {editing === m.id ? (
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} dir="auto"
                    className="mt-1 w-full rounded-xl border border-line bg-sunken p-2 text-[15px]" />
                ) : (
                  <p className="text-[15px] leading-snug mt-0.5" dir="auto">{m.content}</p>
                )}
                {m.question && editing !== m.id && <p className="text-sm text-muted mt-1">{m.question}</p>}
                {m.evidence && <p className="text-xs text-muted mt-1">Seen in: {m.evidence}</p>}
                <div className="flex gap-2 mt-3">
                  {editing === m.id ? (
                    <>
                      <Button onClick={() => act(m.id, "edit", text)}>Save</Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => act(m.id, "accept")}>That's right</Button>
                      <Button variant="soft" onClick={() => { setEditing(m.id); setText(m.content); }}>Change</Button>
                      <Button variant="ghost" onClick={() => act(m.id, "ignore")}>Ignore</Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {MEM_AREAS.map(([area, label]) => {
        const list = known.filter((m) => (m.area ?? "") === area);
        if (!list.length) return null;
        return (
          <section key={area}>
            <h2 className="px-1 mb-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted">{label}<span className="ml-1.5 font-normal opacity-70">{list.length}</span></h2>
            <ul className="rounded-2xl bg-surface border border-line px-4 divide-y divide-line">
              {list.map((m) => (
                <li key={m.id} className="py-2.5 flex gap-2 items-start">
                  {editing === m.id ? (
                    <div className="flex-1">
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} dir="auto" className="w-full rounded-xl border border-line bg-sunken p-2 text-sm" />
                      <div className="flex gap-2 mt-1"><Button onClick={() => act(m.id, "edit", text)}>Save</Button><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <>
                      <p className="flex-1 text-sm" dir="auto" onClick={() => { setEditing(m.id); setText(m.content); }}>{m.content}</p>
                      <button className="text-xs text-muted hover:text-danger" onClick={async () => { if (window.confirm("Forget this?")) { await api.deleteMemory(m.id); reload(); } }}>Forget</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {known.length === 0 && pending.length === 0 && <Empty>Nothing remembered yet.</Empty>}
    </div>
  );
}

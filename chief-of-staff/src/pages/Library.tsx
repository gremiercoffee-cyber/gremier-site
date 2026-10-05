import { useEffect, useState, type ReactNode } from "react";
import type { BrainDump, Item, Memory } from "../../shared/types";
import { api } from "../api";
import { Button, Card, Empty, ItemRow, Markdown, timeAgo } from "../components/ui";

export type LibraryTab = "dump" | "ideas" | "trackers" | "people" | "memory" | "dumps";
const TABS: [LibraryTab, string][] = [["ideas", "Ideas"], ["memory", "What I know"]];
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
    if (tab === "ideas" || tab === "dump") api.brainDumps().then(setDumps).catch(() => {});
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


      {(tab === "ideas" || tab === "dump") && <Ideas onAsk={onAsk} refreshKey={refreshKey} dumps={dumps} />}

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
  const [people, setPeople] = useState<(Awaited<ReturnType<typeof api.people>>[number] & { key?: number })[]>([]);
  const load = () => api.people().then(setPeople).catch(() => {});
  useEffect(() => { load(); }, [refreshKey]);
  const sorted = [...people].sort((a, b) => (b.key ?? 0) - (a.key ?? 0) || a.name.localeCompare(b.name));
  return (
    <div className="space-y-2 mt-4">
      <p className="text-sm text-muted px-1">★ = always on my mind (sent with every message; keep it to the few central people). Everyone else I look up when you mention them.</p>
      <Card title={`People (${people.length})`}>
        {people.length === 0 ? <Empty>No one yet. Mention someone and I'll remember them.</Empty> : (
          <ul className="divide-y divide-line">
            {sorted.map((p) => (
              <li key={p.id} className="py-2.5 flex gap-2 items-start">
                <button aria-label={p.key ? "Unstar" : "Star"} onClick={async () => { await api.setKeyPerson(p.id, !p.key); load(); }}
                  className={`text-[18px] leading-none mt-0.5 ${p.key ? "text-amber-500" : "text-line hover:text-muted"}`}>★</button>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium">{p.name}{p.role && <span className="text-muted font-normal"> · {p.role}</span>}</p>
                  <p className="text-xs text-muted">{[p.email, p.whatsapp_name && `WhatsApp: ${p.whatsapp_name}`, p.preferred_channel && `prefers ${p.preferred_channel}`].filter(Boolean).join(" · ") || "No contact details yet"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
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

const VERDICT: Record<string, [string, string]> = {
  promising: ["Promising", "bg-emerald-500/15 text-emerald-700"], mixed: ["Mixed", "bg-amber-500/15 text-amber-700"], doubtful: ["Doubtful", "bg-rose-500/15 text-rose-700"],
};
const STEP_ICON: Record<string, string> = { research: "🔎", plan: "🗺️", remind: "⏰", task: "✅", other: "➡️" };
const STATUS_LABEL: Record<string, string> = { new: "New", exploring: "Exploring", parked: "Parked", done: "Done" };
type IStep = { id: string; label: string; kind: string; status: string; detail?: string };
type INote = { at: string; kind: string; text: string; sources?: string[] };
const pj = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };

/** Ideas you work on together: summary, honest take, next steps to pick, and what was added since. */
function Ideas({ onAsk, refreshKey, dumps }: { onAsk: (t: string) => void; refreshKey: number; dumps: BrainDump[] }) {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.ideas>> | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api.ideas().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [refreshKey]);
  if (!list) return <p className="text-sm text-muted">Loading…</p>;

  const step = async (id: string, s: IStep, action: "do" | "dismiss") => {
    setBusy(s.id);
    try { await api.ideaStep(id, s.id, action); } finally { setBusy(null); load(); }
    if (action === "do" && s.kind === "research") window.setTimeout(load, 45_000);
  };
  const live = list.filter((i) => i.status === "new" || i.status === "exploring");
  const rest = list.filter((i) => i.status !== "new" && i.status !== "exploring");

  const card = (i: (typeof list)[number]) => {
    const steps = pj<IStep[]>(i.steps, []);
    const notes = pj<INote[]>(i.notes, []);
    const suggested = steps.filter((s) => s.status === "suggested");
    const going = steps.filter((s) => s.status === "queued" || s.status === "working");
    const isOpen = open === i.id;
    return (
      <div key={i.id} className="rounded-2xl bg-surface border border-line p-4">
        <button className="w-full text-left" onClick={() => setOpen(isOpen ? null : i.id)}>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted">
            <span>{STATUS_LABEL[i.status] ?? i.status}</span>
            {i.area && <span>· {({ coffee: "☕ Coffee", yeshiva: "📚 Yeshiva", personal: "🏠 Personal" } as Record<string, string>)[i.area]}</span>}
            <span>· {timeAgo(i.updated_at)}</span>
            {i.verdict && VERDICT[i.verdict] && <span className={`ml-auto normal-case tracking-normal rounded-full px-2 py-0.5 ${VERDICT[i.verdict][1]}`}>{VERDICT[i.verdict][0]}</span>}
          </div>
          <p className="font-display text-[20px] leading-snug mt-1" dir="auto">{i.title}</p>
          {i.summary && <p className={`text-sm text-muted mt-1 ${isOpen ? "" : "line-clamp-2"}`} dir="auto">{i.summary}</p>}
        </button>

        {going.map((s) => <p key={s.id} className="text-xs text-accent mt-2">{STEP_ICON[s.kind]} Working on: {s.label}…</p>)}

        {suggested.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wide text-muted mb-1.5">Want me to…</p>
            <div className="space-y-1.5">
              {suggested.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-xl bg-sunken px-3 py-2">
                  <span>{STEP_ICON[s.kind] ?? "➡️"}</span>
                  <span className="flex-1 text-[14px] leading-snug" dir="auto">{s.label}</span>
                  <button disabled={busy === s.id} onClick={() => step(i.id, s, "do")} className="text-sm font-medium text-accent">{busy === s.id ? "…" : "Yes"}</button>
                  <button onClick={() => step(i.id, s, "dismiss")} aria-label="No thanks" className="text-muted px-1">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isOpen && (
          <div className="mt-3 space-y-3">
            {i.analysis && <div><p className="text-[11px] uppercase tracking-wide text-muted mb-1">My take</p><Markdown text={i.analysis} /></div>}
            {notes.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted mb-1">Added since</p>
                <div className="space-y-2">
                  {notes.slice().reverse().map((n, k) => (
                    <details key={k} className="rounded-xl bg-sunken px-3 py-2" open={k === 0}>
                      <summary className="text-sm cursor-pointer">{n.kind === "research" ? "🔎 Research" : n.kind === "plan" ? "🗺️ Plan" : "📝 Note"} · {timeAgo(n.at)}</summary>
                      <div className="mt-1"><Markdown text={n.text} /></div>
                    </details>
                  ))}
                </div>
              </div>
            )}
            {i.transcript && (
              <details className="rounded-xl bg-sunken px-3 py-2">
                <summary className="text-sm cursor-pointer">Your words</summary>
                <p className="text-sm text-muted whitespace-pre-wrap mt-1" dir="auto">{i.transcript}</p>
              </details>
            )}
            {steps.filter((s) => s.status === "done").length > 0 && (
              <ul className="text-xs text-muted space-y-0.5">
                {steps.filter((s) => s.status === "done").map((s) => <li key={s.id}>✓ {s.label}{s.detail ? ` · ${s.detail.replace(/ \(item [^)]+\)/, "")}` : ""}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="soft" onClick={() => onAsk(`About my idea "${i.title}": `)}>Talk about it</Button>
          {i.status !== "parked" && i.status !== "done" && <Button variant="ghost" onClick={async () => { await api.updateIdea(i.id, { status: "parked" }); load(); }}>Park</Button>}
          {(i.status === "parked" || i.status === "done") && <Button variant="ghost" onClick={async () => { await api.updateIdea(i.id, { status: "exploring" }); load(); }}>Reopen</Button>}
          {i.status !== "done" && <Button variant="ghost" onClick={async () => { await api.updateIdea(i.id, { status: "done" }); load(); }}>Done</Button>}
          <Button variant="ghost" onClick={async () => { if (window.confirm("Drop this idea?")) { await api.updateIdea(i.id, { status: "dropped" }); load(); } }}>Drop</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted px-1">
        Just think out loud on the home screen. I'll recognize an idea, give you my honest take, save it here, and offer to look into it, plan it, or remind you.
      </p>
      {live.length === 0 && rest.length === 0 && <Empty>No ideas yet. Tap Talk on the home screen and tell me what you're thinking.</Empty>}
      {live.map(card)}
      {rest.length > 0 && (
        <details>
          <summary className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted cursor-pointer">Parked & done ({rest.length})</summary>
          <div className="space-y-3 mt-2">{rest.map(card)}</div>
        </details>
      )}
      {dumps.length > 0 && (
        <details>
          <summary className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted cursor-pointer">Older brain dumps ({dumps.length})</summary>
          <div className="rounded-2xl bg-surface border border-line px-4 mt-2">
            {dumps.map((b) => (
              <details key={b.id} className="py-2 border-b border-line last:border-0">
                <summary className="text-sm cursor-pointer">{b.summary || b.raw.slice(0, 80)} <span className="text-xs text-muted">· {timeAgo(b.created_at)}</span></summary>
                <p className="text-sm text-muted whitespace-pre-wrap mt-1">{b.raw}</p>
              </details>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

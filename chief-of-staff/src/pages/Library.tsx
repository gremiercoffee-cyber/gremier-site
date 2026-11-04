import { useEffect, useState } from "react";
import type { Memory } from "../../shared/types";
import { api } from "../api";
import { areaName, useAreas } from "../areas";
import { Button, Card, Empty, timeAgo } from "../components/ui";

/** What your Chief of Staff knows about you: suggestions to review, and what you confirmed. */
export default function Library({ refreshKey }: { refreshKey: number }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const load = () => { api.memories().then(setMemories).catch(() => {}); };
  useEffect(load, [refreshKey]);
  return <div className="space-y-4"><MemoryReview memories={memories} reload={load} /></div>;
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

const KIND_LABEL: Record<string, string> = { person: "Who's who", schedule: "Schedule", preference: "Preference" };

/** What I picked up (to review) and what I know (confirmed), grouped by area. */
function MemoryReview({ memories, reload }: { memories: Memory[]; reload: () => void }) {
  const areas = useAreas();
  const MEM_AREAS: [string, string][] = [...areas.map((a): [string, string] => [a.key, `${a.icon} ${a.label}`]), ["", "General"]];
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

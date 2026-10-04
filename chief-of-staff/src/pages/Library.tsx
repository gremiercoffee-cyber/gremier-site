import { useEffect, useState, type ReactNode } from "react";
import type { BrainDump, Item, Memory } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, ItemRow, timeAgo } from "../components/ui";

export type LibraryTab = "dump" | "ideas" | "people" | "memory" | "dumps";
const TABS: [LibraryTab, string][] = [["dump", "Brain dump"], ["ideas", "Ideas"], ["people", "People"], ["memory", "Memory"]];
const AREAS: [string, string][] = [["all", "All"], ["coffee", "☕ Coffee"], ["yeshiva", "📚 Yeshiva"], ["personal", "🏠 Personal"]];

/** Everything your Chief of Staff has organized, to browse: ideas, people, memories, past brain dumps. */
export default function Library({ tab, onTab, onOpenItem, refreshKey, brainDump }: {
  tab: LibraryTab; onTab: (t: LibraryTab) => void; onOpenItem: (i: Item) => void; refreshKey: number; brainDump: ReactNode;
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

      {tab === "people" && (
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
      )}

      {tab === "memory" && (
        <Card title={`Memory (${memories.length})`}>
          {memories.length === 0 ? <Empty>Nothing remembered yet.</Empty> : (
            <ul className="divide-y divide-line">
              {memories.map((m) => (
                <li key={m.id} className="py-2 flex gap-2 items-start">
                  <span className="text-[10px] uppercase tracking-wide text-muted bg-sunken rounded px-1.5 py-0.5 mt-0.5">{m.category}</span>
                  <p className="flex-1 text-sm">{m.content}</p>
                  <button className="text-xs text-muted hover:text-danger" onClick={async () => { await api.deleteMemory(m.id); load(); }}>Forget</button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

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

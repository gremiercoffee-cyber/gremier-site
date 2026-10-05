import { useEffect, useState } from "react";
import { api, type MissionRow } from "../api";
import { Button, Card, Empty, timeAgo } from "../components/ui";

const parse = <T,>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
const AREA: Record<string, string> = { coffee: "☕ Coffee", yeshiva: "📚 Yeshiva", personal: "🏠 Personal" };

/** Goals your Chief of Staff is working through in the background. */
export default function Missions({ onAsk, refreshKey, embedded }: { onAsk: (text: string) => void; refreshKey: number; embedded?: boolean }) {
  const [missions, setMissions] = useState<MissionRow[] | null>(null);
  const load = () => api.missions().then(setMissions).catch(() => setMissions([]));
  useEffect(() => { load(); }, [refreshKey]);

  const set = async (id: string, status: string) => { await api.setMission(id, status); load(); };

  if (!missions) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-4">
      {!embedded && <Button onClick={() => onAsk("New task: ")}>+ New task</Button>}
      {missions.length === 0 && !embedded && <Empty>No one-time tasks yet.</Empty>}
      {missions.filter((m) => m.status === "active" || m.status === "paused").map(card)}
      {missions.some((m) => m.status === "done" || m.status === "cancelled") && (
        <details>
          <summary className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted cursor-pointer">
            Finished & cancelled ({missions.filter((m) => m.status === "done" || m.status === "cancelled").length})
          </summary>
          <div className="space-y-3 mt-2">{missions.filter((m) => m.status === "done" || m.status === "cancelled").map(card)}</div>
        </details>
      )}
    </div>
  );

  function card(m: MissionRow) {
        const steps = parse<{ id: string; text: string; status: string; note?: string }[]>(m.steps, []);
        const log = parse<{ at: string; text: string }[]>(m.log, []);
        const done = steps.filter((s) => s.status === "done").length;
        const finished = m.status === "done" || m.status === "cancelled";
        return (
          <Card key={m.id} title={<span>One-time · {m.status === "active" ? "In progress" : m.status === "paused" ? "Paused" : m.status === "done" ? "Done" : "Cancelled"}{m.category ? ` · ${AREA[m.category] ?? m.category}` : ""}</span>}>
            <p className={`font-display text-[20px] leading-snug ${finished ? "text-muted" : ""}`}>{m.goal}</p>
            {steps.length > 0 && (
              <div className="mt-2 h-1.5 rounded-full bg-sunken overflow-hidden">
                <div className="h-full bg-accent" style={{ width: `${(100 * done) / steps.length}%` }} />
              </div>
            )}
            {m.waiting_on_user && (
              <div className="mt-3 rounded-2xl bg-accent/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.12em] text-accent">Needs your answer</p>
                <p className="text-[15px] mt-1">{m.waiting_on_user}</p>
                <Button className="mt-2" onClick={() => onAsk(`About my task "${m.goal}", your question "${m.waiting_on_user}": `)}>Answer…</Button>
              </div>
            )}
            <ul className="mt-3 space-y-1.5">
              {steps.map((s) => (
                <li key={s.id} className="flex gap-2 text-sm">
                  <span className="w-4 shrink-0">{s.status === "done" ? "✓" : s.status === "doing" ? "◐" : s.status === "blocked" ? "⚠" : "○"}</span>
                  <span className={s.status === "done" ? "text-muted line-through" : ""}>
                    {s.text}{s.note && <span className="block text-xs text-muted no-underline">{s.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {log.length > 0 && (
              <details className="mt-3">
                <summary className="text-xs text-muted cursor-pointer">Progress log ({log.length})</summary>
                <ul className="mt-1 space-y-1">
                  {log.slice(-8).reverse().map((l, i) => <li key={i} className="text-xs"><span className="text-muted">{timeAgo(l.at)} · </span>{l.text}</li>)}
                </ul>
              </details>
            )}
            {!finished && (
              <div className="flex flex-wrap gap-2 mt-3">
                {m.status === "active"
                  ? <Button variant="soft" onClick={() => set(m.id, "paused")}>Pause</Button>
                  : <Button variant="soft" onClick={() => set(m.id, "active")}>Resume</Button>}
                <Button variant="soft" onClick={() => onAsk(`About my task "${m.goal}": `)}>Tell it something</Button>
                <Button variant="danger" onClick={() => { if (window.confirm("Cancel this task?")) set(m.id, "cancelled"); }}>Cancel</Button>
              </div>
            )}
          </Card>
        );
  }
}

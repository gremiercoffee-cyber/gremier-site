import { useEffect, useState } from "react";
import { api, type RoutineRow, type RoutineSchedule, type SituationRow } from "../api";
import { Button, Card, Empty, Markdown, timeAgo } from "../components/ui";
import Missions from "./Missions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEPTHS: { id: string; label: string; detail: string; cost: number }[] = [
  { id: "quick", label: "Quick", detail: "a fast check, ~4 searches", cost: 0.06 },
  { id: "standard", label: "Standard", detail: "solid report, ~24 searches", cost: 0.3 },
  { id: "deep", label: "Deep", detail: "comprehensive research, ~64 searches", cost: 0.8 },
  { id: "adaptive", label: "Adaptive", detail: "full report first, then quick checks; goes deeper only when something important turns up", cost: 0.1 },
];
const DELIVER: [string, string][] = [["doc", "Google Doc + notification"], ["alert", "Notification only"], ["briefing", "Quietly, in my briefing"]];

const runsPerMonth = (s: RoutineSchedule) =>
  s.kind === "hours" ? (30 * 24) / (s.every_hours ?? 6) : s.kind === "daily" ? 30 : s.kind === "weekly" ? 4.3 * (s.weekdays?.length || 1) : 1;

/** Recurring jobs your Chief of Staff runs on a schedule: research, reports, checks. */
export default function Tasks({ onAsk, onOpenReport, refreshKey }: {
  onAsk: (text: string) => void; onOpenReport: (id: string, mode: "brief" | "read") => void; refreshKey: number;
}) {
  const [list, setList] = useState<RoutineRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [situations, setSituations] = useState<SituationRow[]>([]);
  const load = () => {
    api.routines().then(setList).catch(() => setList([]));
    api.situations().then(setSituations).catch(() => {});
  };
  useEffect(() => { load(); }, [refreshKey]);

  if (!list) return <p className="text-sm text-muted">Loading…</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted px-1">
        Things I work on for you. <b>One-time</b>: a goal I work through until it's done ("get every rabbi's list by Monday").
        <b> Repeating</b>: something I do on a schedule ("every Sunday, a report on the coffee market"). Just tell me what you need.
      </p>
      <Button onClick={() => onAsk("New task: ")}>+ New task</Button>
      <Missions embedded refreshKey={refreshKey} onAsk={onAsk} />
      {list.length === 0 && <Empty>No repeating tasks yet.</Empty>}

      {list.map((r) => editing === r.id
        ? <Editor key={r.id} r={r} onDone={() => { setEditing(null); load(); }} />
        : <TaskCard key={r.id} r={r} onEdit={() => setEditing(r.id)} onChanged={load} onOpenReport={onOpenReport} />)}
    </div>
  );
}

function TaskCard({ r, onEdit, onChanged, onOpenReport }: {
  r: RoutineRow; onEdit: () => void; onChanged: () => void; onOpenReport: (id: string, mode: "brief" | "read") => void;
}) {
  const [msg, setMsg] = useState("");
  const [tell, setTell] = useState("");
  const [telling, setTelling] = useState(false);
  const depth = DEPTHS.find((d) => d.id === r.depth) ?? DEPTHS[1];
  const monthly = depth.cost * runsPerMonth(r.schedule);
  return (
    <Card title={<span>Repeating · {r.active ? "Active" : "Paused"} · {depth.label}</span>}>
      <p className="font-display text-[20px] leading-snug">{r.name}</p>
      <p className="text-sm text-muted mt-0.5">
        {r.active ? r.schedule_text : "Paused"} · results {DELIVER.find(([k]) => k === r.deliver)?.[1].toLowerCase()} · ~${monthly < 1 ? monthly.toFixed(2) : monthly.toFixed(1)}/month
      </p>
      <p className="text-sm mt-2 whitespace-pre-wrap">{r.instructions}</p>
      {r.rules && <p className="text-sm mt-2 text-muted whitespace-pre-wrap"><span className="font-medium text-ink">Your notes:</span> {r.rules}</p>}
      <form className="mt-3 flex gap-2 items-end" onSubmit={async (e) => {
        e.preventDefault(); if (!tell.trim()) return;
        const box = e.currentTarget.querySelector("textarea");
        setTelling(true); setMsg("");
        try { const res = await api.tellRoutine(r.id, tell.trim()); setMsg(res.reply); setTell(""); box?.style.setProperty("height", "auto"); onChanged(); }
        catch (err) { setMsg((err as Error).message); }
        setTelling(false);
      }}>
        <textarea value={tell} rows={1} dir="auto"
          onChange={(e) => { setTell(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
          placeholder="Tell it something: e.g. 'after this, quick checks; go deeper only if something big'"
          className="flex-1 min-w-0 resize-none overflow-hidden rounded-2xl border border-line bg-bg px-4 py-2 text-[14px] leading-snug max-h-60" />
        <Button disabled={telling || !tell.trim()}>{telling ? "…" : "Update"}</Button>
      </form>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button onClick={async () => { const res = await api.runRoutine(r.id); setMsg(res.message); setTimeout(onChanged, 60_000); }}>Run now</Button>
        <Button variant="soft" onClick={onEdit}>Adjust</Button>
        <Button variant="soft" onClick={async () => { await api.saveRoutine({ id: r.id, active: !r.active }); onChanged(); }}>{r.active ? "Pause" : "Resume"}</Button>
        <Button variant="danger" onClick={async () => { if (window.confirm(`Delete "${r.name}" and its reports?`)) { await api.deleteRoutine(r.id); onChanged(); } }}>Delete</Button>
      </div>
      {msg && <p className="text-sm text-accent mt-2">{msg}</p>}
      {r.runs.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-medium text-muted uppercase tracking-[0.14em]">Reports</p>
          {r.runs.map((x) => (
            <details key={x.id} className="rounded-2xl bg-sunken px-4 py-3">
              <summary className="cursor-pointer text-sm">
                {x.status === "running" ? "⏳ Working on it…" : x.status === "failed" ? "⚠️ Didn't finish" : "📄 Report"} · {timeAgo(x.started_at)}
                {x.searches ? <span className="text-muted"> · {x.searches} searches</span> : null}
                {x.summary && <span className="block text-muted mt-1">{x.summary}</span>}
              </summary>
              {x.error && <p className="text-sm text-danger mt-2">{x.error}</p>}
              {x.status === "done" && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {x.doc_link && <a href={x.doc_link} target="_blank" rel="noreferrer" className="rounded-full bg-surface border border-line px-3 py-1.5 text-[13px]">📄 Open Doc</a>}
                  <button onClick={() => onOpenReport(x.id, "brief")} className="rounded-full bg-surface border border-line px-3 py-1.5 text-[13px]">💬 Tell me about it</button>
                  <button onClick={() => onOpenReport(x.id, "read")} className="rounded-full bg-surface border border-line px-3 py-1.5 text-[13px]">🔊 Read it to me</button>
                </div>
              )}
              {x.report && <div className="mt-3 text-[15px] leading-relaxed"><Markdown text={x.report} /></div>}
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

function Editor({ r, onDone }: { r: RoutineRow; onDone: () => void }) {
  const [f, setF] = useState({ ...r, schedule: { ...r.schedule } });
  const [saving, setSaving] = useState(false);
  const field = "w-full rounded-xl bg-sunken px-3 py-2.5 outline-none text-[15px]";
  const s = f.schedule;
  const setS = (patch: Partial<RoutineSchedule>) => setF({ ...f, schedule: { ...s, ...patch } });
  return (
    <Card title="Adjust task">
      <div className="space-y-3">
        <label className="block text-xs text-muted space-y-1"><span>Name</span>
          <input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="block text-xs text-muted space-y-1"><span>What it does</span>
          <textarea className={field} rows={4} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted space-y-1"><span>How often</span>
            <select className={field} value={s.kind} onChange={(e) => setS({ kind: e.target.value as RoutineSchedule["kind"] })}>
              <option value="hours">Every few hours</option><option value="daily">Daily</option>
              <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
            </select>
          </label>
          {s.kind === "hours" ? (
            <label className="block text-xs text-muted space-y-1"><span>Every (hours)</span>
              <input type="number" min={1} max={168} className={field} value={s.every_hours ?? 6} onChange={(e) => setS({ every_hours: Number(e.target.value) })} />
            </label>
          ) : (
            <label className="block text-xs text-muted space-y-1"><span>At</span>
              <input type="time" className={field} value={s.time ?? "08:00"} onChange={(e) => setS({ time: e.target.value })} />
            </label>
          )}
        </div>
        {s.kind === "weekly" && (
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = (s.weekdays ?? [0]).includes(i);
              return <button key={d} onClick={() => setS({ weekdays: on ? (s.weekdays ?? [0]).filter((x) => x !== i) : [...(s.weekdays ?? []), i] })}
                className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-ink text-bg" : "bg-sunken text-muted"}`}>{d}</button>;
            })}
          </div>
        )}
        {s.kind === "monthly" && (
          <label className="block text-xs text-muted space-y-1"><span>Day of month</span>
            <input type="number" min={1} max={28} className={field} value={s.day ?? 1} onChange={(e) => setS({ day: Number(e.target.value) })} />
          </label>
        )}
        <div className="space-y-1.5">
          <p className="text-xs text-muted">How much it looks up</p>
          {DEPTHS.map((d) => (
            <button key={d.id} onClick={() => setF({ ...f, depth: d.id })}
              className={`w-full text-left rounded-2xl border px-4 py-2.5 ${f.depth === d.id ? "border-accent bg-accent/5" : "border-line"}`}>
              <span className="font-medium">{d.label}</span> <span className="text-sm text-muted">· {d.detail} · ~${d.cost.toFixed(2)} a run</span>
            </button>
          ))}
        </div>
        <label className="block text-xs text-muted space-y-1"><span>Results</span>
          <select className={field} value={f.deliver} onChange={(e) => setF({ ...f, deliver: e.target.value })}>
            {DELIVER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <Button disabled={saving} onClick={async () => {
            setSaving(true);
            try { await api.saveRoutine({ id: f.id, name: f.name, instructions: f.instructions, schedule: f.schedule, depth: f.depth, deliver: f.deliver }); onDone(); }
            catch (e) { alert((e as Error).message); } finally { setSaving(false); }
          }}>{saving ? "Saving…" : "Save"}</Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </div>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { api, type SituationRow } from "../api";
import { iconOf, useAreas } from "../areas";
import { Button, Empty } from "../components/ui";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const days = (s: SituationRow): number[] => { try { return JSON.parse(s.weekdays ?? "[]"); } catch { return []; } };
const skipped = (s: SituationRow, date: string) => (s.skip_dates ?? "").split(",").includes(date);
/** Blocks grouped by the exact days they run; the biggest group (your standard day) first. */
const groups = (list: SituationRow[]) => {
  const m = new Map<string, SituationRow[]>();
  for (const s of list) { const k = [...days(s)].sort().join(","); m.set(k, [...(m.get(k) ?? []), s]); }
  return [...m.entries()].sort((a, b) => b[1].length - a[1].length || b[0].split(",").length - a[0].split(",").length);
};
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** [0,1,2,3,4] → "Sun–Thu"; [0,2] → "Sun, Tue"; [0] → "Sundays". */
const dayRange = (d: number[]) => {
  const x = [...new Set(d)].sort();
  if (x.length === 1) return `${DAYS[x[0]]}s`;
  const runs: string[] = [];
  for (let i = 0; i < x.length; ) {
    let j = i; while (j + 1 < x.length && x[j + 1] === x[j] + 1) j++;
    runs.push(j - i >= 2 ? `${SHORT[x[i]]}–${SHORT[x[j]]}` : x.slice(i, j + 1).map((n) => SHORT[n]).join(", "));
    i = j + 1;
  }
  return runs.join(", ");
};
const byStart = (a: SituationRow, b: SituationRow) => (a.start_time ?? "").localeCompare(b.start_time ?? "");

/** Your schedule: today (with one-day changes) and your usual week. Change it by just telling me. */
export default function Schedule({ onAsk, refreshKey }: { onAsk: (t: string) => void; refreshKey: number }) {
  useAreas();
  const [list, setList] = useState<SituationRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const load = () => api.situations().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [refreshKey]);
  if (!list) return <p className="text-sm text-muted">Loading…</p>;

  const today = localDate(), dow = new Date().getDay();
  const active = list.filter((s) => s.active);
  const todays = active.filter((s) => s.start_time && (s.date ? s.date === today : days(s).includes(dow))).sort(byStart);
  const recurring = active.filter((s) => s.start_time && !s.date);
  const upcoming = active.filter((s) => s.date && s.date > today).sort((a, b) => (a.date! + a.start_time).localeCompare(b.date! + b.start_time));
  const triggers = active.filter((s) => !s.start_time && s.calendar_keywords);
  const paused = list.filter((s) => !s.active && !s.date);
  const save = async (patch: Record<string, unknown>) => { await api.saveSituation(patch); load(); };
  // The main daily schedule (the biggest group of blocks sharing the same days) is listed once.
  const grouped = groups(recurring);
  const main = grouped[0]?.[1].slice().sort(byStart);
  const mainIds = new Set(main?.map((s) => s.id));
  const mainToday = !!main && days(main[0]).includes(dow);
  const extras = recurring.filter((s) => !mainIds.has(s.id)).sort((a, b) => days(a)[0] - days(b)[0] || byStart(a, b));
  const todayExtras = todays.filter((s) => !mainIds.has(s.id));

  /** A block line: "Off today" when it applies today; tap for Pause/Delete. */
  const blockRow = (s: SituationRow, appliesToday: boolean, sub?: string) => {
    const off = appliesToday && skipped(s, today);
    return (
      <div key={s.id} onClick={() => setSel(sel === s.id ? null : s.id)} className="cursor-pointer">
        <Row s={s} muted={off} sub={off ? "Off today" : sub}>
          {sel === s.id ? <>
            <button className="text-xs text-accent" onClick={(e) => { e.stopPropagation(); save({ id: s.id, active: false }); }}>Pause</button>
            <button className="text-xs text-muted hover:text-danger" onClick={async (e) => { e.stopPropagation(); if (window.confirm(`Delete "${s.name}"?`)) { await api.deleteSituation(s.id); load(); } }}>Delete</button>
          </> : appliesToday ? (
            <button className="text-xs text-accent" onClick={(e) => { e.stopPropagation(); save({ id: s.id, [off ? "unskip_date" : "skip_date"]: today }); }}>{off ? "Back on" : "Off today"}</button>
          ) : null}
        </Row>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted px-1">Change it any time by just telling me: "today I'm not going into yeshiva", "from now on yeshiva ends at 2".</p>
      <div className="flex gap-2">
        <Button onClick={() => onAsk("Today my schedule is: ")}>Change today</Button>
        <Button variant="soft" onClick={() => onAsk("My usual schedule: ")}>Change my usual week</Button>
      </div>

      {recurring.length === 0 && <Section title="Your daily schedule"><div className="py-3"><Empty>No usual schedule yet. Tell me, e.g. "I'm in yeshiva Sunday to Thursday 9 to 1".</Empty></div></Section>}

      {main && (
        <Section title={`Your daily schedule · ${dayRange(days(main[0]))}`}>
          {main.map((s) => blockRow(s, mainToday))}
        </Section>
      )}

      {(todayExtras.length > 0 || (!mainToday && todays.length === 0)) && (
        <Section title={`Also today · ${DAYS[dow]}`}>
          {todayExtras.length === 0 ? <p className="py-3 text-sm text-muted">Nothing scheduled today.</p> : todayExtras.map((s) => (
            s.date
              ? <Row key={s.id} s={s} sub="Just today"><button className="text-xs text-muted hover:text-danger" onClick={async () => { await api.deleteSituation(s.id); load(); }}>Remove</button></Row>
              : blockRow(s, true)
          ))}
        </Section>
      )}

      {upcoming.length > 0 && (
        <Section title="Coming days">
          {upcoming.map((s) => (
            <Row key={s.id} s={s} sub={new Date(`${s.date}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}>
              <button className="text-xs text-muted hover:text-danger" onClick={async () => { await api.deleteSituation(s.id); load(); }}>Remove</button>
            </Row>
          ))}
        </Section>
      )}

      {extras.length > 0 && (
        <Section title="Weekly extras">
          {extras.map((s) => blockRow(s, false, dayRange(days(s))))}
        </Section>
      )}

      {triggers.length > 0 && (
        <Section title="When something's on my calendar">
          {triggers.map((s) => (
            <Row key={s.id} s={s} sub={s.when}>
              <button className="text-xs text-muted hover:text-danger" onClick={async () => { await api.deleteSituation(s.id); load(); }}>Delete</button>
            </Row>
          ))}
        </Section>
      )}

      {paused.length > 0 && (
        <Section title="Paused">
          {paused.map((s) => (
            <Row key={s.id} s={s} muted sub={s.when}>
              <button className="text-xs text-accent" onClick={() => save({ id: s.id, active: true })}>Resume</button>
              <button className="text-xs text-muted hover:text-danger" onClick={async () => { await api.deleteSituation(s.id); load(); }}>Delete</button>
            </Row>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-1 mb-2 font-display text-[21px] leading-tight">{title}</h2>
      <div className="rounded-2xl bg-surface border border-line px-4 divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ s, sub, muted, children }: { s: SituationRow; sub?: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className="py-2.5 flex gap-3 items-center">
      {s.start_time && <span className={`w-[5.5rem] shrink-0 text-sm tabular-nums ${muted ? "text-muted line-through" : "text-muted"}`}>{s.start_time}–{s.end_time ?? "?"}</span>}
      <div className="flex-1 min-w-0">
        <p className={`text-[15px] leading-snug ${muted ? "text-muted" : ""}`}>{s.category && iconOf(s.category) ? `${iconOf(s.category)} ` : ""}{s.name}</p>
        {(sub || s.note) && <p className="text-xs text-muted truncate">{[sub, s.note].filter(Boolean).join(" · ")}</p>}
      </div>
      <div className="flex gap-3 shrink-0">{children}</div>
    </div>
  );
}

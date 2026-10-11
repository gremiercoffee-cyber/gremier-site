import { useState } from "react";
import type { Item } from "../../shared/types";
import { api } from "../api";

/** "Not now — remind me when?" Quick options for the usual answers, plus any date and time. Used from notifications, cards and the widget. */
export default function Reschedule({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: (msg: string) => void }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const nowMs = Date.now();
  /** Same clock time, n days from now (or a set clock time when h is given). */
  const inDays = (n: number, h?: number, m = 0) => {
    const d = new Date(nowMs);
    d.setDate(d.getDate() + n);
    if (h !== undefined) d.setHours(h, m, 0, 0);
    return d;
  };
  const evening = inDays(0, 19);
  // Next Sunday morning (the start of the working week), unless it's so close it duplicates "tomorrow".
  const sunday = (() => {
    const away = ((7 - new Date(nowMs).getDay()) % 7) || 7;
    return inDays(away, 9);
  })();
  const options: [string, Date][] = [
    ["In 1 hour", new Date(nowMs + 3600_000)],
    ["In 3 hours", new Date(nowMs + 3 * 3600_000)],
    ...(evening.getTime() > nowMs + 1800_000 ? [["This evening", evening] as [string, Date]] : []),
    ["Tomorrow morning", inDays(1, 9)],
    ["Tomorrow, same time", inDays(1)],
    ["In 2 days", inDays(2)],
    ["In 3 days", inDays(3)],
    ...(sunday.getTime() - nowMs > 3 * 86400_000 ? [["Sunday morning", sunday] as [string, Date]] : []),
    ["In a week", inDays(7)],
    ["In 2 weeks", inDays(14)],
    ["In a month", (() => { const d = new Date(nowMs); d.setMonth(d.getMonth() + 1); return d; })()],
  ];

  const save = async (d: Date, label: string) => {
    setBusy(true);
    try {
      await api.updateItem(item.id, { due_at: d.toISOString(), status: "open" });
      onSaved(`OK, I'll remind you ${label.charAt(0).toLowerCase()}${label.slice(1)}.`);
    } finally {
      setBusy(false);
    }
  };
  const show = (d: Date) => d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-surface p-5 pb-safe shadow-card" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Remind me again…</p>
        <p className="font-display text-[22px] leading-tight mt-1">{item.title}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {options.map(([label, d]) => (
            <button key={label} disabled={busy} onClick={() => save(d, label)}
              className="text-left rounded-2xl border border-line px-3.5 py-2.5 hover:border-accent active:bg-sunken disabled:opacity-50">
              <span className="block text-[15px] font-medium leading-tight">{label}</span>
              <span className="block text-[12px] text-muted mt-0.5">{show(d)}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 mb-1.5 text-xs text-muted">Or pick a day and time</p>
        <div className="flex gap-2 items-center">
          <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)}
            className="flex-1 min-w-0 rounded-2xl bg-sunken px-4 py-3 outline-none" />
          <button disabled={!custom || busy} onClick={() => save(new Date(custom), "at the time you picked")}
            className="rounded-full bg-accent text-accent-ink px-5 py-3 text-sm font-medium disabled:opacity-40">Set</button>
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-full py-3 text-muted">Cancel</button>
      </div>
    </div>
  );
}

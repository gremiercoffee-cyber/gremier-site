import { useState } from "react";
import type { Item } from "../../shared/types";
import { api } from "../api";

/** Quick "when instead?" picker, used from notifications, cards and the widget. */
export default function Reschedule({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: (msg: string) => void }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const at = (h: number, m = 0, addDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + addDays);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const evening = at(19);
  const options: [string, Date][] = [
    ["In 1 hour", new Date(Date.now() + 3600_000)],
    ["In 3 hours", new Date(Date.now() + 3 * 3600_000)],
    ...(evening.getTime() > Date.now() + 1800_000 ? [["This evening (19:00)", evening] as [string, Date]] : []),
    ["Tomorrow morning (09:00)", at(9, 0, 1)],
    ["Next week", at(9, 0, 7)],
  ];

  const save = async (d: Date, label: string) => {
    setBusy(true);
    try {
      await api.updateItem(item.id, { due_at: d.toISOString(), status: "open" });
      onSaved(`Moved to ${label.replace(/\s*\(.*\)/, "").toLowerCase()}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-surface p-5 pb-safe shadow-card" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Reschedule</p>
        <p className="font-display text-[22px] leading-tight mt-1">{item.title}</p>
        <div className="mt-4 grid gap-2">
          {options.map(([label, d]) => (
            <button key={label} disabled={busy} onClick={() => save(d, label)}
              className="w-full text-left rounded-2xl border border-line px-4 py-3 hover:border-accent disabled:opacity-50">
              {label}
              <span className="float-right text-sm text-muted">{d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </button>
          ))}
          <div className="flex gap-2 items-center">
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)}
              className="flex-1 rounded-2xl bg-sunken px-4 py-3 outline-none" />
            <button disabled={!custom || busy} onClick={() => save(new Date(custom), "the time you picked")}
              className="rounded-full bg-accent text-accent-ink px-5 py-3 text-sm font-medium disabled:opacity-40">Set</button>
          </div>
        </div>
        <button onClick={onClose} className="mt-3 w-full rounded-full py-3 text-muted">Cancel</button>
      </div>
    </div>
  );
}

import type { Item } from "../../shared/types";
import { api } from "../api";
import { formatDue } from "./ui";
import { useAreas } from "../areas";

/** Show a short message at the bottom of the screen, optionally with Undo (5 seconds). */
export function toast(text: string, undo?: () => Promise<unknown> | void) {
  window.dispatchEvent(new CustomEvent("cos:toast", { detail: { text, undo } }));
}
/** Open the one sheet for a task, from anywhere. */
export const openTask = (id: string) => window.dispatchEvent(new CustomEvent("cos:open-item", { detail: id }));

/** Done or Cancel, each with Undo. The only way the app closes a task. */
export async function closeTask(item: Pick<Item, "id" | "title">, status: "done" | "dropped", onChanged: () => void) {
  await api.updateItem(item.id, { status });
  onChanged();
  toast(status === "done" ? `✅ Done: ${item.title}` : `✕ Cancelled: ${item.title}`, async () => { await api.updateItem(item.id, { status: "open" }); onChanged(); });
}

/**
 * One task, three buttons: ✓ Done, 🕒 Change time, ✕ Cancel. Edit details is a small link underneath.
 */
export default function TaskSheet({ item, onClose, onChanged, onReschedule, onEdit }: {
  item: Item; onClose: () => void; onChanged: () => void; onReschedule: (i: Item) => void; onEdit: (i: Item) => void;
}) {
  const areas = useAreas();
  const area = areas.find((a) => a.key === item.category);
  const due = formatDue(item.due_at);
  const open = item.status === "open";
  const finish = async (status: "done" | "dropped") => { onClose(); await closeTask(item, status, onChanged).catch((e) => toast(`⚠️ ${(e as Error).message}`)); };
  const big = "flex flex-col items-center justify-center gap-1 rounded-2xl py-3.5 text-[14px] font-medium active:scale-[.98] transition";
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label={item.title} className="w-full sm:max-w-md bg-surface rounded-t-3xl sm:rounded-3xl p-5 pb-safe shadow-card sheet-in" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line sm:hidden" />
        <div className="flex items-start gap-3">
          <span className="text-[26px] leading-none mt-0.5" aria-hidden>{item.kind === "reminder" ? "⏰" : area?.icon ?? "📋"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-[19px] font-semibold leading-snug" dir="auto">{item.title}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
              {due && <span className={due.overdue && open ? "text-danger font-medium" : ""}>🕒 {due.text}</span>}
              {area && <span>{area.icon} {area.label}</span>}
              {item.person && <span>👤 {item.person}</span>}
              {!open && <span>{item.status === "done" ? "✅ Done" : "✕ Cancelled"}</span>}
            </div>
          </div>
        </div>
        {item.notes && <p className="mt-3 rounded-xl bg-sunken px-3 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap" dir="auto">{item.notes}</p>}
        {open ? (
          <div className="mt-5 grid grid-cols-3 gap-2">
            <button onClick={() => void finish("done")} className={`${big} bg-ok/15 text-ok`}><span className="text-[22px]">✓</span>Done</button>
            <button onClick={() => { onClose(); onReschedule(item); }} className={`${big} bg-accent/10 text-accent`}><span className="text-[22px]">🕒</span>Change time</button>
            <button onClick={() => void finish("dropped")} className={`${big} bg-danger/10 text-danger`}><span className="text-[22px]">✕</span>Cancel</button>
          </div>
        ) : (
          <button onClick={async () => { onClose(); await api.updateItem(item.id, { status: "open" }); onChanged(); toast(`↩️ Reopened: ${item.title}`); }}
            className="mt-5 w-full rounded-2xl bg-sunken py-3.5 text-[14px] font-medium">↩️ Reopen</button>
        )}
        <div className="mt-3 flex justify-between">
          <button onClick={() => { onClose(); onEdit(item); }} className="px-1 py-2 text-[13px] text-muted">✏️ Edit details</button>
          <button onClick={onClose} className="px-1 py-2 text-[13px] text-muted">Close</button>
        </div>
      </div>
    </div>
  );
}

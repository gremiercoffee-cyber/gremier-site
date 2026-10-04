import { useEffect, useState } from "react";
import type { Item, ItemKind, Project } from "../../shared/types";
import { api } from "../api";
import { Button, KIND_META } from "./ui";

/** Bottom sheet for creating or editing an item. */
export default function ItemSheet({ item, defaultKind = "task", onClose, onSaved }: {
  item: Item | null; defaultKind?: ItemKind; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    kind: item?.kind ?? defaultKind,
    title: item?.title ?? "",
    notes: item?.notes ?? "",
    priority: item?.priority ?? 2,
    due: item?.due_at ? toLocalInput(item.due_at) : "",
    person: item?.person ?? "",
    project_id: item?.project_id ?? "",
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const payload: Partial<Item> = {
      kind: form.kind, title: form.title, notes: form.notes, priority: form.priority,
      due_at: form.due ? new Date(form.due).toISOString() : null,
      person: form.person || null, project_id: form.project_id || null,
    };
    try {
      if (item) await api.updateItem(item.id, payload);
      else await api.createItem(payload);
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (!item || !confirm("Delete this item?")) return;
    await api.deleteItem(item.id);
    onSaved();
  };

  const field = "w-full rounded-xl bg-sunken px-3 py-2.5 outline-none text-[15px] focus:ring-2 ring-accent/50";
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-bg rounded-t-3xl sm:rounded-3xl p-5 pb-safe space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1.5 flex-wrap">
          {(Object.keys(KIND_META) as ItemKind[]).map((k) => (
            <button key={k} onClick={() => set("kind", k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${form.kind === k ? "bg-ink text-bg" : "bg-sunken text-muted"}`}>
              {KIND_META[k].label}
            </button>
          ))}
        </div>
        <input autoFocus className={field} placeholder="What is it?" value={form.title} onChange={(e) => set("title", e.target.value)} />
        <textarea className={field} rows={3} placeholder="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted space-y-1">
            <span>{form.kind === "reminder" ? "Remind me at" : "Due"}</span>
            <input type="datetime-local" className={field} value={form.due} onChange={(e) => set("due", e.target.value)} />
          </label>
          <label className="text-xs text-muted space-y-1">
            <span>Priority</span>
            <select className={field} value={form.priority} onChange={(e) => set("priority", Number(e.target.value))}>
              <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
            </select>
          </label>
          <label className="text-xs text-muted space-y-1">
            <span>Person</span>
            <input className={field} value={form.person} placeholder={form.kind === "waiting" ? "Waiting on…" : "Optional"} onChange={(e) => set("person", e.target.value)} />
          </label>
          <label className="text-xs text-muted space-y-1">
            <span>Project</span>
            <select className={field} value={form.project_id} onChange={(e) => set("project_id", e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <div className="flex justify-between pt-1">
          {item ? <Button variant="danger" onClick={remove}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="soft" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!form.title.trim()}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

import { useCallback, useEffect, useState } from "react";
import type { Item, Project } from "../../shared/types";
import { api } from "../api";
import { Button, Card, Empty, ItemRow } from "../components/ui";

export default function Projects({ onOpenItem, refreshKey }: { onOpenItem: (i: Item) => void; refreshKey: number }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [draft, setDraft] = useState({ name: "", area: "personal" as Project["area"] });

  const load = useCallback(() => { api.projects().then(setProjects).catch(() => {}); }, []);
  useEffect(load, [load, refreshKey]);
  const loadItems = useCallback(() => {
    if (open) api.items({ project_id: open, status: "open" }).then(setItems);
  }, [open]);
  useEffect(loadItems, [loadItems, refreshKey]);

  const create = async () => {
    if (!draft.name.trim()) return;
    await api.createProject(draft);
    setDraft({ name: "", area: draft.area });
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[32px] leading-tight">Projects</h1>
      <form onSubmit={(e) => { e.preventDefault(); create(); }} className="flex gap-2">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="New project"
          className="flex-1 min-w-0 rounded-xl bg-surface border border-line px-3.5 py-2.5 outline-none text-[15px] focus:border-accent" />
        <select value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value as Project["area"] })}
          className="rounded-xl bg-surface border border-line px-2 text-sm">
          <option value="personal">Personal</option><option value="business">Business</option>
        </select>
        <Button type="submit" disabled={!draft.name.trim()}>Add</Button>
      </form>
      {projects.length === 0 && <Empty>No projects yet. Create one, or just tell your Chief of Staff about it.</Empty>}
      {projects.map((p) => (
        <Card key={p.id} className={p.status !== "active" ? "opacity-60" : ""}>
          <button className="w-full text-left flex items-center justify-between" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <div>
              <p className="font-semibold">{p.name}</p>
              <p className="text-xs text-muted">{p.area} · {p.status} · {p.open_count ?? 0} open</p>
              {p.description && <p className="text-sm text-muted mt-1">{p.description}</p>}
            </div>
            <span className="text-muted">{open === p.id ? "−" : "+"}</span>
          </button>
          {open === p.id && (
            <div className="mt-3 border-t border-line pt-2">
              <div className="divide-y divide-line">
                {items.length ? items.map((i) => <ItemRow key={i.id} item={i} onChange={() => { loadItems(); load(); }} onOpen={onOpenItem} />) : <Empty>No open items.</Empty>}
              </div>
              <div className="flex gap-1 mt-2 -ml-3">
                {(["active", "paused", "done"] as const).filter((s) => s !== p.status).map((s) => (
                  <Button key={s} variant="ghost" onClick={async () => { await api.updateProject(p.id, { status: s }); load(); }}>
                    {s === "active" ? "Resume" : s === "paused" ? "Pause" : "Mark done"}
                  </Button>
                ))}
                <Button variant="danger" onClick={async () => { if (confirm(`Delete ${p.name}? Items are kept.`)) { await api.deleteProject(p.id); setOpen(null); load(); } }}>Delete</Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

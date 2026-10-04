import { useCallback, useEffect, useState } from "react";
import type { Item, ItemKind } from "../../shared/types";
import { api } from "../api";
import { Button, Empty, ItemRow, KIND_META } from "../components/ui";

const TAB_KEY = "cos.listTab";

export default function Lists({ onOpenItem, onNew, refreshKey }: {
  onOpenItem: (i: Item) => void; onNew: (k: ItemKind) => void; refreshKey: number;
}) {
  const [kind, setKind] = useState<ItemKind>(() => { try { return (localStorage.getItem(TAB_KEY) as ItemKind) || "task"; } catch { return "task"; } });
  const [showDone, setShowDone] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [quick, setQuick] = useState("");

  const load = useCallback(() => {
    api.items({ kind, status: showDone ? "all" : "open" }).then(setItems).catch(() => setItems([]));
  }, [kind, showDone]);
  useEffect(load, [load, refreshKey]);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, kind); } catch { /* ignore */ } }, [kind]);

  const addQuick = async () => {
    if (!quick.trim()) return;
    await api.createItem({ kind, title: quick.trim() });
    setQuick("");
    load();
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-[32px] leading-tight">Lists</h1>
        <Button variant="soft" onClick={() => onNew(kind)}>+ New</Button>
      </header>
      <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1">
        {(Object.keys(KIND_META) as ItemKind[]).map((k) => (
          <button key={k} onClick={() => setKind(k)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${kind === k ? "bg-ink text-bg" : "bg-surface border border-line text-muted"}`}>
            {KIND_META[k].plural}
          </button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); addQuick(); }} className="flex gap-2">
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={`Quick add ${KIND_META[kind].label.toLowerCase()}…`}
          className="flex-1 rounded-xl bg-surface border border-line px-3.5 py-2.5 outline-none text-[15px] focus:border-accent" />
        <Button type="submit" disabled={!quick.trim()}>Add</Button>
      </form>
      <div className="rounded-2xl bg-surface border border-line px-4 py-1 divide-y divide-line">
        {items === null ? <Empty>Loading…</Empty> : items.length === 0 ? <Empty>Nothing here.</Empty> :
          items.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} />)}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed
      </label>
    </div>
  );
}

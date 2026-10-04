import { useCallback, useEffect, useState } from "react";
import type { Dashboard, Item } from "../../shared/types";
import { api } from "../api";
import { Button, Card, Empty, ItemRow, KIND_META, timeAgo } from "../components/ui";

export default function Today({ name, onOpenItem, goChat, refreshKey }: {
  name: string; onOpenItem: (i: Item) => void; goChat: (prompt?: string) => void; refreshKey: number;
}) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.dashboard().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load, refreshKey]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const briefing = async () => {
    setBusy(true);
    try { await api.runProactive(true); load(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };

  if (error) return <p className="text-danger text-sm">{error}</p>;
  if (!data) return <p className="text-muted text-sm">Loading…</p>;

  const counts = data.counts;
  return (
    <div className="space-y-4">
      <header className="pt-1">
        <p className="text-muted text-sm">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
        <h1 className="font-display text-[32px] leading-tight">{greeting}{name ? `, ${name}` : ""}.</h1>
      </header>

      <button onClick={() => goChat()} className="w-full text-left rounded-2xl bg-surface border border-line px-4 py-3.5 text-muted hover:border-accent transition">
        Ask your Chief of Staff anything…
      </button>

      {data.pending.length > 0 && (
        <Card title="Needs your approval">
          <div className="space-y-2">
            {data.pending.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <p className="flex-1 text-[15px]">{a.description}</p>
                <Button variant="soft" onClick={async () => { await api.decide(a.id, "reject"); load(); }}>Decline</Button>
                <Button onClick={async () => { await api.decide(a.id, "approve"); load(); }}>Approve</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {data.nudges.length > 0 && (
        <div className="space-y-2">
          {data.nudges.map((n) => (
            <div key={n.id} className={`rounded-2xl border p-4 ${n.type === "briefing" ? "bg-surface border-accent/40" : "bg-surface border-line"}`}>
              <div className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">{n.title}</p>
                    <span className="text-xs text-muted shrink-0">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.body && <p className="text-sm text-muted mt-1 whitespace-pre-line">{n.body}</p>}
                  <div className="flex gap-1 mt-2 -ml-3">
                    {n.type === "waiting" && <Button variant="ghost" onClick={() => goChat(`Help me follow up on: ${n.title.replace(/^Still waiting: /, "")}`)}>Draft follow-up</Button>}
                    <Button variant="ghost" onClick={async () => { await api.dismissNudge(n.id); load(); }}>Dismiss</Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.overdue.length > 0 && (
        <Card title={<span className="text-danger">Overdue</span>}>
          <div className="divide-y divide-line">
            {data.overdue.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} />)}
          </div>
        </Card>
      )}

      <Card title="Later today">
        {data.today.length ? (
          <div className="divide-y divide-line">{data.today.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} />)}</div>
        ) : <Empty>Nothing else scheduled today.</Empty>}
      </Card>

      <Card title="Waiting for">
        {data.waiting.length ? (
          <div className="divide-y divide-line">{data.waiting.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} />)}</div>
        ) : <Empty>You're not waiting on anyone.</Empty>}
      </Card>

      {data.projects.length > 0 && (
        <Card title="Active projects">
          <div className="grid grid-cols-2 gap-2">
            {data.projects.map((p) => (
              <div key={p.id} className="rounded-xl bg-sunken p-3">
                <p className="font-medium text-sm truncate">{p.name}</p>
                <p className="text-xs text-muted">{p.open_count ?? 0} open · {p.area}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-5 gap-2 text-center">
        {(["task", "reminder", "commitment", "waiting", "idea"] as const).map((k) => (
          <div key={k} className="rounded-xl bg-surface border border-line py-2">
            <div className="text-lg font-semibold">{counts[k] ?? 0}</div>
            <div className="text-[10px] text-muted leading-tight">{KIND_META[k].plural}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <Button variant="ghost" onClick={briefing} disabled={busy}>{busy ? "Preparing…" : "Brief me now"}</Button>
      </div>
    </div>
  );
}

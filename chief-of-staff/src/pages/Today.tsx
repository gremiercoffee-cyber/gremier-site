import { useCallback, useEffect, useState } from "react";
import type { CalendarEvent, Dashboard, Item } from "../../shared/types";
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
    <div className="space-y-5">
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

      {groupNudges(data.nudges).map(([title, list]) => (
        <Section key={title} title={title} count={list.length}>
          {list.map((n) => (
            <div key={n.id} className="flex items-start gap-2 py-2">
              <span className={`mt-[7px] h-1.5 w-1.5 rounded-full shrink-0 ${n.type === "briefing" ? "bg-accent" : "bg-accent/60"}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] leading-snug">{cleanTitle(n.title)}</p>
                <p className="text-xs text-muted">{[n.type !== "briefing" && n.body?.split("\n")[0], timeAgo(n.created_at)].filter(Boolean).join(" · ")}</p>
                {n.type === "briefing" && n.body && <p className="text-sm text-muted mt-1 whitespace-pre-line">{n.body}</p>}
                {(n.type === "waiting" || (n.type === "auto_done" && n.item_id)) && (
                  <div className="flex gap-1 -ml-3">
                    {n.type === "waiting" && <Button variant="ghost" onClick={() => goChat(`Help me follow up on: ${cleanTitle(n.title)}`)}>Draft follow-up</Button>}
                    {n.type === "auto_done" && <Button variant="ghost" onClick={async () => { await api.undoNudge(n.id); load(); }}>Undo</Button>}
                  </div>
                )}
              </div>
              <button aria-label="Dismiss" onClick={async () => { await api.dismissNudge(n.id); load(); }}
                className="shrink-0 -mr-1 h-7 w-7 grid place-items-center rounded-full text-muted hover:bg-sunken">✕</button>
            </div>
          ))}
        </Section>
      ))}

      {data.events.length > 0 && (
        <Section title="Calendar" count={data.events.length}>
          {data.events.map((e) => <EventRow key={e.id} e={e} />)}
        </Section>
      )}

      {data.overdue.length > 0 && (
        <Section title="Overdue" count={data.overdue.length} danger>
          {data.overdue.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} compact />)}
        </Section>
      )}

      {data.today.length > 0 && (
        <Section title="Later today" count={data.today.length}>
          {data.today.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} compact />)}
        </Section>
      )}

      {data.waiting.length > 0 && (
        <Section title="Waiting on others" count={data.waiting.length}>
          {data.waiting.map((i) => <ItemRow key={i.id} item={i} onChange={load} onOpen={onOpenItem} compact />)}
        </Section>
      )}

      {!data.nudges.length && !data.today.length && !data.overdue.length && <Empty>All clear. Nothing needs you right now.</Empty>}

      {data.projects.length > 0 && (
        <Section title="Active projects" count={data.projects.length}>
          <div className="grid grid-cols-2 gap-2">
            {data.projects.map((p) => (
              <div key={p.id} className="rounded-xl bg-sunken p-3">
                <p className="font-medium text-sm truncate">{p.name}</p>
                <p className="text-xs text-muted">{p.open_count ?? 0} open · {p.area}</p>
              </div>
            ))}
          </div>
        </Section>
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

function EventRow({ e }: { e: CalendarEvent }) {
  const start = new Date(e.start_at);
  const past = !e.all_day && e.end_at ? new Date(e.end_at).getTime() < Date.now() : false;
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <a href={e.html_link ?? undefined} target="_blank" rel="noreferrer" className={`flex gap-3 py-2.5 ${past ? "opacity-45" : ""}`}>
      <span className="w-[4.5rem] shrink-0 text-sm tabular-nums text-muted whitespace-nowrap">{e.all_day ? "All day" : fmt(start)}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] leading-snug truncate">{e.summary}</span>
        {e.location && <span className="block text-xs text-muted truncate">{e.location}</span>}
      </span>
    </a>
  );
}

/** A headed group: small caps header with a count, rows in one white card. */
function Section({ title, count, danger, children }: { title: string; count?: number; danger?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h2 className={`px-1 mb-1.5 text-[12px] font-semibold uppercase tracking-wider ${danger ? "text-danger" : "text-muted"}`}>
        {title}{count ? <span className="ml-1.5 font-normal opacity-70">{count}</span> : null}
      </h2>
      <div className="rounded-2xl bg-surface border border-line px-4 divide-y divide-line">{children}</div>
    </section>
  );
}

const GROUPS: [string, (n: Dashboard["nudges"][number]) => boolean][] = [
  ["Briefing", (n) => n.type === "briefing"],
  ["Right now", (n) => n.type === "situation"],
  ["Don't forget", (n) => /^don't forget/i.test(n.title) || n.type === "reminder"],
  ["Coming up", (n) => /^coming up/i.test(n.title) || n.type === "deadline"],
  ["Waiting on others", (n) => n.type === "waiting"],
  ["Done for you", (n) => n.type === "auto_done"],
];

function groupNudges(nudges: Dashboard["nudges"]) {
  const out = new Map<string, Dashboard["nudges"]>();
  for (const n of nudges) {
    const g = GROUPS.find(([, test]) => test(n))?.[0] ?? "Updates";
    out.set(g, [...(out.get(g) ?? []), n]);
  }
  const order = [...GROUPS.map(([t]) => t), "Updates"];
  return [...out.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
}

const cleanTitle = (t: string) => t.replace(/^(don't forget|coming up|still waiting|reminder|due soon)\s*:\s*/i, "");

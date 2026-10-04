import { useEffect, useState, type ReactNode } from "react";
import type { CalendarEvent, Item, Memory, Project } from "../../shared/types";
import { api } from "../api";
import { Card, Empty, ItemRow, timeAgo } from "../components/ui";

type Results = Awaited<ReturnType<typeof api.search>>;

/** One search box over everything: tasks (incl. finished), ideas, conversations, people, memory, brain dumps, projects, calendar. */
export default function Search({ query, onQuery, onOpenItem, onOpenConversation }: {
  query: string; onQuery: (q: string) => void; onOpenItem: (i: Item) => void; onOpenConversation: (id: string) => void;
}) {
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setRes(null); return; }
    setLoading(true);
    const t = setTimeout(() => api.search(query).then(setRes).catch(() => setRes(null)).finally(() => setLoading(false)), 250);
    return () => clearTimeout(t);
  }, [query]);

  const total = res ? res.items.length + res.memories.length + res.people.length + res.conversations.length + res.brain_dumps.length + res.projects.length + res.events.length : 0;

  return (
    <div className="space-y-4">
      <input autoFocus value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search everything…"
        className="w-full rounded-full bg-surface border border-line px-5 py-3 outline-none focus:border-accent shadow-card text-[16px]" />
      {query.trim().length < 2 ? (
        <p className="text-sm text-muted px-1">Tasks, ideas, conversations, people, memories, brain dumps, projects and calendar, all at once.</p>
      ) : loading && !res ? <p className="text-sm text-muted px-1">Searching…</p> : total === 0 ? (
        <Empty>Nothing found for "{query}".</Empty>
      ) : res && (
        <>
          <Group title="Tasks & ideas" n={res.items.length}>
            <div className="divide-y divide-line">{res.items.map((i) => <ItemRow key={i.id} item={i} onChange={() => onQuery(query)} onOpen={onOpenItem} />)}</div>
          </Group>
          <Group title="Conversations" n={res.conversations.length}>
            {res.conversations.map((m, k) => (
              <button key={k} onClick={() => m.conversation_id && onOpenConversation(m.conversation_id)} className="w-full text-left py-2 border-b border-line last:border-0">
                <p className="text-xs text-muted">{m.title || "Conversation"} · {m.role === "user" ? "you" : "Chief of Staff"} · {timeAgo(m.created_at)}</p>
                <p className="text-sm line-clamp-2">{highlight(m.content, query)}</p>
              </button>
            ))}
          </Group>
          <Group title="People" n={res.people.length}>
            {res.people.map((p) => (
              <div key={p.id} className="py-2 border-b border-line last:border-0">
                <p className="text-sm font-medium">{p.name}{p.role && <span className="text-muted font-normal"> · {p.role}</span>}</p>
                <p className="text-xs text-muted">{[p.email, p.phone, p.whatsapp_name && `WhatsApp: ${p.whatsapp_name}`, p.notes].filter(Boolean).join(" · ")}</p>
              </div>
            ))}
          </Group>
          <Group title="Memory" n={res.memories.length}>
            {res.memories.map((m: Memory) => <p key={m.id} className="text-sm py-1.5 border-b border-line last:border-0">{highlight(m.content, query)}</p>)}
          </Group>
          <Group title="Calendar" n={res.events.length}>
            {res.events.map((e: CalendarEvent) => (
              <a key={e.id} href={e.html_link ?? undefined} target="_blank" rel="noreferrer" className="block py-2 border-b border-line last:border-0">
                <p className="text-sm">{e.summary}</p>
                <p className="text-xs text-muted">{e.all_day ? e.start_at : new Date(e.start_at).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{e.location ? ` · ${e.location}` : ""}</p>
              </a>
            ))}
          </Group>
          <Group title="Brain dumps" n={res.brain_dumps.length}>
            {res.brain_dumps.map((b) => (
              <details key={b.id} className="py-2 border-b border-line last:border-0">
                <summary className="text-sm cursor-pointer">{b.summary || b.raw.slice(0, 80)} <span className="text-xs text-muted">· {timeAgo(b.created_at)}</span></summary>
                <p className="text-sm text-muted whitespace-pre-wrap mt-1">{b.raw}</p>
              </details>
            ))}
          </Group>
          <Group title="Projects" n={res.projects.length}>
            {res.projects.map((p: Project) => <p key={p.id} className="text-sm py-1.5">{p.name}<span className="text-muted"> · {p.status}</span></p>)}
          </Group>
        </>
      )}
    </div>
  );
}

function Group({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  if (!n) return null;
  return <Card title={`${title} (${n})`}>{children}</Card>;
}

function highlight(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 220);
  const start = Math.max(0, i - 60);
  const snip = (start ? "…" : "") + text.slice(start, i + q.length + 140);
  const j = snip.toLowerCase().indexOf(q.toLowerCase());
  return <>{snip.slice(0, j)}<mark className="bg-accent/20 text-ink rounded px-0.5">{snip.slice(j, j + q.length)}</mark>{snip.slice(j + q.length)}</>;
}

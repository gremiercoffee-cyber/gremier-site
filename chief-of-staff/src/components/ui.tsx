import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Item, ItemKind } from "../../shared/types";
import { api } from "../api";
import { createRecognizer, speechRecognitionAvailable, startRecording } from "../voice";

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[20px] bg-surface border border-line/70 shadow-card p-5 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-medium text-muted uppercase tracking-[0.14em]">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Button({
  children, onClick, variant = "primary", disabled, type = "button", className = "", title,
}: {
  children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger" | "soft";
  disabled?: boolean; type?: "button" | "submit"; className?: string; title?: string;
}) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    soft: "bg-sunken text-ink hover:bg-line",
    ghost: "text-muted hover:text-ink hover:bg-sunken",
    danger: "text-danger hover:bg-sunken",
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export const KIND_META: Record<ItemKind, { label: string; plural: string; color: string }> = {
  task: { label: "Task", plural: "Tasks", color: "#6b78e5" },
  reminder: { label: "Reminder", plural: "Reminders", color: "#3a9bc4" },
  commitment: { label: "Commitment", plural: "Commitments", color: "#a46bd6" },
  waiting: { label: "Waiting for", plural: "Waiting for", color: "#3fa883" },
  idea: { label: "Idea", plural: "Ideas", color: "#8a8fa0" },
};

export function formatDue(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const nowD = new Date();
  const overdue = d.getTime() < nowD.getTime();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(nowD.getTime() + 86400_000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  let text: string;
  if (sameDay(d, nowD)) text = `Today ${time}`;
  else if (sameDay(d, tomorrow)) text = `Tomorrow ${time}`;
  else if (Math.abs(d.getTime() - nowD.getTime()) < 6 * 86400_000) text = `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  else text = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return { text, overdue };
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ItemRow({ item, onChange, onOpen }: { item: Item; onChange: () => void; onOpen?: (i: Item) => void }) {
  const due = formatDue(item.due_at);
  const done = item.status === "done";
  const toggle = async () => {
    await api.updateItem(item.id, { status: done ? "open" : "done" });
    onChange();
  };
  return (
    <div className="flex items-start gap-3 py-2.5 group">
      {item.kind === "idea" ? (
        <span className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: KIND_META.idea.color }} />
      ) : (
        <button onClick={toggle} aria-label={done ? "Mark open" : "Mark done"}
          className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 grid place-items-center transition ${done ? "bg-ok border-ok" : "border-line hover:border-accent"}`}>
          {done && <svg viewBox="0 0 16 16" className="h-3 w-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3.5 8.5l3 3 6-7" /></svg>}
        </button>
      )}
      <button className="flex-1 min-w-0 text-left" onClick={() => onOpen?.(item)}>
        <div className={`text-[15px] leading-snug ${done ? "line-through text-muted" : ""}`}>{item.title}</div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-xs text-muted">
          {item.priority === 1 && <span className="text-danger font-medium">High</span>}
          {due && <span className={due.overdue && !done ? "text-danger font-medium" : ""}>{due.text}</span>}
          {item.person && <span>{item.kind === "waiting" ? "from" : "with"} {item.person}</span>}
          {item.notes && <span className="truncate max-w-[16rem]">{item.notes}</span>}
        </div>
        {!done && item.kind !== "idea" && !item.category && (
          <span className="flex flex-wrap items-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-[11px] text-accent mr-0.5">Which area?</span>
            {[["coffee", "☕ Coffee"], ["yeshiva", "📚 Yeshiva"], ["personal", "🏠 Personal"]].map(([k, label]) => (
              <span key={k} role="button" onClick={async () => { await api.updateItem(item.id, { category: k }); onChange(); }}
                className="rounded-full bg-sunken px-2 py-0.5 text-[11px] hover:bg-line">{label}</span>
            ))}
          </span>
        )}
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted py-2">{children}</p>;
}

/**
 * Small markdown renderer for replies and reports: headings, bullet/numbered lists, bold, links.
 * Escapes everything else (React text nodes).
 */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (/^https?:\/\//.test(part)) {
        return <a key={i} href={part} target="_blank" rel="noreferrer" className="text-accent underline break-all">{part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}</a>;
      }
      return <span key={i}>{part}</span>;
    });
  // Walk line by line so headings, lists and paragraphs can sit next to each other.
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => { if (para.length) { out.push(<p key={out.length}>{para.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>); para = []; } };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((l, j) => <li key={j}>{inline(l)}</li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^\s*([-*•]|\d+\.)\s+(.*)$/);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) {
      flushPara(); flushList();
      out.push(<p key={out.length} className={`${h[1].length <= 2 ? "text-[16px] mt-3" : "text-[15px] mt-2"} font-semibold`}>{inline(h[2])}</p>);
    } else if (li) {
      flushPara();
      const ordered = /\d/.test(li[1]);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push(li[2]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return <div className="prose-chat">{out}</div>;
}

/**
 * Batch dictation button: records a clip, transcribes it on the server (gpt-transcribe) and
 * returns the text. Falls back to on-device recognition if the server can't transcribe.
 */
export function DictateButton({ onText, serverTranscription, compact }: { onText: (t: string) => void; serverTranscription: boolean; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [error, setError] = useState("");
  const recRef = useRef<{ stop: () => Promise<Blob> } | null>(null);
  const srRef = useRef<{ stop: () => void } | null>(null);
  const bufRef = useRef<string[]>([]);

  useEffect(() => () => { srRef.current?.stop(); }, []);

  const start = async () => {
    setError("");
    try {
      if (serverTranscription && typeof MediaRecorder !== "undefined") {
        recRef.current = await startRecording();
      } else if (speechRecognitionAvailable()) {
        bufRef.current = [];
        const sr = createRecognizer({
          continuous: true,
          onFinal: (t) => bufRef.current.push(t),
          onError: (e) => setError(e),
        });
        sr.start();
        srRef.current = sr;
      } else {
        setError("Dictation isn't supported in this browser.");
        return;
      }
      setState("recording");
    } catch {
      setError("Microphone permission denied.");
    }
  };

  const stop = async () => {
    if (recRef.current) {
      setState("working");
      try {
        const blob = await recRef.current.stop();
        const { text } = await api.transcribe(blob);
        if (text.trim()) onText(text.trim());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transcription failed");
      }
      recRef.current = null;
    } else if (srRef.current) {
      srRef.current.stop();
      srRef.current = null;
      // Allow the final result event to land.
      await new Promise((r) => setTimeout(r, 400));
      const text = bufRef.current.join(" ").trim();
      if (text) onText(text);
    }
    setState("idle");
  };

  if (compact) {
    return (
      <div className="relative">
        <button onClick={state === "recording" ? stop : start} disabled={state === "working"} aria-label="Dictate"
          className={`h-12 w-12 rounded-full grid place-items-center border transition ${state === "recording" ? "bg-danger text-white border-danger" : "bg-surface border-line text-muted"}`}>
          {state === "working" ? <span className="text-xs">…</span> : state === "recording" ? <span className="h-3.5 w-3.5 rounded-sm bg-white" /> : <DictIcon />}
        </button>
        {error && <span className="absolute top-full mt-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-danger">{error}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant={state === "recording" ? "primary" : "soft"} onClick={state === "recording" ? stop : start}
        disabled={state === "working"} title="Dictate">
        <MicIcon />
        {state === "recording" ? "Stop" : state === "working" ? "Transcribing…" : "Dictate"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

export const MicIcon = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const DictIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M4 7h10M4 12h16M4 17h7" /><circle cx="18" cy="7" r="2" />
  </svg>
);

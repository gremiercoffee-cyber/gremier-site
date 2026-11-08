import { useEffect, useState } from "react";
import type { ApprovalCard } from "../../shared/types";
import { api } from "../api";
import { Button } from "./ui";

const ICONS: Record<ApprovalCard["kind"], { label: string; path: string }> = {
  email: { label: "Email to", path: "M4 6h16v12H4z M4 7l8 6 8-6" },
  whatsapp: { label: "WhatsApp to", path: "M5 19l1.3-3.6A7 7 0 1 1 9 18.3z" },
  ai: { label: "AI job", path: "M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" },
  share: { label: "Share", path: "M8 12h8 M12 8l4 4-4 4 M4 4h7 M4 4v16h16v-7" },
  delete: { label: "Delete", path: "M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13" },
  other: { label: "Approval", path: "M5 12l4 4 10-10" },
};

/** Everything waiting for the owner's OK, one short card each. Nothing happens until Approve. */
export default function Approvals({ refreshKey, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [cards, setCards] = useState<ApprovalCard[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const load = () => api.approvals().then((c) => { setCards(c); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [refreshKey]);

  const decide = async (c: ApprovalCard, decision: "approve" | "reject") => {
    setBusy(c.id); setError("");
    try {
      const r = await api.decideApproval(c.source, c.id, decision);
      setNotice(r.outcome || (decision === "approve" ? "Done." : "Declined."));
      setCards((all) => all.filter((x) => x.id !== c.id));
      onChanged?.();
    } catch (e) { setError((e as Error).message); void load(); }
    setBusy(null);
  };

  if (!cards.length) return notice ? <p role="status" className="text-sm text-accent px-1">{notice}</p> : error ? <p role="alert" className="text-sm text-danger px-1">{error}</p> : null;
  return (
    <section aria-label="Needs your approval">
      <h2 className="px-1 mb-2 flex items-center gap-2 text-[17px] font-semibold">✋ Needs your OK<span className="text-[13px] font-normal text-muted">{cards.length}</span></h2>
      {notice && <p role="status" className="text-sm text-accent px-1 mb-2">{notice}</p>}
      {error && <p role="alert" className="text-sm text-danger px-1 mb-2">{error}</p>}
      <div className="space-y-2.5">
        {cards.map((c) => {
          const icon = ICONS[c.kind] ?? ICONS.other, expanded = open === c.id;
          const title = c.title.replace(/^(Email to|WhatsApp to|Alumni visit:)\s*/i, "");
          return (
            <article key={`${c.source}:${c.id}`} className="rounded-[18px] bg-surface border border-line/70 shadow-card p-4">
              <div className="flex items-start gap-3">
                <span aria-hidden className="mt-0.5 grid place-items-center h-9 w-9 shrink-0 rounded-xl bg-accent/10 text-accent">
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={icon.path} /></svg>
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-muted">{icon.label}</p>
                  <p className="text-[15px] font-medium leading-snug truncate">{title}</p>
                  {c.detail && <p className="text-sm text-muted leading-snug truncate">{c.detail}</p>}
                  {c.meta && <p className="text-xs text-muted truncate mt-0.5">{c.meta}</p>}
                </div>
              </div>
              {c.preview && (
                <button onClick={() => setOpen(expanded ? null : c.id)} className="mt-3 w-full text-left rounded-xl bg-sunken px-3 py-2.5 text-sm leading-relaxed">
                  <span className={expanded ? "whitespace-pre-wrap" : "line-clamp-2"}>{c.preview}</span>
                </button>
              )}
              <div className="mt-3 flex items-center gap-2">
                {c.link && <a href={c.link} target="_blank" rel="noreferrer" className="text-sm text-accent font-medium shrink-0 px-1">Edit in Gmail</a>}
                <span className="ml-auto flex gap-2 shrink-0">
                  <Button variant="soft" disabled={busy === c.id} onClick={() => void decide(c, "reject")}>Decline</Button>
                  <Button disabled={busy === c.id} onClick={() => void decide(c, "approve")}>{busy === c.id ? "…" : c.approve}</Button>
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

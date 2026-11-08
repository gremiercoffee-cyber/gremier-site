import { useState } from "react";
import type { HomeJob } from "../../shared/types";
import { api } from "../api";
import { timeAgo } from "./ui";
import { toast } from "./TaskSheet";

/** A thin progress bar: how much of the job is done. */
function Bar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-2.5 h-2 rounded-full bg-sunken overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={`${done} of ${total}`}>
      <div className={`h-full rounded-full ${pct === 100 ? "bg-ok" : "bg-accent"}`} style={{ width: `${Math.max(pct, 4)}%` }} />
    </div>
  );
}

/**
 * "In progress": work the Chief of Staff is doing for you. Each card shows how far along it is and what
 * happens next; tap it for the details and the one Stop button.
 */
export default function InProgress({ jobs, onChanged, onOpenChat }: { jobs: HomeJob[]; onChanged: () => void; onOpenChat: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const job = jobs.find((j) => j.id === open) ?? null;
  if (!jobs.length) return null;
  return (
    <section aria-label="In progress">
      <h2 className="px-1 mb-2 flex items-center gap-2 text-[17px] font-semibold">🔄 In progress<span className="text-[13px] font-normal text-muted">{jobs.length}</span></h2>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {jobs.map((j) => (
          <button key={j.id} onClick={() => setOpen(j.id)} className="text-left rounded-[20px] bg-surface border border-line/70 shadow-card p-4 hover:border-accent/40 transition">
            <div className="flex items-start gap-3">
              <span className="grid place-items-center h-10 w-10 shrink-0 rounded-2xl bg-sunken text-[20px]" aria-hidden>{j.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold leading-snug line-clamp-2">{j.title}</p>
                <p className="text-[13px] text-muted leading-snug mt-0.5">{j.status}</p>
              </div>
            </div>
            {j.progress && <Bar {...j.progress} />}
            {j.kind === "hashgacha" && j.rows.some((r) => r.icon !== "✅") && (
              <p className="mt-2 text-[13px] leading-snug"><span className="text-muted">Still out: </span>{j.rows.filter((r) => r.icon === "⏳" || r.icon === "❔").map((r) => r.label).join(", ") || "none"}</p>
            )}
            {j.kind === "waiting" && <p className="mt-2 text-[13px] leading-snug text-muted line-clamp-2">{j.rows.slice(0, 3).map((r) => r.label).join(" · ")}{j.rows.length > 3 ? ` · +${j.rows.length - 3} more` : ""}</p>}
            {j.next && <p className="mt-2 text-[12.5px] leading-snug text-accent">⏭️ {j.next}</p>}
          </button>
        ))}
      </div>
      {job && <JobSheet job={job} onClose={() => setOpen(null)} onChanged={onChanged} onOpenChat={onOpenChat} />}
    </section>
  );
}

/** One job: every row, what happens next, and Stop (asks once to make sure). */
function JobSheet({ job, onClose, onChanged, onOpenChat }: { job: HomeJob; onClose: () => void; onChanged: () => void; onOpenChat: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const stop = async (row?: string) => {
    setBusy(true);
    try {
      const r = await api.stopHomeJob(job.id, row);
      toast(`⏹️ ${r.message}`);
      if (row) setHidden((h) => new Set(h).add(row)); else onClose();
      onChanged();
    } catch (e) { toast(`⚠️ ${(e as Error).message}`); }
    setBusy(false); setConfirming(false);
  };
  const check = async () => { setBusy(true); try { await api.homeJobs(true); onChanged(); toast("🔄 Checked just now"); } catch (e) { toast(`⚠️ ${(e as Error).message}`); } setBusy(false); };
  const rows = job.rows.filter((r) => !hidden.has(r.id));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label={job.title} className="w-full sm:max-w-lg max-h-[88vh] flex flex-col bg-surface rounded-t-3xl sm:rounded-3xl shadow-card sheet-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 pb-3">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line sm:hidden" />
          <div className="flex items-start gap-3">
            <span className="grid place-items-center h-11 w-11 shrink-0 rounded-2xl bg-sunken text-[22px]" aria-hidden>{job.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[18px] font-semibold leading-snug">{job.title}</p>
              <p className="text-[14px] text-muted">{job.status}</p>
            </div>
          </div>
          {job.progress && <Bar {...job.progress} />}
          {job.next && <p className="mt-3 rounded-xl bg-accent/10 text-accent px-3 py-2 text-[13.5px] leading-snug">⏭️ {job.next}</p>}
          {job.note && <p className="mt-2 text-[13px] text-muted leading-snug">{job.note}</p>}
        </div>
        {!!rows.length && (
          <ul className="flex-1 min-h-0 overflow-y-auto px-5 divide-y divide-line/70 border-y border-line/70">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="w-6 text-center text-[16px]" aria-hidden>{r.icon}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14.5px] leading-snug" dir="auto">{r.label}</span>
                  {r.detail && <span className="block text-[12px] text-muted">{r.detail}</span>}
                </span>
                {r.stoppable && <button disabled={busy} onClick={() => void stop(r.id)} className="shrink-0 rounded-full bg-sunken px-3 py-1.5 text-[12.5px] text-muted hover:text-danger">✕ Stop</button>}
              </li>
            ))}
          </ul>
        )}
        <div className="p-5 pt-3 pb-safe flex flex-wrap items-center gap-2">
          {job.kind === "hashgacha" && <button disabled={busy} onClick={() => void check()} className="rounded-full bg-sunken px-4 py-2.5 text-[13.5px] font-medium">🔄 Check now</button>}
          {job.kind === "research" && <button onClick={() => { onClose(); onOpenChat(job.id); }} className="rounded-full bg-sunken px-4 py-2.5 text-[13.5px] font-medium">💬 Open chat</button>}
          {job.checked_at && <span className="text-[12px] text-muted">checked {timeAgo(job.checked_at)}</span>}
          <span className="ml-auto flex gap-2">
            {job.can_stop && (confirming
              ? <><button onClick={() => setConfirming(false)} className="rounded-full px-4 py-2.5 text-[13.5px] text-muted">Keep going</button>
                  <button disabled={busy} onClick={() => void stop()} className="rounded-full bg-danger text-white px-4 py-2.5 text-[13.5px] font-medium">Yes, stop</button></>
              : <button onClick={() => setConfirming(true)} className="rounded-full bg-danger/10 text-danger px-4 py-2.5 text-[13.5px] font-medium">⏹️ {job.stop_label ?? "Stop"}</button>)}
            {!confirming && <button onClick={onClose} className="rounded-full px-4 py-2.5 text-[13.5px] text-muted">Close</button>}
          </span>
        </div>
      </div>
    </div>
  );
}

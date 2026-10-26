import { useEffect, useState } from "react";
import { api, type HelperJob } from "../api";
import { Button, timeAgo } from "./ui";

const STATUS: Record<string, [string, string]> = {
  waiting_approval: ["Waiting for your OK", "bg-amber-500/15 text-amber-700"],
  queued: ["Waiting for your computer", "bg-sunken text-muted"],
  running: ["Working…", "bg-accent/15 text-accent"],
  needs_you: ["Needs you", "bg-amber-500/15 text-amber-700"],
  done: ["Done", "bg-ok/15 text-ok"],
  failed: ["Couldn't finish", "bg-danger/10 text-danger"],
  cancelled: ["Cancelled", "bg-sunken text-muted"],
};

/** The computer helper's jobs: give it one, approve outside requests, answer its questions, see the result. */
export default function HelperJobs({ refreshKey }: { refreshKey: number }) {
  const [jobs, setJobs] = useState<HelperJob[] | null>(null);
  const [text, setText] = useState(""), [busy, setBusy] = useState(""), [error, setError] = useState(""), [answers, setAnswers] = useState<Record<string, string>>({}), [openLog, setOpenLog] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null | undefined>(undefined);
  const load = () => { api.helperStatus().then((s) => setSeen(s.last_seen)).catch(() => {}); return api.helperJobs().then(setJobs).catch((e) => setError(e.message)); };
  useEffect(() => { void load(); }, [refreshKey]);
  // While something is in progress, check every 5 seconds.
  useEffect(() => {
    if (!jobs?.some((j) => ["queued", "running", "needs_you", "waiting_approval"].includes(j.status))) return;
    const t = setInterval(() => void load(), 5000); return () => clearInterval(t);
  }, [jobs]);
  const act = async (id: string, decision: "approve" | "cancel" | "answer") => {
    setBusy(id + decision); setError("");
    try { await api.helperDecide(id, decision, answers[id]); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };
  const add = async () => {
    setBusy("new"); setError("");
    try { await api.helperCreate(text); setText(""); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  };
  if (!jobs) return null;
  return (
    <section className="rounded-[20px] bg-surface border border-line p-4 space-y-3" aria-label="Computer helper">
      <div>
        <p className="font-display text-xl">🖥️ Computer helper</p>
        <p className="text-xs text-muted">Jobs done in Chrome on your home computer, signed in as you. It never types passwords or pays, and asks you here when it needs you.</p>
      </div>
      {/* Jobs waiting but the computer isn't checking in (it asks every 30 seconds when switched on). */}
      {seen !== undefined && jobs.some((j) => j.status === "queued" && !(j.not_before && Date.parse(j.not_before) > Date.now())) && (!seen || Date.now() - Date.parse(seen) > 3 * 60_000) && (
        <div className="rounded-xl bg-danger/10 border border-danger/30 p-3 text-sm space-y-1">
          <p className="font-medium">Your computer helper isn't connected{seen ? ` (last seen ${new Date(seen).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })})` : ""}.</p>
          <p className="text-muted">On the home computer: open <b>chrome://extensions</b>, press ↻ (reload) on “Chief of Staff for WhatsApp”, and allow what it asks. Then check the extension's popup has <b>Computer helper</b> switched on. Waiting jobs start within a minute.</p>
        </div>
      )}
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Enable the People API in my Google Cloud project" className="flex-1 min-w-0 rounded-xl bg-sunken px-3 py-2 text-sm" />
        <Button onClick={() => void add()} disabled={!text.trim() || busy === "new"}>Send</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {jobs.map((j) => {
        // A job whose website was down runs again by itself at its time.
        const later = j.status === "queued" && j.not_before && Date.parse(j.not_before) > Date.now();
        const [label, tone] = later ? [`Site was down · trying again ${new Date(j.not_before!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, "bg-sunken text-muted"] : STATUS[j.status] ?? [j.status, "bg-sunken"];
        const log = (() => { try { return JSON.parse(j.log) as { did: string; url: string }[]; } catch { return []; } })();
        return (
          <div key={j.id} className="rounded-2xl bg-sunken/60 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <p className="flex-1 min-w-0 text-[15px]" dir="auto">{j.instruction}</p>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
            </div>
            <p className="text-xs text-muted">{j.source !== "you" ? `Asked by ${j.source} · ` : ""}{timeAgo(j.created_at)}{j.steps ? ` · ${j.steps} steps` : ""}</p>
            {j.status === "waiting_approval" && <div className="flex gap-2"><Button onClick={() => void act(j.id, "approve")} disabled={!!busy}>✓ Allow</Button><Button variant="ghost" onClick={() => void act(j.id, "cancel")} disabled={!!busy}>✗ Deny</Button></div>}
            {j.status === "needs_you" && (
              <div className="space-y-2 rounded-xl bg-amber-500/10 p-3">
                <p className="text-sm font-medium" dir="auto">{j.question}</p>
                <div className="flex gap-2">
                  <input value={answers[j.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [j.id]: e.target.value })} placeholder="Your answer (or the code)" className="flex-1 min-w-0 rounded-xl bg-surface px-3 py-2 text-sm" />
                  <Button onClick={() => void act(j.id, "answer")} disabled={!answers[j.id]?.trim() || !!busy}>Send</Button>
                </div>
              </div>
            )}
            {j.result && <p className="text-sm" dir="auto">{j.result}</p>}
            {j.screenshot && <img src={j.screenshot} alt="What the page looked like at the end" className="w-full rounded-lg border border-line" />}
            <div className="flex flex-wrap gap-3 text-xs">
              {!!log.length && <button className="text-accent" onClick={() => setOpenLog(openLog === j.id ? null : j.id)}>{openLog === j.id ? "Hide steps" : "See what it did"}</button>}
              {["queued", "running", "needs_you"].includes(j.status) && <button className="text-muted" onClick={() => void act(j.id, "cancel")}>Stop</button>}
            </div>
            {openLog === j.id && <ol className="list-decimal pl-5 text-xs text-muted space-y-0.5">{log.map((l, i) => <li key={i}>{l.did}</li>)}</ol>}
          </div>
        );
      })}
      {!jobs.length && <p className="text-sm text-muted">Nothing yet. Switch the helper on in the Chrome extension on your home computer, then give it a job here or in chat.</p>}
    </section>
  );
}

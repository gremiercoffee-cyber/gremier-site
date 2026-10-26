import { useEffect, useState } from "react";
import { api, type AutopilotPreview } from "../api";
import { Button, Card } from "./ui";

const LABEL: Record<string, string> = { thursday: "Thursday reminder", saturday: "Saturday-night reminder", sunday: "Last reminder", thanks: "Thank-you" };

/** On/off for the Hashgacha autopilot, this week's status, and every email it has sent. */
export default function HashgachaAutopilot() {
  const [p, setP] = useState<AutopilotPreview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [show, setShow] = useState(false);
  const load = () => api.hashgachaAutopilot().then(setP).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  if (!p) return error ? <Card title="Hashgacha autopilot"><p className="text-sm text-danger">{error}</p></Card> : null;
  return (
    <Card title="Hashgacha autopilot">
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={p.enabled} disabled={busy} onChange={async (e) => {
            setBusy(true); try { await api.saveHashgachaAutopilot({ enabled: e.target.checked }); await load(); } catch (x) { setError((x as Error).message); } finally { setBusy(false); }
          }} />
          {p.enabled ? "On: emails the rabbis automatically" : "Off: no emails are sent"}
        </label>
        <ul className="text-muted space-y-0.5 list-disc pl-5">
          <li>Thursday 20:00: reminder to everyone who hasn't filed</li>
          <li>When a report comes in: a thank-you (checked every 15 minutes)</li>
          <li>Saturday night, after Shabbat: reminder to anyone still missing</li>
          <li>Sunday 09:00: last reminder to anyone still missing</li>
        </ul>
        <p className="text-xs text-muted">Never on Shabbat or at night; each email at most once per rabbi per week. You get a short note after each round.</p>
        {p.start_week && p.start_week > p.week_of && <p className="rounded-xl bg-accent/10 text-accent px-3 py-2 text-sm">Starts with the week of {new Date(`${p.start_week}T12:00:00Z`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}: nothing is sent about the current week.</p>}
        <div className="rounded-xl bg-sunken p-3 space-y-1">
          <p className="font-medium">Week of {new Date(`${p.week_of}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short" })}</p>
          {p.error ? <p className="text-danger text-xs">Couldn't read the reports: {p.error}</p> : <>
            <p>✓ Filed ({p.filed.length}): {p.filed.join(", ") || "nobody yet"}</p>
            <p>⏳ Not yet ({p.missing.length}): {p.missing.join(", ") || "nobody"}</p>
            {!!p.no_email.length && <p className="text-amber-700">No email on file: {p.no_email.join(", ")}</p>}
          </>}
        </div>
        {!!p.sent.length && <details><summary className="cursor-pointer text-muted">Emails sent ({p.sent.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">{p.sent.map((s, i) => <li key={i} className={s.error ? "text-danger" : ""}>{new Date(s.sent_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })} · {LABEL[s.kind] ?? s.kind} → {s.name}{s.error ? ` (failed: ${s.error})` : ""}</li>)}</ul>
        </details>}
        <Button variant="ghost" onClick={() => setShow(!show)}>{show ? "Hide the email wording" : "See the email wording"}</Button>
        {show && <div className="space-y-2">{Object.entries(p.templates).map(([k, t]) => (
          <div key={k} className="rounded-xl border border-line p-3"><p className="text-xs text-muted">{LABEL[k] ?? k}</p><p className="font-medium">{t.subject}</p><p className="whitespace-pre-wrap text-xs mt-1" dir="auto">{t.body}</p></div>
        ))}<p className="text-xs text-muted">To change the wording, tell me (or the assistant) what it should say.</p></div>}
      </div>
    </Card>
  );
}

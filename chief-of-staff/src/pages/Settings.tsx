import { useEffect, useState } from "react";
import type { Memory, Settings as S } from "../../shared/types";
import { api, setToken } from "../api";
import { Button, Card, Empty } from "../components/ui";

// OpenAI Realtime voices for live conversation.
const VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];

type Usage = Awaited<ReturnType<typeof api.usage>>;

export default function Settings({ settings, onSaved, installPrompt }: {
  settings: S; onSaved: (s: S) => void; installPrompt: (() => void) | null;
}) {
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [usage, setUsage] = useState<Usage>([]);
  const [notif, setNotif] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("cos.theme") ?? "system"; } catch { return "system"; } });

  useEffect(() => {
    api.memories().then(setMemories).catch(() => {});
    api.usage().then(setUsage).catch(() => {});
  }, []);

  const save = async () => {
    const s = await api.saveSettings(form);
    onSaved(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const applyTheme = (t: string) => {
    setTheme(t);
    try { localStorage.setItem("cos.theme", t); } catch { /* ignore */ }
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };

  const [pushState, setPushState] = useState<"unknown" | "on" | "off" | "working">("unknown");
  const [pushMsg, setPushMsg] = useState("");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setPushState("off");
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setPushState(s ? "on" : "off")).catch(() => setPushState("off"));
  }, []);

  // Ask permission, subscribe this device with the server's VAPID key, and register it.
  const enableNotifications = async () => {
    setPushMsg("");
    if (typeof Notification === "undefined" || !("PushManager" in window)) {
      setPushMsg("This browser can't receive notifications. On iPhone, open the app from your Home Screen icon first.");
      return;
    }
    setPushState("working");
    try {
      const p = await Notification.requestPermission();
      setNotif(p);
      if (p !== "granted") throw new Error("Notifications were blocked. Allow them in your phone's settings for this app.");
      const { key } = await api.pushKey();
      if (!key) throw new Error("The server isn't set up to send notifications yet.");
      const reg = await navigator.serviceWorker.ready;
      const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw }));
      await api.subscribePush(sub.toJSON());
      setPushState("on");
      setPushMsg("Done. You'll get reminders on this device.");
    } catch (e) {
      setPushState("off");
      setPushMsg((e as Error).message);
    }
  };
  const testNotification = async () => {
    const r = await api.pushTest().catch(() => ({ sent: 0, failed: 1 }));
    setPushMsg(r.sent ? "Test sent. It should appear in a few seconds." : "Couldn't send. Try turning alerts on again.");
  };

  const field = "w-full rounded-xl bg-sunken px-3 py-2.5 outline-none text-[15px]";
  const timezones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  if (!timezones.includes(form.timezone)) timezones.unshift(form.timezone);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-[32px] leading-tight">Settings</h1>

      <Card title="You">
        <div className="space-y-3">
          <label className="block text-xs text-muted space-y-1"><span>What should I call you?</span>
            <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block text-xs text-muted space-y-1"><span>Time zone</span>
            <select className={field} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>
              {timezones.map((z) => <option key={z}>{z}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-muted space-y-1"><span>Morning briefing at</span>
              <select className={field} value={form.briefing_hour} onChange={(e) => setForm({ ...form, briefing_hour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted space-y-1"><span>Voice</span>
              <select className={field} value={form.voice_name} onChange={(e) => setForm({ ...form, voice_name: e.target.value })}>
                <option value="">Default (Marin)</option>
                {VOICES.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.proactive} onChange={(e) => setForm({ ...form, proactive: e.target.checked })} />
            Proactive nudges and morning briefing
          </label>
          <Button onClick={save}>{saved ? "Saved ✓" : "Save"}</Button>
        </div>
      </Card>

      <Card title="Appearance & device">
        <div className="space-y-3">
          <div className="flex gap-1.5">
            {["system", "light", "dark"].map((t) => (
              <button key={t} onClick={() => applyTheme(t)}
                className={`rounded-full px-3 py-1 text-sm capitalize ${theme === t ? "bg-ink text-bg" : "bg-sunken text-muted"}`}>{t}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {installPrompt && <Button variant="soft" onClick={installPrompt}>Install app</Button>}
            {pushState !== "on" && <Button onClick={enableNotifications} disabled={pushState === "working"}>
              {pushState === "working" ? "Turning on…" : "Turn on notifications"}</Button>}
            {pushState === "on" && <Button variant="soft" onClick={testNotification}>Send a test notification</Button>}
          </div>
          {pushMsg && <p className="text-sm">{pushMsg}</p>}
          <p className="text-xs text-muted">
            Notifications: {pushState === "on" ? "on for this device" : notif === "denied" ? "blocked in your phone settings" : "off"}.
            On iPhone, add to Home Screen first (Share → Add to Home Screen) and open the app from that icon.
          </p>
        </div>
      </Card>

      <Card title={`Memory (${memories.length})`}>
        {memories.length === 0 ? <Empty>Nothing remembered yet. Tell me about yourself, your business and the people you work with.</Empty> : (
          <ul className="divide-y divide-line">
            {memories.map((m) => (
              <li key={m.id} className="py-2 flex gap-2 items-start">
                <span className="text-[10px] uppercase tracking-wide text-muted bg-sunken rounded px-1.5 py-0.5 mt-0.5">{m.category}</span>
                <p className="flex-1 text-sm">{m.content}</p>
                <button className="text-xs text-muted hover:text-danger" onClick={async () => { await api.deleteMemory(m.id); setMemories((x) => x.filter((y) => y.id !== m.id)); }}>Forget</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Model usage (30 days)">
        {usage.length === 0 ? <Empty>No model calls yet.</Empty> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="font-normal">Purpose</th><th className="font-normal">Calls</th><th className="font-normal text-right">Tokens in / out</th></tr></thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.model + u.purpose} className="border-t border-line">
                  <td className="py-1.5">{u.purpose}<div className="text-[10px] text-muted">{u.model}</div></td>
                  <td>{u.calls}</td>
                  <td className="text-right tabular-nums">{u.input_tokens.toLocaleString()} / {u.output_tokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Data">
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={async () => {
            const r = await fetch("/api/export", { headers: { authorization: `Bearer ${localStorage.getItem("cos.token")}` } });
            const url = URL.createObjectURL(await r.blob());
            const a = document.createElement("a");
            a.href = url; a.download = `chief-of-staff-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
            URL.revokeObjectURL(url);
          }}>Export everything</Button>
          <Button variant="danger" onClick={() => { setToken(""); location.reload(); }}>Sign out</Button>
        </div>
      </Card>
    </div>
  );
}

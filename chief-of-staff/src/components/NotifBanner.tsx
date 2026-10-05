import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * Shows when this device isn't getting notifications (Chrome/Android can switch them off on its own),
 * with a one-tap fix. Checks every time the app comes back to the foreground.
 */
export default function NotifBanner() {
  const [state, setState] = useState<"ok" | "off" | "blocked">("ok");
  const [msg, setMsg] = useState("");
  const check = async () => {
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return;
    if (Notification.permission === "denied") return setState("blocked");
    if (Notification.permission !== "granted") return setState("off");
    try {
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? "ok" : "off");
    } catch { setState("off"); }
  };
  useEffect(() => {
    check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  const turnOn = async () => {
    setMsg("");
    try {
      const p = await Notification.requestPermission();
      if (p !== "granted") { setState(p === "denied" ? "blocked" : "off"); return; }
      const { key } = await api.pushKey();
      const reg = await navigator.serviceWorker.ready;
      const raw = Uint8Array.from(atob(key!.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw }));
      await api.subscribePush(sub.toJSON());
      setState("ok");
    } catch (e) { setMsg((e as Error).message); }
  };
  if (state === "ok") return null;
  return (
    <div className="mx-4 mb-2 rounded-2xl bg-danger/10 border border-danger/30 px-4 py-3">
      <p className="text-[15px] font-medium text-danger">🔕 Notifications are off on this phone</p>
      {state === "off" ? (
        <>
          <p className="text-[13px] text-ink/80 mt-0.5">You won't get reminders until they're back on.</p>
          <button onClick={turnOn} className="mt-2 rounded-full bg-danger text-white px-4 py-1.5 text-[14px] font-medium">Turn on</button>
        </>
      ) : (
        <p className="text-[13px] text-ink/80 mt-0.5">
          Android blocked them for this app. To fix: tap the ⓘ or lock icon next to the address bar (or Chrome menu → Settings → Site settings → Notifications), find this site and set it to <b>Allow</b>. Then come back here.
        </p>
      )}
      {msg && <p className="text-xs text-danger mt-1">{msg}</p>}
    </div>
  );
}

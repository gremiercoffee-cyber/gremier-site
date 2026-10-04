// Sends what content.js found to the Chief of Staff, using the bridge key from config.js.
importScripts("config.js"); // defines COS_CONFIG = { api_base, bridge_key, my_names }

async function call(path, body) {
  const r = await fetch(COS_CONFIG.api_base.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bridge-key": COS_CONFIG.bridge_key },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let lastDiag = 0;
async function remember(patch) {
  const cur = (await chrome.storage.local.get("cos")).cos || {};
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ cos: next });
  // Health report to the Chief of Staff (status words and sender names only, never message text).
  if (Date.now() - lastDiag > 5000) {
    lastDiag = Date.now();
    call("/api/bridge/diag", { mode: next.mode, last_seen: next.last_seen, last_event: next.last_event, error: next.error, at: new Date().toISOString() }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "config") { reply({ my_names: COS_CONFIG.my_names || [] }); return; }
  if (msg.type === "seen") { remember({ last_seen: `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${msg.note}` }); reply({ ok: true }); return; }
  if (msg.type === "status") { remember({ mode: msg.mode, mode_at: Date.now() }); reply({ ok: true }); return; }
  if (msg.type === "incoming" || msg.type === "replied") {
    const path = msg.type === "incoming" ? "/api/bridge/incoming" : "/api/bridge/replied";
    call(path, msg.payload)
      .then((res) => remember({
        last_ok: Date.now(),
        last_event: msg.type === "incoming" ? `${msg.payload.sender}: ${res.filed ? "sent to Chief of Staff" : res.reason}` : `You replied to ${msg.payload.chat}`,
        error: null,
      }))
      .catch((e) => remember({ error: `${e.message} at ${new Date().toLocaleTimeString()}` }));
    reply({ ok: true });
  }
});

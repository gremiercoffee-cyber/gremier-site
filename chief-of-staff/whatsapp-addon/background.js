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

async function remember(patch) {
  const cur = (await chrome.storage.local.get("cos")).cos || {};
  await chrome.storage.local.set({ cos: { ...cur, ...patch } });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "config") { reply({ my_names: COS_CONFIG.my_names || [] }); return; }
  if (msg.type === "seen") { remember({ last_seen: `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${msg.note}` }); return; }
  if (msg.type === "status") { remember({ mode: msg.mode, mode_at: Date.now() }); return; }
  if (msg.type === "incoming" || msg.type === "replied") {
    const path = msg.type === "incoming" ? "/api/bridge/incoming" : "/api/bridge/replied";
    call(path, msg.payload)
      .then((res) => remember({
        last_ok: Date.now(),
        last_event: msg.type === "incoming" ? `${msg.payload.sender}: ${res.filed ? "sent to Chief of Staff" : res.reason}` : `You replied to ${msg.payload.chat}`,
        error: null,
      }))
      .catch((e) => remember({ error: `${e.message} at ${new Date().toLocaleTimeString()}` }));
  }
});

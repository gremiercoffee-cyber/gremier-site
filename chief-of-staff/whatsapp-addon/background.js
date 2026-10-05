// Sends what content.js found to the Chief of Staff, using the bridge key from config.js.
importScripts("config.js"); // defines COS_CONFIG = { api_base, bridge_key, my_names }

/** Which WhatsApp this Chrome profile holds: "personal" or "business" (set in the popup). */
async function account() {
  return (await chrome.storage.local.get("account")).account || "personal";
}

async function call(path, body) {
  body = { ...body, account: await account() };
  const r = await fetch(COS_CONFIG.api_base.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bridge-key": COS_CONFIG.bridge_key },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let diagTimer = null;
async function remember(patch) {
  const cur = (await chrome.storage.local.get("cos")).cos || {};
  await chrome.storage.local.set({ cos: { ...cur, ...patch } });
  // Health report to the Chief of Staff, at most every 5 s and always with the latest state
  // (status words, counts and sender names only, never message text).
  if (diagTimer) return;
  diagTimer = setTimeout(async () => {
    diagTimer = null;
    const { cos = {} } = await chrome.storage.local.get("cos");
    call("/api/bridge/diag", { mode: cos.mode, counts: cos.counts, last_seen: cos.last_seen, last_event: cos.last_event, error: cos.error, at: new Date().toISOString() }).catch(() => {});
  }, 5000);
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "config") { reply({ my_names: COS_CONFIG.my_names || [] }); return; }
  if (msg.type === "seen") { remember({ last_seen: `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ${msg.note}` }); reply({ ok: true }); return; }
  if (msg.type === "counts") { remember({ counts: msg.counts }); reply({ ok: true }); return; }
  if (msg.type === "status") { remember({ mode: msg.mode, mode_at: Date.now() }); reply({ ok: true }); return; }
  if (msg.type === "trackers") {
    account().then((a) => fetch(`${COS_CONFIG.api_base.replace(/\/$/, "")}/api/bridge/trackers?account=${a}`, { headers: { "x-bridge-key": COS_CONFIG.bridge_key } }))
      .then((r) => r.json()).then(reply).catch(() => reply([]));
    return true; // async reply
  }
  if (msg.type === "track") {
    call("/api/bridge/track", msg.payload)
      .then((res) => { if (res.kept) remember({ last_event: `Tracker: saved a message from ${msg.payload.sender}` }); })
      .catch(() => {});
    reply({ ok: true });
    return;
  }
  if (msg.type === "chats") {
    account().then((a) => call("/api/bridge/chats", { account: a, names: msg.names })).catch(() => {});
    reply({ ok: true });
    return;
  }
  if (msg.type === "backfilled") {
    account().then((a) => call(`/api/bridge/trackers/${msg.id}/backfilled`, { account: a })).catch(() => {});
    reply({ ok: true });
    return;
  }
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

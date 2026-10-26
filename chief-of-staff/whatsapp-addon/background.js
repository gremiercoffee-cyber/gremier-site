// Sends what content.js found to the Chief of Staff, using the bridge key from config.js.
importScripts("config.js");
importScripts("helper.js"); // the computer helper (off until switched on in the popup) // defines COS_CONFIG = { api_base, bridge_key, my_names }

// When the add-on is reloaded or updated, the reader inside an already-open WhatsApp tab is cut off and silently
// stops (WhatsApp and shopping messages are missed) until that tab is refreshed. Refresh it here instead.
chrome.runtime.onInstalled.addListener(async (d) => {
  if (d.reason !== "update" && d.reason !== "install") return;
  for (const t of await chrome.tabs.query({ url: "https://web.whatsapp.com/*" })) chrome.tabs.reload(t.id).catch(() => {});
});

/** Which WhatsApp this Chrome profile holds: "personal" or "business" (set in the popup). */
async function account() {
  return (await chrome.storage.local.get("account")).account || "personal";
}

async function call(path, body, fixedAccount) {
  body = { ...body, account: fixedAccount || await account() };
  const r = await fetch(COS_CONFIG.api_base.replace(/\/$/, "") + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bridge-key": COS_CONFIG.bridge_key },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

let diagTimer = null;
// Durable retry queue for shopping if the computer briefly loses its connection.
let queueWork = Promise.resolve();
function shoppingQueue(change, key = 'shopping_queue') {
  const next = queueWork.then(async () => {
    const current = await chrome.storage.local.get(key);
    const updated = change(current[key] || []);
    await chrome.storage.local.set({ [key]: updated });
  });
  queueWork = next.catch(() => {});
  return next;
}
async function retryShopping() {
  const { shopping_queue = [] } = await chrome.storage.local.get('shopping_queue');
  for (const entry of shopping_queue) {
    try {
      await call('/api/bridge/shopping', entry.payload, entry.account);
      await shoppingQueue(rows => rows.filter(r => r.id !== entry.id));
    } catch { break; }
  }
}
chrome.alarms.create('shopping-retry', { periodInMinutes: 1 });
async function retryResponses() {
  const { response_queue = [] } = await chrome.storage.local.get('response_queue');
  for (const entry of response_queue) {
    try { await call('/api/bridge/replied',entry.payload,entry.account);await shoppingQueue(rows=>rows.filter(r=>r.id!==entry.id),'response_queue'); }
    catch { break; }
  }
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'shopping-retry') { void retryShopping();void retryResponses(); } });
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
  if (msg.type === 'replied') {
    (async()=>{
      const a=await account(),id=JSON.stringify([a,msg.payload]);
      await shoppingQueue(rows=>rows.some(r=>r.id===id)?rows:[...rows,{id,account:a,payload:msg.payload}],'response_queue');
      try { await call('/api/bridge/replied',msg.payload,a);await shoppingQueue(rows=>rows.filter(r=>r.id!==id),'response_queue');await remember({last_ok:Date.now(),last_event:msg.payload.kind==='reaction'?`Your reaction in ${msg.payload.chat}`:`You replied to ${msg.payload.chat}`,error:null}); }
      catch(e) { await remember({error:`Response signal queued: ${e.message}`}); }
      reply({ok:true});
    })().catch(()=>reply({ok:false}));
    return true;
  }
  if (msg.type === 'shopping-config') {
    account().then(a => a !== 'personal' ? { enabled: false, chat: '', chat_id: '' } : fetch(`${COS_CONFIG.api_base.replace(/\/$/, '')}/api/bridge/shopping`, { headers: { 'x-bridge-key': COS_CONFIG.bridge_key } }).then(r => { if (!r.ok) throw new Error('Shopping setup unavailable'); return r.json(); }))
      .then(async cfg => { await chrome.storage.local.set({ shopping_config: cfg }); reply(cfg); })
      .catch(async () => { const { shopping_config } = await chrome.storage.local.get('shopping_config'); reply(shopping_config || { enabled: false, chat: '', chat_id: '' }); });
    return true;
  }
  if (msg.type === 'shopping') {
    (async () => {
      const a = await account();
      if (a !== 'personal') return reply({ handled: false });
      const id = `${a}|${msg.payload.chatId}|${msg.payload.messageId}`;
      await shoppingQueue(rows => rows.some(r => r.id === id) ? rows : [...rows, { id, account: a, payload: msg.payload }]);
      try {
        const res = await call('/api/bridge/shopping', msg.payload, a);
        await shoppingQueue(rows => rows.filter(r => r.id !== id));
        reply(res);
      } catch (e) {
        remember({ error: `Shopping message queued: ${e.message}` });
        reply({ handled: true, queued: true });
      }
    })().catch(() => reply({ handled: false }));
    return true;
  }
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
  if (msg.type === "selfnote") {
    call("/api/bridge/selfnote", msg.payload).catch(() => {});
    reply({ ok: true });
    return;
  }
  if (msg.type === "convo") {
    account().then((a) => call("/api/bridge/convo", { ...msg.payload, account: a })).catch(() => {});
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

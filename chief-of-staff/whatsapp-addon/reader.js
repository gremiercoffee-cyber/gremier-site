// Runs inside WhatsApp Web's page. READ-ONLY: it listens to WhatsApp Web's own message and chat
// collections and passes plain facts (chat, sender, text, from-me) to content.js. It never calls
// anything that clicks, opens, marks read or sends, and never changes the page.
(() => {
  const post = (data) => window.postMessage({ source: "cos-reader", ...data }, location.origin);
  const started = Date.now() / 1000;
  const done = new Set();           // message ids already passed on
  const counts = { add: 0, chat: 0, passed: 0 };
  let attached = false;

  function modules() {
    try {
      const req = window.require;
      if (typeof req !== "function") return null;
      const col = req("WAWebCollections");
      return col && col.Msg && col.Chat ? col : null;
    } catch {
      return null;
    }
  }

  const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const idOf = (msg) => str(msg && msg.id && (msg.id._serialized || msg.id.id));

  function describe(col, msg) {
    const id = msg.id || {};
    const remote = str(id.remote && (id.remote._serialized || id.remote));
    const isGroup = remote.endsWith("@g.us");
    const chat = col.Chat.get(id.remote);
    const chatName = str(chat && (chat.formattedTitle || chat.name)) || remote.split("@")[0];
    let sender = chatName;
    if (isGroup && !id.fromMe) {
      const c = msg.author && col.Contact && col.Contact.get(msg.author);
      sender = str(c && (c.formattedName || c.name || c.pushname)) || str(msg.notifyName) || "Someone";
    }
    const text = str(msg.type === "chat" ? msg.body : msg.caption);
    // Your own chat ("note to self"): the chat is with your own number.
    const me = str(msg.from && (msg.from._serialized || msg.from));
    const self = !!id.fromMe && !isGroup && !!me && me === remote;
    return {
      chatId: remote, chat: chatName, sender, isGroup, fromMe: !!id.fromMe, self, text,
      kind: str(msg.type), muted: !!(chat && chat.mute && chat.mute.isMuted), archived: !!(chat && chat.archive), t: Number(msg.t) || 0,
    };
  }

  /** Pass a message on once, if it's fresh (sent after this tab started, minus a minute of slack). */
  function consider(col, msg) {
    try {
      if (!msg) return;
      const key = idOf(msg);
      if (!key || done.has(key)) return;
      const t = Number(msg.t) || 0;
      if (!t || t < started - 60) return;           // no timestamp or older than this tab: history loading, not live traffic
      const d = describe(col, msg);
      if (!d.chatId || d.chatId === "status@broadcast") return;
      if (!d.text && d.kind !== "chat" && !d.fromMe) return; // their media without caption (anything YOU send counts as replying)
      done.add(key);
      counts.passed++;
      post({ kind: "message", message: d });
    } catch { /* never disturb WhatsApp */ }
  }

  function lastMsgOf(chat) {
    try {
      const msgs = chat.msgs || (chat.getAllMsgs && { _models: chat.getAllMsgs() });
      const list = msgs && (msgs._models || msgs.models || (typeof msgs.toArray === "function" ? msgs.toArray() : null));
      return list && list.length ? list[list.length - 1] : null;
    } catch { return null; }
  }

  function attach() {
    const col = modules();
    if (!col) return false;
    // Signal 1: messages added to the global message collection.
    col.Msg.on("add", (msg) => { counts.add++; consider(col, msg); });
    // Signals 2 and 3: a chat's last-activity time or unread count changes.
    const onChat = (chat) => { counts.chat++; consider(col, lastMsgOf(chat)); };
    col.Chat.on("change:t", onChat);
    col.Chat.on("change:unreadCount", onChat);
    attached = true;
    post({ kind: "status", mode: "store" });
    setInterval(() => post({ kind: "counts", counts }), 30_000);
    return true;
  }

  // Chat names, so the Chief of Staff can match "R' Silber" / "הרב זילבר" to people it follows (read-only).
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "cos-content" || e.data.kind !== "chats") return;
    const col = modules();
    let names = [];
    try {
      const all = col && (typeof col.Chat.getModelsArray === "function" ? col.Chat.getModelsArray() : col.Chat._models || col.Chat.models || []);
      names = (all || []).map((c) => str(c.formattedTitle || c.name)).filter(Boolean).slice(0, 600);
    } catch { /* never disturb WhatsApp */ }
    post({ kind: "chats", names });
  });

  // History search for trackers: walk the messages WhatsApp Web already has loaded (read-only).
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "cos-content" || e.data.kind !== "history") return;
    const col = modules();
    const since = Number(e.data.since) || 0;
    let n = 0;
    try {
      const all = col && (typeof col.Msg.getModelsArray === "function" ? col.Msg.getModelsArray() : col.Msg._models || col.Msg.models || []);
      for (const msg of all || []) {
        if (!msg || (Number(msg.t) || 0) < since) continue;
        const d = describe(col, msg);
        if (!d.chatId || d.chatId === "status@broadcast" || !d.text) continue;
        post({ kind: "history", message: d });
        n++;
      }
    } catch { /* never disturb WhatsApp */ }
    post({ kind: "history_done", requestId: e.data.requestId, count: n });
  });

  // WhatsApp Web loads its modules a while after the page; try for ~2 minutes, then give up.
  let tries = 0;
  const timer = setInterval(() => {
    if (attached || attach()) return clearInterval(timer);
    if (++tries > 60) { clearInterval(timer); post({ kind: "status", mode: "unavailable" }); }
  }, 2000);
})();

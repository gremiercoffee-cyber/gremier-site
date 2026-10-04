// Runs inside WhatsApp Web's page. READ-ONLY: it subscribes to new-message events in WhatsApp
// Web's own message store and passes plain facts (chat, sender, text, from-me) to content.js.
// It never calls anything that clicks, opens, marks read or sends, and never changes the page.
(() => {
  const post = (data) => window.postMessage({ source: "cos-reader", ...data }, location.origin);
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
    return {
      chatId: remote, chat: chatName, sender, isGroup, fromMe: !!id.fromMe, text,
      kind: str(msg.type), muted: !!(chat && chat.mute && chat.mute.isMuted), t: Number(msg.t) || Date.now() / 1000,
    };
  }

  function attach() {
    const col = modules();
    if (!col) return false;
    col.Msg.on("add", (msg) => {
      try {
        if (!msg || !msg.isNewMsg) return; // only live traffic, not history being loaded
        const d = describe(col, msg);
        if (d.chatId === "status@broadcast" || !d.chatId) return;
        post({ kind: "message", message: d });
      } catch { /* never disturb WhatsApp */ }
    });
    attached = true;
    post({ kind: "status", mode: "store" });
    return true;
  }

  // WhatsApp Web loads its modules a while after the page; try for ~2 minutes, then give up.
  let tries = 0;
  const timer = setInterval(() => {
    if (attached || attach()) return clearInterval(timer);
    if (++tries > 60) { clearInterval(timer); post({ kind: "status", mode: "unavailable" }); }
  }, 2000);
})();

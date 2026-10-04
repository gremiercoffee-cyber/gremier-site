// Bridges reader.js (inside the page) to background.js (talks to the Chief of Staff).
// Bundles a burst of messages from one chat into a single forward, and reports your own replies.
// If WhatsApp's internals can't be read, falls back to watching the chat list (still read-only).
(() => {
  const BUNDLE_MS = 60_000;
  const buffers = new Map(); // chatId -> { chat, sender, isGroup, muted, lines: [], actionable, timer }
  const lastReplied = new Map();
  let myNames = [];
  let mode = "starting";

  chrome.runtime.sendMessage({ type: "config" }, (cfg) => { myNames = (cfg && cfg.my_names) || []; });
  const status = (m) => { mode = m; chrome.runtime.sendMessage({ type: "status", mode: m }); };
  status("starting"); // visible in the popup as soon as the add-on is attached to the tab

  function flush(chatId) {
    const b = buffers.get(chatId);
    buffers.delete(chatId);
    if (!b || !b.actionable) return;
    chrome.runtime.sendMessage({
      type: "incoming",
      payload: { chat: b.chat, sender: b.sender, text: b.lines.join("\n"), at: new Date().toISOString() },
    });
  }

  function onIncoming(m) {
    const b = buffers.get(m.chatId) || { chat: m.chat, sender: m.sender, isGroup: m.isGroup, muted: m.muted, lines: [], actionable: false };
    if (m.text) b.lines.push(m.isGroup ? `${m.sender}: ${m.text}` : m.text);
    const ok = cosActionable(m, myNames);
    b.actionable = b.actionable || ok;
    const why = ok ? "will forward in 1 min" : m.isGroup ? "skipped: group, you weren't mentioned" : m.muted ? "skipped: muted chat" : "skipped: didn't look like a request";
    chrome.runtime.sendMessage({ type: "seen", note: `${m.sender}${m.isGroup ? ` in ${m.chat}` : ""} (${why})` });
    clearTimeout(b.timer);
    b.timer = setTimeout(() => flush(m.chatId), BUNDLE_MS);
    buffers.set(m.chatId, b);
  }

  function onMine(m) {
    chrome.runtime.sendMessage({ type: "seen", note: `Your message to ${m.chat} (counts as replying)` });
    buffers.delete(m.chatId); // you answered: nothing pending to forward
    const prev = lastReplied.get(m.chatId) || 0;
    if (Date.now() - prev < 30_000) return;
    lastReplied.set(m.chatId, Date.now());
    chrome.runtime.sendMessage({ type: "replied", payload: { chat: m.chat } });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "cos-reader") return;
    if (e.data.kind === "status") {
      status(e.data.mode);
      if (e.data.mode === "unavailable") startListMode();
    } else if (e.data.kind === "message") {
      const m = e.data.message;
      m.fromMe ? onMine(m) : onIncoming(m);
    }
  });

  // ---- Fallback: watch the chat list (latest message per chat only) ---------------------
  function startListMode() {
    status("list");
    const seen = new Map();
    setInterval(() => {
      const rows = document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]');
      rows.forEach((row) => {
        const titles = [...row.querySelectorAll("span[title]")].map((s) => s.getAttribute("title")).filter(Boolean);
        if (titles.length < 2) return;
        const chat = titles[0], preview = titles[titles.length - 1];
        const key = `${chat}|${preview}`;
        if (seen.get(chat) === key) return;
        const first = !seen.has(chat);
        seen.set(chat, key);
        if (first) return; // don't replay what was already on screen at start-up
        const fromMe = !!row.querySelector('[data-icon^="msg-check"], [data-icon^="msg-dblcheck"], [data-icon^="status-"]');
        const m = { chatId: chat, chat, sender: chat, isGroup: false, muted: false, fromMe, text: preview };
        const g = preview.match(/^(.{1,40}?):\s(.+)$/);
        if (g && !fromMe) Object.assign(m, { isGroup: true, sender: g[1], text: g[2] });
        fromMe ? onMine(m) : onIncoming(m);
      });
    }, 5000);
  }
})();

// Bridges reader.js (inside the page) to background.js (talks to the Chief of Staff).
// Bundles a burst of messages from one chat into a single forward, and reports your own replies.
// If WhatsApp's internals can't be read, falls back to watching the chat list (still read-only).
(() => {
  const BUNDLE_MS = 60_000;
  const buffers = new Map(); // chatId -> { chat, sender, isGroup, muted, lines: [], actionable, timer }
  const lastReplied = new Map();
  let myNames = [];
  let mode = "starting";

  // Messages to background.js can fail if Chrome restarted the add-on or put it to sleep.
  // Retry a few times; if the add-on was reloaded under this tab, ask for a tab reload.
  async function send(msg, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        if (!chrome.runtime?.id) throw new Error("Extension context invalidated");
        return await chrome.runtime.sendMessage(msg);
      } catch (e) {
        if (String(e).includes("invalidated")) { console.warn("[Chief of Staff] Add-on was updated: reload this tab (F5)."); return; }
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
  }

  send({ type: "config" }).then((cfg) => { myNames = (cfg && cfg.my_names) || []; });
  const status = (m) => { mode = m; send({ type: "status", mode: m }); };
  status("starting"); // visible in the popup as soon as the add-on is attached to the tab

  function flush(chatId) {
    const b = buffers.get(chatId);
    buffers.delete(chatId);
    if (!b || !b.actionable) return;
    send({
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
    send({ type: "seen", note: `${m.sender}${m.isGroup ? ` in ${m.chat}` : ""} (${why})` });
    clearTimeout(b.timer);
    b.timer = setTimeout(() => flush(m.chatId), BUNDLE_MS);
    buffers.set(m.chatId, b);
  }

  function onMine(m) {
    send({ type: "seen", note: `Your message to ${m.chat} (counts as replying)` });
    buffers.delete(m.chatId); // you answered: nothing pending to forward
    const prev = lastReplied.get(m.chatId) || 0;
    if (Date.now() - prev < 30_000) return;
    lastReplied.set(m.chatId, Date.now());
    send({ type: "replied", payload: { chat: m.chat } });
  }

  // ---- Trackers: collect every message on a topic (downloaded from the Chief of Staff) ----
  let trackers = [];
  let backfillPending = [];
  const lc = (s) => (s || "").toLowerCase();
  const squash = (s) => lc(s).replace(/[^\p{L}\p{N}]/gu, "");
  function matches(t, m) {
    const text = lc(m.text);
    if (!text) return false;
    const who = lc(`${m.chat} ${m.sender}`);
    const whoS = squash(who);
    const peopleOk = !t.people.length || t.people.some((p) => who.includes(p) || (squash(p).length >= 4 && whoS.includes(squash(p))));
    // The user's own chat: recognised directly, or by its name as a fallback.
    if (t.self_chat) return !!m.self || (!!m.fromMe && !m.isGroup && t.people.length > 0 && peopleOk);
    if (m.fromMe && !t.include_mine) return false;
    const kwOk = !t.keywords.length || t.keywords.some((k) => text.includes(k));
    return kwOk && peopleOk;
  }
  function track(m, only) {
    for (const t of trackers) {
      if (only && !only.includes(t.id)) continue;
      if (!matches(t, m)) continue;
      send({ type: "track", payload: { tracker_id: t.id, chat: m.chat, sender: m.fromMe ? "Me" : m.sender, text: m.text,
        at: new Date((m.t || Date.now() / 1000) * 1000).toISOString() } });
    }
  }
  async function refreshTrackers() {
    const list = await send({ type: "trackers" });
    if (!Array.isArray(list)) return;
    trackers = list;
    if (list.length && mode === "store") window.postMessage({ source: "cos-content", kind: "chats" }, location.origin);
    const want = list.filter((t) => t.backfill_days > 0);
    if (want.length && mode === "store" && !backfillPending.length) {
      backfillPending = want.map((t) => t.id);
      const days = Math.max(...want.map((t) => t.backfill_days));
      window.postMessage({ source: "cos-content", kind: "history", since: Date.now() / 1000 - days * 86400, requestId: Date.now() }, location.origin);
    }
  }
  setTimeout(refreshTrackers, 8000);           // once WhatsApp has loaded
  setInterval(refreshTrackers, 5 * 60_000);    // new trackers apply within minutes

  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "cos-reader") return;
    if (e.data.kind === "history") { track(e.data.message, backfillPending); return; }
    if (e.data.kind === "chats") { send({ type: "chats", names: e.data.names }); return; }
    if (e.data.kind === "history_done") {
      for (const id of backfillPending) send({ type: "backfilled", id });
      send({ type: "seen", note: `Searched ${e.data.count} loaded messages for trackers` });
      backfillPending = [];
      return;
    }
    if (e.data.kind === "status") {
      status(e.data.mode);
      if (e.data.mode === "unavailable") startListMode();
    } else if (e.data.kind === "counts") {
      send({ type: "counts", counts: e.data.counts });
    } else if (e.data.kind === "message") {
      const m = e.data.message;
      track(m);
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

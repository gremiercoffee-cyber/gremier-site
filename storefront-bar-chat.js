/* Coffee bar helper: a chat box under the builder on the Coffee Bars page. It greets the customer,
   offers to walk them through the bar one question at a time, and answers questions with the site's
   assistant (chat-assistant, coffee_bar mode), which is told what's in their bar so far.
   The site-wide chat bubble is hidden on this page so there's one assistant. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const URL_ = 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/chat-assistant';
  const KEY = 'gremier_bar_chat';
  let history = (() => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (_) { return []; } })();
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(history.slice(-20))); } catch (_) {} };
  let busy = false;

  const css = document.createElement('style');
  css.textContent = `
  #barChat{max-width:760px;margin:18px auto 30px;padding:0 16px;box-sizing:border-box}
  .bc-card{background:#fff;border:1px solid #ece8e1;border-radius:20px;box-shadow:0 6px 24px rgba(40,30,20,.06);overflow:hidden}
  .bc-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #f1ede7;font:600 14px 'DM Sans',sans-serif;color:#1a1a1a}
  .bc-head img{width:30px;height:30px;border-radius:50%}
  .bc-head small{display:block;font-weight:400;color:#8a8f96;font-size:12px}
  .bc-log{max-height:300px;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
  .bc-msg{max-width:85%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap;animation:bcIn .3s ease}
  .bc-bot{background:#f5f2ed;color:#1a1a1a;align-self:flex-start;border-end-start-radius:4px}
  .bc-me{background:#1a1a1a;color:#fff;align-self:flex-end;border-end-end-radius:4px}
  .bc-typing{display:inline-flex;gap:4px}.bc-typing i{width:6px;height:6px;border-radius:50%;background:#b9b2a8;animation:bcDot 1s infinite}.bc-typing i:nth-child(2){animation-delay:.15s}.bc-typing i:nth-child(3){animation-delay:.3s}
  .bc-quick{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px}
  .bc-quick button{border:1px solid #d9d4cc;background:#fff;border-radius:999px;padding:7px 12px;font:500 13px 'DM Sans',sans-serif;cursor:pointer;color:#1a1a1a}
  .bc-quick button:hover{border-color:#1a1a1a}
  .bc-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #f1ede7}
  .bc-form input{flex:1;border:1px solid #e3ded6;border-radius:999px;padding:11px 15px;font:14px 'DM Sans',sans-serif;outline:none;min-width:0}
  .bc-form input:focus{border-color:#1a1a1a}
  .bc-form button{border:0;background:#1a1a1a;color:#fff;border-radius:999px;padding:0 18px;font:600 14px 'DM Sans',sans-serif;cursor:pointer}
  .bc-pop{animation:bcPop .45s cubic-bezier(.2,.8,.2,1)}
  @keyframes bcIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes bcPop{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes bcDot{0%,80%,100%{opacity:.3}40%{opacity:1}}
  body.on-coffeebars #chatFabWrapper{display:none!important}`;
  document.head.appendChild(css);

  const greeting = () => T('Hi! 👋 I’m here to help you plan your coffee bar. Want me to walk you through it, one question at a time? Or ask me anything, like how much coffee you need.',
    'היי! 👋 אני כאן לעזור לכם לתכנן את בר הקפה. רוצים שאעבור איתכם על זה, שאלה אחרי שאלה? או שאלו אותי כל דבר, למשל כמה קפה צריך.');
  const quick = () => [
    ['walk', T('Walk me through it', 'תעבור איתי על זה')],
    ['ask', T('How much coffee do I need?', 'כמה קפה אני צריך?')],
    ['ask', T('What’s included?', 'מה כלול?')],
  ];

  function draw() {
    const log = $('bcLog'); if (!log) return;
    const msgs = [{ role: 'assistant', content: greeting() }, ...history];
    log.innerHTML = msgs.map((m) => `<div class="bc-msg ${m.role === 'user' ? 'bc-me' : 'bc-bot'}">${esc(m.content)}</div>`).join('')
      + (busy ? '<div class="bc-msg bc-bot"><span class="bc-typing"><i></i><i></i><i></i></span></div>' : '');
    log.scrollTop = log.scrollHeight;
    const q = $('bcQuick'); if (q) q.innerHTML = history.length ? '' : quick().map(([k, label]) => `<button type="button" data-bc="${k}">${esc(label)}</button>`).join('');
  }
  async function ask(text) {
    text = String(text || '').trim(); if (!text || busy) return;
    history.push({ role: 'user', content: text }); busy = true; save(); draw();
    let reply = '';
    try {
      const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ mode: 'coffee_bar', lang: he() ? 'he' : 'en', context: typeof window.plannerSummary === 'function' ? window.plannerSummary() : '', messages: history.slice(-12) }) });
      reply = (await res.json().catch(() => ({}))).reply || '';
    } catch (_) {}
    history.push({ role: 'assistant', content: reply || T('Sorry, I couldn’t answer that right now. You can message us on WhatsApp.', 'סליחה, לא הצלחתי לענות כרגע. אפשר לכתוב לנו בוואטסאפ.') });
    busy = false; save(); draw();
  }
  function walk() {
    history.push({ role: 'user', content: T('Walk me through it', 'תעבור איתי על זה') },
      { role: 'assistant', content: T('Great! Let’s start with your guests: pick how many above, and I’ll take you to the next question. Ask me anything along the way.', 'מעולה! נתחיל במספר האורחים: בחרו למעלה כמה, ואעביר אתכם לשאלה הבאה. אפשר לשאול אותי כל דבר בדרך.') });
    save(); draw();
    if (typeof window.plannerGoStep === 'function') window.plannerGoStep(0);
    $('planner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function mount() {
    const page = $('coffeebarsPage'), planner = $('planner');
    if (!page || !planner) return;
    let box = $('barChat');
    if (!box) {
      box = document.createElement('section'); box.id = 'barChat'; box.setAttribute('aria-label', 'Coffee bar helper');
      box.innerHTML = `<div class="bc-card bc-pop"><div class="bc-head"><img src="/icon-192.png" alt=""><div><span id="bcTitle"></span><small id="bcSub"></small></div></div>
        <div class="bc-log" id="bcLog" aria-live="polite"></div><div class="bc-quick" id="bcQuick"></div>
        <form class="bc-form" id="bcForm"><input id="bcInput" autocomplete="off"><button type="submit" id="bcSend"></button></form></div>`;
      planner.after(box);
      box.addEventListener('click', (e) => { const b = e.target.closest('[data-bc]'); if (!b) return; if (b.dataset.bc === 'walk') walk(); else ask(b.textContent); });
      $('bcForm').addEventListener('submit', (e) => { e.preventDefault(); const i = $('bcInput'); ask(i.value); i.value = ''; });
    } else if (box.previousElementSibling !== planner) planner.after(box);
    $('bcTitle').textContent = T('Coffee bar helper', 'העוזר לבר הקפה');
    $('bcSub').textContent = T('Ask me anything about your bar', 'שאלו אותי כל דבר על הבר');
    $('bcInput').placeholder = T('Ask a question…', 'כתבו שאלה…');
    $('bcSend').textContent = T('Send', 'שליחה');
    draw();
  }
  function onPage() {
    const active = !!$('coffeebarsPage')?.classList.contains('active');
    document.body.classList.toggle('on-coffeebars', active);
    if (active) setTimeout(mount, 300);
  }
  function hook() {
    for (const fn of ['showPage', 'applyTranslations', 'toggleLang']) {
      const orig = window[fn];
      if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); try { onPage(); } catch (_) {} return r; };
    }
    onPage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();

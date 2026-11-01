/* Coffee bar helper: a chat bubble on the coffee bar builder page, at the bottom on the side opposite the
   scene (on phones opposite the floating bar thumbnail). Tapping it opens "Got any questions? I can help."
   Answers come from the site's assistant (chat-assistant, coffee_bar mode), told what's in the bar so far.
   The site-wide chat bubble is hidden on the Coffee Bars page so there's one assistant. */
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
  let busy = false, open = false;

  const css = document.createElement('style');
  css.textContent = `
  #barChat{position:fixed;z-index:96;bottom:24px;inset-inline-end:24px;display:none;flex-direction:column;align-items:flex-end;gap:10px}
  body.bb-builder-on #barChat{display:flex}
  [dir=rtl] #barChat,#barChat:dir(rtl){align-items:flex-start}
  .bc-bubble{width:58px;height:58px;border-radius:50%;border:0;background:#1a1a1a;color:#fff;font-size:24px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.25);display:grid;place-items:center;transition:transform .2s}
  .bc-bubble:hover{transform:scale(1.05)}
  .bc-panel{width:min(360px,calc(100vw - 32px));background:#fff;border:1px solid #ece8e1;border-radius:20px;box-shadow:0 14px 40px rgba(30,20,10,.18);overflow:hidden;display:none;animation:bcPop .3s cubic-bezier(.2,.8,.2,1)}
  #barChat.open .bc-panel{display:block}
  .bc-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #f1ede7;font:600 14px 'DM Sans',sans-serif;color:#1a1a1a}
  .bc-head img{width:30px;height:30px;border-radius:50%}
  .bc-head small{display:block;font-weight:400;color:#8a8f96;font-size:12px}
  .bc-close{margin-inline-start:auto;background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:#8a8f96}
  .bc-log{max-height:min(320px,45vh);overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
  .bc-msg{max-width:85%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap;animation:bcIn .3s ease}
  .bc-bot{background:#f5f2ed;color:#1a1a1a;align-self:flex-start;border-end-start-radius:4px}
  .bc-me{background:#1a1a1a;color:#fff;align-self:flex-end;border-end-end-radius:4px}
  .bc-typing{display:inline-flex;gap:4px}.bc-typing i{width:6px;height:6px;border-radius:50%;background:#b9b2a8;animation:bcDot 1s infinite}.bc-typing i:nth-child(2){animation-delay:.15s}.bc-typing i:nth-child(3){animation-delay:.3s}
  .bc-quick{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
  .bc-quick button{border:1px solid #d9d4cc;background:#fff;border-radius:999px;padding:7px 12px;font:500 13px 'DM Sans',sans-serif;cursor:pointer;color:#1a1a1a}
  .bc-form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #f1ede7}
  .bc-form input{flex:1;border:1px solid #e3ded6;border-radius:999px;padding:10px 14px;font:14px 'DM Sans',sans-serif;outline:none;min-width:0}
  .bc-form input:focus{border-color:#1a1a1a}
  .bc-form button{border:0;background:#1a1a1a;color:#fff;border-radius:999px;padding:0 16px;font:600 14px 'DM Sans',sans-serif;cursor:pointer}
  @keyframes bcIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  @keyframes bcPop{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:none}}
  @keyframes bcDot{0%,80%,100%{opacity:.3}40%{opacity:1}}
  body.on-coffeebars #chatFabWrapper{display:none!important}
  @media(max-width:860px){#barChat{inset-inline-end:auto;inset-inline-start:14px;bottom:calc(84px + env(safe-area-inset-bottom));align-items:flex-start}
    body:not(.has-tab-bar) #barChat{bottom:calc(16px + env(safe-area-inset-bottom))}.bc-bubble{width:54px;height:54px}}`;
  document.head.appendChild(css);

  const greeting = () => T('Got any questions? I can help. 😊 Ask me anything about your coffee bar, like how much coffee you need or what’s included.',
    'יש לכם שאלות? אני כאן לעזור. 😊 שאלו אותי כל דבר על בר הקפה, למשל כמה קפה צריך או מה כלול.');
  const quick = () => [T('How much coffee do I need?', 'כמה קפה אני צריך?'), T('What’s included?', 'מה כלול?'), T('Do I need more stations?', 'צריך עוד עמדות?')];

  function draw() {
    const log = $('bcLog'); if (!log) return;
    log.innerHTML = [{ role: 'assistant', content: greeting() }, ...history].map((m) => `<div class="bc-msg ${m.role === 'user' ? 'bc-me' : 'bc-bot'}">${esc(m.content)}</div>`).join('')
      + (busy ? '<div class="bc-msg bc-bot"><span class="bc-typing"><i></i><i></i><i></i></span></div>' : '');
    log.scrollTop = log.scrollHeight;
    $('bcQuick').innerHTML = history.length ? '' : quick().map((label) => `<button type="button" data-bc-ask>${esc(label)}</button>`).join('');
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
  function setOpen(v) {
    open = v; const box = $('barChat'); if (!box) return;
    box.classList.toggle('open', open);
    $('bcBubble').setAttribute('aria-expanded', String(open));
    $('bcBubble').textContent = open ? '×' : '💬';
    if (open) { draw(); setTimeout(() => $('bcInput')?.focus(), 50); }
  }
  function mount() {
    let box = $('barChat');
    if (!box) {
      box = document.createElement('div'); box.id = 'barChat';
      box.innerHTML = `<div class="bc-panel" role="dialog" aria-labelledby="bcTitle"><div class="bc-head"><img src="/icon-192.png" alt=""><div><span id="bcTitle"></span><small id="bcSub"></small></div><button type="button" class="bc-close" data-bc-close aria-label="Close">×</button></div>
        <div class="bc-log" id="bcLog" aria-live="polite"></div><div class="bc-quick" id="bcQuick"></div>
        <form class="bc-form" id="bcForm"><input id="bcInput" autocomplete="off"><button type="submit" id="bcSend"></button></form></div>
        <button type="button" class="bc-bubble" id="bcBubble" aria-expanded="false">💬</button>`;
      ($('bbWorld')||document.body).appendChild(box);
      box.addEventListener('click', (e) => {
        if (e.target.closest('#bcBubble')) setOpen(!open);
        else if (e.target.closest('[data-bc-close]')) setOpen(false);
        else if (e.target.closest('[data-bc-ask]')) ask(e.target.closest('[data-bc-ask]').textContent);
      });
      $('bcForm').addEventListener('submit', (e) => { e.preventDefault(); const i = $('bcInput'); ask(i.value); i.value = ''; });
    }
    $('bcTitle').textContent = T('Coffee bar helper', 'העוזר לבר הקפה');
    $('bcSub').textContent = T('Ask me anything about your bar', 'שאלו אותי כל דבר על הבר');
    $('bcInput').placeholder = T('Ask a question…', 'כתבו שאלה…');
    $('bcSend').textContent = T('Send', 'שליחה');
    $('bcBubble').setAttribute('aria-label', T('Questions? Chat with us', 'שאלות? צ׳אט איתנו'));
    if (open) draw();
  }
  // Shown only on the builder page (the Coffee Bars page with the builder open).
  function sync() {
    const page = $('coffeebarsPage'), active = !!page?.classList.contains('active');
    document.body.classList.toggle('on-coffeebars', active);
    const on = active && page.classList.contains('bb-building');
    document.body.classList.toggle('bb-builder-on', on);
    if (on) { mount(); const room=$('bbWorld');if(room&&$('barChat').parentElement!==room)room.append($('barChat')); } else if (open) setOpen(false);
  }
  function hook() {
    const page = $('coffeebarsPage');
    if (page) new MutationObserver(sync).observe(page, { attributes: true, attributeFilter: ['class'] });
    const toggle = window.toggleLang;
    if (typeof toggle === 'function') window.toggleLang = function () { const r = toggle.apply(this, arguments); try { if ($('barChat')) mount(); } catch (_) {} return r; };
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();

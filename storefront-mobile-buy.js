/* Mobile buying, fewer steps (Nov 2026):
   1. Product sheet: a buy bar fixed to the bottom of the sheet (purchase type, quantity, "Add to cart · ₪price"),
      visible as soon as the sheet opens. One-time purchase stays the default.
   2. Shipping prices for every area (regular / express / free-from), on the product sheet and folded in the cart.
      Read from the same delivery zones checkout uses; nothing here sets a price.
   3. Shop category chips: a fade on the side that has more chips, and one small nudge the first time.
   4. First load: the chat button and the past-order feedback card wait for the first tap, scroll or key (or 20s). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang === 'undefined' || lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '₪' + (Math.round(Number(n) * 100) / 100);
  function wrap(name, after) {
    const fn = window[name];
    if (typeof fn !== 'function') return;
    window[name] = function () { const r = fn.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { console.warn(e); } return r; };
  }

  // ── First interaction (tap, scroll, key), or 20 seconds ──
  const waiting = [];
  let touched = false;
  function firstTouch() {
    if (touched) return;
    touched = true;
    ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach((e) => window.removeEventListener(e, firstTouch, true));
    document.documentElement.classList.remove('gm-quiet');   // the chat button appears
    waiting.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
  }
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach((e) => window.addEventListener(e, firstTouch, { capture: true, passive: true }));
  setTimeout(firstTouch, 20000);
  window.GremierAfterFirstTouch = (fn) => { if (touched) fn(); else waiting.push(fn); };

  // ── Shipping prices by area ──
  const titleCase = (n) => (n && n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : n);
  function rateRows() {
    const zones = (typeof deliveryZones !== 'undefined' && Array.isArray(deliveryZones) ? deliveryZones : []).filter((z) => z.is_active !== false);
    if (!zones.length || typeof deliveryDefaults === 'undefined') return [];
    const groups = new Map();
    for (const z of zones) {
      const reg = Number(z.regular_price) || 0, exp = Number(z.expedited_price) || 0, free = Number(z.free_above) || 0;
      const k = reg + '|' + exp + '|' + free;
      if (!groups.has(k)) groups.set(k, { reg, exp, free, names: [] });
      groups.get(k).names.push(titleCase(he() ? (z.name_he || z.name_en) : (z.name_en || z.name_he)));
    }
    const rows = [...groups.values()].sort((a, b) => b.names.length - a.names.length || a.reg - b.reg);
    rows.push({ reg: Number(deliveryDefaults.default_regular_price) || 0, exp: Number(deliveryDefaults.default_expedited_price) || 0, free: 0, names: [T('Rest of Israel', 'שאר הארץ')], rest: true });
    return rows;
  }
  function rowHtml(r) {
    const parts = [r.reg ? money(r.reg) : T('Free', 'חינם'), T('express ', 'מהיר ') + money(r.exp)];
    if (r.free && r.reg) parts.push(T('free over ', 'חינם מעל ') + money(r.free));
    return `<li><b>${esc(r.names.join(', '))}</b><span>${parts.join(' · ')}</span></li>`;
  }
  function tableHtml(product) {
    if (product && product.delivery_price != null && !isNaN(product.delivery_price)) {
      return `<ul class="gm-rates"><li><b>${T('Delivery for this item', 'משלוח למוצר הזה')}</b><span>${money(product.delivery_price)}</span></li></ul>`;
    }
    const rows = rateRows();
    return rows.length ? `<ul class="gm-rates">${rows.map(rowHtml).join('')}</ul>` : '';
  }
  window.GremierShipRates = {
    table: tableHtml,
    details() {
      const t = tableHtml();
      return t ? `<details class="gm-rates-fold"><summary>${T('Delivery prices by area', 'דמי משלוח לפי אזור')}</summary>${t}</details>` : '';
    },
  };

  // ── Product sheet: buy bar ──
  const isBar = (p) => !!p && typeof isCoffeeBarProduct === 'function' && isCoffeeBarProduct(p);
  function current() { return typeof pdCurrentProduct !== 'undefined' ? pdCurrentProduct : null; }
  function keepBarLast() {
    const bar = $('pdBuyBar'), body = bar?.parentElement;
    if (bar && body && body.lastElementChild !== bar) body.appendChild(bar);
  }
  function syncMode() {
    const box = $('pdBuyMode'), section = $('pdSubscriptionSection'), drawer = $('pdDrawer');
    if (!box || !section) return;
    const radios = [...section.querySelectorAll('input[name="pdPurchaseMode"]')];
    const on = radios.length === 2 && section.style.display !== 'none';
    box.hidden = !on;
    drawer?.classList.toggle('gm-has-mode', on);
    if (!on) { box.innerHTML = ''; return; }
    const labels = radios.map((r) => (r.closest('label')?.textContent || '').trim());
    box.innerHTML = radios.map((r, i) => `<button type="button" role="radio" aria-checked="${r.checked}" class="${r.checked ? 'on' : ''}" data-i="${i}">${esc(labels[i])}</button>`).join('');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', T('Purchase type', 'סוג רכישה'));
    box.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const r = radios[Number(b.dataset.i)];
        if (!r || r.checked) return;
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        // Subscribing opens its choices (frequency, extras) in the sheet: bring them into view.
        if (Number(b.dataset.i) === 1) setTimeout(() => $('pdSubscriptionSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      };
    });
  }
  function syncPrice() {
    const p = current(), btn = $('pdAddBtn');
    if (!p || !btn || isBar(p)) return;   // coffee bars already show "Book now · ₪total"
    let total = null;
    try {
      if (typeof pdIsSubscription === 'function' && pdIsSubscription()) total = pdGetSubscriptionTotal();
      else total = (pdGetVariationPrice(p) + pdGetAddonsTotal() - pdNoDispenserOff(p)) * (typeof pdQty !== 'undefined' ? pdQty : 1);
    } catch (_) {}
    const label = T('Add to Cart', 'הוסף לעגלה');
    btn.innerHTML = Number.isFinite(Number(total)) && Number(total) > 0 ? `${label} <span class="gm-btn-price">· ${money(total)}</span>` : label;
  }
  function syncShipping() {
    const p = current(), info = $('pvPdInfo');
    $('gmPdRates')?.remove();
    if (!p || !info || isBar(p)) return;
    const t = tableHtml(p);
    if (t) info.insertAdjacentHTML('afterend', `<div id="gmPdRates" class="gm-pd-rates"><div class="gm-rates-title">${T('Delivery prices', 'דמי משלוח')}</div>${t}</div>`);
  }
  function syncAll() { keepBarLast(); syncMode(); syncPrice(); }
  wrap('openProductDrawerUI', () => { syncAll(); syncShipping(); const d = $('pdDrawer'); if (d) d.scrollTop = 0; });
  ['pdUpdateDrawerPrice', 'pdChangeQty', 'pdSetSubscribe', 'renderPdSubscriptionSection', 'pdOnAddonChange'].forEach((n) => wrap(n, syncAll));
  wrap('applyTranslations', () => { if ($('pdDrawer')?.classList.contains('open')) { syncAll(); syncShipping(); } });
  function watchBody() {
    const body = $('pdBuyBar')?.parentElement;
    if (body) new MutationObserver(() => keepBarLast()).observe(body, { childList: true });   // trust line, "goes well with" stay above the bar
  }

  // ── Shop category chips: show there's more to swipe ──
  function chips() {
    const row = $('catFilter');
    if (!row || row.dataset.gmHint) return;
    row.dataset.gmHint = '1';
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      const at = Math.abs(row.scrollLeft);   // RTL scrolls with negative values
      row.classList.toggle('gm-more-end', max > 4 && at < max - 4);
      row.classList.toggle('gm-more-start', max > 4 && at > 4);
    };
    row.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    new MutationObserver(update).observe(row, { childList: true });
    update();
    // Once per visit, when the shop is first shown: a small nudge toward the hidden chips.
    const nudge = () => {
      if (row.dataset.gmNudged || row.scrollWidth - row.clientWidth < 20 || !row.getClientRects().length) return;
      row.dataset.gmNudged = '1';
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const dir = getComputedStyle(row).direction === 'rtl' ? -1 : 1;
      setTimeout(() => { row.scrollBy({ left: 48 * dir, behavior: 'smooth' }); setTimeout(() => row.scrollBy({ left: -48 * dir, behavior: 'smooth' }), 650); }, 500);
    };
    new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) nudge(); }).observe(row);
  }

  // ── Checkout: placeholders in the visitor's language ──
  const PH = {
    coName: ['Your name', 'שם מלא'],
    coEmail: ['you@email.com', 'name@email.com'],
    coAddr: ['Street and number, then choose from the list', 'רחוב ומספר, ואז בחרו מהרשימה'],
    coApt: ['Apt / unit', 'מס׳ דירה'],
    coFloor: ['Floor', 'קומה'],
    coEntrance: ['e.g. Building B, side entrance', 'למשל בניין ב׳, כניסה צדדית'],
    coInstr: ['e.g. call on arrival, leave with the guard', 'למשל להתקשר כשמגיעים, להשאיר אצל השומר'],
    coRedeemCode: ['Enter code', 'הזינו קוד'],
    coNotes: ['Any special requests?', 'בקשות מיוחדות?'],
  };
  function placeholders() { for (const [id, [en, hebrew]] of Object.entries(PH)) { const el = $(id); if (el) el.placeholder = he() ? hebrew : en; } }
  wrap('applyTranslations', placeholders);
  wrap('openCheckout', placeholders);
  // While typing in checkout on a phone, the pay button stops floating over the form (see the CSS).
  const typingField = (el) => el && el.closest?.('#checkoutOverlay') && (el.matches('textarea, select') || (el.matches('input') && !/^(radio|checkbox|button|submit)$/i.test(el.type)));
  let typingOff = null;
  document.addEventListener('focusin', (e) => { if (typingField(e.target)) { clearTimeout(typingOff); document.documentElement.classList.add('gm-typing'); } });
  document.addEventListener('focusout', (e) => { if (typingField(e.target)) typingOff = setTimeout(() => document.documentElement.classList.remove('gm-typing'), 150); });

  function start() { watchBody(); chips(); placeholders(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

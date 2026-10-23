/* Cart extras: "add ₪X for free delivery", a one-tap switch to the 5L when it's cheaper,
   and suggestions that fit the cart (coffee → syrups, syrup only → coffee). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const all = () => (typeof products !== 'undefined' && Array.isArray(products) ? products : []);
  const baseId = (i) => String(i.base_product_id || String(i.id).split('_')[0]);
  const productOf = (i) => all().find((p) => String(p.id) === baseId(i));
  const isSyrup = (p) => !!p && typeof isSyrupProduct === 'function' && isSyrupProduct(p);
  const isCoffee = (p) => !!p && !isSyrup(p) && ['bottles', 'minis', 'bulk'].includes(p.category);
  const name = (p) => (he() ? (p.name_he || p.name_en) : p.name_en);
  const firstWord = (s) => String(s || '').replace(/^5\s*l\s+/i, '').trim().split(/\s+/)[0].toLowerCase();

  // The 5L of the same coffee ("Classic Dark Roast" ↔ "5L Classic Dark Roast").
  function bulkFor(p) {
    return all().find((q) => q.category === 'bulk' && /^5\s*l\b/i.test(q.name_en || '') && firstWord(q.name_en) === firstWord(p.name_en) && q.is_active !== false);
  }

  function knownCity() {
    const c = (typeof selectedCheckoutCity !== 'undefined' && selectedCheckoutCity) || (get('gremier_checkout_details_v1') || {}).city;
    return c && (c.en || c.he) ? c : null;
  }

  function freeDeliveryHtml() {
    const city = knownCity();
    if (!city || typeof resolveDeliveryPricing !== 'function') return '';
    if (cart.some((i) => i.is_subscription || (i.delivery_price != null && !isNaN(i.delivery_price)))) return '';
    const freeAbove = Number(resolveDeliveryPricing(city).freeAbove) || 0;
    if (!freeAbove) return '';
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    if (subtotal >= freeAbove) return `<div class="cx-free done">${T('✓ Free delivery on this order', '✓ משלוח חינם להזמנה הזו')}</div>`;
    const left = Math.ceil(freeAbove - subtotal);
    return `<div class="cx-free"><span>${T(`Add ₪${left} more for free delivery`, `עוד ₪${left} ומשלוח חינם`)}</span>
      <div class="cx-bar"><i style="width:${Math.min(100, Math.round((subtotal / freeAbove) * 100))}%"></i></div></div>`;
  }

  function fiveLitreHtml() {
    for (const item of cart) {
      const p = productOf(item);
      if (!p || item.is_subscription || p.category !== 'bottles' || isSyrup(p) || item.qty < 4 || item.id !== String(p.id)) continue;
      const bulk = bulkFor(p);
      if (!bulk) continue;
      const n = Math.min(item.qty, 5);
      const now = n * Number(item.price);
      if (now <= Number(bulk.price)) continue;
      return `<div class="cx-deal">
        <div><b>${T(`Save ₪${Math.round(now - bulk.price)} with the 5L`, `חוסכים ₪${Math.round(now - bulk.price)} עם ה-5 ליטר`)}</b>
        <small>${esc(name(bulk))} · ₪${bulk.price} ${T(`instead of ${n} bottles for ₪${now}`, `במקום ${n} בקבוקים ב-₪${now}`)}</small></div>
        <button type="button" onclick="cartSwitchTo5L('${esc(item.id)}','${esc(bulk.id)}')">${T('Switch', 'להחליף')}</button>
      </div>`;
    }
    return '';
  }
  window.cartSwitchTo5L = function (itemId, bulkId) {
    const item = cart.find((i) => i.id === itemId);
    if (!item) return;
    item.qty -= Math.min(item.qty, 5);
    if (item.qty <= 0) cart.splice(cart.indexOf(item), 1);
    if (typeof addToCart === 'function') addToCart(bulkId);
    if (typeof renderCartDrawer === 'function') renderCartDrawer();
  };

  function suggestionsHtml() {
    const inCart = new Set(cart.map(baseId));
    const items = cart.map(productOf).filter(Boolean);
    const hasCoffee = items.some(isCoffee), hasSyrup = items.some(isSyrup);
    let picks = [], title = '';
    if (hasCoffee && !hasSyrup) {
      picks = all().filter((p) => isSyrup(p) && !inCart.has(String(p.id)));
      title = T('Goes great with your coffee', 'מתאים לקפה שלכם');
    } else if (hasSyrup && !hasCoffee) {
      const rank = (p) => (window.GremierTaste ? window.GremierTaste.rank(p.id) : 0);
      picks = all().filter((p) => isCoffee(p) && p.category === 'bottles' && !inCart.has(String(p.id))).sort((a, b) => rank(a) - rank(b));
      title = T('Add the cold brew', 'הוסיפו את הקולד ברו');
    }
    if (!picks.length) return '';
    return `<div class="pv-suggest"><div class="pv-suggest-title">${title}</div>${picks.slice(0, 2).map((p) => `<div class="pv-suggest-row">
        ${p.images && p.images[0] ? `<img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(p.images[0], 80) : p.images[0])}" alt="">` : ''}
        <span class="n">${esc(name(p))} · ₪${p.price}</span>
        <button type="button" onclick="closeCart();openProductDrawer('${esc(p.id)}')">${T('+ Add', '+ הוספה')}</button>
      </div>`).join('')}</div>`;
  }

  function decorate() {
    const body = $('cartBody'), footer = $('cartFooter');
    if (!body || typeof cart === 'undefined' || !cart.length) return;
    body.querySelectorAll('.pv-suggest, .cx-deal').forEach((el) => el.remove());   // replaces the older syrup-only suggestion
    if (!cart.some((i) => i.is_subscription)) body.insertAdjacentHTML('beforeend', fiveLitreHtml() + suggestionsHtml());
    footer?.querySelector('.cx-free')?.remove();
    const free = freeDeliveryHtml();
    if (free && footer) footer.insertAdjacentHTML('afterbegin', free);
  }

  function hook() {
    const orig = window.renderCartDrawer;
    if (typeof orig !== 'function') return;
    window.renderCartDrawer = function () { const r = orig.apply(this, arguments); try { decorate(); } catch (_) {} return r; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();

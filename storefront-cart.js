/* Cart extras: "add ₪X for free delivery" and suggestions that fit the cart
   (coffee → syrups, syrup only → coffee). */
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

  function knownCity() {
    const c = (typeof selectedCheckoutCity !== 'undefined' && selectedCheckoutCity) || (get('gremier_checkout_details_v1') || {}).city;
    return c && (c.en || c.he) ? c : null;
  }

  function freeDeliveryHtml() {
    if (typeof shabbatPromoActive === 'function' && shabbatPromoActive() && cart.length && !cart.some((i) => i.is_subscription)) {
      return `<div class="cx-free done">${T('✓ Free delivery today, before Shabbat*', '✓ משלוח חינם היום, לפני שבת*')}</div>`;
    }
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
    body.querySelectorAll('.pv-suggest').forEach((el) => el.remove());   // replaces the older syrup-only suggestion
    if (!cart.some((i) => i.is_subscription)) body.insertAdjacentHTML('beforeend', suggestionsHtml());
    footer?.querySelector('.cx-free')?.remove();
    const free = freeDeliveryHtml();
    if (free && footer) footer.insertAdjacentHTML('afterbegin', free);
    // How they can pay, under the buttons.
    footer?.querySelector('.cx-trust')?.remove();
    footer?.insertAdjacentHTML('beforeend', `<div class="cx-trust">🔒 ${T('Secure payment', 'תשלום מאובטח')}: ${T('card', 'כרטיס')} · bit · Apple Pay · Google Pay</div>`);
  }

  // Signed-in customers' carts are kept on their profile too, so a cart left on the site can get the
  // Tuesday "free delivery before Shabbat" email (admin-tools shabbat_promo_email). Plain fields only.
  let saveTimer = null, lastSaved = null;
  function saveToProfile() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (typeof currentUser === 'undefined' || !currentUser || typeof sb === 'undefined') return;
      const items = cart.map((i) => ({
        id: i.id, base_product_id: i.base_product_id, name_en: i.name_en, name_he: i.name_he, qty: i.qty, price: i.price,
        is_subscription: !!i.is_subscription, options: !!((i.selected_variations && Object.keys(i.selected_variations).length) || i.selected_guest_price || (i.selected_addons && i.selected_addons.length)),
      }));
      const key = JSON.stringify(items) + lang;
      if (key === lastSaved) return;
      lastSaved = key;
      try {
        await sb.from('profiles').update({ saved_cart: items.length ? items : null, saved_cart_at: new Date().toISOString(), site_lang: lang }).eq('id', currentUser.id);
      } catch (_) {}
    }, 2500);
  }

  function hook() {
    const orig = window.renderCartDrawer;
    if (typeof orig !== 'function') return;
    window.renderCartDrawer = function () { const r = orig.apply(this, arguments); try { decorate(); } catch (_) {} return r; };
    const save = window.saveCartToStorage;
    if (typeof save === 'function') window.saveCartToStorage = function () { const r = save.apply(this, arguments); saveToProfile(); return r; };
    // Switching language updates it on the profile too (emails follow it).
    const toggle = window.toggleLang;
    if (typeof toggle === 'function') window.toggleLang = function () { const r = toggle.apply(this, arguments); saveToProfile(); return r; };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();

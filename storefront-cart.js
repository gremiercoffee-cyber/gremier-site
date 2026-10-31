/* Cart extras: "add ₪X for free delivery" (also before we know the city), picks that close that gap,
   and suggestions that fit the cart (coffee → syrups, liters → minis, one flavour → another,
   syrup only → coffee). Simple products are added in one tap. */
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
    const g = gap();
    if (!g) return '';
    if (g.left <= 0) return `<div class="cx-free done">${T('✓ Free delivery on this order', '✓ משלוח חינם להזמנה הזו')}${g.where ? ' · ' + esc(g.where) : ''}</div>`;
    return `<div class="cx-free"><span>${g.where ? T(`Add ₪${g.left} more for free delivery in ${g.where}`, `עוד ₪${g.left} ומשלוח חינם ב${g.where}`) : T(`Add ₪${g.left} more for free delivery`, `עוד ₪${g.left} ומשלוח חינם`)}</span>
      <div class="cx-bar"><i style="width:${Math.min(100, Math.round((g.subtotal / g.freeAbove) * 100))}%"></i></div></div>`;
  }
  // How far the cart is from free delivery. With the city known, its own threshold; before that, the
  // lowest threshold of the areas that have one, naming them.
  function gap() {
    if (cart.some((i) => i.is_subscription || (i.delivery_price != null && !isNaN(i.delivery_price)))) return null;
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0), city = knownCity();
    let freeAbove = 0, where = '';
    if (city && typeof resolveDeliveryPricing === 'function') freeAbove = Number(resolveDeliveryPricing(city).freeAbove) || 0;
    else if (typeof deliveryZones !== 'undefined' && Array.isArray(deliveryZones)) {
      const zones = deliveryZones.filter((z) => Number(z.free_above) > 0).sort((a, b) => Number(a.free_above) - Number(b.free_above));
      if (zones.length) {
        freeAbove = Math.min(...zones.map((z) => Number(z.free_above)));
        const named = zones.filter((z) => Number(z.free_above) <= freeAbove + 10).map((z) => (he() ? z.name_he : z.name_en) || '').filter(Boolean)
          .map((n) => n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : n);
        where = named.slice(0, 2).join(he() ? ' ו' : ' & ');
      }
    }
    if (!freeAbove) return null;
    return { subtotal, freeAbove, left: Math.ceil(freeAbove - subtotal), where };
  }
  // Up to three ways to reach free delivery with one or two simple items (coffee and syrups), each
  // landing as little over the line as possible. Favourites and coffee come first; one of each kind.
  function freeDeliveryOptions(left) {
    if (left > 160) return [];
    const rank = (p) => (window.GremierTaste ? window.GremierTaste.rank(p.id) : 0);
    const pool = all().filter((p) => p.is_active !== false && Number(p.price) > 0 && simple(p) && (isCoffee(p) || isSyrup(p)));
    const combos = [];
    pool.forEach((a, i) => {
      combos.push([a]);
      pool.slice(i).forEach((b) => combos.push([a, b]));   // includes two of the same
    });
    const scored = combos.map((items) => ({ items, total: items.reduce((n, p) => n + Number(p.price), 0) }))
      .filter((o) => o.total >= left && o.total - left <= 70)
      .map((o) => ({ ...o, score: (o.total - left) + (o.items.length - 1) * 6 + o.items.filter((p) => !isCoffee(p)).length * 8, fav: o.items.reduce((n, p) => n + rank(p), 0) / o.items.length }))
      .sort((a, b) => a.score - b.score || a.fav - b.fav);
    const out = [], seen = new Set();
    for (const o of scored) {
      const kind = o.items.map((p) => p.category + (isSyrup(p) ? ':syrup' : '')).sort().join('+');
      if (seen.has(kind)) continue;
      seen.add(kind);
      const same = o.items.length === 2 && o.items[0].id === o.items[1].id;
      o.label = same ? `2 × ${name(o.items[0])}` : o.items.map(name).join(' + ');
      out.push(o);
      if (out.length === 3) break;
    }
    return out;
  }
  window.cxAddAll = function (ids) {
    for (const id of String(ids).split(',')) { const p = all().find((x) => String(x.id) === id); if (p && simple(p)) addToCart(p.id); }
    if (typeof renderCartDrawer === 'function') renderCartDrawer();
  };
  // Products that need choices (flavours, guests, add-ons) open their page; the rest go straight in.
  const simple = (p) => !p.is_coffee_bar && p.category !== 'subscriptions' && !(p.variations || []).some((v) => v && v.type === 'pack') && !(p.variations || []).some((v) => Array.isArray(v.options) && v.options.length);
  window.cxAdd = function (id) {
    const p = all().find((x) => String(x.id) === String(id));
    if (!p) return;
    if (!simple(p)) { closeCart(); openProductDrawer(id); return; }
    addToCart(p.id);
    if (typeof renderCartDrawer === 'function') renderCartDrawer();
  };

  function suggestionsHtml() {
    const inCart = new Set(cart.map(baseId));
    const items = cart.map(productOf).filter(Boolean);
    if(items.some(p=>p.is_coffee_bar||(p.variations||[]).some(v=>v.type==='serving_pack')))return '';
    const servingOffers=!!window.CoffeeBarOffers?.accessoryOffers(cart,all()).length;

    const hasCoffee = items.some(isCoffee), hasSyrup = items.some(isSyrup);
    const fresh = (p) => !inCart.has(String(p.id)) && p.is_active !== false && Number(p.price) > 0;
    let picks = [], title = '';
    const g = gap();
    // A little more for free delivery: simple items that get there without overshooting much, coffee first.
    const options = g && g.left > 0 ? freeDeliveryOptions(g.left) : [];
    const liters = items.filter((p) => isCoffee(p) && p.category === 'bottles');
    if (options.length) {
      return `<div class="pv-suggest"><div class="pv-suggest-title">${T(`₪${g.left} to free delivery: add one of these`, `עוד ₪${g.left} למשלוח חינם: הוסיפו אחד מאלה`)}</div>${options.map((o) => `<div class="pv-suggest-row">
        ${o.items[0].images && o.items[0].images[0] ? `<img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(o.items[0].images[0], 80) : o.items[0].images[0])}" alt="">` : ''}
        <span class="n">${esc(o.label)} · ₪${o.total}</span>
        <button type="button" onclick="cxAddAll('${o.items.map((p) => esc(p.id)).join(',')}')">${o.items.length > 1 ? T('+ Add both', '+ הוספת שניהם') : T('+ Add', '+ הוספה')}</button>
      </div>`).join('')}</div>`;
    } else if (servingOffers) {
      return '';   // the cups & straws offer is already showing
    } else if (hasCoffee && !hasSyrup) {
      picks = all().filter((p) => isSyrup(p) && fresh(p));
      title = T('Goes great with your coffee', 'מתאים לקפה שלכם');
    } else if (liters.length && !items.some((p) => p.category === 'minis')) {
      picks = all().filter((p) => p.category === 'minis' && fresh(p) && simple(p));
      title = T('Minis for on the go', 'מיני לדרך');
    } else if (liters.length === 1 && items.filter(isCoffee).length === 1) {
      const rank = (p) => (window.GremierTaste ? window.GremierTaste.rank(p.id) : 0);
      picks = all().filter((p) => p.category === 'bottles' && isCoffee(p) && fresh(p)).sort((a, b) => rank(a) - rank(b));
      title = T('Try another flavour', 'נסו טעם נוסף');
    } else if (hasSyrup && !hasCoffee) {
      const rank = (p) => (window.GremierTaste ? window.GremierTaste.rank(p.id) : 0);
      picks = all().filter((p) => isCoffee(p) && p.category === 'bottles' && !inCart.has(String(p.id))).sort((a, b) => rank(a) - rank(b));
      title = T('Add the cold brew', 'הוסיפו את הקולד ברו');
    }
    if (!picks.length) return '';
    return `<div class="pv-suggest"><div class="pv-suggest-title">${title}</div>${picks.slice(0, 2).map((p) => `<div class="pv-suggest-row">
        ${p.images && p.images[0] ? `<img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(p.images[0], 80) : p.images[0])}" alt="">` : ''}
        <span class="n">${esc(name(p))} · ₪${p.price}</span>
        <button type="button" onclick="cxAdd('${esc(p.id)}')">${T('+ Add', '+ הוספה')}</button>
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

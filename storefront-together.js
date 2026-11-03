/* "Goes together with" in the product window: what's most often in the same order (bought_together() in
   Supabase), then the sugar syrup + cups set and the cups & straws. Simple products add in one tap;
   anything with choices opens its own window. */
(function () {
  'use strict';
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const all = () => (typeof products !== 'undefined' && Array.isArray(products) ? products : []);
  const ADD_ONS = ['46dc3b6a-37a5-4c49-a12d-566a43fd4c39', '9e1abc84-b3b8-40e0-a23c-3bfbeb8602f4'];   // sugar syrup + cups, cups & straws
  const KEY = 'gremier_together_v1', MAX_AGE = 12 * 3600 * 1000;
  let pairs = null;

  function cached() { try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && Date.now() - c.at < MAX_AGE ? c.rows : null; } catch (_) { return null; } }
  async function load() {
    if (pairs) return pairs;
    const rows = cached();
    if (rows) return (pairs = rows);
    try {
      const { data, error } = await sb.rpc('bought_together');
      if (error) throw error;
      pairs = data || [];
      try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rows: pairs })); } catch (_) {}
    } catch (_) { pairs = []; }
    return pairs;
  }

  const simple = (p) => !p.is_coffee_bar && p.category !== 'subscriptions' && !(p.variations || []).some((v) => v && v.type === 'pack') && !(p.variations || []).some((v) => Array.isArray(v.options) && v.options.length);
  const sellable = (p) => p && p.is_active !== false && Number(p.price) > 0 && !p.is_coffee_bar && p.category !== 'subscriptions' && !(typeof isSubscriptionProduct === 'function' && isSubscriptionProduct(p));

  function pick(p) {
    const byId = (id) => all().find((x) => String(x.id) === String(id));
    const out = [];
    for (const r of (pairs || []).filter((r) => r.product_id === String(p.id))) { const o = byId(r.other_id); if (sellable(o) && !ADD_ONS.includes(String(o.id))) out.push(o); if (out.length === 3) break; }
    for (const id of ADD_ONS) { const o = byId(id); if (o && String(o.id) !== String(p.id) && o.is_active !== false && !out.includes(o)) out.push(o); }
    // Cups are rarely in past orders yet: suggest the flavour syrups with them.
    if (ADD_ONS.includes(String(p.id))) for (const o of all()) if (sellable(o) && typeof isSyrupProduct === 'function' && isSyrupProduct(o) && !out.includes(o) && !ADD_ONS.includes(String(o.id))) out.unshift(o);
    return out.slice(0, 6);
  }

  function host() {
    let el = document.getElementById('pdTogether');
    if (!el) {
      const row = document.querySelector('#pdDrawer .pd-qty-row');
      if (!row) return null;
      el = document.createElement('section');
      el.id = 'pdTogether';
      el.className = 'pd-together';
      row.after(el);
    }
    return el;
  }

  async function render(p) {
    const el = host();
    if (!el) return;
    el.hidden = true;
    if (!p || p.is_coffee_bar || p.category === 'subscriptions' || (typeof isSubscriptionProduct === 'function' && isSubscriptionProduct(p))) return;
    await load();
    if (typeof pdCurrentProduct !== 'undefined' && pdCurrentProduct && String(pdCurrentProduct.id) !== String(p.id)) return;   // another product opened meanwhile
    const items = pick(p);
    if (!items.length) return;
    el.innerHTML = `<h3 class="pd-together-title">${T('Goes together with', 'הולך טוב עם')}</h3>
      <div class="pd-together-row">${items.map((o) => {
        const name = he() ? (o.name_he || o.name_en) : o.name_en, img = o.images && o.images[0];
        return `<div class="pd-together-item">
          <button class="pd-together-open" onclick="openProductDrawer('${esc(o.id)}')" aria-label="${esc(name)}">
            <span class="pd-together-img">${img ? `<img src="${esc(typeof cloudinaryOptimize === 'function' ? cloudinaryOptimize(img, 240) : img)}" alt="" loading="lazy">` : ''}</span>
            <span class="pd-together-name">${esc(name)}</span>
          </button>
          <div class="pd-together-foot"><span>₪${Number(o.price)}</span>
            <button class="pd-together-add" onclick="gremierTogetherAdd('${esc(o.id)}', this)" aria-label="${esc(T('Add', 'הוספה'))} ${esc(name)}">+</button></div>
        </div>`;
      }).join('')}</div>`;
    el.hidden = false;
  }

  window.gremierTogetherAdd = function (id, btn) {
    const o = all().find((x) => String(x.id) === String(id));
    if (!o) return;
    if (!simple(o)) { openProductDrawer(o.id); return; }
    addToCart(o.id);
    if (btn) { btn.textContent = '✓'; btn.classList.add('done'); setTimeout(() => { btn.textContent = '+'; btn.classList.remove('done'); }, 1200); }
  };

  const orig = window.openProductDrawerUI;
  if (typeof orig === 'function') {
    window.openProductDrawerUI = function (productId) {
      const r = orig.apply(this, arguments);
      if (r) { render(typeof pdCurrentProduct !== 'undefined' ? pdCurrentProduct : null); document.getElementById('pdDrawer')?.scrollTo?.(0, 0); }
      return r;
    };
    try { openProductDrawerUI = window.openProductDrawerUI; } catch (_) {}
  }
  setTimeout(load, 4000);   // warm the data after the page settles
})();

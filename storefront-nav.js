/* Storefront: personal product order, real best sellers, and the phone tab bar.
   Personal interest stays on this device (localStorage) – nothing is sent anywhere. */
(function () {
  'use strict';
  const TASTE_KEY = 'gremier_taste_v1', BEST_KEY = 'gremier_best_sellers_v1';
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  // Browsing interest halves every 30 days so old looks fade out.
  function readTaste() {
    const t = get(TASTE_KEY) || { at: Date.now(), s: {} };
    const days = (Date.now() - (t.at || Date.now())) / 864e5;
    if (days > 1) {
      const f = Math.pow(0.5, days / 30);
      for (const k in t.s) { t.s[k] *= f; if (t.s[k] < 0.2) delete t.s[k]; }
      t.at = Date.now(); put(TASTE_KEY, t);
    }
    return t;
  }

  // How products are ordered for each shopper. Score = what sells (everyone) + what this shopper likes:
  //  · popularity: paid orders in the last 90 days, on a square-root curve (top seller = 10),
  //    so a best seller is ahead by default but not so far ahead that personal interest can't move things;
  //  · this shopper's purchases: 8 per order, fading by half every 90 days (strongest personal signal);
  //  · browsing on this device: opened = 1, added to cart = 3, fading by half every 30 days.
  // One look at a product doesn't jump it past the best sellers; buying it again and again does.
  // Niche products start lower so they sit at the end unless this shopper actually buys them.
  const NICHE = { '2203b52d-df14-4c71-afe6-5c0a4c29079b': -10 }; // Decaf: last unless this shopper buys it
  let bestRank = {}, pop = {}, bought = {}, rerender = null;
  const setBest = (rows) => {
    bestRank = {}; pop = {};
    const max = Math.max(1, ...rows.map((r) => Number(r.n) || 0));
    rows.forEach((r, i) => { bestRank[r.id] = i; pop[r.id] = 10 * Math.sqrt((Number(r.n) || 0) / max); });
  };
  const Taste = {
    /** Product opened = 1, added to cart = 3. */
    bump(id, w) {
      if (!id) return;
      const t = readTaste(); id = String(id);
      t.s[id] = Math.min(50, (t.s[id] || 0) + w);
      put(TASTE_KEY, t);
    },
    /** Past orders (signed-in account or this device): [{ id, date }] — one entry per order a product was in. */
    setBought(list) {
      const next = {};
      for (const x of list || []) {
        const id = String(typeof x === 'object' ? x.id : x), days = x && x.date ? Math.max(0, (Date.now() - new Date(x.date)) / 864e5) : 0;
        if (id) next[id] = Math.min(40, (next[id] || 0) + 8 * Math.pow(0.5, days / 90));
      }
      if (JSON.stringify(next) === JSON.stringify(bought)) return;
      bought = next; rerender?.();
    },
    /** This shopper's own interest. */
    personal(id) { id = String(id); return (readTaste().s[id] || 0) + (bought[id] || 0); },
    score(id) { id = String(id); return (pop[id] || 0) + (NICHE[id] || 0) + this.personal(id); },
    isPersonal() { return Object.keys(bought).length > 0 || Object.keys(readTaste().s).length > 0; },
    isBestSeller(id) { const r = bestRank[String(id)]; return r != null && r < 3; },
    /** Sort key, lower comes first. Negative when the product has any popularity or personal interest. */
    rank(id) { return -this.score(id) * 100; },
    loadBestSellers(sb, onChange) {
      rerender = onChange;
      const cached = get(BEST_KEY);
      if (cached && Array.isArray(cached.rows)) setBest(cached.rows);
      if (cached && Array.isArray(cached.rows) && Date.now() - cached.ts < 6 * 36e5) return;
      sb.rpc('storefront_best_sellers', { days: 90 }).then(({ data, error }) => {
        if (error || !Array.isArray(data)) return;
        const rows = data.map((r) => ({ id: String(r.product_id), n: Number(r.orders) || 0 }));
        put(BEST_KEY, { ts: Date.now(), rows });
        if (cached && JSON.stringify(cached.rows) === JSON.stringify(rows)) return;
        setBest(rows);
        onChange?.();
      }, () => {});
    },
  };
  window.GremierTaste = Taste;

  // ── Phone tab bar: the main sections are always one tap away (no hamburger) ──
  const ICONS = {
    home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
    shop: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    coffeebars: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c0 1 1 1.5 1 2.5M12 3.5c0 1 1 1.5 1 2.5"/>',
    cart: '<path d="M5 6h15l-1.6 8.5a1.5 1.5 0 0 1-1.5 1.2H8.6a1.5 1.5 0 0 1-1.5-1.2L5 3.5H3"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="16.5" cy="19.5" r="1.3"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c0-4 3.6-7 8-7s8 3 8 7"/>',
  };
  const LABELS = {
    home: ['Home', 'בית'], shop: ['Shop', 'חנות'], coffeebars: ['Coffee Bars', 'עמדות קפה'],
    cart: ['Cart', 'עגלה'], account: ['Account', 'חשבון'],
  };
  const he = () => typeof lang !== 'undefined' && lang === 'he';

  function go(tab) {
    if (tab === 'cart') return window.openCart?.();
    if (tab === 'account') {
      if (typeof currentUser !== 'undefined' && currentUser) return window.showPage?.('myorders');
      return window.handleAuthClick?.();
    }
    if (tab === 'coffeebars' && typeof window.openCoffeeBarsFromMenu === 'function') return window.openCoffeeBarsFromMenu();
    window.showPage?.(tab);
    window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
  }

  function build() {
    if (document.getElementById('tabBar')) return;
    // A <div>, not <nav>: the site's own `nav` styles pin it to the top of the page.
    const bar = document.createElement('div');
    bar.id = 'tabBar';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Main');
    bar.innerHTML = Object.keys(ICONS).map((k) => `
      <button type="button" data-tab="${k}">
        <span class="tb-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>${k === 'cart' ? '<i class="tb-badge" hidden></i>' : ''}</span>
        <span class="tb-label"></span>
      </button>`).join('');
    bar.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); });
    document.body.appendChild(bar);
    document.body.classList.add('has-tab-bar');
    refresh();
    // Follow page changes, language changes and the cart without touching their code.
    for (const name of ['showPage', 'applyTranslations', 'updateCartCount', 'goToAbout']) {
      const orig = window[name];
      if (typeof orig !== 'function') continue;
      window[name] = function () { const r = orig.apply(this, arguments); try { refresh(); } catch (_) {} return r; };
    }
  }

  function refresh() {
    const bar = document.getElementById('tabBar');
    if (!bar) return;
    const page = typeof appPage !== 'undefined' ? appPage : 'home';
    const n = typeof cart !== 'undefined' ? cart.reduce((s, i) => s + i.qty, 0) : 0;
    bar.querySelectorAll('button[data-tab]').forEach((b) => {
      const k = b.dataset.tab;
      b.querySelector('.tb-label').textContent = LABELS[k][he() ? 1 : 0];
      const on = k === page || (k === 'account' && page === 'myorders');
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const badge = bar.querySelector('.tb-badge');
    badge.hidden = !n; badge.textContent = n > 9 ? '9+' : n;
  }

  // Switching to Hebrew moves the closed cart panel from the right edge to the left one;
  // without this its slide animation sweeps across the screen on load and on language change.
  function settleSoon() {
    document.body.classList.remove('sf-settled');
    clearTimeout(settleSoon.t);
    settleSoon.t = setTimeout(() => document.body.classList.add('sf-settled'), 900);
  }
  function start() {
    build();
    settleSoon();
    // Same task as the direction flip, so the browser never starts the slide.
    const apply = window.applyTranslations;
    if (typeof apply === 'function') window.applyTranslations = function () {
      const wasRtl = document.body.classList.contains('rtl');
      const r = apply.apply(this, arguments);
      if (document.body.classList.contains('rtl') !== wasRtl) settleSoon();
      return r;
    };
  }
  // "Complete your order" link from a cart reminder email: /?cart=<productId>.<qty>~… refills
  // the cart (keeping what's already there) and opens it.
  function restoreCartFromLink() {
    const params = new URLSearchParams(location.search);
    const raw = params.get('cart');
    if (!raw) return;
    const wanted = raw.split('~').map((p) => p.split('.')).filter(([id, q]) => id && Number(q) > 0).slice(0, 20);
    let tries = 0;
    const timer = setInterval(() => {
      const list = typeof products !== 'undefined' ? products : [];
      if (!list.length && ++tries < 40) return;
      clearInterval(timer);
      for (const [id, q] of wanted) {
        const p = list.find((x) => String(x.id) === id);
        if (!p) continue;
        const qty = Math.min(50, Math.round(Number(q)));
        const existing = cart.find((x) => String(x.id) === id);
        if (existing) existing.qty = Math.max(existing.qty, qty);
        else cart.push({ id: p.id, base_product_id: p.id, name_en: p.name_en, name_he: p.name_he, price: p.price, images: p.images, category: p.category, delivery_price: p.delivery_price != null ? parseFloat(p.delivery_price) : null, qty });
      }
      params.delete('cart'); params.delete('utm_source');
      history.replaceState(history.state, '', location.pathname + (params.toString() ? '?' + params : '') + location.hash);
      if (typeof updateCartCount === 'function') updateCartCount();
      if (cart.length && typeof openCart === 'function') openCart();
    }, 250);
  }

  // Switching category (sidebar, chips): the products ease in, like a page change.
  function animateCategorySwitch() {
    const set = window.setCategory;
    if (typeof set !== 'function' || set.animated) return;
    window.setCategory = function () {
      const r = set.apply(this, arguments);
      const grid = document.getElementById('shopGrid');
      if (grid && document.getElementById('shopPage')?.classList.contains('active')) {
        grid.classList.remove('cat-in'); void grid.offsetWidth; grid.classList.add('cat-in');
      }
      return r;
    };
    window.setCategory.animated = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', animateCategorySwitch); else animateCategorySwitch();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { start(); restoreCartFromLink(); });
  else start();
})();

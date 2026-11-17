/* Pop-up event shop (template; first used for ELLE Fitness, Wed 18 Nov 2026, 09:30–13:00 Israel time).
   A banner under the homepage video opens the event's own little shop. Its products and discount come from the
   event's coupon row in Supabase (so items hidden in the main shop can be sold here). Shoppers never see or type
   a code: it is applied at checkout by itself and shown as the event's price. The items are picked up at the
   event with no shipping. Preview any time with ?elle=preview; direct link /#elle (or ?elle=1).
   For the next event: change EV below and the coupon row. See docs/popup-event-template.md. */
(function () {
  // ── The event: the only lines to change for the next one ──
  const EV = { code: 'ELLEFITNESS', name: 'ELLE Fitness', from: Date.parse('2026-11-18T07:30:00Z'), until: Date.parse('2026-11-18T11:00:00Z') };
  const KEY = 'gremier_event_code';
  let preview = false;
  try { preview = /[?&]elle=preview\b/.test(location.search) || sessionStorage.getItem('gremier_elle_preview') === '1'; if (preview) sessionStorage.setItem('gremier_elle_preview', '1'); } catch (_) {}
  const live = () => preview || (Date.now() >= EV.from && Date.now() < EV.until);
  const he = () => (typeof lang !== 'undefined' ? lang : 'en') === 'he';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => '₪' + Math.round(n);
  const after = (price, off) => price - Math.round(price * off / 100);   // the discount is rounded to whole shekels, like at checkout
  const T = {
    eye: [`Today only · at ${EV.name}`, `היום בלבד · ב-${EV.name}`],
    title: [`The ${EV.name} pop-up`, `הפופ-אפ של ${EV.name}`],
    text: ['Pick up right here. 10% off automatically (no code needed), no shipping, and 10% off your next order.', 'אוספים כאן במקום. 10% הנחה אוטומטית (בלי קוד), בלי משלוח, ועוד 10% הנחה על ההזמנה הבאה.'],
    cta: [`Shop ${EV.name} products`, `למוצרים של ${EV.name}`],
    sub: ['Pick up here today', 'איסוף כאן היום'],
    p1: ['10% off everything, no code needed', '10% הנחה על הכול, בלי קוד'],
    p2: ['No shipping: pick up at the event', 'בלי משלוח: איסוף באירוע'],
    p3: ['10% off your next order, by email', '10% על ההזמנה הבאה, במייל'],
    add: ['Add', 'הוספה'],
    checkout: ['Checkout', 'לתשלום'],
    empty: ['Add something to check out', 'הוסיפו מוצר כדי להמשיך'],
    loading: ['Loading…', 'טוען…'],
    failed: ["Couldn't load the products. Try again.", 'לא הצלחנו לטעון את המוצרים. נסו שוב.'],
    close: ['Close', 'סגירה'],
  };
  const t = (k) => T[k][he() ? 1 : 0];

  let catalog = null, loading = null;
  function load() {
    if (catalog) return Promise.resolve(catalog);
    if (!loading) loading = fetch(`${SUPABASE_URL}/functions/v1/validate-coupon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ code: EV.code, catalog: true }),
    }).then((r) => r.json()).then((d) => { if (!d.valid) throw new Error(d.message || 'not available'); catalog = d; return d; })
      .catch((e) => { loading = null; throw e; });
    return loading;
  }
  const pct = () => (catalog && catalog.discount_type === 'percent' ? Number(catalog.discount_value) || 0 : 0);
  const inCart = (id) => cart.find((i) => String(i.base_product_id || i.id).split('_')[0] === String(id) && !i.is_subscription);
  function setQty(p, n) {
    const line = inCart(p.id);
    if (n <= 0) { if (line) cart = cart.filter((i) => i !== line); }
    else if (line) line.qty = n;
    else cart.push({ id: p.id, base_product_id: p.id, name_en: p.name_en, name_he: p.name_he, price: Number(p.price), images: p.images, category: p.category,
      delivery_price: p.delivery_price != null ? parseFloat(p.delivery_price) : null, qty: n });
    updateCartCount();
    try { sessionStorage.setItem(KEY, EV.code); } catch (_) {}
    render();
  }

  // ── Homepage banner, under the video ──
  function banner() {
    const home = document.querySelector('#homePage .hero');
    let b = document.getElementById('elleBanner');
    if (!live() || !home) { b?.remove(); return; }
    if (!b) { b = document.createElement('section'); b.id = 'elleBanner'; b.className = 'elle-banner'; home.insertAdjacentElement('afterend', b); }
    b.dir = he() ? 'rtl' : 'ltr';
    b.innerHTML = `<div class="elle-banner-copy"><div class="elle-eye">${t('eye')}</div><h2>${t('title')}</h2><p>${t('text')}</p></div>
      <button type="button" class="elle-banner-btn">${t('cta')} <span aria-hidden="true">${he() ? '←' : '→'}</span></button>`;
    b.querySelector('button').onclick = open;
  }

  // ── The pop-up shop ──
  let sheet = null;
  let userClosed = false;
  function open() {
    if (!live()) return;
    userClosed = false;
    if (sheet && !sheet.isConnected) sheet = null;   // removed from the page during start-up: make it again
    if (!sheet) {
      sheet = document.createElement('div'); sheet.id = 'elleStore'; sheet.className = 'elle-store'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
      document.body.appendChild(sheet);
    }
    sheet.classList.add('open'); document.body.style.overflow = 'hidden';
    try { sessionStorage.setItem(KEY, EV.code); } catch (_) {}
    if (location.hash !== '#elle') history.replaceState(history.state, '', '#elle');
    render();
    load().then(render, () => render(true));
  }
  function close() {
    userClosed = true;
    sheet?.classList.remove('open'); document.body.style.overflow = '';
    if (location.hash === '#elle') history.replaceState(history.state, '', location.pathname + location.search);
  }
  function render(failed) {
    if (!sheet || !sheet.classList.contains('open')) return;
    sheet.dir = he() ? 'rtl' : 'ltr';
    const off = pct();
    const items = catalog ? catalog.products : [];
    const count = items.reduce((s, p) => s + (inCart(p.id)?.qty || 0), 0);
    const sum = items.reduce((s, p) => s + (inCart(p.id)?.qty || 0) * Number(p.price), 0), net = sum - Math.round(sum * off / 100);
    const grid = !catalog ? `<p class="elle-msg">${failed === true ? t('failed') : t('loading')}</p>` : items.map((p) => {
      const q = inCart(p.id)?.qty || 0, name = he() ? (p.name_he || p.name_en) : p.name_en, desc = he() ? (p.description_he || p.description_en) : p.description_en;
      return `<article class="elle-card"><div class="elle-img">${p.images && p.images[0] ? `<img src="${esc(p.images[0])}" alt="${esc(name)}" decoding="async">` : ''}</div>
        <div class="elle-info"><h3>${esc(name)}</h3>${desc ? `<p>${esc(desc)}</p>` : ''}
        <div class="elle-row"><span class="elle-price">${off ? `<s>${money(Number(p.price))}</s> ` : ''}<b>${money(after(Number(p.price), off))}</b></span>
        ${q ? `<span class="elle-qty"><button type="button" data-id="${esc(p.id)}" data-d="-1" aria-label="−">−</button><b>${q}</b><button type="button" data-id="${esc(p.id)}" data-d="1" aria-label="+">+</button></span>`
            : `<button type="button" class="elle-add" data-id="${esc(p.id)}" data-d="1">${t('add')}</button>`}</div></div></article>`;
    }).join('');
    sheet.innerHTML = `<div class="elle-panel">
      <header class="elle-head"><div><div class="elle-eye">${t('sub')}</div><h2>${esc(EV.name)} <span>×</span> Gremier</h2></div><button type="button" class="elle-x" aria-label="${t('close')}">✕</button></header>
      <ul class="elle-perks"><li>🏷️ ${t('p1')}</li><li>📍 ${t('p2')}</li><li>🎁 ${t('p3')}</li></ul>
      <div class="elle-grid">${grid}</div>
      <footer class="elle-foot"><button type="button" class="elle-go" ${count ? '' : 'disabled'}>${count ? `${t('checkout')} · ${count} · ${money(net)}` : t('empty')}</button></footer></div>`;
    sheet.querySelector('.elle-x').onclick = close;
    sheet.onclick = (e) => { if (e.target === sheet) close(); };
    sheet.querySelectorAll('[data-id]').forEach((btn) => btn.onclick = () => {
      const p = items.find((x) => String(x.id) === btn.dataset.id); if (!p) return;
      setQty(p, (inCart(p.id)?.qty || 0) + Number(btn.dataset.d));
    });
    sheet.querySelector('.elle-go').onclick = () => { if (!count) return; close(); openCheckout(); };
  }

  // At checkout the event code applies itself (when the cart has an event item and no other code is in).
  function autoApply() {
    let code = null; try { code = sessionStorage.getItem(KEY); } catch (_) {}
    // The event's price wins over any code typed before (it carries the pick-up and the reward).
    if (!code || !live() || (typeof appliedRedeem !== 'undefined' && appliedRedeem && appliedRedeem.event_name)) return;
    const ids = new Set((catalog?.products || []).map((p) => String(p.id)));
    if (catalog && !cart.some((i) => ids.has(String(i.base_product_id || i.id).split('_')[0]))) return;
    const input = document.getElementById('coRedeemCode');
    if (!input || typeof applyRedeemCode !== 'function') return;
    window.__eventShopCode = code;   // tells the server this is an order from the event's shop
    input.value = code; applyRedeemCode();
  }
  const origOpen = window.openCheckout;
  if (typeof origOpen === 'function') window.openCheckout = function () { const r = origOpen.apply(this, arguments); setTimeout(autoApply, 350); return r; };

  let lastLang = null;
  function tick() {
    const l = he() ? 'he' : 'en';
    if (l !== lastLang) { lastLang = l; banner(); render(); }
    else if (!!document.getElementById('elleBanner') !== live()) banner();
  }
  function start() {
    banner();
    // The site tidies the address on load, so read the link the page was opened with (…/#elle or ?elle=1).
    let first = location.href; try { first = performance.getEntriesByType('navigation')[0]?.name || first; } catch (_) {}
    if (/#elle\b/.test(first) || /[?&]elle=1\b/.test(first) || location.hash === '#elle') {
      // Open once the site has finished starting up (its start-up resets the page and would hide it).
      // Checked a few times through start-up (which can undo it), unless the visitor closes it.
      const go = () => { if (!userClosed && (!sheet || !sheet.isConnected || !sheet.classList.contains('open'))) open(); };
      [300, 1200, 2500, 4500].forEach((ms) => setTimeout(go, ms));
    }
    window.addEventListener('hashchange', () => { if (location.hash === '#elle') open(); });
    setInterval(tick, 1000);
    window.openElleStore = open;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

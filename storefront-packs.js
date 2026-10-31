/* Build-your-own 6-packs (liter bottles or minis): pick any six, mix flavours, 5% off for taking six.
   A pack product opens this picker instead of its product window; regular liter and mini products
   point to it ("Taking 6? Build a 6-pack and save 5%"). The order server re-prices the pack. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const all = () => (typeof products !== 'undefined' && Array.isArray(products) ? products : []);
  const packOf = (p) => (p?.variations || []).find((v) => v && v.type === 'pack') || null;
  const nameOf = (p) => (he() ? (p.name_he || p.name_en) : p.name_en);
  // Same rules as the server (supabase/functions/_shared/pack-model.ts).
  const perProduct = (p) => Number((p.variations || []).find((v) => v.type === 'ops_settings')?.pack_size) || Number((String(p.name_en || '').match(/(\d+)\s*-?\s*pack/i) || [])[1]) || 1;
  const inPool = (p, pool) => p && p.is_active !== false && !packOf(p) && (pool === 'bottles' ? p.category === 'bottles' && !/syrup|סירופ/i.test(`${p.name_en || ''} ${p.name_he || ''}`) : pool === 'minis' && p.category === 'minis');
  const unitPrice = (p) => Number(p.price) / perProduct(p);
  const packFor = (pool) => all().find((p) => packOf(p)?.pool === pool && p.is_active !== false);
  let open = null;   // { pack, picks: {id: n} }
  let returnFocus = null, previousOverflow = '';
  const art = (pool, flavour) => `/packs/studio/${pool}-${flavour}-${pool === 'bottles' ? 'v2' : 'v1'}.webp`;
  function flavour(p, pool) {
    const name = String(p?.name_en || '').toLowerCase();
    if (pool === 'minis') return /classic/.test(name) ? 'classic' : /vanilla/.test(name) ? 'vanilla' : /caramel/.test(name) ? 'caramel' : 'original';
    return /decaf/.test(name) ? 'decaf' : /sweetened/.test(name) ? 'sweetened' : /house/.test(name) ? 'house' : /colombia/.test(name) ? 'colombia' : 'classic';
  }
  const warmed = new Set();
  function warmScene(pool) {
    if (warmed.has(pool)) return;
    warmed.add(pool);
    for (const kind of pool === 'minis' ? ['carrier','original','vanilla','caramel','classic'] : ['carrier','classic','house','colombia','sweetened','decaf']) {
      const image = new Image(); image.src = art(pool, kind);
    }
  }
  function updateScene(scene, pool) {
    open.slots = PackSceneSlots.reconcile(open.slots, open.picks);
    open.slots.forEach((id, slot) => {
      const old = scene.querySelector(`[data-slot="${slot}"]:not(.leaving)`);
      if (old?.dataset.product === id) return;
      if (old) { old.classList.remove('entering'); old.classList.add('leaving'); setTimeout(() => old.remove(), 240); }
      if (!id) return;
      const p = all().find(p => String(p.id) === id), node = document.createElement('div');
      const back = slot < 3, col = slot % 3, width = pool === 'minis' ? (back ? 19 : 21) : (back ? 13 : 14.5);
      node.className = 'pack-scene-bottle entering'; node.dataset.slot = slot; node.dataset.product = id;
      node.style.cssText = `--left:${(back ? 33 : 28) + col * 21 - width/2}%;--bottom:${back ? 29 : 12}%;--width:${width}%;--height:${back ? 63 : 67}%;--z:${back ? 5 : 15};`;
      const img = document.createElement('img'); img.src = art(pool, flavour(p,pool)); img.alt = nameOf(p); img.draggable = false;
      node.appendChild(img); scene.appendChild(node);
    });
  }

  function quote(pack, picks) {
    const cfg = packOf(pack), size = Number(cfg.size) || 6;
    const chosen = Object.entries(picks).filter(([, n]) => n > 0).map(([id, n]) => ({ p: all().find((x) => String(x.id) === id), n })).filter((x) => x.p);
    const count = chosen.reduce((s, x) => s + x.n, 0), full = chosen.reduce((s, x) => s + unitPrice(x.p) * x.n, 0);
    return { size, count, full, total: Math.round(full * (1 - (Number(cfg.discount) || 0))), chosen };
  }
  const money = (n) => '₪' + (Math.round(n * 100) / 100).toLocaleString('en-IL', { maximumFractionDigits: 2 });

  function render() {
    const el = $('packSheet');
    if (!el || !open) return;
    const { pack } = open, cfg = packOf(pack), q = quote(pack, open.picks), pool = all().filter((p) => inPool(p, cfg.pool));
    const left = q.size - q.count;
    const prior = el.querySelector('.pack-scene'), scroll = el.querySelector('.pack-box')?.scrollTop || 0;
    const focused = document.activeElement?.closest('[data-pack-step]');
    const focusId = focused?.dataset.packStep, focusDelta = focused?.dataset.d;
    if (prior) {
      // Reattaching the scene must not replay the drop on bottles already in place.
      prior.querySelectorAll('.entering').forEach(node => node.classList.remove('entering'));
      prior.remove();
    }
    el.innerHTML = `<div class="pack-box" role="dialog" aria-modal="true" aria-labelledby="packTitle">
      <button type="button" class="pack-close" data-pack-close aria-label="${T('Close', 'סגירה')}">×</button>
      <h3 id="packTitle">${esc(nameOf(pack))}</h3>
      <p class="pack-sub">${T(`Pick any ${q.size}, mix the flavours. <b>5% cheaper</b> than buying them one by one.`, `בחרו ${q.size}, שלבו טעמים. <b>זול ב-5%</b> מקנייה אחד אחד.`)}</p>
      <div class="pack-scene-mount"></div>
      <p class="pack-scene-caption">${T('Your 6-pack · made by you', 'השישייה שלכם · בדיוק לטעמכם')}</p>
      <div class="pack-slots" aria-label="${T(`${q.count} of ${q.size} chosen`, `${q.count} מתוך ${q.size} נבחרו`)}">${Array.from({ length: q.size }, (_, i) => `<i class="${i < q.count ? 'on' : ''}"></i>`).join('')}<span>${T(`${q.count} of ${q.size}`, `${q.count} מתוך ${q.size}`)}</span></div>
      <div class="pack-list">${pool.map((p) => { const n = open.picks[p.id] || 0; return `<div class="pack-row${n ? ' on' : ''}">
        <img class="pack-rendered-thumb" src="${art(cfg.pool, flavour(p,cfg.pool))}" alt="" width="42" height="54">
        <span class="pack-name">${esc(nameOf(p).replace(/\s*(4[\s-]*pack|רביעייה)\s*/i, ' ').trim())}<small>${money(unitPrice(p))}</small></span>
        <span class="pack-step"><button type="button" data-pack-step="${esc(p.id)}" data-d="-1" ${n ? '' : 'disabled'} aria-label="${T('One less', 'אחד פחות')}">−</button><b>${n}</b><button type="button" data-pack-step="${esc(p.id)}" data-d="1" ${left ? '' : 'disabled'} aria-label="${T('One more', 'עוד אחד')}">+</button></span></div>`; }).join('')}</div>
      <div class="pack-total">${q.count && !left ? `<span><s>${money(q.full)}</s> <b>${money(q.total)}</b></span><small>${T(`You save ${money(q.full - q.total)}`, `חוסכים ${money(q.full - q.total)}`)}</small>` : `<span>${q.count ? money(q.full) + ' ' + T('so far', 'עד עכשיו') : ''}</span><small>${T('5% off when you reach 6', '5% הנחה כשמגיעים ל-6')}</small>`}</div>
      <button type="button" class="pack-add" data-pack-add ${left ? 'disabled' : ''}>${left ? T(`Pick ${left} more`, `בחרו עוד ${left}`) : T(`Add 6-pack to cart · ${money(q.total)}`, `הוספת השישייה לעגלה · ${money(q.total)}`)}</button>
    </div>`;
    const scene = prior || document.createElement('div');
    if (!prior) {
      scene.className = 'pack-scene'; scene.setAttribute('role','img');
      scene.innerHTML = `<img class="pack-scene-carrier" src="${art(cfg.pool,'carrier')}" alt=""><div class="pack-scene-lip"><img class="pack-scene-carrier" src="${art(cfg.pool,'carrier')}" alt=""></div>`;
    }
    scene.setAttribute('aria-label', T(`Your pack: ${q.count} of ${q.size} bottles selected`, `השישייה שלכם: ${q.count} מתוך ${q.size} בקבוקים נבחרו`));
    el.querySelector('.pack-scene-mount').replaceWith(scene);
    updateScene(scene,cfg.pool);
    el.querySelector('.pack-box').scrollTop = scroll;
    if (focusId) Array.from(el.querySelectorAll('[data-pack-step]')).find(b => b.dataset.packStep === focusId && b.dataset.d === focusDelta)?.focus({preventScroll:true});
  }
  window.openPackBuilder = function (packId, start) {
    const pack = all().find((p) => String(p.id) === String(packId));
    if (!pack || !packOf(pack)) return false;
    let el = $('packSheet');
    if (!el) { el = document.createElement('div'); el.id = 'packSheet'; el.className = 'pack-sheet'; document.body.appendChild(el); }
    if (!open) { returnFocus = document.activeElement; previousOverflow = document.body.style.overflow; }
    document.body.style.overflow = 'hidden';
    el.innerHTML = '';
    warmScene(packOf(pack).pool);
    open = { pack, slots: [], picks: start && inPool(all().find((p) => String(p.id) === String(start)), packOf(pack).pool) ? { [start]: 1 } : {} };
    render();
    el.classList.add('open');
    el.querySelector('[data-pack-close]')?.focus({preventScroll:true});
    return true;
  };
  function close() { $('packSheet')?.classList.remove('open'); document.body.style.overflow = previousOverflow; open = null; returnFocus?.focus?.({preventScroll:true}); }
  function add() {
    if (!open) return;
    const { pack } = open, q = quote(pack, open.picks);
    if (q.count !== q.size) return;
    const key = q.chosen.map((x) => `${x.p.id}x${x.n}`).sort().join('-');
    const single = q.chosen.some((x) => perProduct(x.p) > 1), clean = (n) => String(n || '').replace(/\s*\d+\s*-?\s*pack\b/i, '').replace(/\s*רביעייה/, '').trim();
    const label = (lng) => q.chosen.map((x) => `${x.n}× ${clean(lng === 'he' ? (x.p.name_he || x.p.name_en) : x.p.name_en)}`).join(', ') + (single ? (lng === 'he' ? ' (מיני בודדים)' : ' (single minis)') : '');
    const id = `${pack.id}_pack_${key}`, existing = cart.find((i) => i.id === id);
    if (existing) existing.qty++;
    else cart.push({ id, base_product_id: pack.id, name_en: `${pack.name_en} · ${label('en')}`, name_he: `${pack.name_he || pack.name_en} · ${label('he')}`, price: q.total, images: pack.images, category: pack.category, qty: 1, delivery_price: null, pack_items: q.chosen.map((x) => ({ product_id: String(x.p.id), qty: x.n })) });
    updateCartCount();
    if (typeof showToast === 'function') showToast(T('6-pack added ✓', 'השישייה נוספה ✓'));
    close();
    if (typeof openCart === 'function') openCart();
  }
  document.addEventListener('click', (e) => {
    const sheet = $('packSheet');
    if (sheet && sheet.classList.contains('open') && sheet.contains(e.target)) {
      if (e.target === sheet || e.target.closest('[data-pack-close]')) { close(); return; }
      const step = e.target.closest('[data-pack-step]');
      if (step && open) { const id = step.dataset.packStep, q = quote(open.pack, open.picks); const n = (open.picks[id] || 0) + Number(step.dataset.d); if (n >= 0 && (Number(step.dataset.d) < 0 || q.count < q.size)) { open.picks[id] = n; render(); } return; }
      if (e.target.closest('[data-pack-add]')) { add(); return; }
    }
    const hint = e.target.closest('[data-pack-hint]');
    if (hint) { const pid = hint.dataset.packHint, from = hint.dataset.from; if (typeof closeProductDrawer === 'function') closeProductDrawer(); setTimeout(() => window.openPackBuilder(pid, from), 250); }
  });
  // In a liter or mini product window: "Taking 6? Build a 6-pack and save 5%".
  function hintInDrawer() {
    document.querySelector('#pdDrawer .pack-hint')?.remove();
    const p = typeof pdCurrentProduct !== 'undefined' ? pdCurrentProduct : null;
    if (!p || packOf(p)) return;
    const pool = inPool(p, 'bottles') ? 'bottles' : inPool(p, 'minis') ? 'minis' : null, pack = pool && packFor(pool);
    if (!pack) return;
    $('pdDesc')?.insertAdjacentHTML('afterend', `<button type="button" class="pack-hint" data-pack-hint="${esc(pack.id)}" data-from="${esc(p.id)}">${pool === 'minis' ? T('Taking 6 minis? Build your own 6-pack and save 5% →', 'לוקחים 6 מיני? בנו שישייה וחסכו 5% ←') : T('Taking 6 bottles? Build your own 6-pack and save 5% →', 'לוקחים 6 בקבוקים? בנו שישייה וחסכו 5% ←')}</button>`);
  }
  function hook() {
    // A pack product opens the picker instead of its product window or a plain add-to-cart.
    for (const fn of ['openProductDrawer', 'addToCart']) {
      const orig = window[fn];
      if (typeof orig === 'function') window[fn] = function (id) { const p = all().find((x) => String(x.id) === String(id)); if (p && packOf(p)) { window.openPackBuilder(p.id); return; } return orig.apply(this, arguments); };
    }
    const ui = window.openProductDrawerUI;
    if (typeof ui === 'function') window.openProductDrawerUI = function () { const r = ui.apply(this, arguments); try { const p = typeof pdCurrentProduct !== 'undefined' ? pdCurrentProduct : null; if (p && packOf(p)) { if (typeof closeProductDrawer === 'function') closeProductDrawer(true); window.openPackBuilder(p.id); } else hintInDrawer(); } catch (_) {} return r; };
    document.addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape') close();
      if (e.key === 'Tab') {
        const buttons = Array.from($('packSheet').querySelectorAll('button:not(:disabled)'));
        const first = buttons[0], last = buttons[buttons.length-1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();

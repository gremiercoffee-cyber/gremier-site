/* Production (and kiosk): concentrate calculator. Pick a product, type the concentrate on hand,
 * and it says how much finished product that makes: concentrate × 100 ÷ the product's percent. */
(function (root) {
  'use strict';
  const PRODUCTS = [
    { id: 'classic', label: 'Classic', pct: 44, stock: 'classic', unit: 1, unitName: 'liter bottles' },
    { id: 'unfiltered', label: 'Unfiltered', pct: 40, stock: 'unfiltered', unit: 1, unitName: 'liter bottles' },
    { id: 'cremier', label: 'Cream latte minis', pct: 29, stock: 'classic', unit: 0.25, unitName: 'minis' },
    { id: 'houseBlend', label: 'House Blend', pct: 50, stock: 'houseBlend', unit: 1, unitName: 'liter bottles' },
    { id: 'colombia', label: 'Colombia', pct: 50, stock: 'colombia', unit: 1, unitName: 'liter bottles' },
    { id: 'decaf', label: 'Decaf', pct: 50, stock: 'decaf', unit: 1, unitName: 'liter bottles' },
  ];
  let pick = 'classic', stock = {};
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });

  const css = `
  .cc-card{background:var(--card,#fff);border:1px solid var(--border,#e0e0e0);border-radius:16px;padding:16px;margin:0 0 16px}
  .cc-card h2{font-size:1.05rem;font-weight:700;margin:0 0 12px}
  .cc-products{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .cc-products button{min-height:48px;padding:8px 14px;border-radius:12px;border:1px solid var(--border,#e0e0e0);background:#fff;color:var(--text,#121212);font:inherit;font-size:.95rem;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;line-height:1.15}
  .cc-products button small{font-weight:400;color:var(--text2,#6a6a6a);font-size:.75rem}
  .cc-products button.on{background:#121212;color:#fff;border-color:#121212}
  .cc-products button.on small{color:#ddd}
  .cc-in{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .cc-in label{font-weight:600}
  .cc-in .cc-field{display:flex;align-items:center;border:1px solid var(--border,#e0e0e0);border-radius:12px;overflow:hidden;background:#fff}
  .cc-in input{width:120px;min-height:52px;border:0;padding:0 12px;font:inherit;font-size:1.4rem;font-weight:700;outline:none;background:transparent;color:var(--text,#121212)}
  .cc-in .cc-l{padding:0 12px;color:var(--text2,#6a6a6a);font-weight:600}
  .cc-in .cc-stock{min-height:48px;padding:8px 14px;border-radius:12px;border:1px dashed var(--border,#ccc);background:transparent;font:inherit;font-size:.9rem;cursor:pointer;color:var(--text,#121212)}
  .cc-out{margin-top:14px;padding:14px 16px;border-radius:12px;background:var(--bg2,#f7f7f7);min-height:56px}
  .cc-out .cc-big{font-size:2rem;font-weight:800;line-height:1.1}
  .cc-out .cc-sub{color:var(--text2,#6a6a6a);margin-top:4px;font-size:.92rem}
  .cc-out .cc-empty{color:var(--text2,#6a6a6a)}`;

  function result() {
    const host = document.querySelector('#productionConcentrateCalc .cc-out');
    if (!host) return;
    const p = PRODUCTS.find((x) => x.id === pick);
    const liters = parseFloat(String(document.getElementById('ccLiters')?.value || '').replace(',', '.'));
    if (!(liters > 0)) { host.innerHTML = '<div class="cc-empty">Type how much concentrate you have.</div>'; return; }
    const total = (liters * 100) / p.pct;
    const units = Math.floor(total / p.unit + 1e-9);
    host.innerHTML = `<div class="cc-big">Make ${fmt(total)} L</div>
      <div class="cc-sub">≈ ${units} ${esc(p.unitName)} · ${fmt(liters)} L concentrate + ${fmt(total - liters)} L everything else · ${fmt(liters)} × 100 ÷ ${p.pct}</div>`;
  }

  function render() {
    const host = document.getElementById('productionConcentrateCalc');
    if (!host) return;
    const p = PRODUCTS.find((x) => x.id === pick);
    const have = Number(stock[p.stock]);
    const prev = document.getElementById('ccLiters')?.value || '';
    host.innerHTML = `<h2>Concentrate calculator</h2>
      <div class="cc-products">${PRODUCTS.map((x) => `<button type="button" data-cc-pick="${x.id}" class="${x.id === pick ? 'on' : ''}">${esc(x.label)}<small>${x.pct}% concentrate</small></button>`).join('')}</div>
      <div class="cc-in"><label for="ccLiters">Concentrate I have</label>
        <span class="cc-field"><input id="ccLiters" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(prev)}"><span class="cc-l">L</span></span>
        ${have > 0 ? `<button type="button" class="cc-stock" data-cc-stock="${have}">Use all in stock (${fmt(have)} L)</button>` : ''}
      </div>
      <div class="cc-out"></div>`;
    result();
  }

  async function loadStock() {
    try {
      const rows = await root.opsFetch?.('concentrate?select=*');
      if (Array.isArray(rows)) { stock = Object.fromEntries(rows.map((r) => [r.type, Number(r.liters) || 0])); render(); }
    } catch { /* the calculator works without stock */ }
  }

  function mount() {
    const tab = document.getElementById('tab-production');
    if (!tab || document.getElementById('productionConcentrateCalc')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    const card = document.createElement('section');
    card.id = 'productionConcentrateCalc';
    card.className = 'cc-card';
    card.setAttribute('aria-label', 'Concentrate calculator');
    (document.getElementById('productionWorkerBar') || tab.querySelector('.page-header'))?.after(card);
    render();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cc-pick]');
    if (b) { pick = b.dataset.ccPick; render(); return; }
    const s = e.target.closest('[data-cc-stock]');
    if (s) { const i = document.getElementById('ccLiters'); i.value = fmt(Number(s.dataset.ccStock)).replace(/,/g, ''); result(); }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'ccLiters') result(); });

  mount();
  // Refresh concentrate stock whenever Production is opened (tab or kiosk).
  const tab = document.getElementById('tab-production');
  if (tab) new MutationObserver(() => { if (tab.style.display !== 'none') loadStock(); }).observe(tab, { attributes: true, attributeFilter: ['style'] });
  root.addEventListener('gremier:stock-changed', loadStock);
  root.GremierConcentrateCalc = { PRODUCTS, render };
})(window);

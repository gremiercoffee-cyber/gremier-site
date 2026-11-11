// Log store delivery: case buttons. Each tap adds one case of 12 large bottles, and its flavors.
// Large bottles = the cases plus anything typed by hand (counted as Classic), so the flavor split is
// known when the delivery is saved and there's nothing to fill in afterwards for large bottles.
(function (root) {
  'use strict';
  const CASES = [
    { id: 'mixed', label: 'Mixed case', sub: '6 Classic · 2 Sweetened · 2 House · 2 Colombia', fill: { classic_liter: 6, sweetened_classic: 2, house_blend: 2, colombia_liter: 2 } },
    { id: 'classic_liter', label: 'Classic', sub: '12 Classic', fill: { classic_liter: 12 } },
    { id: 'sweetened_classic', label: 'Sweetened', sub: '12 Sweetened', fill: { sweetened_classic: 12 } },
    { id: 'house_blend', label: 'House Blend', sub: '12 House Blend', fill: { house_blend: 12 } },
    { id: 'colombia_liter', label: 'Colombia', sub: '12 Colombia', fill: { colombia_liter: 12 } },
    { id: 'decaf_liter', label: 'Decaf', sub: '12 Decaf', fill: { decaf_liter: 12 } },
  ];
  const PER_CASE = 12;
  let cases = {};

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Large-bottle flavors from the cases tapped so far. */
  function liters() {
    const out = {};
    for (const c of CASES) for (const [pid, n] of Object.entries(c.fill)) if (cases[c.id]) out[pid] = (out[pid] || 0) + n * cases[c.id];
    return out;
  }
  const caseBottles = () => Object.values(cases).reduce((s, n) => s + n, 0) * PER_CASE;

  function render() {
    const el = document.getElementById('ldCases');
    if (!el) return;
    el.innerHTML = CASES.map((c) => {
      const n = cases[c.id] || 0;
      return `<div class="ld-case${n ? ' on' : ''}">
        <button type="button" class="ld-case-add" data-ld-case="${c.id}" aria-label="Add a ${esc(c.label)} case"><b>${esc(c.label)}</b><small>${esc(c.sub)}</small>${n ? `<span class="ld-case-n">×${n}</span>` : '<span class="ld-case-plus">+</span>'}</button>
        ${n ? `<button type="button" class="ld-case-minus" data-ld-case-minus="${c.id}" aria-label="One ${esc(c.label)} case less">−</button>` : ''}
      </div>`;
    }).join('');
  }
  function add(id, delta) {
    const before = cases[id] || 0, after = Math.max(0, before + delta);
    if (after === before) return;
    cases[id] = after;
    if (!after) delete cases[id];
    if (typeof root.ldStep === 'function') root.ldStep('ldLarge', (after - before) * PER_CASE);
    render();
  }
  function reset() { cases = {}; render(); }

  /** Replace the guessed large-bottle split with the cases' flavors. `exact` when every large bottle came from a case. */
  function apply(quantities, counts, products) {
    const total = caseBottles();
    if (!total || counts.large < total) return { quantities, exact: false, used: false };
    const bucket = root.GremierDelivery.bucket;
    const out = Object.fromEntries(Object.entries(quantities).filter(([id]) => bucket(id, products) !== 'large'));
    for (const [pid, n] of Object.entries(liters())) out[pid] = (out[pid] || 0) + n;
    const loose = counts.large - total;
    if (loose) out.classic_liter = (out.classic_liter || 0) + loose;
    return { quantities: out, exact: !loose, used: true };
  }

  /** Cream latte minis go on shelves in no fixed mix, so a delivery's n are assumed to be 5 Caramel : 3 Original :
   *  2 Vanilla, among the flavors in stock (out-of-stock flavors are left out and the rest share their part).
   *  No flavor takes more than its stock while another still has some; past the stock, the 5:3:2 ratio carries on. */
  const CREMIER = { caramel_mini: 5, original_mini: 3, vanilla_mini: 2 };
  function byWeight(n, weights) {
    const ids = Object.keys(weights), total = ids.reduce((s, id) => s + weights[id], 0), out = {};
    if (!n || !total) return out;
    const share = ids.map((id) => ({ id, exact: (n * weights[id]) / total }));
    share.forEach((x) => { out[x.id] = Math.floor(x.exact); });
    let left = n - share.reduce((s, x) => s + out[x.id], 0);
    share.sort((a, b) => (b.exact % 1) - (a.exact % 1) || weights[b.id] - weights[a.id]);
    for (const x of share) { if (!left) break; out[x.id]++; left--; }
    return out;
  }
  function splitCremier(n, stock) {
    const have = Object.fromEntries(Object.keys(CREMIER).map((id) => [id, Math.max(0, Math.floor(Number(stock[id]) || 0))]));
    const out = Object.fromEntries(Object.keys(CREMIER).map((id) => [id, 0]));
    let left = n;
    // Fill in rounds: flavors still in stock share what's left by 5:3:2, capped at their stock.
    for (let guard = 0; left > 0 && guard < 10; guard++) {
      const open = Object.fromEntries(Object.entries(CREMIER).filter(([id]) => have[id] - out[id] > 0));
      if (!Object.keys(open).length) break;
      const part = byWeight(left, open);
      for (const [id, q] of Object.entries(part)) { const take = Math.min(q, have[id] - out[id]); out[id] += take; left -= take; }
    }
    if (left > 0) {   // more than is in stock: the rest by 5:3:2 among the flavors that had stock (all three if none did)
      const had = Object.fromEntries(Object.entries(CREMIER).filter(([id]) => have[id] > 0));
      for (const [id, q] of Object.entries(byWeight(left, Object.keys(had).length ? had : CREMIER))) out[id] += q;
    }
    return Object.fromEntries(Object.entries(out).filter(([, q]) => q > 0));
  }

  document.addEventListener('click', (e) => {
    const plus = e.target.closest('[data-ld-case]');
    if (plus) return add(plus.dataset.ldCase, 1);
    const minus = e.target.closest('[data-ld-case-minus]');
    if (minus) add(minus.dataset.ldCaseMinus, -1);
  });
  root.GremierDeliveryCases = { CASES, render, add, reset, apply, liters, caseBottles, splitCremier, CREMIER };
})(window);

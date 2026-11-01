/* "Compare our coffees": the liter bottles side by side (roast, sweetened, caffeine, best with), at the
   top of the shop's bottles shelf and inside each liter coffee's product window. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // What each coffee is, by its English name. Only facts: roast, sweetened, caffeine, and how it's best served.
  const COFFEES = [
    { re: /classic dark/i, roast: 3, sweet: false, caf: true, best: ['Black or with milk', 'שחור או עם חלב'] },
    { re: /house blend/i, roast: 2, sweet: false, caf: true, best: ['Black or with milk', 'שחור או עם חלב'] },
    { re: /colomb/i, roast: 1, sweet: false, caf: true, best: ['Black, over ice', 'שחור, על קרח'] },
    { re: /sweetened/i, roast: 3, sweet: true, caf: true, best: ['Ready to drink, over ice', 'מוכן לשתייה, על קרח'] },
    { re: /decaf/i, roast: 0, sweet: false, caf: false, best: ['Evenings, with milk', 'לערב, עם חלב'] },
    { re: /unfiltered/i, roast: 3, sweet: false, caf: true, best: ['Black or with milk', 'שחור או עם חלב'] },
  ];
  const ROAST = { 3: ['Dark', 'כהה'], 2: ['Medium', 'בינונית'], 1: ['Light', 'בהירה'] };
  const all = () => (typeof products !== 'undefined' && Array.isArray(products) ? products : []);
  const isSyrup = (p) => typeof isSyrupProduct === 'function' && isSyrupProduct(p);
  function rows() {
    return all().filter((p) => p.category === 'bottles' && p.is_active !== false && !isSyrup(p))
      .map((p) => ({ p, c: COFFEES.find((c) => c.re.test(p.name_en || '')) })).filter((r) => r.c)
      .sort((a, b) => COFFEES.indexOf(a.c) - COFFEES.indexOf(b.c));
  }
  const dots = (n) => n ? `<span class="cmp-dots" aria-label="${n}/3">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>` : '';
  function table(current) {
    const list = rows();
    if (list.length < 2) return '';
    return `<div class="cmp-wrap"><table class="cmp-table"><thead><tr><th></th><th>${T('Roast', 'קלייה')}</th><th>${T('Sweetened', 'ממותק')}</th><th>${T('Caffeine', 'קפאין')}</th><th>${T('Best', 'הכי טוב')}</th></tr></thead><tbody>${list.map(({ p, c }) => `
      <tr class="${current && String(current.id) === String(p.id) ? 'cmp-current' : ''}" data-cmp-open="${esc(p.id)}"><th>${esc(he() ? (p.name_he || p.name_en) : p.name_en)}</th>
      <td>${c.roast ? `${dots(c.roast)} <small>${T(...ROAST[c.roast])}</small>` : '—'}</td><td>${c.sweet ? T('Yes', 'כן') : T('No', 'לא')}</td><td>${c.caf ? T('Yes', 'כן') : T('Decaf', 'נטול')}</td><td><small>${T(...c.best)}</small></td></tr>`).join('')}</tbody></table></div>`;
  }
  // Shop: above the bottles shelf.
  function placeShop() {
    const shelf = $('shop-shelf-bottles');
    if (!shelf || shelf.querySelector('.cmp-shop')) return;
    const html = table();
    if (!html) return;
    const tools = shelf.querySelector('.shelf-tools');
    const pill = `<details class="cmp-shop"><summary class="shelf-pill"><span aria-hidden="true">⚖</span>${T('Compare our coffees', 'השוואת הקפה שלנו')}</summary>${html}</details>`;
    if (tools) tools.insertAdjacentHTML('afterbegin', pill); else shelf.querySelector('.shelf-heading')?.insertAdjacentHTML('afterend', pill);
  }
  // Product window of a liter coffee.
  function placeDrawer() {
    const p = typeof pdCurrentProduct !== 'undefined' ? pdCurrentProduct : null;
    document.querySelector('#pdDrawer .cmp-drawer')?.remove();
    if (!p || p.category !== 'bottles' || isSyrup(p) || !COFFEES.some((c) => c.re.test(p.name_en || ''))) return;
    const html = table(p);
    if (html) $('pdDesc')?.insertAdjacentHTML('afterend', `<details class="cmp-drawer"><summary><span aria-hidden="true">⚖</span>${T('Compare our coffees', 'השוואת הקפה שלנו')}</summary>${html}</details>`);
  }
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-cmp-open]');
    if (!row || typeof openProductDrawer !== 'function') return;
    if (typeof pdCurrentProduct !== 'undefined' && pdCurrentProduct && String(pdCurrentProduct.id) === row.dataset.cmpOpen) return;
    openProductDrawer(row.dataset.cmpOpen);
  });
  function hook() {
    for (const [fn, after] of [['renderShop', placeShop], ['openProductDrawerUI', placeDrawer]]) {
      const orig = window[fn];
      if (typeof orig === 'function') window[fn] = function () { const r = orig.apply(this, arguments); try { after(); } catch (_) {} return r; };
    }
    placeShop();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();

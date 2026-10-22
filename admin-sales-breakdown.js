/* Stats → "Sales by product type": large bottles, minis, jerry cans, coffee bars (+ other) — units and revenue,
   for stores only, online only, or overall. Read-only.
   Online  = paid website orders (not cancelled / refunded / test), by order date (Jerusalem), item prices.
   Stores  = store deliveries by delivery date, valued at each store's prices (same math as billing). */
(function (root) {
  'use strict';
  const TYPES = [
    { key: 'large', label: 'Large bottles' },
    { key: 'mini', label: 'Minis' },
    { key: 'jerry', label: 'Jerry cans' },
    { key: 'bar', label: 'Coffee bars' },
    { key: 'other', label: 'Other (syrups, gift cards, fees)' },
  ];
  const VIEWS = [['all', 'Overall'], ['stores', 'Stores'], ['online', 'Online']];
  const blank = () => Object.fromEntries(TYPES.map(t => [t.key, { units: 0, revenue: 0 }]));

  // ── classification (pure; exported for tests) ──
  /** Type of one product line + how many physical units one "qty" is (3 × 5L = 3 cans, a 4-pack = 4 minis). */
  function classify(item, product) {
    const cat = String(item?.category || product?.category || '').toLowerCase();
    const name = [item?.name_en, item?.name_he, product?.name_en, product?.name_he].filter(Boolean).join(' ').toLowerCase();
    if (['giftcard', 'gift_card', 'delivery_fee', 'custom_adjustment'].includes(cat) || /gift.?card/.test(name)) return { type: 'other', per: 1 };
    if (product?.is_coffee_bar || item?.is_coffee_bar || item?.meta?.service_type === 'coffee_bar' || cat.startsWith('coffeebar') || cat === 'coffee_bar' || /coffee ?bar|dispenser|עמדת קפה|דיספנסר/.test(name)) return { type: 'bar', per: 1 };
    if (/syrup|סירופ/.test(name)) return { type: 'other', per: 1 };
    if (cat === 'bulk' || /\b5\s*l\b|jerry|ג.?ריקן|5 ליטר/.test(name)) {
      const m = name.match(/(\d+)\s*[×x]\s*5\s*l/);
      return { type: 'jerry', per: m ? Number(m[1]) : 1 };
    }
    if (cat === 'minis' || cat === 'mini' || /mini|cremier|קרמייר|מיני/.test(name)) {
      const m = name.match(/(\d+)\s*[- ]?pack|pack\s*(?:of\s*)?(\d+)|(\d+)\s*יחידות/);
      return { type: 'mini', per: m ? Number(m[1] || m[2] || m[3]) : 1 };
    }
    if (cat === 'bottles' || cat === 'liter' || /liter|litre|roast|blend|colombia|decaf|classic|unfilter|sweetened|ליטר|בקבוק/.test(name)) return { type: 'large', per: 1 };
    return { type: 'other', per: 1 };
  }
  const eligible = o => o.payment_status === 'paid' && !o.is_test && !o.delivery_info?.is_test && !/^TEST(?:\b|[_-])/i.test(o.customer_name || '') && !['cancelled', 'refunded'].includes(o.status);

  function onlineTotals(orders, products) {
    const byId = new Map((products || []).map(p => [String(p.id), p]));
    const t = blank();
    let count = 0;
    for (const o of (orders || []).filter(eligible)) {
      count++;
      for (const item of (o.items || [])) {
        const qty = Number(item.qty) || 1;
        const lineRevenue = (Number(item.price) || 0) * qty;
        const contents = Array.isArray(item.subscription_items) ? item.subscription_items : [];
        if (contents.length) {
          // Subscription box: split its price across what's inside, by the contents' own prices.
          const weights = contents.map(c => (Number(c.price) || 0) * (Number(c.qty) || 1));
          const totalW = weights.reduce((s, w) => s + w, 0);
          contents.forEach((c, i) => {
            const { type, per } = classify(c, byId.get(String(c.product_id)));
            t[type].units += (Number(c.qty) || 1) * per * qty;
            t[type].revenue += totalW ? lineRevenue * (weights[i] / totalW) : lineRevenue / contents.length;
          });
          continue;
        }
        const { type, per } = classify(item, byId.get(String(item.product_id)));
        t[type].units += qty * per;
        t[type].revenue += lineRevenue;
      }
    }
    return { totals: t, count };
  }

  function storeTotals(deliveries, stores) {
    const byId = new Map((stores || []).map(s => [s.id, s]));
    const t = blank();
    for (const d of deliveries || []) {
      const s = byId.get(d.store_id) || {};
      const add = (type, qty, price) => { qty = Number(qty) || 0; if (qty <= 0) return; t[type].units += qty; t[type].revenue += qty * (Number(price) || 0); };
      add('large', d.qty_large, s.price_large);
      add('large', d.qty_unfiltered, s.price_unfiltered);
      add('mini', d.qty_small, s.price_small);
      add('mini', d.qty_dairy_free, s.price_dairy_free);
      add('other', d.qty_syrup, s.price_syrup);
    }
    return { totals: t, count: (deliveries || []).length };
  }

  const api = { classify, onlineTotals, storeTotals, TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  root.GremierSalesByType = api;

  // ── page ──
  const get = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '₪' + Math.round(n).toLocaleString('en-IL');
  const count = n => Math.round(n).toLocaleString('en-IL');
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const shift = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const day = v => { const d = new Date(v); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d) : ''; };
  let view = 'all';
  try { view = localStorage.getItem('gremier_sales_by_type_view') || 'all'; } catch (e) { /* private mode */ }
  let state = null, serial = 0;

  function range() {
    const kind = get('sbtPeriod')?.value || 'month', t = today(), y = +t.slice(0, 4);
    if (kind === 'lastmonth') { const end = shift(t.slice(0, 7) + '-01', -1); return { from: end.slice(0, 7) + '-01', to: end }; }
    if (kind === 'year') return { from: y + '-01-01', to: t };
    if (kind === 'lastyear') return { from: (y - 1) + '-01-01', to: (y - 1) + '-12-31' };
    if (kind === 'all') return { from: '2020-01-01', to: t };
    if (kind === 'pick') {
      const m = get('sbtMonth')?.value || t.slice(0, 7);
      const end = new Date(m + '-01T12:00:00Z'); end.setUTCMonth(end.getUTCMonth() + 1, 0);
      return { from: m + '-01', to: end.toISOString().slice(0, 10) };
    }
    return { from: t.slice(0, 7) + '-01', to: t };
  }

  function setup() {
    const host = get('tab-reports');
    if (!host || get('salesByType')) return;
    const panel = document.createElement('section');
    panel.id = 'salesByType';
    panel.className = 'sales-panel sbt-panel';
    panel.innerHTML = `
      <div class="sales-heading"><div><h2>Sales by product type</h2></div></div>
      <div class="sales-controls">
        <label>Period<select class="form-input" id="sbtPeriod">
          <option value="month">This month to date</option><option value="lastmonth">Last full month</option>
          <option value="pick">Specific month</option><option value="year">This year to date</option>
          <option value="lastyear">Last full year</option><option value="all">All time</option>
        </select></label>
        <label id="sbtMonthWrap" hidden>Month<input type="month" class="form-input" id="sbtMonth" value="${today().slice(0, 7)}"></label>
        <div class="sbt-seg" role="group" aria-label="Which sales">${VIEWS.map(([k, l]) => `<button type="button" data-view="${k}" aria-pressed="${view === k}">${l}</button>`).join('')}</div>
      </div>
      <p class="sales-note" id="sbtStatus" role="status"></p>
      <div id="sbtResults"></div>
      <details class="sales-help"><summary>How these figures work</summary><p class="sales-note">
        Online: paid website orders (cancelled, refunded and test orders left out), using each line's price — delivery fees and gift cards are under Other.
        Subscription boxes are split by what's inside them. Packs count each bottle (a 4-pack = 4 minis; 3 × 5L = 3 jerry cans).
        Stores: store deliveries, valued at each store's current prices like the billing screens. Large includes Unfiltered; Minis include dairy-free.
        Stores don't currently receive jerry cans or coffee bars.</p></details>`;
    const after = get('salesExplorer');
    if (after) after.after(panel); else { const tb = host.querySelector('.fin-toolbar'); if (tb) tb.before(panel); else host.append(panel); }
    get('sbtPeriod').onchange = () => { get('sbtMonthWrap').hidden = get('sbtPeriod').value !== 'pick'; load(); };
    get('sbtMonth').onchange = load;
    panel.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
      view = b.getAttribute('data-view');
      try { localStorage.setItem('gremier_sales_by_type_view', view); } catch (e) { /* ignore */ }
      panel.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      draw();
    });
  }

  async function pages(make) {
    const rows = [];
    for (let off = 0; off < 100000; off += 1000) {
      const r = await make().range(off, off + 999);
      if (r.error || !Array.isArray(r.data)) throw Error('Could not load complete sales data. Try again.');
      rows.push(...r.data);
      if (r.data.length < 1000) return rows;
    }
    throw Error('Too much data — choose a shorter period.');
  }

  async function load() {
    setup();
    if (!get('salesByType')) return;
    const r = range(), request = ++serial;
    get('sbtStatus').textContent = 'Loading…';
    try {
      const client = typeof sb !== 'undefined' ? sb : (root.MAIN_SB || root.ADMIN_SB);
      const [orders, deliveries, products, stores] = await Promise.all([
        pages(() => client.from('orders').select('id,created_at,items,payment_status,status,delivery_info,customer_name').eq('payment_status', 'paid').gte('created_at', shift(r.from, -1) + 'T00:00:00Z').lt('created_at', shift(r.to, 1) + 'T23:59:59Z').order('created_at').order('id')),
        pages(() => client.from('store_deliveries').select('id,store_id,delivery_date,qty_large,qty_small,qty_dairy_free,qty_unfiltered,qty_syrup').gte('delivery_date', r.from).lte('delivery_date', r.to).order('delivery_date').order('id')),
        pages(() => client.from('products').select('id,name_en,name_he,category,is_coffee_bar').order('id')),
        pages(() => client.from('stores').select('id,price_large,price_small,price_dairy_free,price_unfiltered,price_syrup').order('id')),
      ]);
      if (request !== serial) return;
      const inRange = orders.filter(o => { const d = day(o.created_at); return d >= r.from && d <= r.to; });
      state = { range: r, online: onlineTotals(inRange, products), stores: storeTotals(deliveries, stores) };
      get('sbtStatus').textContent = '';
      draw();
    } catch (e) {
      if (request !== serial) return;
      state = null;
      get('sbtStatus').textContent = e.message || 'Sales by type is unavailable right now.';
      get('sbtResults').innerHTML = '';
    }
  }

  function draw() {
    if (!state || !get('sbtResults')) return;
    const parts = view === 'stores' ? [state.stores] : view === 'online' ? [state.online] : [state.stores, state.online];
    const t = blank();
    for (const p of parts) for (const k of Object.keys(t)) { t[k].units += p.totals[k].units; t[k].revenue += p.totals[k].revenue; }
    const total = Object.values(t).reduce((s, x) => s + x.revenue, 0);
    const rows = TYPES.filter(x => x.key !== 'other' || t.other.units || t.other.revenue);
    const basis = view === 'stores' ? `${state.stores.count} store deliveries`
      : view === 'online' ? `${state.online.count} paid website orders`
      : `${state.stores.count} store deliveries + ${state.online.count} paid website orders`;
    get('sbtResults').innerHTML = `
      <p class="sales-note">${esc(state.range.from)} → ${esc(state.range.to)} · ${esc(basis)}</p>
      <div class="table-wrap sales-table"><table class="sbt-table">
        <thead><tr><th scope="col">Type</th><th scope="col">Units</th><th scope="col">Revenue</th><th scope="col">Share of revenue</th></tr></thead>
        <tbody>${rows.map(r => {
          const v = t[r.key], share = total ? (v.revenue / total) * 100 : 0;
          return `<tr><th scope="row">${esc(r.label)}</th><td>${v.units ? count(v.units) : '—'}</td><td>${v.revenue ? money(v.revenue) : '—'}</td>
            <td><span class="sbt-bar" aria-hidden="true"><span style="width:${share.toFixed(1)}%"></span></span>${share ? share.toFixed(0) + '%' : '—'}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><th scope="row">Total</th><td></td><td>${money(total)}</td><td></td></tr></tfoot>
      </table></div>`;
  }

  // Load with the rest of the Stats page (loadReports is wrapped by several Stats modules; keep the chain).
  const original = root.loadReports;
  root.loadReports = function (...args) { const result = original?.apply(this, args); setup(); load(); return result; };

  const css = document.createElement('style');
  css.textContent = `
    .sbt-panel .sales-controls{align-items:flex-end}
    .sbt-seg{display:inline-flex;border:1px solid var(--border);border-radius:999px;overflow:hidden;align-self:flex-end}
    .sbt-seg button{background:transparent;border:0;color:var(--text2);padding:8px 14px;font-size:.85rem;cursor:pointer;min-height:36px}
    .sbt-seg button[aria-pressed="true"]{background:var(--gold, #c8860a);color:#111;font-weight:600}
    .sbt-table td,.sbt-table th{white-space:nowrap}
    .sbt-bar{display:inline-block;width:70px;height:6px;border-radius:6px;background:var(--bg3, #2a2a2a);margin-right:8px;vertical-align:middle;overflow:hidden}
    .sbt-bar span{display:block;height:100%;background:var(--gold, #c8860a)}
    .sbt-table tfoot th,.sbt-table tfoot td{font-weight:600;border-top:1px solid var(--border)}
  `;
  document.head.appendChild(css);
})(typeof window === 'undefined' ? globalThis : window);

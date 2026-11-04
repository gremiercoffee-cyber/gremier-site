// Dashboard: quick list of paid orders that still need to be fulfilled, right under the top cards.
// Same rule as the Orders tab highlight: paid, and not fulfilled or cancelled.
// Shows nothing at all when there are none. Tapping a row opens the same order screen as Orders.
(function (root) {
  'use strict';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE = { regular: 'Regular', expedited: 'Expedited', event: 'Event', pickup: 'Pickup' };
  let rows = [];

  function css() {
    if (document.getElementById('dash-open-css')) return;
    const st = document.createElement('style');
    st.id = 'dash-open-css';
    st.textContent = `#dashOpenOrders{margin:0 0 22px;border:1px solid var(--border);border-radius:16px;background:var(--card,#fff);overflow:hidden}
#dashOpenOrders[hidden]{display:none}
.dso-head{display:flex;align-items:baseline;justify-content:space-between;padding:16px 18px 8px}
.dso-head h2{margin:0;font-size:1rem;font-weight:700;color:var(--cream)}
.dso-head span{font-size:.78rem;color:var(--text2)}
.dso-row{display:flex;align-items:center;gap:12px;width:100%;border:0;border-top:1px solid var(--border);background:none;padding:12px 18px;text-align:left;font:inherit;cursor:pointer}
.dso-row:hover{background:var(--bg2)}
.dso-no{flex:none;min-width:54px;font-size:.8rem;font-weight:700;color:var(--text2)}
.dso-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dso-main b{font-size:.92rem;color:var(--cream);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dso-main small{font-size:.78rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dso-total{flex:none;font-weight:700;font-size:.92rem;color:var(--cream)}
.dso-go{flex:none;color:var(--text2);font-size:1.2rem}`;
    document.head.append(st);
  }

  function when(o) {
    const di = o.delivery_info && typeof o.delivery_info === 'object' ? o.delivery_info : {};
    const type = TYPE[String(di.delivery_type || '').toLowerCase()] || '';
    const date = di.delivery_date ? new Date(String(di.delivery_date).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
    return [type, date].filter(Boolean).join(' · ');
  }

  function render() {
    const el = document.getElementById('dashOpenOrders');
    if (!el) return;
    if (!rows.length) { el.hidden = true; el.innerHTML = ''; return; }
    css();
    el.hidden = false;
    el.innerHTML = `<div class="dso-head"><h2>To fulfill</h2><span>${rows.length} order${rows.length === 1 ? '' : 's'}</span></div>` +
      rows.map((o) => {
        const items = (o.items || []).filter((i) => i.category !== 'delivery_fee').map((i) => `${(i.qty || 1) > 1 ? i.qty + '× ' : ''}${i.name_en || i.name || 'Item'}`).join(', ');
        const sub = [when(o), items].filter(Boolean).join(' · ');
        return `<button type="button" class="dso-row" data-order="${esc(o.id)}">
          <span class="dso-no">#${esc(o.order_number || String(o.id).slice(0, 6))}</span>
          <span class="dso-main"><b>${esc(o.customer_name || 'Customer')}</b><small>${esc(sub)}</small></span>
          <span class="dso-total">₪${Math.round(Number(o.total) || 0)}</span><span class="dso-go" aria-hidden="true">›</span>
        </button>`;
      }).join('');
  }

  async function open(id) {
    const o = rows.find((r) => r.id === id);
    // The order screen reads from the Orders list; add this one if Orders hasn't loaded yet.
    if (o && typeof allOrders !== 'undefined' && !allOrders.some((x) => x.id === id)) allOrders.push(o);
    if (typeof openOrderDetail === 'function') await openOrderDetail(id);
  }

  async function load() {
    if (typeof sb === 'undefined') return;
    const { data, error } = await sb.from('orders').select('*').eq('payment_status', 'paid')
      .not('status', 'in', '(fulfilled,cancelled)').order('created_at', { ascending: true }).limit(100);
    if (error) { console.warn('open orders:', error.message); return; }
    rows = data || [];
    render();
  }

  document.addEventListener('click', (e) => {
    const row = e.target.closest?.('#dashOpenOrders .dso-row');
    if (row) open(row.dataset.order);
  });
  root.GremierOpenOrders = { load, render };
})(window);

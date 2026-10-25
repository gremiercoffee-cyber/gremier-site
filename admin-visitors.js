/* Website visitors (Cloudflare Web Analytics) at the top of the Activity page. */
(function () {
  'use strict';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n || 0).toLocaleString('en-IL');

  function mount() {
    const list = document.getElementById('actList');
    if (!list || document.getElementById('visitorsCard')) return !!list;
    list.insertAdjacentHTML('beforebegin', `
      <section class="hub-card vis-card" id="visitorsCard">
        <h3><span>Website activity</span>
          <select class="form-input vis-days" id="visDays" aria-label="Website activity period" onchange="adminLoadVisitors()">
            <option value="1">Today</option><option value="7" selected>7 days</option><option value="30">30 days</option>
          </select>
        </h3>
        <div id="visBody"><div class="hub-empty">Loading…</div></div>
      </section>`);
    return true;
  }

  function list(title, rows, label) {
    if (!rows.length) return '';
    const max = Math.max(...rows.map((r) => r.visits || r.views), 1);
    return `<div class="vis-list"><div class="vis-list-title">${title}</div>${rows.map((r) => `
      <div class="vis-row"><span class="vis-k">${esc(label(r.key))}</span>
        <span class="vis-bar"><i style="width:${Math.max(4, Math.round(100 * (r.visits || r.views) / max))}%"></i></span>
        <span class="vis-v">${num(r.visits || r.views)}</span></div>`).join('')}</div>`;
  }

  // Shopping browsers and orders are different units, not a linked conversion funnel.
  function shoppingHtml(data) {
    const f=data.funnel;
    if(!f||f.error)return '<p class="vis-f-note">Shopping activity is temporarily unavailable.</p>';
    return `<div class="vis-order-kpis"><div><b>${num(f.orders)}</b><span>Orders placed</span></div><div><b>${num(f.paid)}</b><span>Paid orders</span></div></div>
      <div class="vis-shopping"><div class="vis-list-title">Shopping actions · browsers</div>
        ${[['Added to cart',f.cart],['Opened checkout',f.checkout],['Pressed pay',f.pay]].map(([label,count])=>`<div class="vis-shopping-row"><span>${label}</span><strong>${num(count)}</strong></div>`).join('')}
      </div>`;
  }
  let requestId=0;

  window.adminLoadVisitors = async function () {
    if (!mount()) return;
    const body = document.getElementById('visBody');
    const days = Number(document.getElementById('visDays').value) || 7;
    const currentRequest=++requestId;
    let data;
    try {
      const r = await callAdminFunction('admin-tools', { action: 'site_analytics', days });
      if(currentRequest!==requestId)return;
      data = r.data || {};
      if (!r.res.ok) throw new Error(data.error || r.res.status);
    } catch (e) {
      body.innerHTML = `<div class="hub-empty">Couldn't load visitors (${esc(e.message || e)}).</div>`;
      return;
    }
    const daysRows = data.byDay || [];
    const peak = Math.max(...daysRows.map((d) => d.visits), 1);
    const chart = days > 1 && daysRows.length ? `<div class="vis-chart" role="img" aria-label="Visitors per day">${daysRows.map((d) => {
      const label = new Date(d.key + 'T12:00:00').toLocaleDateString('en-IL', { day: 'numeric', month: 'short' });
      return `<div class="vis-col" title="${esc(label)}: ${num(d.visits)} visitors, ${num(d.views)} page views"><i style="height:${Math.max(3, Math.round(100 * d.visits / peak))}%"></i></div>`;
    }).join('')}</div>` : '';
    const device = (k) => ({ desktop: 'Computer', mobile: 'Phone', tablet: 'Tablet' }[String(k).toLowerCase()] || k || 'Other');
    const trafficOk=data.configured&&!data.error;
    const trafficTitle=trafficOk?`Visitors & traffic · ${num(data.visits)} recorded visits`:'Visitors & traffic · unavailable';
    const traffic=trafficOk?`<div class="vis-kpis"><div><b>${num(data.visits)}</b><span>Visits recorded</span></div><div><b>${num(data.views)}</b><span>Page views</span></div></div>
      ${Number(data.visits)>0?chart:'<p class="vis-f-note">No visits recorded by the traffic tracker for this period.</p>'}
      <div class="vis-lists">${list('Came from',data.referrers||[],k=>String(k||'').replace(/^(www|l|m|lm)\./,'')||'Direct / app')}${list('Country',data.countries||[],k=>k||'Unknown')}${list('Device',data.devices||[],device)}</div>`
      :'<p class="vis-f-note">Traffic tracking is unavailable. Shopping and order counts are shown above.</p>';
    body.innerHTML=`${shoppingHtml(data)}<details class="vis-traffic"><summary>${trafficTitle}</summary>${traffic}</details>
      <details class="vis-count-help"><summary>How counts work</summary><p>Dates use Jerusalem time. Shopping actions count browsers; orders count purchases. These are separate totals, not conversion percentages. Traffic comes from Cloudflare and may be delayed or blocked. Shopping tracking started 24 Oct 2026.</p></details>`;
  };

  // Load with the Activity page.
  const _showTab = window.showTab;
  window.showTab = function (tab) {
    const r = _showTab.apply(this, arguments);
    if (tab === 'activity') adminLoadVisitors();
    return r;
  };
  if (document.getElementById('tab-activity')?.style.display !== 'none' && document.getElementById('tab-activity')) adminLoadVisitors();
})();

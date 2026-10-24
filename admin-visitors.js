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
        <h3><span>🌐 Website visitors</span>
          <select class="form-input vis-days" id="visDays" aria-label="Visitors period" onchange="adminLoadVisitors()">
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

  // Where people drop off: each step with how many continued from the one before.
  function funnelHtml(data) {
    const f = data.funnel;
    if (!f) return '';
    const steps = [
      ['Visitors', data.visits || 0], ['Added to cart', f.cart], ['Opened checkout', f.checkout],
      ['Reached payment', f.orders], ['Paid', f.paid],
    ];
    const top = Math.max(steps[0][1], 1);
    return `<div class="vis-funnel"><div class="vis-list-title">From visit to order</div>${steps.map(([label, n], i) => {
      const prev = i ? steps[i - 1][1] : 0;
      const pct = i && prev ? `${Math.round((100 * n) / prev)}%` : '';
      return `<div class="vis-f-row"><span class="vis-k">${label}</span><span class="vis-bar"><i style="width:${Math.max(2, Math.round((100 * n) / top))}%"></i></span><span class="vis-v">${num(n)}</span><span class="vis-pct">${pct}</span></div>`;
    }).join('')}<small class="vis-f-note">% = of the step before. Cart and checkout counts started 24 Oct 2026.</small></div>`;
  }

  window.adminLoadVisitors = async function () {
    if (!mount()) return;
    const body = document.getElementById('visBody');
    const days = Number(document.getElementById('visDays').value) || 7;
    let data;
    try {
      const r = await callAdminFunction('admin-tools', { action: 'site_analytics', days });
      data = r.data || {};
      if (!r.res.ok) throw new Error(data.error || r.res.status);
    } catch (e) {
      body.innerHTML = `<div class="hub-empty">Couldn't load visitors (${esc(e.message || e)}).</div>`;
      return;
    }
    if (!data.configured) {
      body.innerHTML = '<div class="hub-empty">Not connected yet: Cloudflare needs an analytics token (one-time setup).</div>';
      return;
    }
    if (data.error) { body.innerHTML = `<div class="hub-empty">⚠️ ${esc(data.error)}</div>`; return; }

    const daysRows = data.byDay || [];
    const peak = Math.max(...daysRows.map((d) => d.visits), 1);
    const chart = days > 1 && daysRows.length ? `<div class="vis-chart" role="img" aria-label="Visitors per day">${daysRows.map((d) => {
      const label = new Date(d.key + 'T12:00:00').toLocaleDateString('en-IL', { day: 'numeric', month: 'short' });
      return `<div class="vis-col" title="${esc(label)}: ${num(d.visits)} visitors, ${num(d.views)} page views"><i style="height:${Math.max(3, Math.round(100 * d.visits / peak))}%"></i></div>`;
    }).join('')}</div>` : '';
    const device = (k) => ({ desktop: 'Computer', mobile: 'Phone', tablet: 'Tablet' }[String(k).toLowerCase()] || k || 'Other');
    body.innerHTML = `
      <div class="vis-kpis">
        <div><b>${num(data.visits)}</b><span>Visitors</span></div>
        <div><b>${num(data.views)}</b><span>Page views</span></div>
      </div>
      ${chart}
      ${funnelHtml(data)}
      <div class="vis-lists">
        ${list('Came from', data.referrers || [], (k) => String(k || '').replace(/^(www|l|m|lm)\./, '') || 'Direct / app')}
        ${list('Country', data.countries || [], (k) => k || 'Unknown')}
        ${list('Device', data.devices || [], device)}
      </div>`;
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

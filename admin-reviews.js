/* Reviews: every "How was it?" answer (email link or website card) with the average rating,
   a breakdown by stars, sorting, filtering and the full comments. Data: public.feedback. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FACES = ['', '😞', '😕', '😐', '🙂', '😍'];
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  let rows = [];
  let state = { sort: 'newest', stars: 0, comments: false };

  const main = $('websiteMain');
  if (!main) return;
  main.insertAdjacentHTML('beforeend', `
    <div id="tab-reviews" class="tab-content" style="display:none">
      <div class="page-header"><div class="flex-between">
        <div><h1 class="page-title">⭐ Reviews</h1></div>
        <div class="header-actions">
          <select class="form-input" style="width:auto" id="rvSort" aria-label="Sort reviews">
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
            <option value="high">Highest rating</option><option value="low">Lowest rating</option>
          </select>
        </div>
      </div></div>
      <div id="rvSummary" class="rv-summary"><div class="hub-empty">Loading…</div></div>
      <div class="rv-filters" id="rvFilters"></div>
      <div id="rvList"></div>
    </div>`);
  const navItem = `<div class="nav-item" onclick="showTab('reviews')" id="nav-reviews"><span class="icon">⭐</span><span>Reviews</span></div>`;
  ($('nav-reports') || $('nav-members'))?.insertAdjacentHTML('afterend', navItem);
  document.querySelector('.nav-drawer-item[onclick*="showTab(\'reports\')"]')?.insertAdjacentHTML('afterend',
    `<button class="nav-drawer-item" onclick="showTab('reviews');closeNavDrawer()"><span>⭐</span>Reviews</button>`);

  async function load() {
    const list = $('rvList');
    list.innerHTML = '<div class="hub-empty">Loading…</div>';
    const { data, error } = await sb.from('feedback').select('order_id, email, rating, comment, source, created_at, updated_at').order('created_at', { ascending: false }).limit(1000);
    if (error) { list.innerHTML = `<div class="hub-empty">⚠️ ${esc(error.message)}</div>`; return; }
    const ids = (data || []).map((r) => r.order_id).filter(Boolean);
    const orders = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: o } = await sb.from('orders').select('id, order_number, customer_name, items, total').in('id', ids.slice(i, i + 200));
      (o || []).forEach((x) => orders.set(x.id, x));
    }
    rows = (data || []).map((r) => ({ ...r, order: orders.get(r.order_id) || null }));
    render();
  }

  function render() {
    // Summary: average, count, and a clickable bar per star rating.
    const n = rows.length;
    const avg = n ? rows.reduce((s, r) => s + r.rating, 0) / n : 0;
    const withText = rows.filter((r) => (r.comment || '').trim()).length;
    const counts = [0, 0, 0, 0, 0, 0];
    rows.forEach((r) => counts[r.rating]++);
    $('rvSummary').innerHTML = n ? `
      <div class="rv-avg"><b>${avg.toFixed(1)}</b><span class="rv-stars">${stars(Math.round(avg))}</span><small>${n} review${n === 1 ? '' : 's'} · ${withText} with comments</small></div>
      <div class="rv-bars">${[5, 4, 3, 2, 1].map((s) => `
        <button type="button" class="rv-bar-row ${state.stars === s ? 'on' : ''}" data-stars="${s}" title="Show ${s}★ only">
          <span>${s}★</span><span class="rv-bar"><i style="width:${n ? Math.round((100 * counts[s]) / n) : 0}%"></i></span><span>${counts[s]}</span>
        </button>`).join('')}</div>`
      : '<div class="hub-empty">No reviews yet. Answers from the "How was it?" emails and the website card show up here.</div>';
    $('rvFilters').innerHTML = n ? `
      <button type="button" data-stars="0" class="${!state.stars ? 'on' : ''}">All</button>
      ${[5, 4, 3, 2, 1].map((s) => `<button type="button" data-stars="${s}" class="${state.stars === s ? 'on' : ''}">${s}★</button>`).join('')}
      <button type="button" data-comments="1" class="${state.comments ? 'on' : ''}">💬 With comments</button>` : '';

    let list = rows.filter((r) => (!state.stars || r.rating === state.stars) && (!state.comments || (r.comment || '').trim()));
    const by = { newest: (a, b) => b.created_at.localeCompare(a.created_at), oldest: (a, b) => a.created_at.localeCompare(b.created_at),
      high: (a, b) => b.rating - a.rating || b.created_at.localeCompare(a.created_at), low: (a, b) => a.rating - b.rating || b.created_at.localeCompare(a.created_at) };
    list = list.slice().sort(by[state.sort]);
    $('rvList').innerHTML = list.length ? list.map((r) => {
      const o = r.order;
      const items = o && Array.isArray(o.items) ? o.items.map((i) => `${i.name_en} ×${i.qty}`).join(', ') : '';
      const when = new Date(r.created_at).toLocaleDateString('en-IL', { day: 'numeric', month: 'short', year: 'numeric' });
      return `<article class="rv-card">
        <div class="rv-head"><span class="rv-face">${FACES[r.rating]}</span>
          <div class="rv-who"><b>${esc(o?.customer_name || r.email || 'Customer')}</b>
            <small>${when} · ${r.source === 'site' ? 'website' : 'email'}${o ? ` · <a href="#" onclick="event.preventDefault();showTab('orders');setTimeout(()=>openOrderDetail('${esc(o.id)}'),300)">order #${esc(o.order_number)}</a>` : ''}</small></div>
          <span class="rv-stars rv-n">${stars(r.rating)}</span></div>
        ${(r.comment || '').trim() ? `<p class="rv-text">${esc(r.comment)}</p>` : ''}
        ${items ? `<div class="rv-items">${esc(items)}</div>` : ''}
      </article>`;
    }).join('') : (n ? '<div class="hub-empty">No reviews match this filter.</div>' : '');
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('#tab-reviews [data-stars], #tab-reviews [data-comments]');
    if (!t) return;
    if (t.dataset.comments) state.comments = !state.comments;
    else { const s = Number(t.dataset.stars); state.stars = state.stars === s ? 0 : s; }
    render();
  });
  document.addEventListener('change', (e) => { if (e.target.id === 'rvSort') { state.sort = e.target.value; render(); } });

  const _showTab = window.showTab;
  window.showTab = function (tab) {
    const r = _showTab.apply(this, arguments);
    if (tab === 'reviews') load();
    return r;
  };

  const style = document.createElement('style');
  style.textContent = `
    .rv-summary { display:flex; flex-wrap:wrap; gap:18px 30px; align-items:center; background:var(--card,#fff); border:1px solid var(--border); border-radius:14px; padding:16px 18px; margin-bottom:12px; }
    .rv-avg { display:flex; flex-direction:column; gap:2px; min-width:140px; }
    .rv-avg b { font-size:2.4rem; line-height:1; }
    .rv-avg small { color:var(--text2); font-size:.76rem; }
    .rv-stars { color:#c8873a; letter-spacing:1px; }
    .rv-bars { flex:1; min-width:220px; display:flex; flex-direction:column; gap:4px; }
    .rv-bar-row { display:grid; grid-template-columns:30px 1fr 30px; align-items:center; gap:8px; padding:3px 6px; border:none; border-radius:8px; background:none; font-size:.78rem; cursor:pointer; color:inherit; text-align:start; }
    .rv-bar-row:hover, .rv-bar-row.on { background:rgba(200,135,58,.1); }
    .rv-bar { height:8px; border-radius:4px; background:rgba(0,0,0,.07); overflow:hidden; }
    .rv-bar i { display:block; height:100%; background:#c8873a; border-radius:4px; }
    .rv-filters { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
    .rv-filters button { padding:7px 13px; border-radius:999px; border:1px solid var(--border); background:var(--card,#fff); font-size:.78rem; cursor:pointer; color:inherit; }
    .rv-filters button.on { background:#1a1a1a; border-color:#1a1a1a; color:#fff; }
    .rv-card { background:var(--card,#fff); border:1px solid var(--border); border-radius:14px; padding:14px 16px; margin-bottom:10px; }
    .rv-head { display:flex; align-items:center; gap:10px; }
    .rv-face { font-size:1.6rem; line-height:1; }
    .rv-who { flex:1; min-width:0; display:flex; flex-direction:column; }
    .rv-who b { font-size:.92rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .rv-who small { color:var(--text2); font-size:.74rem; }
    .rv-who a { color:inherit; text-decoration:underline; }
    .rv-n { font-size:.86rem; flex:0 0 auto; }
    .rv-text { margin:10px 0 0; font-size:.9rem; line-height:1.55; white-space:pre-wrap; }
    .rv-items { margin-top:8px; font-size:.74rem; color:var(--text2); }`;
  document.head.appendChild(style);
})();

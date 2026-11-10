// Orders screen calendar: every open order and delivery on its day.
// Week (default): a vertical week, Sunday to Saturday, one row per day, square picture cards.
// Month: the month as a grid of small pictures; tap a day to see it. Today: one day, bigger cards.
// A card shows pictures of what goes out, with the name and the street on top; tapping it shows the address (street and number,
// then the city), everything to deliver, and the usual buttons. "Full order" opens the order itself.
// Entries come from admin-orders-board.js: { key, kind:'order'|'job', date, time, name, phone,
// address, city, items:[{label, qty, img, note}], labels, total, late, unpaidParts, open(), actions:[…] }.
(function (root) {
  'use strict';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const at = (s) => new Date(s + 'T12:00:00');
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
  const VIEW_KEY = 'gremier_orders_view';
  let view = (() => { try { return localStorage.getItem(VIEW_KEY) || 'week'; } catch (_) { return 'week'; } })();
  if (!['day', 'week', 'month'].includes(view)) view = 'week';
  let anchor = iso(new Date());
  let last = { body: null, entries: [] };
  const byKey = new Map();

  /** "BET SHEMESH, HaRav Kook Street 48, Apt 26, Floor 6" → { street: "HaRav Kook Street 48", city: "Bet Shemesh" }. */
  function splitAddress(address, cityHint) {
    const title = (s) => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()));
    const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean)
      .filter((p) => !/^(apt|apartment|floor|entrance|building|דירה|קומה|כניסה|בניין)\b/i.test(p));
    if (!parts.length) return { street: '', city: '' };
    const hints = (Array.isArray(cityHint) ? cityHint : [cityHint]).filter(Boolean).map((c) => String(c).trim().toLowerCase());
    let i = parts.findIndex((p) => hints.includes(p.toLowerCase()));
    if (i < 0 && parts.length > 1) i = /\p{L}/u.test(parts[0]) && parts[0] === parts[0].toUpperCase() && /[A-Z]/.test(parts[0]) ? 0 : parts.length - 1;
    const city = i >= 0 ? parts[i] : '';
    return { street: parts.filter((_, k) => k !== i).join(', '), city: city ? title(city) : '' };
  }

  function thumbs(e, big) {
    const imgs = [...new Set(e.items.map((i) => i.img).filter(Boolean))].slice(0, 4);
    const n = imgs.length;
    const inner = n ? imgs.map((src) => `<img src="${esc(src)}" alt="" loading="lazy"/>`).join('') : `<span class="ocal-ph">${e.kind === 'job' && e.type === 'store' ? '🏪' : e.type === 'coffeebar' ? '☕' : '📦'}</span>`;
    const qty = e.items.reduce((s, i) => s + (Number(i.qty) || 1), 0);
    // Name top right, street and number bottom left (the city and the rest are in the preview).
    const sp = e.type === 'pickup' ? { street: 'Pickup', city: '' } : splitAddress(e.address, e.city);
    const where = sp.street || sp.city;
    const flags = [
      e.type === 'pickup' ? '<i class="ocal-flag" title="Pickup">🛍️</i>' : e.type === 'store' ? '<i class="ocal-flag" title="Store">🏪</i>' : e.type === 'coffeebar' ? '<i class="ocal-flag" title="Coffee bar">☕</i>' : '',
      e.labels.length > 1 ? `<i class="ocal-flag" title="${e.labels.length} orders combined">🔗</i>` : '',
    ].join('');
    return `<span class="ocal-pics n${Math.min(n, 4)}">${inner}</span>${flags ? `<span class="ocal-flags">${flags}</span>` : ''}<span class="ocal-name">${esc(e.name)}</span>${where ? `<span class="ocal-where">${esc(where)}</span>` : ''}${qty > 1 ? `<span class="ocal-qty">×${qty}</span>` : ''}`;
  }
  const card = (e) => `<button type="button" class="ocal-card${e.late ? ' late' : ''}${e.labels.length > 1 ? ' combined' : ''}" data-ocal="${esc(e.key)}" aria-label="${esc(e.name)}">${thumbs(e)}</button>`;

  function dayRow(d, list, today) {
    const k = iso(d), isToday = k === today;
    return `<div class="ocal-row${isToday ? ' today' : ''}${k < today ? ' past' : ''}" data-day="${k}">
      <button type="button" class="ocal-day" data-goday="${k}"><b>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</b><span>${d.getDate()}</span>${isToday ? '<small>Today</small>' : ''}</button>
      <div class="ocal-cards">${list.length ? list.map(card).join('') : '<span class="ocal-none"></span>'}</div>
    </div>`;
  }
  const sortDay = (a, b) => String(a.time || '99').localeCompare(String(b.time || '99'));

  function render(body, entries) {
    last = { body, entries };
    byKey.clear(); entries.forEach((e) => byKey.set(e.key, e));
    const today = iso(new Date());
    const on = (k) => entries.filter((e) => e.date === k && !e.late).sort(sortDay);
    const late = entries.filter((e) => e.late), nodate = entries.filter((e) => !e.date);
    const a = at(anchor);
    let title = '', grid = '', rangeEnd = anchor;
    if (view === 'week') {
      const start = addDays(a, -a.getDay());
      const end = addDays(start, 6);
      rangeEnd = iso(end);
      title = `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
      grid = `<div class="ocal-week">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = addDays(start, i); return dayRow(d, on(iso(d)), today); }).join('')}</div>`;
    } else if (view === 'day') {
      title = a.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      const list = on(anchor);
      grid = `<div class="ocal-dayview">${list.length ? list.map(card).join('') : '<p class="ocal-empty">Nothing on this day.</p>'}</div>`;
    } else {
      const first = new Date(a.getFullYear(), a.getMonth(), 1, 12), start = addDays(first, -first.getDay());
      const lastDay = new Date(a.getFullYear(), a.getMonth() + 1, 0, 12), weeks = Math.ceil((first.getDay() + lastDay.getDate()) / 7);
      title = a.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      rangeEnd = iso(lastDay);
      const cells = [];
      for (let i = 0; i < weeks * 7; i++) {
        const d = addDays(start, i), k = iso(d), list = on(k), inMonth = d.getMonth() === a.getMonth();
        const pics = list.slice(0, 4).map((e) => { const img = e.items.find((x) => x.img)?.img; return img ? `<img src="${esc(img)}" alt="" loading="lazy"/>` : '<span>📦</span>'; }).join('');
        cells.push(`<button type="button" class="ocal-mcell${inMonth ? '' : ' out'}${k === today ? ' today' : ''}${list.length ? ' has' : ''}" data-goday="${k}"><span class="ocal-mnum">${d.getDate()}</span><span class="ocal-mpics">${pics}</span>${list.length > 4 ? `<span class="ocal-mmore">+${list.length - 4}</span>` : ''}</button>`);
      }
      grid = `<div class="ocal-month"><div class="ocal-mhead">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => `<span>${x}</span>`).join('')}</div><div class="ocal-mgrid">${cells.join('')}</div></div>`;
    }
    const band = (label, list, cls) => list.length ? `<div class="ocal-row ocal-band ${cls}"><div class="ocal-day"><b>${label}</b><span>${list.length}</span></div><div class="ocal-cards">${list.map(card).join('')}</div></div>` : '';
    // Coming up: everything after what's on screen, in date order, as one row of small pictures.
    const next = entries.filter((e) => e.date && e.date > rangeEnd).sort((x, y) => (x.date + (x.time || '99')).localeCompare(y.date + (y.time || '99')));
    const strip = next.length ? `<div class="ocal-next"><div class="ocal-next-h"><b>Coming up</b><span>${next.length} after ${view === 'month' ? 'this month' : view === 'week' ? 'this week' : 'this day'}</span></div>
      <div class="ocal-next-row">${next.map((e, i) => { const d = at(e.date), newDay = !i || next[i - 1].date !== e.date; return `<div class="ocal-next-i${newDay ? ' first' : ''}">${card(e)}<small>${newDay ? esc(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })) : '&nbsp;'}</small></div>`; }).join('')}</div></div>` : '';
    body.innerHTML = `<div class="ocal">
      <div class="ocal-bar">
        <div class="ocal-views" role="tablist">${[['day', view === 'day' && anchor !== today ? 'Day' : 'Today'], ['week', 'Week'], ['month', 'Month']].map(([v, l]) => `<button type="button" role="tab" aria-selected="${view === v}" class="${view === v ? 'on' : ''}" data-view="${v}">${l}</button>`).join('')}</div>
        <div class="ocal-nav"><button type="button" data-step="-1" aria-label="Previous">‹</button><span class="ocal-title">${esc(title)}</span><button type="button" data-step="1" aria-label="Next">›</button>${anchor !== today ? '<button type="button" class="ocal-now" data-now="1">Today</button>' : ''}</div>
      </div>
      ${band('Overdue', late, 'late')}${band('No date', nodate, 'nodate')}
      ${grid}
      ${strip}
    </div>`;
  }

  function rerender() { if (last.body) render(last.body, last.entries); }
  function setView(v, day) {
    view = v; if (day) anchor = day;
    try { localStorage.setItem(VIEW_KEY, v); } catch (_) {}
    rerender();
  }
  function step(n) {
    const a = at(anchor);
    anchor = iso(view === 'month' ? new Date(a.getFullYear(), a.getMonth() + n, 1, 12) : addDays(a, view === 'week' ? 7 * n : n));
    rerender();
  }

  // ── The card preview: address, everything to deliver, buttons ──
  function preview(e) {
    closePreview();
    const { street, city } = e.type === 'pickup' ? { street: 'Pickup', city: '' } : splitAddress(e.address, e.city);
    const maps = e.address && e.type !== 'pickup' ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.address)}` : '';
    const when = e.date ? at(e.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) + (e.time ? ' · ' + String(e.time).slice(0, 5) : '') : 'No date yet';
    const el = document.createElement('div');
    el.id = 'ocalSheet';
    el.innerHTML = `<div class="ocal-sheet" role="dialog" aria-modal="true" aria-labelledby="ocalName">
      <button type="button" class="ocal-x" aria-label="Close">×</button>
      <div class="ocal-sh-head"><b id="ocalName">${esc(e.name)}</b><small>${esc([e.labels.join(' + '), when].filter(Boolean).join(' · '))}</small></div>
      <div class="ocal-addr${e.late ? ' late' : ''}">
        <span class="ocal-pin" aria-hidden="true">📍</span>
        <span class="ocal-addr-t"><b>${esc(street || 'No address')}</b>${city ? `<span>${esc(city)}</span>` : ''}</span>
        ${maps ? `<a class="ocal-map" href="${esc(maps)}" target="_blank" rel="noopener">Map</a>` : ''}
      </div>
      <h4>To deliver${e.labels.length > 1 ? ` <small>· ${e.labels.length} orders together</small>` : ''}</h4>
      <ul class="ocal-items">${e.items.map((i) => `<li>${i.img ? `<img src="${esc(i.img)}" alt=""/>` : '<span class="ocal-noimg">☕</span>'}<span><b>${esc(i.label)}</b>${i.note ? `<small>${esc(i.note)}</small>` : ''}</span><em>×${esc(i.qty)}</em></li>`).join('') || '<li>No items listed</li>'}</ul>
      ${e.unpaidParts ? `<p class="ocal-note">${esc(e.unpaidParts)}</p>` : ''}
      <div class="ocal-acts">${e.actions.map((x, n) => x.href ? `<a class="oc-btn ${x.cls || ''}" href="${esc(x.href)}" target="_blank" rel="noopener">${esc(x.label)}</a>` : `<button type="button" class="oc-btn ${x.cls || ''}" data-act="${n}">${esc(x.label)}</button>`).join('')}</div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (ev) => {
      if (ev.target === el || ev.target.closest('.ocal-x')) return closePreview();
      const b = ev.target.closest('[data-act]');
      if (b) { const a = e.actions[Number(b.dataset.act)]; closePreview(); a.run(); }
    });
    root.addEventListener('keydown', escClose);
    el.querySelector('.ocal-x').focus();
  }
  function escClose(ev) { if (ev.key === 'Escape') closePreview(); }
  function closePreview() { document.getElementById('ocalSheet')?.remove(); root.removeEventListener('keydown', escClose); }

  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.ocal')) return;
    const c = ev.target.closest('[data-ocal]');
    if (c) { const e = byKey.get(c.dataset.ocal); if (e) preview(e); return; }
    const v = ev.target.closest('[data-view]');
    if (v) return setView(v.dataset.view, v.dataset.view === 'day' ? iso(new Date()) : null);
    const g = ev.target.closest('[data-goday]');
    if (g) return setView('day', g.dataset.goday);
    const s = ev.target.closest('[data-step]');
    if (s) return step(Number(s.dataset.step));
    if (ev.target.closest('[data-now]')) { anchor = iso(new Date()); rerender(); }
  });

  root.GremierCalendar = { render, splitAddress, closePreview };
})(window);

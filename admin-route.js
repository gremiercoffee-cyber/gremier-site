/* Delivery route planner: pick the deliveries you're taking now, add extra stops, choose where you
   start and finish, then open Google Maps with every stop loaded (route preview, so you can reorder
   the stops in Maps before starting). Opening Maps changes nothing: no delivery is completed or moved.

   Maps URLs: https://developers.google.com/maps/documentation/urls/get-started#directions-action
   - api=1, travelmode=driving, origin / destination / waypoints (| separated).
   - *_place_id goes with its text parameter. waypoint_place_ids must match waypoints one-to-one, so it's
     sent only when every middle stop has a Google place.
   - Up to 9 waypoints after the origin in the app; mobile browsers allow only 3. We count the final
     destination as one of the 9 to stay conservative, and never drop a stop silently. */
(function (root) {
  'use strict';
  const MAX_AFTER_ORIGIN = 9;          // middle stops + final destination
  const BROWSER_MIDDLE_MAX = 3;        // what a mobile browser accepts
  const MAPS_PACKAGE = 'com.google.android.apps.maps';

  // ── Pure helpers (tested in scripts/test-delivery-route.cjs) ──
  const clean = (s) => String(s ?? '').replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

  /** Where Maps should go for a stop: the building (never apartment/floor/instructions). */
  function navTarget(stop) {
    const p = stop?.place;
    if (p && p.source === 'google' && p.id && (p.precision === 'building' || p.confirmed)) return { text: clean(stop.address || p.label), placeId: p.id };
    if (p && p.source === 'pin' && p.confirmed && Number.isFinite(p.lat) && Number.isFinite(p.lng)) return { text: `${p.lat},${p.lng}`, placeId: null };
    if (stop?.coords && Number.isFinite(stop.coords.lat) && Number.isFinite(stop.coords.lng)) return { text: `${stop.coords.lat},${stop.coords.lng}`, placeId: null };
    return null;   // unresolved: needs review before it can be routed
  }

  /** How many deliveries/extra stops fit for this finish choice. */
  function stopLimit(end) { return end === 'last' ? MAX_AFTER_ORIGIN : MAX_AFTER_ORIGIN - 1; }

  /**
   * Build the Google Maps directions link.
   * origin: null = the phone's current location (Maps uses it when origin is left out), or a target.
   * end: 'last' (finish at the last stop) | 'return' (back to origin) | 'custom' (endTarget).
   * Returns { url, intent, middle, error }.
   */
  function buildMapsUrl({ origin = null, stops = [], end = 'last', endTarget = null }) {
    const targets = stops.map(navTarget);
    const missing = targets.findIndex((t) => !t);
    if (!stops.length) return { error: 'Select at least one stop.' };
    if (missing >= 0) return { error: `“${stops[missing].name || 'A stop'}” has no confirmed location yet. Fix its address first.` };
    const limit = stopLimit(end);
    if (stops.length > limit) return { error: `Google Maps takes up to ${limit} stops ${end === 'last' ? '' : 'plus the finish '}in one route. You selected ${stops.length}. Remove ${stops.length - limit}, or split the run into two routes.` };
    let destination, middle;
    if (end === 'last') { destination = targets[targets.length - 1]; middle = targets.slice(0, -1); }
    else if (end === 'return') { if (!origin) return { error: 'To return to the start, Maps needs your start location.' }; destination = origin; middle = targets; }
    else { if (!endTarget) return { error: 'Choose where to finish.' }; destination = endTarget; middle = targets; }

    const parts = [['api', '1'], ['travelmode', 'driving']];
    if (origin) { parts.push(['origin', origin.text]); if (origin.placeId) parts.push(['origin_place_id', origin.placeId]); }
    parts.push(['destination', destination.text]);
    if (destination.placeId) parts.push(['destination_place_id', destination.placeId]);
    if (middle.length) {
      parts.push(['waypoints', middle.map((t) => t.text).join('|')]);
      if (middle.every((t) => t.placeId)) parts.push(['waypoint_place_ids', middle.map((t) => t.placeId).join('|')]);
    }
    const query = parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');   // encodes Hebrew, spaces, commas and | (%7C)
    const url = 'https://www.google.com/maps/dir/?' + query;
    // Android: open the installed Maps app directly. Without the app, a browser only takes 3 middle stops,
    // so for longer routes the fallback explains that instead of opening a route with stops missing.
    const fallback = middle.length > BROWSER_MIDDLE_MAX ? ((root.location?.origin || 'https://gremiercoffee.co.il') + '/admin?maps=app-needed') : url;
    const intent = `intent://www.google.com/maps/dir/?${query}#Intent;scheme=https;package=${MAPS_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
    return { url, intent, middle: middle.length, destination, error: null };
  }

  /** "Apartment 12 · Floor 3 · Entrance B · Call on arrival" */
  function detailsLine(d) {
    if (!d) return '';
    return [d.apartment && 'Apt ' + d.apartment, d.floor && 'Floor ' + d.floor, d.entrance && 'Entrance ' + d.entrance, d.instructions].filter(Boolean).join(' · ');
  }

  /** One pending delivery job (+ its website order / store) as a planner stop. */
  function stopFromJob(job, order, store) {
    const info = order?.delivery_info || {};
    const isStore = job.delivery_type === 'store' || (!job.delivery_type && job.store_name);
    const name = isStore ? job.store_name : job.delivery_type === 'coffeebar' ? (job.cb_name || job.private_name || 'Coffee bar') : (job.private_name || order?.customer_name || 'Delivery');
    const address = isStore ? [store?.public_address, store?.public_city].filter(Boolean).join(', ') : (job.delivery_type === 'coffeebar' ? job.cb_address : job.private_address) || order?.delivery_address || '';
    const place = job.delivery_location || info.address_place || null;
    const details = job.delivery_details || info.address_details || null;
    const coords = isStore && store && Number.isFinite(Number(store.lat)) && store.lat !== null ? { lat: Number(store.lat), lng: Number(store.lng) } : null;
    return { key: 'job:' + job.id, jobId: job.id, kind: isStore ? 'store' : job.delivery_type || 'private', name, date: job.date, time: job.time || '', address, details, place, coords, phone: job.customer_phone || null, orderNumber: order?.order_number || null };
  }

  const api = { buildMapsUrl, navTarget, stopLimit, detailsLine, stopFromJob, MAX_AFTER_ORIGIN, BROWSER_MIDDLE_MAX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;
  root.GremierRoute = api;

  // ── Planner UI ──
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const client = () => (typeof sb !== 'undefined' ? sb : root.ADMIN_SB || root.MAIN_SB);
  const toast = (m) => (typeof showToast === 'function' ? showToast(m) : alert(m));
  const pretty = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  let state = null;
  const JOB_COLS = 'id,date,time,done,delivery_type,store_name,private_name,private_address,cb_name,cb_address,customer_phone,website_order_id';

  async function load() {
    const db = client();
    let q = db.from('jobs').select(JOB_COLS + ',delivery_location,delivery_details').eq('type', 'delivery').eq('done', false);
    q = state.all ? q.gte('date', addDays(today(), -14)) : q.eq('date', state.date);
    let { data: jobs, error } = await q.order('date').order('time');
    if (error && /delivery_location|delivery_details/.test(error.message || '')) {   // before the migration: plain addresses
      let q2 = db.from('jobs').select(JOB_COLS).eq('type', 'delivery').eq('done', false);
      q2 = state.all ? q2.gte('date', addDays(today(), -14)) : q2.eq('date', state.date);
      ({ data: jobs, error } = await q2.order('date').order('time'));
    }
    if (error) throw error;
    const orderIds = [...new Set((jobs || []).map((j) => j.website_order_id).filter(Boolean))];
    const [orders, stores] = await Promise.all([
      orderIds.length ? db.from('orders').select('id,order_number,customer_name,delivery_address,delivery_info').in('id', orderIds) : { data: [] },
      db.from('stores').select('id,name,public_address,public_city,lat,lng'),
    ]);
    const byOrder = new Map((orders.data || []).map((o) => [o.id, o]));
    const byStore = new Map((stores.data || []).map((s) => [String(s.name || '').trim().toLowerCase(), s]));
    state.jobs = (jobs || []).map((j) => stopFromJob(j, byOrder.get(j.website_order_id), byStore.get(String(j.store_name || '').trim().toLowerCase())));
  }

  function selectedStops() {
    const all = [...(state.jobs || []), ...state.extras];
    return state.order.map((k) => all.find((s) => s.key === k)).filter(Boolean);
  }

  const PIN = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" fill="currentColor"/></svg>';
  const FLAG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M5 21V4h9l.6 2H20v9h-6.4l-.6-2H7v8z" fill="currentColor"/></svg>';
  function dayWord(d) {
    const t = today();
    return d === t ? 'Today' : d === addDays(t, 1) ? 'Tomorrow' : d === addDays(t, -1) ? 'Yesterday'
      : new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  }
  const stopAddress = (s) => s.address || (s.place?.source === 'pin' ? 'Pinned location' : 'No address');

  function stopRow(s, extra) {
    const target = navTarget(s), idx = state.order.indexOf(s.key), on = idx >= 0, d = detailsLine(s.details);
    const kind = extra ? 'Extra stop' : s.kind === 'store' ? 'Store' : s.kind === 'coffeebar' ? 'Coffee bar' : 'Delivery';
    const chips = [
      `<span class="rt-chip">${kind}</span>`,
      !extra && state.all && s.date ? `<span class="rt-chip">${esc(pretty(s.date))}</span>` : '',
      s.time ? `<span class="rt-chip strong">${esc(String(s.time).slice(0, 5))}</span>` : '',
      s.orderNumber ? `<span class="rt-chip">#${esc(s.orderNumber)}</span>` : '',
    ].join('');
    return `<div class="rt-stop${on ? ' on' : ''}${target ? '' : ' bad'}">
      <label class="rt-check">
        <input type="checkbox" class="rt-cb" data-pick="${esc(s.key)}"${on ? ' checked' : ''}${target ? '' : ' disabled'}>
        <span class="rt-num" aria-hidden="true">${on ? idx + 1 : ''}</span>
        <span class="rt-info">
          <b class="rt-name">${esc(s.name)}</b>
          <span class="rt-chips">${chips}</span>
          <span class="rt-addr">${PIN}<span>${esc(stopAddress(s))}</span></span>
          ${d ? `<span class="rt-details">${esc(d)}</span>` : ''}
          ${target ? '' : '<span class="rt-flag">⚠ No confirmed location yet. Fix the address to add this stop.</span>'}
        </span>
      </label>
      ${!target && s.jobId ? `<button class="rt-btn amber" data-fix="${esc(s.key)}">Fix address</button>` : ''}
      ${extra ? `<button class="rt-remove" data-remove="${esc(s.key)}" aria-label="Remove stop">✕</button>` : ''}
      ${state.fixing === s.key ? `<div class="rt-fix"><input class="form-input" id="rtFixInput" placeholder="Search the address"><button class="rt-btn dark" data-fixsave="${esc(s.key)}">Save location</button></div>` : ''}
    </div>`;
  }

  function render() {
    const host = document.getElementById('routePlanner');
    if (!host) return;
    const sel = selectedStops(), limit = stopLimit(state.end), over = sel.length > limit, jobs = state.jobs;
    const sub = host.querySelector('#rtSub');
    if (sub) sub.textContent = sel.length ? `${sel.length} stop${sel.length === 1 ? '' : 's'} on this route` : 'Pick the stops you are taking now';
    const seg = (name, value, label, cur) => `<label class="rt-seg-opt"><input type="radio" name="${name}" value="${value}"${cur === value ? ' checked' : ''}><span>${label}</span></label>`;
    const noneLabel = state.all ? 'pending' : dayWord(state.date) === 'Today' ? 'today' : 'on ' + pretty(state.date);
    host.querySelector('.rt-body').innerHTML = `
      <div class="rt-datebar">
        <button class="rt-arrow" data-day="-1" aria-label="Previous day"${state.all ? ' disabled' : ''}>‹</button>
        <label class="rt-datepill${state.all ? ' off' : ''}">
          <b>${state.all ? 'All pending' : esc(dayWord(state.date))}</b>
          <small>${state.all ? 'Every delivery not yet done' : esc(pretty(state.date))}</small>
          <input type="date" id="rtDate" value="${state.date}"${state.all ? ' disabled' : ''} aria-label="Delivery date">
        </label>
        <button class="rt-arrow" data-day="1" aria-label="Next day"${state.all ? ' disabled' : ''}>›</button>
        <label class="rt-allpill"><input type="checkbox" id="rtAll"${state.all ? ' checked' : ''}><span>All</span></label>
      </div>

      <section class="rt-sec">
        <div class="rt-sec-h"><h3>Deliveries</h3>${jobs ? `<span class="rt-count">${jobs.length}</span>` : ''}</div>
        ${!jobs ? '<div class="rt-skel"></div><div class="rt-skel"></div>'
          : jobs.length ? jobs.map((s) => stopRow(s)).join('')
          : `<div class="rt-empty"><span class="rt-empty-ico" aria-hidden="true">🚚</span><b>No deliveries ${esc(noneLabel)}</b><small>You can still route extra stops below.</small>${state.all ? '' : '<button class="rt-link" id="rtShowAll">Show every pending delivery</button>'}</div>`}
        ${state.extras.map((s) => stopRow(s, true)).join('')}
        ${state.addOpen
          ? '<div class="rt-addcard"><input class="form-input" id="rtExtraInput" placeholder="Search an address"><input class="form-input" id="rtExtraName" placeholder="Name (optional), e.g. Supplier"><div class="rt-addrow"><button class="rt-btn ghost" id="rtAddToggle">Cancel</button><button class="rt-btn dark" id="rtExtraAdd">Add stop</button></div></div>'
          : '<button class="rt-addbtn" id="rtAddToggle"><span aria-hidden="true">＋</span> Add a stop <small>supplier, pickup, anything</small></button>'}
      </section>

      <section class="rt-sec">
        <div class="rt-sec-h"><h3>Your trip</h3><span class="rt-count${over ? ' warn' : ''}">${sel.length} / ${limit} stops</span></div>
        <div class="rt-trip">
          <div class="rt-leg"><span class="rt-dot start" aria-hidden="true"></span><div class="rt-leg-main">
            <span class="rt-leg-label">Start</span>
            <div class="rt-seg">${seg('rtStart', 'here', '📍 My location', state.start)}${seg('rtStart', 'custom', 'Another place', state.start)}</div>
            <div class="rt-pick"${state.start === 'custom' ? '' : ' hidden'}><input class="form-input" id="rtStartInput" placeholder="Search the start address"></div>
          </div></div>
          ${sel.length ? sel.map((s, i) => `<div class="rt-leg"><span class="rt-dot n" aria-hidden="true">${i + 1}</span><div class="rt-leg-main"><b>${esc(s.name)}</b><small>${esc(stopAddress(s))}${detailsLine(s.details) ? ' · ' + esc(detailsLine(s.details)) : ''}</small></div></div>`).join('')
            : '<div class="rt-leg"><span class="rt-dot ghost" aria-hidden="true"></span><div class="rt-leg-main"><small class="rt-hint">Tick deliveries above to add them to the route.</small></div></div>'}
          <div class="rt-leg"><span class="rt-dot end" aria-hidden="true">${FLAG}</span><div class="rt-leg-main">
            <span class="rt-leg-label">Finish</span>
            <div class="rt-seg">${seg('rtEnd', 'last', 'Last stop', state.end)}${seg('rtEnd', 'return', 'Round trip', state.end)}${seg('rtEnd', 'custom', 'Elsewhere', state.end)}</div>
            <div class="rt-pick"${state.end === 'custom' ? '' : ' hidden'}><input class="form-input" id="rtEndInput" placeholder="Search the finish address"></div>
          </div></div>
        </div>
        ${over ? `<p class="rt-error">Google Maps takes up to ${limit} stops ${state.end === 'last' ? '' : 'plus the finish '}in one route. Remove ${sel.length - limit}, or split this run into two routes.</p>` : ''}
        ${sel.length > BROWSER_MIDDLE_MAX + 1 ? '<p class="rt-note">Opens in the Google Maps app, which takes all these stops. A phone browser only takes 3 stops in the middle, so keep the Maps app installed.</p>' : ''}
        <p class="rt-note">Maps opens in route preview, where you can drag stops into any order. Opening Maps doesn't mark anything delivered.</p>
      </section>`;
    host.querySelector('#rtOpen').disabled = !sel.length || over;
    host.querySelector('#rtGoLabel').textContent = sel.length ? `Start route · ${sel.length} stop${sel.length === 1 ? '' : 's'}` : 'Pick stops to start';
    attachPickers();
  }

  function attachPickers() {
    const P = root.GremierPlaces; if (!P) return;
    // Search in Hebrew when the typed address is Hebrew, otherwise English.
    const langOf = (el) => () => (/[֐-׿]/.test(el.value) ? 'he' : 'en');
    const extra = document.getElementById('rtExtraInput');
    if (extra) state.extraPicker = P.attach(extra, { lang: langOf(extra) });
    const s = document.getElementById('rtStartInput');
    if (s) { state.startPicker = P.attach(s, { lang: langOf(s), onChange: (v) => { state.startValue = v; } }); if (state.startValue) state.startPicker.set(state.startValue); }
    const e = document.getElementById('rtEndInput');
    if (e) { state.endPicker = P.attach(e, { lang: langOf(e), onChange: (v) => { state.endValue = v; } }); if (state.endValue) state.endPicker.set(state.endValue); }
    const f = document.getElementById('rtFixInput');
    if (f) state.fixPicker = P.attach(f, { lang: langOf(f) });
  }

  async function reload() { state.jobs = null; render(); try { await load(); } catch (e) { state.jobs = []; toast('Could not load deliveries: ' + (e.message || e)); } render(); }

  const here = () => new Promise((ok, fail) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => ok({ text: `${Math.round(p.coords.latitude * 1e6) / 1e6},${Math.round(p.coords.longitude * 1e6) / 1e6}`, placeId: null }), fail, { enableHighAccuracy: true, timeout: 15000 }) : fail(new Error('no geolocation')));
  const pickedTarget = (v) => (v && root.GremierPlaces?.placeReady(v.place) ? navTarget({ address: v.text, place: v.place }) : null);

  async function openMaps() {
    const stops = selectedStops();
    let origin = null, endTarget = null;
    if (state.start === 'custom') { origin = pickedTarget(state.startValue); if (!origin) return toast('Choose the start address from the list (and confirm it).'); }
    else if (state.end === 'return') { try { origin = await here(); } catch { return toast('Allow location access to return to your current location, or choose a start address.'); } }
    if (state.end === 'custom') { endTarget = pickedTarget(state.endValue); if (!endTarget) return toast('Choose the finish address from the list (and confirm it).'); }
    const r = buildMapsUrl({ origin, stops, end: state.end, endTarget });
    if (r.error) return toast(r.error);
    const android = /Android/i.test(navigator.userAgent);
    root.location.href = android ? r.intent : r.url;   // read-only handoff: nothing is saved
  }

  async function saveFix(key) {
    const v = state.fixPicker?.value();
    if (!v || !root.GremierPlaces.placeReady(v.place)) return toast('Choose the address from the list and confirm it.');
    const stop = state.jobs.find((s) => s.key === key);
    // Saved on the delivery job only; the original order and its address stay exactly as they were.
    const { error } = await client().from('jobs').update({ delivery_location: v.place }).eq('id', stop.jobId);
    if (error) return toast('Could not save: ' + error.message);
    stop.place = v.place; if (!stop.address) stop.address = v.text; state.fixing = null; toast('Location saved ✓'); render();
  }

  function onClick(e) {
    if (e.target.id === 'rtDate' && e.target.showPicker) { try { e.target.showPicker(); } catch (_) {} return; }
    const t = e.target.closest('[data-day],[data-fix],[data-fixsave],[data-remove],#rtExtraAdd,#rtOpen,#rtClose,#rtAddToggle,#rtShowAll') || e.target;
    if (t.id === 'rtAddToggle') { state.addOpen = !state.addOpen; render(); if (state.addOpen) setTimeout(() => document.getElementById('rtExtraInput')?.focus(), 0); return; }
    if (t.id === 'rtShowAll') { state.all = true; reload(); return; }
    if (t.dataset.day) { state.date = addDays(state.date, Number(t.dataset.day)); reload(); }
    else if (t.dataset.fix) { state.fixing = t.dataset.fix; render(); }
    else if (t.dataset.fixsave) saveFix(t.dataset.fixsave);
    else if (t.dataset.remove) { state.extras = state.extras.filter((s) => s.key !== t.dataset.remove); state.order = state.order.filter((k) => k !== t.dataset.remove); render(); }
    else if (t.id === 'rtExtraAdd') {
      const v = state.extraPicker?.value();
      if (!v || !root.GremierPlaces.placeReady(v.place)) return toast('Choose the stop from the list (and confirm it).');
      const name = document.getElementById('rtExtraName').value.trim() || v.text || 'Extra stop';
      const key = 'extra:' + Date.now();
      state.extras.push({ key, name, address: v.text, place: v.place, details: null });
      state.order.push(key); state.addOpen = false; render();
    } else if (t.id === 'rtOpen') openMaps();
    else if (t.id === 'rtClose' || t.id === 'routePlanner') close();
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.pick) { const k = t.dataset.pick; state.order = t.checked ? [...state.order, k] : state.order.filter((x) => x !== k); render(); }
    else if (t.id === 'rtDate') { state.date = t.value || today(); reload(); }
    else if (t.id === 'rtAll') { state.all = t.checked; reload(); }
    else if (t.name === 'rtStart') { state.start = t.value; render(); }
    else if (t.name === 'rtEnd') { state.end = t.value; render(); }
  }

  function open() {
    // Nothing is preselected: tick the deliveries you are taking now.
    state = { date: today(), all: false, jobs: null, extras: [], order: [], start: 'here', end: 'last', startValue: null, endValue: null, fixing: null, addOpen: false };
    if (!document.getElementById('rt-style')) {
      const st = document.createElement('style'); st.id = 'rt-style';
      st.textContent = `.rt-overlay{position:fixed;inset:0;z-index:9000;background:rgba(15,18,24,.5);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center}
.rt-overlay[hidden]{display:none}
.rt-sheet{background:#f4f5f7;width:100%;max-width:560px;max-height:94vh;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:rtUp .24s ease-out}
@keyframes rtUp{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}
@media (min-width:700px){.rt-overlay{align-items:center}.rt-sheet{border-radius:24px;max-height:90vh}}
.rt-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px 16px 14px;background:linear-gradient(135deg,#111827,#1f2a44);color:#fff}
.rt-title{display:flex;align-items:center;gap:12px;min-width:0}.rt-title h2{margin:0;font-size:1.15rem;font-weight:800;color:#fff;letter-spacing:-.01em}.rt-title small{display:block;font-size:.78rem;color:rgba(255,255,255,.65);margin-top:1px}
.rt-logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;background:#1a73e8;color:#fff;flex:none;box-shadow:0 6px 16px rgba(26,115,232,.45)}
.rt-x{width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;font-size:1rem;cursor:pointer;flex:none}
.rt-body{overflow:auto;padding:12px 14px 18px;-webkit-overflow-scrolling:touch}
.rt-datebar{display:flex;align-items:center;gap:8px;background:#fff;border-radius:18px;padding:8px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.rt-arrow{width:40px;height:44px;border-radius:12px;border:0;background:#f1f3f6;font-size:1.4rem;line-height:1;color:#111;cursor:pointer;flex:none}.rt-arrow:disabled{opacity:.35;cursor:default}
.rt-datepill{position:relative;flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 6px;border-radius:12px;cursor:pointer;text-align:center}
.rt-datepill b{font-size:1rem;color:#111;font-weight:800}.rt-datepill small{font-size:.74rem;color:#6b7280}.rt-datepill.off{cursor:default}
.rt-datepill input{position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;border:0;padding:0}
.rt-allpill{display:flex;align-items:center;cursor:pointer;flex:none;position:relative}.rt-allpill input{position:absolute;opacity:0;pointer-events:none}
.rt-allpill span{padding:11px 14px;border-radius:12px;background:#f1f3f6;font-size:.82rem;font-weight:700;color:#374151}
.rt-allpill input:checked+span{background:#111827;color:#fff}.rt-allpill input:focus-visible+span{outline:2px solid #1a73e8}
.rt-sec{margin-top:18px}.rt-sec-h{display:flex;align-items:center;gap:8px;margin:0 4px 10px}
.rt-sec-h h3{margin:0;font-size:1.02rem;font-weight:800;color:#111;letter-spacing:-.01em}
.rt-count{font-size:.74rem;font-weight:700;padding:2px 9px;border-radius:999px;background:#e5e7eb;color:#374151}.rt-count.warn{background:#fde2e1;color:#b3261e}
.rt-stop{position:relative;background:#fff;border:2px solid transparent;border-radius:18px;padding:12px 14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06);transition:border-color .15s,box-shadow .15s}
.rt-stop.on{border-color:#1a73e8;box-shadow:0 6px 18px rgba(26,115,232,.16)}
.rt-stop.bad{background:#fffaf0;border-color:#f3dca8}
.rt-check{display:flex;gap:12px;align-items:flex-start;cursor:pointer}.rt-stop.bad .rt-check{cursor:default}
.rt-cb{position:absolute;opacity:0;pointer-events:none}
.rt-num{width:32px;height:32px;border-radius:50%;flex:none;display:grid;place-items:center;border:2px solid #cfd4dc;font-weight:800;font-size:.9rem;color:#fff;margin-top:1px;transition:all .15s}
.rt-stop.on .rt-num{background:#1a73e8;border-color:#1a73e8}
.rt-cb:focus-visible~.rt-num{outline:2px solid #1a73e8;outline-offset:2px}
.rt-info{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1;padding-right:24px}
.rt-name{font-size:1rem;color:#111;font-weight:800;line-height:1.25}
.rt-chips{display:flex;flex-wrap:wrap;gap:5px}.rt-chip{font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:999px;background:#f1f3f6;color:#4b5563}.rt-chip.strong{background:#111827;color:#fff}
.rt-addr{display:flex;gap:5px;align-items:flex-start;font-size:.86rem;color:#1f2937;line-height:1.35}.rt-addr svg{color:#ea4335;flex:none;margin-top:2px}
.rt-details{font-size:.8rem;color:#6b7280;padding-left:19px}
.rt-flag{font-size:.8rem;color:#9a6b00;font-weight:700}
.rt-btn{border:0;border-radius:12px;padding:10px 16px;font:inherit;font-size:.86rem;font-weight:700;cursor:pointer}
.rt-btn.dark{background:#111827;color:#fff}.rt-btn.ghost{background:#f1f3f6;color:#374151}.rt-btn.amber{background:#f6c453;color:#3b2a00;margin:10px 0 0 44px}
.rt-remove{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;border:0;background:#f1f3f6;color:#6b7280;cursor:pointer}
.rt-fix,.rt-addcard{display:flex;flex-direction:column;gap:8px}.rt-fix{margin:10px 0 0 44px}
.rt-addcard{background:#fff;border-radius:18px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.rt-addrow{display:flex;gap:8px;justify-content:flex-end}
.rt-addbtn{width:100%;display:flex;align-items:center;gap:8px;padding:14px 16px;border-radius:18px;border:2px dashed #cfd4dc;background:transparent;font:inherit;font-weight:700;font-size:.92rem;color:#374151;cursor:pointer}
.rt-addbtn span{font-size:1.2rem;color:#1a73e8}.rt-addbtn small{font-weight:500;color:#9ca3af;margin-left:auto;font-size:.76rem}
.rt-empty{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;background:#fff;border-radius:18px;padding:22px 16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.rt-empty-ico{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;background:#eef4fe;font-size:1.5rem;margin-bottom:4px}
.rt-empty b{font-size:.98rem;color:#111}.rt-empty small{font-size:.82rem;color:#6b7280}
.rt-link{margin-top:8px;border:0;background:none;color:#1a73e8;font:inherit;font-weight:700;font-size:.86rem;cursor:pointer}
.rt-skel{height:86px;border-radius:18px;margin-bottom:10px;background:linear-gradient(90deg,#e9ebef,#f6f7f9,#e9ebef);background-size:200% 100%;animation:rtSk 1.1s linear infinite}
@keyframes rtSk{to{background-position:-200% 0}}
.rt-trip{background:#fff;border-radius:18px;padding:14px 14px 6px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.rt-leg{position:relative;display:flex;gap:12px;padding-bottom:14px}
.rt-leg:not(:last-child)::before{content:"";position:absolute;left:13px;top:30px;bottom:2px;border-left:2px dotted #c7ccd4}
.rt-dot{width:28px;height:28px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:.8rem;font-weight:800;color:#fff;position:relative;z-index:1;box-sizing:border-box}
.rt-dot.start{background:#fff;border:7px solid #34a853}.rt-dot.end{background:#ea4335}.rt-dot.n{background:#1a73e8}.rt-dot.ghost{background:#fff;border:2px dashed #c7ccd4}
.rt-leg-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding-top:4px}
.rt-leg-main b{font-size:.92rem;color:#111}.rt-leg-main small{font-size:.8rem;color:#6b7280;line-height:1.35}
.rt-leg-label{font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}
.rt-hint{font-style:italic}
.rt-seg{display:flex;gap:4px;background:#f1f3f6;border-radius:12px;padding:4px}
.rt-seg-opt{flex:1;min-width:0;cursor:pointer;position:relative}.rt-seg-opt input{position:absolute;opacity:0;pointer-events:none}
.rt-seg-opt span{display:block;text-align:center;padding:9px 6px;border-radius:9px;font-size:.82rem;font-weight:700;color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-seg-opt input:checked+span{background:#fff;color:#111;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.rt-seg-opt input:focus-visible+span{outline:2px solid #1a73e8}
.rt-pick{display:flex;flex-direction:column}.rt-pick[hidden]{display:none}
.rt-error{margin:10px 4px 0;padding:10px 12px;border-radius:12px;background:#fde2e1;color:#b3261e;font-weight:700;font-size:.85rem}
.rt-note{margin:10px 6px 0;color:#6b7280;font-size:.78rem;line-height:1.45}
.rt-foot{padding:12px 14px calc(12px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #e5e7eb}
.rt-go{width:100%;min-height:56px;display:flex;align-items:center;justify-content:center;gap:10px;border:0;border-radius:16px;background:#1a73e8;color:#fff;font:inherit;font-size:1.05rem;font-weight:800;cursor:pointer;box-shadow:0 8px 22px rgba(26,115,232,.35);transition:transform .12s}
.rt-go:active{transform:scale(.99)}.rt-go:disabled{background:#d6dae0;color:#6b7280;box-shadow:none;cursor:default}
.rt-go-ico{display:grid;place-items:center}
body.rt-open{overflow:hidden}`;
      document.head.append(st);
    }
    let host = document.getElementById('routePlanner');
    if (!host) {
      host = document.createElement('div');
      host.id = 'routePlanner'; host.className = 'rt-overlay';
      host.innerHTML = '<div class="rt-sheet" role="dialog" aria-modal="true" aria-label="Plan a delivery route"><div class="rt-head"><div class="rt-title"><span class="rt-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z" fill="currentColor"/></svg></span><div><h2>Plan a route</h2><small id="rtSub">Pick the stops you are taking now</small></div></div><button class="rt-x" id="rtClose" aria-label="Close">✕</button></div><div class="rt-body"></div><div class="rt-foot"><button class="rt-go" id="rtOpen"><span class="rt-go-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z" fill="currentColor"/></svg></span><span id="rtGoLabel">Open in Google Maps</span></button></div></div>';
      host.addEventListener('click', onClick); host.addEventListener('change', onChange);
      document.body.append(host);
    }
    host.hidden = false; document.body.classList.add('rt-open');
    reload();
  }
  function close() { const host = document.getElementById('routePlanner'); if (host) host.hidden = true; document.body.classList.remove('rt-open'); }
  root.GremierRoute.open = open;
  root.GremierRoute.close = close;

  // Maps app missing (Android fallback for routes a browser can't hold).
  if (/[?&]maps=app-needed/.test(root.location.search)) setTimeout(() => toast('Install or enable the Google Maps app: a phone browser only takes 3 stops in the middle of a route, so the route was not opened there.'), 800);
})(typeof window !== 'undefined' ? window : globalThis);

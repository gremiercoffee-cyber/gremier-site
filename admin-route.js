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

  function stopRow(s, extra) {
    const target = navTarget(s), on = state.order.includes(s.key), d = detailsLine(s.details);
    const when = extra ? 'Extra stop' : `${pretty(s.date)}${s.time ? ' · ' + esc(s.time) : ''}${s.orderNumber ? ' · #' + esc(s.orderNumber) : ''}`;
    return `<div class="rt-stop${on ? ' on' : ''}${target ? '' : ' bad'}">
      <label class="rt-check"><input type="checkbox" data-pick="${esc(s.key)}"${on ? ' checked' : ''}${target ? '' : ' disabled'}>
      <span><b>${esc(s.name)}</b><small>${when}</small>
      <span class="rt-addr">📍 ${esc(s.address || (s.place?.source === 'pin' ? 'Pinned location' : 'No address'))}</span>
      ${d ? `<span class="rt-details">${esc(d)}</span>` : ''}
      ${target ? '' : '<span class="rt-flag">⚠ Address needs review: no confirmed location</span>'}</span></label>
      ${!target && s.jobId ? `<button class="btn btn-outline btn-sm" data-fix="${esc(s.key)}">Fix address</button>` : ''}
      ${extra ? `<button class="btn btn-outline btn-sm" data-remove="${esc(s.key)}">Remove</button>` : ''}
      ${state.fixing === s.key ? `<div class="rt-fix"><input class="form-input" id="rtFixInput" placeholder="Search the address"><button class="btn btn-sm" data-fixsave="${esc(s.key)}">Save location</button></div>` : ''}
    </div>`;
  }

  function render() {
    const host = document.getElementById('routePlanner');
    if (!host) return;
    const sel = selectedStops(), limit = stopLimit(state.end), over = sel.length > limit;
    host.querySelector('.rt-body').innerHTML = `
      <div class="rt-dates"><button class="btn btn-outline btn-sm" data-day="-1">‹</button><input type="date" class="form-input" id="rtDate" value="${state.date}"${state.all ? ' disabled' : ''}><button class="btn btn-outline btn-sm" data-day="1">›</button>
        <label class="rt-all"><input type="checkbox" id="rtAll"${state.all ? ' checked' : ''}> All pending</label></div>
      <h3>Deliveries${state.jobs ? ` · ${state.jobs.length}` : ''}</h3>
      ${!state.jobs ? '<p class="rt-muted">Loading…</p>' : state.jobs.length ? state.jobs.map((s) => stopRow(s)).join('') : `<p class="rt-muted">No pending deliveries ${state.all ? '' : 'on ' + pretty(state.date)}.</p>`}
      <h3>Extra stops</h3>
      ${state.extras.map((s) => stopRow(s, true)).join('')}
      <div class="rt-add"><input class="form-input" id="rtExtraName" placeholder="Name (optional), e.g. Supplier"><input class="form-input" id="rtExtraInput" placeholder="Search an address"><button class="btn btn-outline btn-sm" id="rtExtraAdd">+ Add stop</button></div>
      <h3>Start</h3>
      <label class="rt-radio"><input type="radio" name="rtStart" value="here"${state.start === 'here' ? ' checked' : ''}> My current location</label>
      <label class="rt-radio"><input type="radio" name="rtStart" value="custom"${state.start === 'custom' ? ' checked' : ''}> Another place</label>
      <div class="rt-pick"${state.start === 'custom' ? '' : ' hidden'}><input class="form-input" id="rtStartInput" placeholder="Search the start address"></div>
      <h3>Finish</h3>
      <label class="rt-radio"><input type="radio" name="rtEnd" value="last"${state.end === 'last' ? ' checked' : ''}> At the last delivery</label>
      <label class="rt-radio"><input type="radio" name="rtEnd" value="return"${state.end === 'return' ? ' checked' : ''}> Back to the start</label>
      <label class="rt-radio"><input type="radio" name="rtEnd" value="custom"${state.end === 'custom' ? ' checked' : ''}> Somewhere else</label>
      <div class="rt-pick"${state.end === 'custom' ? '' : ' hidden'}><input class="form-input" id="rtEndInput" placeholder="Search the finish address"></div>
      <h3>Review · ${sel.length} of ${limit} stops</h3>
      ${sel.length ? `<ol class="rt-review">${sel.map((s) => `<li><b>${esc(s.name)}</b> <span>${esc(s.address || 'Pinned location')}</span>${detailsLine(s.details) ? `<small>${esc(detailsLine(s.details))}</small>` : ''}</li>`).join('')}</ol>` : '<p class="rt-muted">Nothing selected yet. Tick the deliveries you are taking now.</p>'}
      ${over ? `<p class="rt-error">Google Maps takes up to ${limit} stops ${state.end === 'last' ? '' : 'plus the finish '}in one route. Remove ${sel.length - limit}, or split this run into two routes.</p>` : ''}
      ${sel.length > BROWSER_MIDDLE_MAX + 1 ? '<p class="rt-muted">Opens in the Google Maps app, which takes all these stops. A phone browser only takes 3 stops in the middle, so keep the Maps app installed.</p>' : ''}
      <p class="rt-muted">Maps opens in route preview: drag the stops into the order you want, then start. Opening Maps doesn't mark anything delivered.</p>`;
    host.querySelector('#rtOpen').disabled = !sel.length || over;
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
    const t = e.target;
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
      state.order.push(key); render();
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
    state = { date: today(), all: false, jobs: null, extras: [], order: [], start: 'here', end: 'last', startValue: null, endValue: null, fixing: null };
    if (!document.getElementById('rt-style')) {
      const st = document.createElement('style'); st.id = 'rt-style';
      st.textContent = `.rt-overlay{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
.rt-overlay[hidden]{display:none}.rt-sheet{background:#fff;width:100%;max-width:560px;max-height:94vh;border-radius:18px 18px 0 0;display:flex;flex-direction:column}
.rt-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #eee}.rt-head h2{margin:0;font-size:1.1rem}
.rt-body{overflow:auto;padding:4px 16px 16px;-webkit-overflow-scrolling:touch}.rt-body h3{font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:18px 0 8px}
.rt-foot{padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #eee}.rt-foot .btn{width:100%;min-height:48px;font-size:1rem}
.rt-dates{display:flex;gap:6px;align-items:center;margin-top:10px}.rt-dates input[type=date]{flex:1}.rt-all{display:flex;gap:4px;align-items:center;font-size:.85rem;white-space:nowrap}
.rt-stop{border:1px solid #e3e3e3;border-radius:12px;padding:10px 12px;margin-bottom:8px}.rt-stop.on{border-color:#1a1a1a;background:#fafafa}.rt-stop.bad{border-color:#f0d49a;background:#fffaf0}
.rt-check{display:flex;gap:10px;align-items:flex-start;cursor:pointer}.rt-check input{width:22px;height:22px;margin-top:2px;flex:none}
.rt-check span{display:flex;flex-direction:column;gap:2px;min-width:0}.rt-check small{color:#777}.rt-addr{font-size:.85rem;color:#3f7fc4}.rt-details{font-size:.85rem;color:#333}
.rt-flag{font-size:.8rem;color:#9a6b00;font-weight:600}.rt-stop>.btn{margin-top:8px}.rt-fix,.rt-add,.rt-pick{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.rt-radio{display:flex;gap:8px;align-items:center;padding:6px 0}.rt-radio input{width:20px;height:20px}
.rt-review{padding-inline-start:20px;margin:0}.rt-review li{margin-bottom:6px}.rt-review span,.rt-review small{display:block;font-size:.85rem;color:#555}
.rt-error{color:#b3261e;font-weight:600}.rt-muted{color:#777;font-size:.85rem}body.rt-open{overflow:hidden}`;
      document.head.append(st);
    }
    let host = document.getElementById('routePlanner');
    if (!host) {
      host = document.createElement('div');
      host.id = 'routePlanner'; host.className = 'rt-overlay';
      host.innerHTML = '<div class="rt-sheet" role="dialog" aria-label="Plan a delivery route"><div class="rt-head"><h2>🧭 Plan a route</h2><button class="btn btn-outline btn-sm" id="rtClose">Close</button></div><div class="rt-body"></div><div class="rt-foot"><button class="btn" id="rtOpen">Open in Google Maps</button></div></div>';
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

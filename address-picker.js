/* Gremier address picker — one picker for checkout, admin delivery scheduling and the route planner.
   Google Places Autocomplete (New) through our `places` function (the key stays on the server).

   const picker = GremierPlaces.attach(inputEl, { lang: () => 'he' | 'en', onChange(value) {} });
   picker.value()  → { text, place, status }
       text   — what the person typed / confirmed (their own words; this is what we keep long term)
       place  — { source:'google', id, label, precision:'building'|'approximate', locality, confirmed, at }
                or { source:'pin', lat, lng, confirmed, at } (a location they confirmed themselves)
                or null
       status — 'empty' | 'typing' | 'selected' | 'unavailable' (lookup not configured / down)
   picker.set({ text, place })   picker.ready()   picker.problem()   picker.destroy()

   Rules: typing alone never selects a place; changing the text after a selection clears it; a result
   that isn't a specific building must be confirmed explicitly (checkbox, or a pin). */
(function (root) {
  'use strict';
  const STYLE_ID = 'gp-style';
  const CSS = `
.gp-list{margin:4px 0 0;border:1px solid #d8d2c8;border-radius:10px;background:#fff;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.08);text-align:start}
.gp-item{display:block;width:100%;padding:10px 12px;border:0;border-bottom:1px solid #f0ece6;background:none;text-align:inherit;font:inherit;color:#1a1a1a;cursor:pointer}
.gp-item:hover,.gp-item.on{background:#f6f2ec}.gp-item b{display:block;font-weight:600}.gp-item small{color:#777}
.gp-attr{padding:6px 12px;font-size:11px;color:#777;text-align:end}
.gp-card{margin:6px 0 0;padding:10px 12px;border-radius:10px;font-size:13px;line-height:1.45;text-align:start}
.gp-card.ok{background:#eef7f0;border:1px solid #bfe0c8;color:#1d4d2b}.gp-card.warn{background:#fff6e5;border:1px solid #f0d49a;color:#5c4200}
.gp-card.info{background:#f3f3f3;border:1px solid #ddd;color:#444}
.gp-card .gp-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.gp-card button{padding:7px 10px;border-radius:8px;border:1px solid #c9bfae;background:#fff;font:inherit;font-size:12px;cursor:pointer}
.gp-card label{display:flex;gap:8px;align-items:flex-start;margin-top:8px;font-weight:600;cursor:pointer}
.gp-card small{display:block;color:#777;margin-top:4px}`;
  const T = {
    building: ['Delivering to', 'משלוח אל'],
    edit: ['Not right? Change the street above to search again.', 'לא נכון? שנו את הרחוב למעלה כדי לחפש שוב.'],
    approx: ['Google found this, but not a specific building:', 'גוגל מצא את זה, אבל לא בניין מסוים:'],
    approxHow: ['Pick a result with the house number, or confirm the exact spot:', 'בחרו תוצאה עם מספר בית, או אשרו את המיקום המדויק:'],
    here: ['Use my current location', 'השתמשו במיקום הנוכחי שלי'],
    paste: ['Paste a Google Maps link', 'הדביקו קישור מגוגל מפות'],
    pasteAsk: ['Paste a Google Maps link or coordinates (e.g. 31.7, 35.1):', 'הדביקו קישור מגוגל מפות או קואורדינטות (למשל 31.7, 35.1):'],
    pasteBad: ['No coordinates found in that link. In Google Maps, long-press the spot and copy the numbers shown.', 'לא נמצאו קואורדינטות בקישור. בגוגל מפות, לחצו לחיצה ארוכה על המקום והעתיקו את המספרים.'],
    confirm: ['Yes, deliver to this location', 'כן, למסור במיקום הזה'],
    pin: ['Pinned location', 'מיקום מסומן'],
    unavailable: ["Address lookup isn't available right now. Your address will be checked before delivery.", 'חיפוש כתובות לא זמין כרגע. הכתובת תיבדק לפני המשלוח.'],
    noResults: ['No matches. Try the street name and number, or add the city.', 'לא נמצאו תוצאות. נסו שם רחוב ומספר, או הוסיפו עיר.'],
    pick: ['Choose your address from the list', 'בחרו את הכתובת מהרשימה'],
    confirmNeeded: ['Confirm the delivery location', 'אשרו את מיקום המשלוח'],
    geoFail: ["Couldn't get your location. Allow location access, or paste a Google Maps link.", 'לא הצלחנו לקבל את המיקום. אשרו גישה למיקום, או הדביקו קישור מגוגל מפות.'],
    powered: ['Powered by Google', 'מופעל על ידי Google'],
  };
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => (root.crypto?.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

  /** Coordinates from a pasted Google Maps link or "lat, lng" text; null when there are none. */
  function parseCoords(text) {
    const s = String(text || '');
    const m = s.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) || s.match(/[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i)
      || s.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) || s.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null;
  }
  /** Is this place good enough to navigate to without asking again? */
  function placeReady(place) {
    return !!place && (place.source === 'google' ? (place.precision === 'building' || place.confirmed === true) : place.source === 'pin' && place.confirmed === true);
  }

  /* Is address lookup working on this page? 'unknown' until checked. Checkout only insists on a
     selection once it is known to work; otherwise the order goes through and is flagged for review. */
  let lookup = 'unknown', probe = null;
  function checkLookup() {
    // An empty search answers without calling Google: 503 when no key is set, otherwise no suggestions.
    if (!probe) probe = call({ action: 'autocomplete', input: '' }).then(() => { lookup = 'up'; }, (e) => { if (e.unavailable) lookup = 'down'; });
    return probe;
  }

  function endpoint() {
    const url = root.GREMIER_PLACES_URL || (typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL + '/functions/v1/places' : '');
    const key = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
    return { url, key };
  }
  async function call(body) {
    const { url, key } = endpoint();
    if (!url) throw Object.assign(new Error('not_configured'), { unavailable: true });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { apikey: key, Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 503 || data.error === 'not_configured') throw Object.assign(new Error('not_configured'), { unavailable: true });
    if (!res.ok) throw Object.assign(new Error(data.error || 'lookup_failed'), { unavailable: res.status >= 500 });
    return data;
  }

  function attach(input, opts = {}) {
    if (!document.getElementById(STYLE_ID)) { const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.append(st); }
    const he = () => (opts.lang ? opts.lang() : (typeof lang !== 'undefined' ? lang : 'en')) === 'he';
    const t = (k) => T[k][he() ? 1 : 0];
    const box = document.createElement('div');
    box.className = 'gp-box';
    input.setAttribute('autocomplete', 'off');
    input.after(box);
    let place = null, status = input.value.trim() ? 'typing' : 'empty', session = null, list = [], active = -1, timer = 0, seq = 0, note = '';

    const value = () => ({ text: input.value.trim(), place, status });
    const changed = () => { render(); opts.onChange?.(value()); };

    function render() {
      let html = '';
      if (list.length) {
        html += '<div class="gp-list" role="listbox">' + list.map((s, i) => `<button type="button" class="gp-item${i === active ? ' on' : ''}" data-i="${i}" role="option"><b>${esc(s.main)}</b><small>${esc(s.secondary)}</small></button>`).join('')
          + `<div class="gp-attr">${t('powered')}</div></div>`;
      }
      if (status === 'unavailable') html += `<div class="gp-card info">${t('unavailable')}</div>`;
      else if (place?.source === 'google' && place.precision === 'building') {
        html += `<div class="gp-card ok">📍 ${t('building')}: <b>${esc(place.label)}</b><small>${t('edit')}</small></div>`;
      } else if (place) {
        const where = place.source === 'pin' ? `${t('pin')}: ${place.lat}, ${place.lng}` : place.label;
        html += `<div class="gp-card warn">${place.source === 'pin' ? '📍' : '⚠️ ' + t('approx')} <b>${esc(where)}</b>`
          + (place.source === 'google' ? `<small>${t('approxHow')}</small>` : '')
          + `<div class="gp-row"><button type="button" data-act="here">${t('here')}</button><button type="button" data-act="paste">${t('paste')}</button></div>`
          + `<label><input type="checkbox" data-act="confirm"${place.confirmed ? ' checked' : ''}> ${t('confirm')}</label></div>`;
      } else if (note) html += `<div class="gp-card info">${esc(note)}</div>`;
      box.innerHTML = html;
    }

    async function search() {
      const q = input.value.trim(), mine = ++seq;
      if (q.length < 2) { list = []; render(); return; }
      session = session || token();
      try {
        const data = await call({ action: 'autocomplete', input: q, session, lang: he() ? 'he' : 'en' });
        if (mine !== seq) return;
        lookup = 'up';
        list = data.suggestions || []; active = -1; note = list.length ? '' : t('noResults');
        if (status === 'unavailable') status = 'typing';
      } catch (e) {
        if (mine !== seq) return;
        list = [];
        if (e.unavailable) { lookup = 'down'; status = 'unavailable'; opts.onChange?.(value()); }
      }
      render();
    }
    async function choose(i) {
      const s = list[i]; if (!s) return;
      list = []; note = '';
      try {
        const data = await call({ action: 'details', placeId: s.placeId, session, lang: he() ? 'he' : 'en' });
        session = null;   // the session ends with the details call
        const p = data.place;
        place = { source: 'google', id: p.id, label: p.label, precision: p.precision, locality: p.locality || '', confirmed: p.precision === 'building', at: new Date().toISOString() };
        input.value = s.main || input.value;
        status = 'selected';
      } catch (e) {
        if (e.unavailable) status = 'unavailable';
      }
      changed();
    }
    function setPin(c) {
      place = { source: 'pin', lat: c.lat, lng: c.lng, confirmed: false, at: new Date().toISOString() };
      status = 'selected'; list = []; changed();
    }

    input.addEventListener('input', () => {
      // Editing the street after a selection clears it: it has to be chosen (and confirmed) again.
      if (place || status === 'selected') { place = null; }
      status = input.value.trim() ? 'typing' : 'empty';
      clearTimeout(timer); timer = setTimeout(search, 250);
      opts.onChange?.(value()); render();
    });
    input.addEventListener('keydown', (e) => {
      if (!list.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length; render(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { list = []; render(); }
    });
    box.addEventListener('mousedown', (e) => { if (e.target.closest('.gp-item')) e.preventDefault(); });   // keep focus while choosing
    box.addEventListener('click', (e) => {
      const item = e.target.closest('.gp-item');
      if (item) { choose(Number(item.dataset.i)); return; }
      const act = e.target.dataset?.act;
      if (act === 'here') {
        if (!navigator.geolocation) { alert(t('geoFail')); return; }
        navigator.geolocation.getCurrentPosition((p) => setPin({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }), () => alert(t('geoFail')), { enableHighAccuracy: true, timeout: 15000 });
      } else if (act === 'paste') {
        const c = parseCoords(prompt(t('pasteAsk')) || '');
        if (c) setPin(c); else alert(t('pasteBad'));
      }
    });
    box.addEventListener('change', (e) => {
      if (e.target.dataset?.act === 'confirm' && place) { place = { ...place, confirmed: e.target.checked }; changed(); }
    });

    const api = {
      value,
      set(v) {
        input.value = v?.text || ''; place = v?.place || null; status = place ? 'selected' : (input.value ? 'typing' : 'empty'); list = []; note = ''; render();
        // A saved address without a chosen place: show the matching suggestions so it can be picked.
        if (!place && input.value.trim().length >= 2) checkLookup().then(() => { if (lookup === 'up' && !place) search(); });
      },
      ready() { return status === 'unavailable' || lookup !== 'up' || placeReady(place); },
      problem() { return api.ready() ? '' : (place ? t('confirmNeeded') : t('pick')); },
      destroy() { box.remove(); },
    };
    render();
    checkLookup();
    return api;
  }

  /** A chosen Google place as a short address line: "Yam Suf St 5, Jerusalem". */
  function shortLabel(place) { return String(place?.label || '').replace(/,\s*(Israel|ישראל)\s*$/, ''); }
  /** The one-line address for emails and receipts: the place (or what was typed) + apartment, floor, entrance. */
  function composeAddress(value, details) {
    const base = value?.place?.source === 'google' && value.place.label ? shortLabel(value.place) : String(value?.text || '').trim();
    const d = details || {};
    return [base, d.apartment && 'Apt ' + d.apartment, d.floor && 'Floor ' + d.floor, d.entrance && 'Entrance ' + d.entrance].filter(Boolean).join(', ');
  }

  const GremierPlaces = { attach, parseCoords, placeReady, shortLabel, composeAddress };
  if (typeof module !== 'undefined' && module.exports) module.exports = GremierPlaces;
  root.GremierPlaces = GremierPlaces;
})(typeof window !== 'undefined' ? window : globalThis);

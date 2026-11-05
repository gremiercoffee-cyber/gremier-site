/* Google address search on the payment link builder. Choosing from the list is optional here (the customer
   can still add the address when paying), but a chosen place travels with the link to the order and route. */
(function (root) {
  'use strict';
  let picker = null;
  const $ = (id) => document.getElementById(id);
  const DETAILS = { apartment: 'plApt', floor: 'plFloor', entrance: 'plEntrance' };

  function ensure() {
    const input = $('plAddress');
    if (!picker && input && root.GremierPlaces) picker = root.GremierPlaces.attach(input, { lang: () => (/[֐-׿]/.test(input.value) ? 'he' : 'en') });
    return picker;
  }
  function details() {
    const out = {};
    for (const [key, id] of Object.entries(DETAILS)) { const v = ($(id)?.value || '').trim(); if (v) out[key] = v; }
    return out;
  }
  root.GremierLinkAddress = {
    /** Fill the builder from a saved link (or clear it with null). */
    set(link) {
      const info = link?.address_info && typeof link.address_info === 'object' ? link.address_info : null, d = info?.address_details || {};
      for (const [key, id] of Object.entries(DETAILS)) { const el = $(id); if (el) el.value = d[key] || ''; }
      const text = info ? (info.address_entered || '') : (link?.delivery_address || '');
      const p = ensure();
      if (p) p.set({ text, place: info?.address_place || null });
      else if ($('plAddress')) $('plAddress').value = text;
    },
    /** { text, info }: the address line to save on the link, and its location + details (null when there are none). */
    read() {
      const p = ensure(), d = details();
      const v = p ? p.value() : { text: ($('plAddress')?.value || '').trim(), place: null };
      if (!v.text) return { text: null, info: null };
      const P = root.GremierPlaces;
      const text = P ? P.composeAddress(v, d) : v.text;
      const entered = P && v.place?.source === 'google' && v.place.label ? P.shortLabel(v.place) : v.text;
      const ready = !!(P && v.place && P.placeReady(v.place));
      return { text, info: ready || Object.keys(d).length ? { address_entered: entered, address_place: ready ? v.place : null, address_details: d } : null };
    },
  };
  // Attach once the page and the picker script are there.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure); else ensure();
})(window);

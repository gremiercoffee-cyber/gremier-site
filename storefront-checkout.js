/* Checkout layout: the existing form (every id and handler unchanged) arranged into
   clear sections, and a compact "Deliver to" card when this customer's details are
   already saved, so returning customers only check and pay. Loaded last, so it wraps
   the other openCheckout/submitOrder layers. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const he = () => typeof lang !== 'undefined' && lang === 'he';
  const T = (en, hebrew) => (he() ? hebrew : en);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const val = (id) => ($(id)?.value || '').trim();
  let editing = false;   // the customer asked to change saved details (until the page reloads)

  function section(cls, titleEn, titleHe) {
    const s = document.createElement('section');
    s.className = 'co-sec ' + cls;
    if (titleEn) s.innerHTML = `<h3 class="co-sec-title" data-en="${esc(titleEn)}" data-he="${esc(titleHe)}"></h3>`;
    return s;
  }

  // One-time: group the fields into sections. Nodes are moved, never recreated.
  function arrange() {
    const view = $('checkoutFormView');
    if (!view || view.dataset.arranged) return;
    const nameGroup = $('coName')?.closest('.form-group');
    const contactRow = $('coPhone')?.closest('.form-row');
    const addr = $('coDeliveryAddressFields');
    const ship = $('shipRegular')?.closest('.form-group');
    const notes = $('coNotes')?.closest('.form-group');
    const redeem = $('coRedeemCode')?.closest('.form-group');
    const sub = $('t-co-sub');
    if (!nameGroup || !contactRow || !addr || !ship || !notes || !redeem || !sub) return;
    view.dataset.arranged = '1';

    const saved = document.createElement('section');
    saved.className = 'co-sec co-saved';
    saved.id = 'coSavedCard';
    const details = section('co-details', 'Your details', 'הפרטים שלך');
    details.append(nameGroup, contactRow);
    const address = section('co-address', 'Delivery address', 'כתובת למשלוח');
    address.append(addr);
    const note = $('t-co-delivery-note');
    if (note) address.append(note);
    const delivery = section('co-delivery', 'Delivery', 'משלוח');
    delivery.append(ship);
    ship.querySelector('#t-co-ship')?.classList.add('co-hide');   // the section title says it

    // Notes and codes are rarely needed: one tap opens each.
    const extras = section('co-extras');
    for (const [group, en, heText, input] of [[redeem, 'Coupon or gift card', 'קופון או כרטיס מתנה', 'coRedeemCode'], [notes, 'Add a note', 'הוספת הערה', 'coNotes']]) {
      const d = document.createElement('details');
      d.className = 'co-more';
      d.innerHTML = `<summary data-en="${esc(en)}" data-he="${esc(heText)}"></summary>`;
      d.append(group);
      d.addEventListener('toggle', () => { if (d.open) setTimeout(() => $(input)?.focus(), 50); });
      extras.append(d);
    }
    sub.after(saved, details, address, delivery, extras);
    saved.addEventListener('click', (e) => { if (e.target.closest('[data-co-edit]')) edit(); });

    // A hidden field that receives focus (e.g. from the browser's autofill) opens the form.
    for (const s of [details, address]) s.addEventListener('focusin', () => { if (view.classList.contains('co-compact')) edit(false); });
  }

  function cityName() {
    const c = typeof selectedCheckoutCity !== 'undefined' ? selectedCheckoutCity : null;
    return c ? (he() ? (c.he || c.en) : (c.en || c.he)) : '';
  }
  function detailsComplete() {
    const pickup = $('shipPickup')?.checked;
    const okEmail = typeof isValidEmail === 'function' ? isValidEmail(val('coEmail')) : !!val('coEmail');
    const okPhone = typeof isValidPhone === 'function' ? isValidPhone(val('coPhone')) : !!val('coPhone');
    if (!val('coName') || !okEmail || !okPhone) return false;
    if (pickup) return true;
    return !!(val('coAddr') && cityName() && ($('coAptNA')?.checked || (val('coApt') && val('coFloor'))));
  }

  function render() {
    const view = $('checkoutFormView');
    if (!view || !view.dataset.arranged) return;
    // The delivery note belongs with the address (other scripts put it back under the phone).
    const note = $('t-co-delivery-note'), address = view.querySelector('.co-address');
    if (note && address && note.parentElement !== address) address.append(note);
    // Section titles / disclosure labels follow the language.
    view.querySelectorAll('[data-en]').forEach((el) => { el.textContent = he() ? el.dataset.he : el.dataset.en; });
    view.querySelectorAll('.co-more').forEach((d) => {
      const input = d.querySelector('input');
      if (input && input.value.trim() && !d.open) d.open = true;
      if (d.contains($('coRedeemCode')) && typeof appliedRedeem !== 'undefined' && appliedRedeem) d.open = true;
    });
    const compact = !editing && detailsComplete();
    view.classList.toggle('co-compact', compact);
    const card = $('coSavedCard');
    if (!compact) { card.innerHTML = ''; window.GremierAddresses?.decorate(); return; }
    const pickup = $('shipPickup')?.checked;
    const apt = $('coAptNA')?.checked ? '' : `, ${T('Apt', 'דירה')} ${esc(val('coApt'))}, ${T('Floor', 'קומה')} ${esc(val('coFloor'))}`;
    card.innerHTML = `
      <div class="co-saved-head"><span class="co-sec-title">${pickup ? T('Your details', 'הפרטים שלך') : T('Deliver to', 'משלוח אל')}</span>
        <button type="button" class="co-link" data-co-edit>${T('Edit', 'עריכה')}</button></div>
      <div class="co-saved-body">
        <b>${esc(val('coName'))}</b><span>${esc(val('coPhone'))} · ${esc(val('coEmail'))}</span>
        ${pickup ? '' : `<span>${esc(val('coAddr'))}${apt}, ${esc(cityName())}</span>`}
      </div>`;
    window.GremierAddresses?.decorate();
    const subEl = $('t-co-sub');
    if (subEl) subEl.dataset.compact = '1';
  }
  window.GremierCheckout = { render, edit };

  function edit(focus = true) {
    editing = true;
    render();
    if (focus) setTimeout(() => { $('coName')?.focus(); $('coName')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30);
  }

  // Wrap the outermost layers: arrange, then decide compact vs full after details are filled in.
  const open = window.openCheckout;
  if (typeof open === 'function') window.openCheckout = async function () {
    arrange();
    const r = await open.apply(this, arguments);
    render();
    // City lookup / saved details can land a moment later.
    setTimeout(render, 400);
    return r;
  };
  const submit = window.submitOrder;
  if (typeof submit === 'function') window.submitOrder = async function () {
    // Never hide a problem: anything missing or invalid opens the full form first.
    if ($('checkoutFormView')?.classList.contains('co-compact') && !detailsComplete()) edit(false);
    const btn = $('t-co-submit');
    if (btn?.classList.contains('is-loading')) return;   // already on its way
    btn?.classList.add('is-loading');
    let handedOff = false;
    try {
      const r = await submit.apply(this, arguments);
      handedOff = !!window.__gremierPayHandoff;
      return r;
    } finally {
      if (handedOff && btn) {
        // PayMe is loading: keep the spinner and stay disabled until the page leaves.
        btn.disabled = true;
        btn.textContent = T('Opening secure payment…', 'פותחים תשלום מאובטח…');
      } else btn?.classList.remove('is-loading');
    }
  };
  // Back from PayMe: the button is usable again.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    const btn = $('t-co-submit');
    if (!btn) return;
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.textContent = T('Proceed to Payment', 'המשך לתשלום');
  });
  // Switching to pickup / delivery changes what "complete" means.
  document.addEventListener('change', (e) => { if (e.target?.name === 'shipType' || e.target?.id === 'coAptNA') render(); });
  const apply = window.applyTranslations;
  if (typeof apply === 'function') window.applyTranslations = function () { const r = apply.apply(this, arguments); try { render(); } catch (_) {} return r; };
})();

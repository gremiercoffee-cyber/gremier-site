/* Refund an order from its order card: money back through PayMe (any amount, several times), then the
   חשבונית זיכוי from FinBot against the order's tax invoice, and optionally an email to the customer.
   Nothing moves until the review step is confirmed. Server: supabase/functions/order-refunds.
   Uses the admin page's globals (callAdminFunction, escHtml, showToast, loadOrders, openOrderDetail). */
(function (root) {
  'use strict';
  const money = (minor) => '₪' + (Number(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const ERR = {
    payme_minimum_5: 'PayMe can’t refund less than ₪5 at a time (unless it’s the whole payment).',
    more_than_left: 'That’s more than is left to refund.',
    invalid_amount: 'Enter an amount.',
    refund_needs_review: 'An earlier refund on this order has no clear answer from PayMe. Check it in PayMe first.',
    refund_in_progress: 'A refund for this order is already in progress.',
    invoice_number_required: 'Enter the number of the order’s tax invoice (from FinBot).',
    order_not_paid: 'This order isn’t paid.',
    payment_verification_required: 'PayMe’s payment doesn’t match this order’s total, so it can’t be refunded from here. Use PayMe.',
    payme_sale_not_found: 'PayMe couldn’t find this payment.',
    payme_sale_not_refundable: 'This payment can’t be refunded in PayMe (already fully refunded?).',
    missing_payment_reference: 'This order has no PayMe payment linked.',
    unsupported_payment_method: 'Only card payments through PayMe can be refunded here.',
    gift_card_review_required: 'Orders paid partly by gift card are refunded in PayMe directly.',
    finbot_link_not_found: 'FinBot still can’t link a credit invoice to this tax invoice. Make it in FinBot by hand.',
    finbot_check_failed: 'FinBot didn’t accept the credit invoice check. Nothing was created.',
  };
  const say = (code) => ERR[code] || `Couldn’t refund (${code || 'unknown error'}).`;
  const creditLine = (r) => ({
    not_needed: '', pending: 'Credit invoice not made yet', issuing: 'Credit invoice: no clear answer from FinBot — check FinBot before retrying',
    issued: `Credit invoice ${r.credit_document_number ? '#' + r.credit_document_number : ''}${r.credit_error ? ' · check it: ' + r.credit_error : ''}`,
    rejected: r.credit_error === 'finbot_link_not_found' ? `Credit invoice not made: FinBot can’t link it automatically yet. Make it in FinBot: חשבונית זיכוי ${money(r.amount_minor)} against #${r.linked_document_number}` : `FinBot refused the credit invoice (${r.credit_error || ''}) — nothing was created`, needs_review: `Credit invoice unclear (${r.credit_error || ''}) — check FinBot before doing anything`,
  })[r.credit_status] ?? '';
  const statusLine = (r) => ({ refunded: 'Refunded', failed: `PayMe refused: ${r.payme_detail || ''} — no money moved`, needs_review: `No clear answer from PayMe (${r.payme_detail || ''}) — check PayMe; don’t refund again until you do`, refunding: 'Sending to PayMe…' })[r.status] || r.status;

  let modal = null, state = null;
  const close = () => { modal?.remove(); modal = null; state = null; };
  const box = (html) => {
    if (!modal) { modal = document.createElement('div'); modal.className = 'modal-backdrop open'; modal.addEventListener('click', (e) => { if (e.target === modal && !state?.busy) close(); }); document.body.appendChild(modal); }
    modal.innerHTML = `<div class="modal-box" style="max-width:460px">${html}</div>`;
  };
  const p = (t, extra = '') => `<p style="color:var(--text2);font-size:.85rem;line-height:1.5;margin:0 0 10px;${extra}">${t}</p>`;

  function history(refunds) {
    if (!refunds.length) return '';
    return `<div style="border-top:1px solid var(--border,#333);margin-top:14px;padding-top:10px">
      <div style="font-weight:600;font-size:.85rem;margin-bottom:6px">Refunds on this order</div>
      ${refunds.map((r) => `<div style="font-size:.8rem;line-height:1.5;margin-bottom:8px">
        <strong>${money(r.amount_minor)}</strong> · ${new Date(r.created_at).toLocaleDateString('en-GB')} · ${escHtml(statusLine(r))}${r.reason ? ' · ' + escHtml(r.reason) : ''}
        ${creditLine(r) ? `<br><span style="color:var(--text2)">${escHtml(creditLine(r))}</span>` : ''}
        ${r.email_sent_at ? '<br><span style="color:var(--text2)">Customer emailed</span>' : r.email_error ? `<br><span style="color:var(--text2)">Email failed: ${escHtml(r.email_error)}</span>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
          ${r.credit_pdf_path ? `<button class="btn btn-outline btn-sm" data-act="pdf" data-id="${r.id}">Credit invoice PDF</button>` : ''}
          ${r.status === 'refunded' && ['rejected', 'pending'].includes(r.credit_status) ? `<button class="btn btn-outline btn-sm" data-act="retry_credit" data-id="${r.id}">Make credit invoice</button>` : ''}
          ${r.status === 'refunded' && state.preview.order.has_email && !r.email_sent_at ? `<button class="btn btn-outline btn-sm" data-act="email" data-id="${r.id}">Email customer</button>` : ''}
        </div></div>`).join('')}
    </div>`;
  }

  function docText(d, amountTxt) {
    if (d.kind === 'credit') return d.invoice_number
      ? `A <strong>חשבונית זיכוי</strong> for ${amountTxt} is made in FinBot against tax invoice <strong>#${escHtml(d.invoice_number)}</strong>.`
      : `A <strong>חשבונית זיכוי</strong> is made in FinBot. Its tax invoice number couldn’t be read — type it:`;
    return { receipt_before_vat: 'No credit invoice: this order was paid before 22 Oct (קבלה, before VAT). Only the money is refunded.',
      no_receipt: 'No credit invoice: this order has no FinBot document. Only the money is refunded.',
      receipt_not_ready: 'No credit invoice: this order’s FinBot document isn’t issued yet. Only the money is refunded.' }[d.why] || '';
  }

  const manualCredit = () => state?.preview?.document?.kind === 'credit' && state.preview.credit_check && !state.preview.credit_check.ready;

  function form() {
    const { preview: v } = state, o = v.order, plan = v.plan, d = v.document;
    const card = v.sale.card_last4 ? ` on the card ending ${escHtml(v.sale.card_last4)}` : '';
    if (plan.left_minor <= 0 || plan.blocked) {
      box(`<h2 class="modal-title">Refund order #${escHtml(o.order_number)}</h2>
        ${p(plan.blocked ? say(plan.blocked) : `Fully refunded: ${money(plan.refunded_minor)}.`)}
        ${history(v.refunds)}
        <div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-outline" data-act="close">Close</button></div>`);
      return;
    }
    box(`<h2 class="modal-title">Refund order #${escHtml(o.order_number)}</h2>
      ${p(`${escHtml(o.customer_name || '')} paid <strong>${money(plan.sale_minor)}</strong>${card}.${plan.refunded_minor ? ` Already refunded ${money(plan.refunded_minor)}; <strong>${money(plan.left_minor)}</strong> left.` : ''}`)}
      <label style="display:block;font-size:.8rem;margin-bottom:4px">Amount to refund (₪)</label>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="rfAmount" class="form-input" type="number" inputmode="decimal" min="5" step="0.01" max="${plan.left_minor / 100}" placeholder="e.g. 40" style="flex:1">
        <button class="btn btn-outline btn-sm" data-act="all">All ${money(plan.left_minor)}</button>
      </div>
      <label style="display:block;font-size:.8rem;margin-bottom:4px">Reason (optional, printed on the credit invoice)</label>
      <input id="rfReason" class="form-input" maxlength="150" placeholder="e.g. one bottle arrived damaged" style="margin-bottom:10px">
      ${manualCredit() ? '' : p(docText(d, 'the amount'))}
      ${manualCredit() ? p('⚠ FinBot can’t link a credit invoice to this tax invoice automatically yet. The money refund works; afterwards make the חשבונית זיכוי in FinBot by hand (the window tells you the amount and invoice).', 'color:var(--cream)') : ''}
      ${d.kind === 'credit' && !d.invoice_number ? `<input id="rfInvoice" class="form-input" inputmode="numeric" placeholder="Tax invoice number, e.g. 30019" style="margin-bottom:10px">` : ''}
      ${o.has_email ? `<label style="display:flex;gap:8px;align-items:center;font-size:.85rem;margin-bottom:12px"><input id="rfEmail" type="checkbox" checked> Email the customer${d.kind === 'credit' && !manualCredit() ? ' the credit invoice' : ''}</label>` : p('No customer email on this order.')}
      <div style="display:flex;gap:10px"><button class="btn btn-outline" data-act="close">Cancel</button><button class="btn btn-amber" data-act="review">Review</button></div>
      ${history(v.refunds)}`);
  }

  function review() {
    const v = state.preview, plan = v.plan, d = v.document;
    const amount = Math.round(Number(document.getElementById('rfAmount')?.value) * 100);
    if (!Number.isFinite(amount) || amount <= 0) return showToast(say('invalid_amount'));
    if (amount > plan.left_minor) return showToast(say('more_than_left'));
    if (amount < 500 && !(plan.untouched && amount === plan.sale_minor)) return showToast(say('payme_minimum_5'));
    const invoice = (document.getElementById('rfInvoice')?.value || '').trim();
    if (d.kind === 'credit' && !d.invoice_number && !/^\d{1,12}$/.test(invoice)) return showToast(say('invoice_number_required'));
    state.req = { id: crypto.randomUUID(), order_id: v.order.id, amount_minor: amount, reason: (document.getElementById('rfReason')?.value || '').trim(),
      email_customer: !!document.getElementById('rfEmail')?.checked, invoice_number: invoice || undefined, confirm: true };
    const card = v.sale.card_last4 ? `the card ending ${escHtml(v.sale.card_last4)}` : 'the customer’s card';
    const number = d.invoice_number || invoice;
    box(`<h2 class="modal-title">Confirm refund</h2>
      <ul style="font-size:.9rem;line-height:1.7;margin:0 0 14px;padding-inline-start:18px">
        <li>Refund <strong>${money(amount)}</strong> to ${card} through PayMe${plan.untouched && amount === plan.sale_minor ? ' (the whole payment)' : ''}</li>
        ${d.kind === 'credit' && manualCredit() ? `<li>Credit invoice: <strong>you make it in FinBot</strong> — חשבונית זיכוי ${money(amount)} against #${escHtml(number)}</li>` : d.kind === 'credit' ? `<li>חשבונית זיכוי for <strong>${money(amount)}</strong> (VAT included) against tax invoice #${escHtml(number)}</li>` : `<li>${escHtml(docText(d).replace(/<[^>]+>/g, ''))}</li>`}
        ${state.req.email_customer ? '<li>Email the customer</li>' : ''}
        ${amount === plan.left_minor ? '<li>The order is marked Refunded</li>' : ''}
      </ul>
      ${p(d.kind === 'credit' && !manualCredit() ? 'This sends real money back and makes an official document. It can’t be undone.' : 'This sends real money back. It can’t be undone.', 'color:var(--cream)')}
      <div style="display:flex;gap:10px"><button class="btn btn-outline" data-act="back">Back</button><button class="btn btn-amber" data-act="confirm">Refund ${money(amount)}</button></div>`);
  }

  async function confirm() {
    state.busy = true;
    box(`<h2 class="modal-title">Refunding…</h2>${p('Sending to PayMe, then FinBot. Don’t close this window.')}`);
    let data;
    try { ({ data } = await callAdminFunction('order-refunds', { action: 'refund', ...state.req })); } catch (e) { data = { error: 'no_response' }; }
    state.busy = false;
    if (data?.error) {
      box(`<h2 class="modal-title">Not refunded</h2>${p(escHtml(say(data.error)))}${data.error === 'no_response' ? p('The page lost contact with the server. Open the refund window again to see whether it went through before trying again.') : ''}
        <div style="display:flex;gap:10px"><button class="btn btn-outline" data-act="close">Close</button></div>`);
      return;
    }
    const r = data.refund;
    const good = data.refunded && ['issued', 'not_needed'].includes(r.credit_status) && !r.credit_error;
    const manual = r.credit_status === 'rejected' && r.credit_error === 'finbot_link_not_found';
    box(`<h2 class="modal-title">${data.refunded ? (good ? 'Refunded ✓' : manual ? 'Refunded ✓ — credit invoice by hand' : 'Refunded — one thing to check') : data.refused ? 'PayMe refused the refund' : 'Check PayMe'}</h2>
      ${p(escHtml(statusLine(r)))}
      ${creditLine(r) ? p(escHtml(creditLine(r))) : ''}
      ${r.email_sent_at ? p('Customer emailed.') : r.email_error ? p('Email failed: ' + escHtml(r.email_error)) : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${r.credit_pdf_path ? `<button class="btn btn-outline" data-act="pdf" data-id="${r.id}">Credit invoice PDF</button>` : ''}
        <button class="btn btn-amber" data-act="done">Done</button>
      </div>`);
    if (data.refunded) showToast(`Refunded ${money(r.amount_minor)} ✓`);
  }

  async function act(name, id) {
    if (name === 'pdf') {
      const w = window.open('', '_blank');
      const { data } = await callAdminFunction('order-refunds', { action: 'pdf', id });
      if (data?.url) { if (w) w.location = data.url; else window.open(data.url, '_blank'); } else { w?.close(); showToast('PDF not available'); }
      return;
    }
    showToast(name === 'email' ? 'Sending…' : 'Making the credit invoice…');
    const { data } = await callAdminFunction('order-refunds', { action: name, id });
    if (data?.error) return showToast(say(data.error));
    showToast(name === 'email' ? (data.refund?.email_sent_at ? 'Customer emailed ✓' : 'Email failed') : (data.refund?.credit_status === 'issued' ? 'Credit invoice made ✓' : creditLine(data.refund)));
    await open(state.preview.order.id);
  }

  async function open(orderId) {
    state = { orderId, busy: false };
    box(`<h2 class="modal-title">Refund</h2>${p('Checking the payment in PayMe…')}`);
    let data;
    try { ({ data } = await callAdminFunction('order-refunds', { action: 'preview', order_id: orderId })); } catch { data = { error: 'no_response' }; }
    if (!state) return;
    if (data?.error) {
      box(`<h2 class="modal-title">Can’t refund here</h2>${p(escHtml(say(data.error)))}<div style="display:flex;gap:10px"><button class="btn btn-outline" data-act="close">Close</button></div>`);
      return;
    }
    state.preview = data;
    form();
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-act]');
    if (!b || !modal || !modal.contains(b) || state?.busy) return;
    const a = b.dataset.act;
    if (a === 'close') close();
    else if (a === 'done') { const id = state.orderId; close(); try { loadOrders?.(); } catch { /* list refresh is best effort */ } if (document.getElementById('orderModal')?.classList.contains('open')) setTimeout(() => root.openOrderDetail?.(id), 600); }
    else if (a === 'all') { const i = document.getElementById('rfAmount'); if (i) i.value = (state.preview.plan.left_minor / 100).toFixed(2).replace(/\.00$/, ''); }
    else if (a === 'review') review();
    else if (a === 'back') form();
    else if (a === 'confirm') confirm();
    else act(a, b.dataset.id);
  });

  root.GremierRefunds = { open };
})(window);

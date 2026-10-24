// supabase/functions/issue-gift-card/index.ts
// Issues a gift card. Two modes:
//   1. order_id  → called server-side after a gift-card PURCHASE order is paid.
//   2. admin     → admin manually issues a card (requires admin bearer token).
// Emails the card to the recipient (in the buyer's site language), and a copy to the buyer.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isServiceOrAdmin } from '../_shared/security.ts';
import { pushToCustomer } from '../_shared/customer-push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

function getServiceRoleKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;

  try {
    const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
    if (!raw) return '';
    const keys = JSON.parse(raw) as Record<string, unknown>;
    return String(keys.default || keys.service_role || Object.values(keys)[0] || '');
  } catch {
    return '';
  }
}

const SERVICE_KEY = getServiceRoleKey();
const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const FROM_EMAIL =
  Deno.env.get('GIFT_FROM_EMAIL') ||
  'Gremier Coffee <orders@gremiercoffee.co.il>';

const SITE_URL =
  (Deno.env.get('SITE_URL') || 'https://gremiercoffee.co.il').replace(/\/$/, '');

const LOGO_URL =
  Deno.env.get('GIFT_CARD_LOGO_URL') ||
  `${SITE_URL}/logo.png`;

const ADMIN_EMAILS = ['gremiercoffee@gmail.com', 'yonigrey@gmail.com'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatAmount(amount: number): string {
  const clean = Number(amount) || 0;
  return `₪${clean.toFixed(clean % 1 === 0 ? 0 : 2)}`;
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing I/O/0/1
  const block = () => {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => alphabet[byte % alphabet.length])
      .join('');
  };

  return `GIFT-${block()}-${block()}`;
}

type GiftEmail = {
  code: string;
  amount: number;
  recipientName?: string | null;
  senderName?: string | null;
  message?: string | null;
  he: boolean;
};

const redeemUrl = (code: string) => `${SITE_URL}/?gift=${encodeURIComponent(code)}&utm_source=gift_card`;

function words(o: GiftEmail) {
  const he = o.he;
  const to = o.recipientName?.trim();
  const from = o.senderName?.trim();
  return {
    subject: he
      ? `קיבלת כרטיס מתנה של גרמיר${from ? ` מאת ${from}` : ''} 🎁`
      : `${from ? `${from} sent you` : "You've received"} a Gremier gift card 🎁`,
    hello: he ? (to ? `${to}, יש לך מתנה!` : 'יש לך מתנה!') : (to ? `${to}, you've got a gift!` : "You've got a gift!"),
    lead: he
      ? `קיבלת${from ? ` מאת ${from}` : ''} כרטיס מתנה של ${formatAmount(o.amount)} לקולד ברו של גרמיר.`
      : `${from ? `${from} sent you` : "You've received"} a ${formatAmount(o.amount)} gift card for Gremier cold brew.`,
    label: he ? 'כרטיס מתנה' : 'Gift card',
    toLabel: he ? 'אל' : 'To',
    fromLabel: he ? 'מאת' : 'From',
    codeLabel: he ? 'קוד הכרטיס' : 'Your code',
    cta: he ? 'לבחירת קולד ברו' : 'Choose your cold brew',
    how: he
      ? 'הכפתור פותח את האתר עם הכרטיס שמור, והוא מופעל לבד בקופה. אפשר גם להזין את הקוד ידנית בשדה "קופון או כרטיס מתנה".'
      : 'The button opens the site with your card saved, and it applies by itself at checkout. You can also type the code into "Coupon or gift card".',
    terms: he
      ? 'הכרטיס לא פג תוקף. לא חייבים להשתמש בכולו בבת אחת: היתרה נשמרת להזמנה הבאה.'
      : "Your card never expires. You don't have to use it all at once: the balance stays for next time.",
    sign: he ? 'גרמיר קופי · קולד ברו טרי עד הבית' : 'Gremier Coffee · Fresh cold brew, delivered',
  };
}

function buildGiftCardEmailHtml(o: GiftEmail) {
  const w = words(o);
  const dir = o.he ? 'rtl' : 'ltr';
  const align = o.he ? 'right' : 'left';
  const message = o.message ? escapeHtml(o.message).replace(/\n/g, '<br>') : '';
  const url = escapeHtml(redeemUrl(o.code));
  return `<!doctype html>
<html dir="${dir}" lang="${o.he ? 'he' : 'en'}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
  <body style="margin:0;padding:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(w.lead)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:28px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto" dir="${dir}">
          <tr><td style="text-align:center;padding:0 0 20px">
            <img src="${escapeHtml(LOGO_URL)}" width="56" height="56" alt="Gremier Coffee Co." style="display:inline-block;border-radius:50%">
          </td></tr>
          <tr><td style="text-align:center;padding:0 8px 6px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:bold">${escapeHtml(w.hello)}</td></tr>
          <tr><td style="text-align:center;padding:0 12px 24px;font-size:15px;line-height:1.6;color:#4a4a4a">${escapeHtml(w.lead)}</td></tr>

          <!-- The card -->
          <tr><td style="padding:0 0 24px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-radius:20px;background:#15110e;background-image:linear-gradient(135deg,#3a2a1a 0%,#1c1714 50%,#0d0b0a 100%);color:#f4efe8">
              <tr><td style="padding:22px 24px 6px;text-align:${align}">
                <table role="presentation" cellspacing="0" cellpadding="0" dir="ltr" style="${o.he ? 'margin-left:auto' : ''}"><tr>
                  <td style="padding-right:10px"><img src="${escapeHtml(LOGO_URL)}" width="34" height="34" alt="" style="display:block;border-radius:50%;background:#ffffff"></td>
                  <td style="font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#f4efe8">Gremier Coffee Co.</td>
                </tr></table>
              </td></tr>
              <tr><td style="padding:34px 24px 0;text-align:${align};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#c8873a">${escapeHtml(w.label)}</td></tr>
              <tr><td style="padding:2px 24px 14px;text-align:${align};font-family:Georgia,'Times New Roman',serif;font-size:52px;line-height:1.05;font-weight:bold;color:#ffffff">${escapeHtml(formatAmount(o.amount))}</td></tr>
              ${o.recipientName || o.senderName ? `<tr><td style="padding:0 24px 20px;text-align:${align};font-size:13px;color:#cbbfb2">
                ${o.recipientName ? `${escapeHtml(w.toLabel)}: <b style="color:#f4efe8;font-weight:normal">${escapeHtml(o.recipientName)}</b>` : ''}
                ${o.recipientName && o.senderName ? '&nbsp;&nbsp;·&nbsp;&nbsp;' : ''}
                ${o.senderName ? `${escapeHtml(w.fromLabel)}: <b style="color:#f4efe8;font-weight:normal">${escapeHtml(o.senderName)}</b>` : ''}
              </td></tr>` : '<tr><td style="padding:0 0 8px"></td></tr>'}
              <tr><td style="padding:0 16px 16px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe8;border-radius:12px">
                  <tr><td style="padding:12px 14px;text-align:center">
                    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8a7c6e;margin-bottom:4px">${escapeHtml(w.codeLabel)}</div>
                    <div dir="ltr" style="font-family:'Courier New',Courier,monospace;font-size:22px;letter-spacing:3px;font-weight:bold;color:#1a1a1a">${escapeHtml(o.code)}</div>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </td></tr>

          ${message ? `<tr><td style="padding:0 0 24px">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:14px;border:1px solid #e7e0d6">
              <tr><td style="padding:18px 20px;text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.55;color:#2a2a2a;font-style:italic">${o.he ? message : `“${message}”`}
                ${o.senderName ? `<div style="font-family:Arial,Helvetica,sans-serif;font-style:normal;font-size:13px;color:#8a8f96;margin-top:8px">${escapeHtml(o.senderName)}</div>` : ''}
              </td></tr>
            </table>
          </td></tr>` : ''}

          <tr><td style="text-align:center;padding:0 0 18px">
            <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:999px;font-size:15px;font-weight:bold">${escapeHtml(w.cta)}</a>
          </td></tr>
          <tr><td style="text-align:center;padding:0 16px 8px;font-size:13px;line-height:1.6;color:#6b7178">${escapeHtml(w.how)}</td></tr>
          <tr><td style="text-align:center;padding:0 16px 26px;font-size:13px;line-height:1.6;color:#6b7178">${escapeHtml(w.terms)}</td></tr>
          <tr><td style="text-align:center;border-top:1px solid #e2dbd1;padding:18px 16px 0;font-size:12px;color:#9a9188">
            ${escapeHtml(w.sign)}<br><a href="${escapeHtml(SITE_URL)}" style="color:#9a9188">gremiercoffee.co.il</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildGiftCardEmailText(o: GiftEmail) {
  const w = words(o);
  return [
    w.hello,
    '',
    w.lead,
    o.message ? `\n“${o.message}”${o.senderName ? ` (${o.senderName})` : ''}\n` : '',
    `${w.codeLabel}: ${o.code}`,
    '',
    `${w.cta}: ${redeemUrl(o.code)}`,
    '',
    w.how,
    w.terms,
    '',
    w.sign,
  ].join('\n');
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html, text }),
  });
  if (!res.ok) console.error('Resend gift card email failed:', res.status, await res.text());
  return res.ok;
}

async function sendGiftEmail(to: string | null | undefined, o: GiftEmail) {
  if (!RESEND_KEY || !to) return false;
  return await sendEmail(to, words(o).subject, buildGiftCardEmailHtml(o), buildGiftCardEmailText(o));
}

/** The buyer gets a copy of what was sent (their payment receipt comes separately). */
async function sendBuyerCopy(buyer: string | null | undefined, recipient: string, o: GiftEmail) {
  if (!RESEND_KEY || !buyer || buyer.toLowerCase() === recipient.toLowerCase()) return false;
  const who = o.recipientName?.trim() || recipient;
  const subject = o.he ? `כרטיס המתנה נשלח אל ${who} 🎁` : `Your gift card was sent to ${who} 🎁`;
  const note = o.he
    ? `שלחנו את כרטיס המתנה של ${formatAmount(o.amount)} אל ${escapeHtml(who)} (${escapeHtml(recipient)}). כך זה נראה אצלם:`
    : `We've emailed your ${formatAmount(o.amount)} gift card to ${escapeHtml(who)} (${escapeHtml(recipient)}). Here's what they got:`;
  const html = buildGiftCardEmailHtml(o).replace(
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:28px 12px">',
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:20px 12px 0"><tr><td align="center"><div dir="${o.he ? 'rtl' : 'ltr'}" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e0d6;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.55;color:#3a3a3a;text-align:center">${note}</div></td></tr></table>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:28px 12px">`,
  );
  const text = `${note.replace(/&[^;]+;/g, '')}\n\n${buildGiftCardEmailText(o)}`;
  return await sendEmail(buyer, subject, html, text);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json();
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Mode 1: from a paid purchase order ──
    if (body.order_id) {
      const { data: order } = await sb
        .from('orders')
        .select('*')
        .eq('id', body.order_id)
        .maybeSingle();

      if (!order) return json({ error: 'order_not_found' }, 404);
      if (order.payment_status !== 'paid') return json({ skipped: 'not_paid' });
      // Only genuine gift card purchases (created server-side by create-gift-card-order).
      // Without this, any paid order carrying a client-written gift_card.amount could mint
      // a card worth far more than was paid.
      if (order.source !== 'gift_card') return json({ error: 'not_a_gift_card_order' }, 403);

      // Idempotency: already issued for this order?
      const { data: existing } = await sb
        .from('gift_cards')
        .select('id, code')
        .eq('purchase_order_id', order.id)
        .maybeSingle();

      // Mode 1 is callable without login — never hand the card code to an anonymous caller.
      if (existing) return json({ ok: true, already: true });

      // Gift card details come from order.delivery_info.gift_card
      const gcInfo = order.delivery_info?.gift_card || {};
      const he = order.delivery_info?.site_lang
        ? order.delivery_info.site_lang === 'he'
        : /[֐-׿]/.test(`${gcInfo.recipient_name || ''} ${gcInfo.sender_name || ''} ${gcInfo.message || ''}`);

      // The card is worth exactly what was paid for it.
      const amount = Number(order.total) || 0;

      if (!amount || amount <= 0) {
        return json({ error: 'invalid_gift_card_amount' }, 400);
      }

      const code = makeCode();

      const { data: card, error } = await sb
        .from('gift_cards')
        .insert({
          code,
          initial_amount: amount,
          balance: amount,
          purchased_by_email: order.customer_email || null,
          purchased_by_user: order.user_id || null,
          recipient_email: gcInfo.recipient_email || order.customer_email || null,
          recipient_name: gcInfo.recipient_name || null,
          sender_name: gcInfo.sender_name || null,
          message: gcInfo.message || null,
          lang: he ? 'he' : 'en',
          purchase_order_id: order.id,
        })
        .select('*')
        .single();

      if (error) return json({ error: error.message }, 400);

      const mail: GiftEmail = { code, amount, recipientName: card.recipient_name, senderName: card.sender_name, message: card.message, he };
      const emailed = await sendGiftEmail(card.recipient_email, mail);
      if (emailed) await sendBuyerCopy(order.customer_email, card.recipient_email, mail);
      // The shop app, for whoever has it: the recipient, and the buyer.
      await pushToCustomer(sb, { email: card.recipient_email }, {
        he: { title: '🎁 קיבלת כרטיס מתנה של ' + formatAmount(amount), body: (card.sender_name ? 'מאת ' + card.sender_name + '. ' : '') + 'לחיצה, והוא מחכה לך בקופה.' },
        en: { title: '🎁 You got a ' + formatAmount(amount) + ' gift card', body: (card.sender_name ? 'From ' + card.sender_name + '. ' : '') + 'Tap and it’s waiting for you at checkout.' },
        url: '/?gift=' + encodeURIComponent(code), tag: 'gift-' + card.id,
      });
      if (emailed && order.customer_email && order.customer_email.toLowerCase() !== String(card.recipient_email).toLowerCase()) {
        const who = card.recipient_name || card.recipient_email;
        await pushToCustomer(sb, { email: order.customer_email, userId: order.user_id }, {
          he: { title: '🎁 כרטיס המתנה נשלח', body: 'שלחנו אותו אל ' + who + '.' },
          en: { title: '🎁 Your gift card was sent', body: 'We emailed it to ' + who + '.' },
          url: '/#giftcards', tag: 'gift-sent-' + card.id,
        });
      }

      return json({ ok: true, amount, emailed });
    }

    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    // ── Preview (server or admin): sample emails to a test address; no card is created ──
    if (body.preview_to && await isServiceOrAdmin(req)) {
      const sample = { code: 'GIFT-SAMP-LE23', amount: Number(body.amount) || 150, recipientName: body.recipient_name ?? 'Dana', senderName: body.sender_name ?? 'Yoni', message: body.message ?? 'Happy birthday! Enjoy a coffee on me ☕' };
      const to = String(body.preview_to);
      const he = await sendGiftEmail(to, { ...sample, recipientName: body.recipient_name ?? 'דנה', senderName: body.sender_name ?? 'יוני', message: body.message ?? 'יום הולדת שמח! קפה עליי ☕', he: true });
      const en = await sendGiftEmail(to, { ...sample, he: false });
      const copy = await sendBuyerCopy(to, 'friend@example.com', { ...sample, he: false });
      return json({ ok: true, he, en, buyer_copy: copy });
    }

    // ── Mode 2: admin manual issue ──

    const {
      data: { user },
    } = await sb.auth.getUser(token);

    if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
      return json({ error: 'admin_only' }, 403);
    }

    const amount = Number(body.amount);
    if (!amount || amount <= 0) return json({ error: 'invalid_amount' }, 400);

    const code = body.code || makeCode();
    const he = body.lang ? body.lang === 'he' : /[֐-׿]/.test(`${body.recipient_name || ''} ${body.message || ''}`);

    const { data: card, error } = await sb
      .from('gift_cards')
      .insert({
        code,
        initial_amount: amount,
        balance: amount,
        purchased_by_email: user.email,
        recipient_email: body.recipient_email || null,
        recipient_name: body.recipient_name || null,
        sender_name: body.sender_name || null,
        message: body.message || null,
        lang: he ? 'he' : 'en',
        expires_at: body.expires_at || null,
      })
      .select('*')
      .single();

    if (error) return json({ error: error.message }, 400);

    let emailed = false;

    if (body.recipient_email) {
      emailed = await sendGiftEmail(body.recipient_email, { code, amount, recipientName: body.recipient_name, senderName: body.sender_name, message: body.message, he });
    }

    return json({ ok: true, code, amount, emailed });
  } catch (err) {
    console.error('issue-gift-card server error:', err);
    return json({ error: 'server_error', message: String(err) }, 500);
  }
});

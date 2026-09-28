// supabase/functions/issue-gift-card/index.ts
// Issues a gift card. Two modes:
//   1. order_id  → called server-side after a gift-card PURCHASE order is paid.
//   2. admin     → admin manually issues a card (requires admin bearer token).
// Emails the code to the recipient via Resend.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function buildGiftCardEmailHtml(opts: {
  code: string;
  amount: number;
  recipientName?: string | null;
  message?: string | null;
}) {
  const amountText = formatAmount(opts.amount);
  const code = escapeHtml(opts.code);
  const name = opts.recipientName ? `Hi ${escapeHtml(opts.recipientName)},` : 'Hi,';
  const message = opts.message ? escapeHtml(opts.message) : '';

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:24px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #ded6cc">
            <tr>
              <td style="padding:26px 22px 18px;text-align:center;background:#141414;color:#efefef">
                <img src="${escapeHtml(LOGO_URL)}" width="78" height="78" alt="Gremier Coffee Co." style="display:block;margin:0 auto 10px;border-radius:50%;object-fit:contain">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.2;font-weight:bold;letter-spacing:.02em">
                  Gremier Coffee Co.
                </div>
                <div style="margin-top:8px;font-size:11px;letter-spacing:2.6px;text-transform:uppercase;color:#cfcfcf">
                  Premium Cold Brew Gift Card
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 22px 10px">
                <p style="margin:0 0 14px;font-size:16px;line-height:1.55">${name}</p>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#3a3a3a">
                  You've received a Gremier Coffee gift card. Use the code below at checkout.
                </p>

                <!-- Gift card graphic -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:0 auto 24px">
                  <tr>
                    <td style="
                      background:#111111;
                      background-image:linear-gradient(135deg,#202020 0%,#111111 48%,#050505 100%);
                      border:1px solid #696969;
                      border-radius:22px;
                      padding:24px 22px;
                      box-shadow:0 18px 35px rgba(0,0,0,.22);
                      color:#efefef;
                    ">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                        <tr>
                          <td width="34%" valign="middle" style="padding-right:18px;text-align:center">
                            <img src="${escapeHtml(LOGO_URL)}" width="124" height="124" alt="Gremier Coffee Co." style="display:block;margin:0 auto;max-width:124px;width:100%;height:auto;object-fit:contain;filter:grayscale(100%)">
                          </td>

                          <td width="66%" valign="middle" style="text-align:center">
                            <div style="font-family:Georgia,'Times New Roman',serif;font-size:40px;line-height:1;color:#f2f2f2;letter-spacing:.02em">
                              Gift Card
                            </div>

                            <div style="font-family:Georgia,'Times New Roman',serif;font-size:58px;line-height:1.05;color:#ffffff;margin:18px 0 8px;font-weight:bold">
                              ${escapeHtml(amountText)}
                            </div>

                            <div style="font-size:12px;letter-spacing:2.3px;text-transform:uppercase;color:#cfcfcf;margin-bottom:18px">
                              A gift of premium cold brew
                            </div>

                            <div style="
                              border:1px solid rgba(255,255,255,.22);
                              border-radius:12px;
                              padding:15px 12px;
                              background:rgba(255,255,255,.035);
                            ">
                              <div style="font-size:11px;letter-spacing:2.2px;text-transform:uppercase;color:#bfbfbf;margin-bottom:8px">
                                Gift card code
                              </div>
                              <div style="font-family:'Courier New',Courier,monospace;font-size:23px;letter-spacing:3px;font-weight:bold;color:#ffffff;word-break:break-word">
                                ${code}
                              </div>
                            </div>

                            <div style="font-size:11px;letter-spacing:2.2px;text-transform:uppercase;color:#a8a8a8;margin-top:18px">
                              Redeem at gremiercoffee.co.il
                            </div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                ${
                  message
                    ? `<div style="background:#f7f5f2;border-left:4px solid #141414;padding:14px 16px;border-radius:8px;margin:0 0 22px;color:#333;font-size:15px;line-height:1.55;font-style:italic">
                        “${message}”
                      </div>`
                    : ''
                }

                <p style="font-size:14px;color:#555;line-height:1.65;margin:0 0 12px">
                  Enter this code at checkout on <strong>gremiercoffee.co.il</strong> to redeem.
                  It does not need to be used all at once — the remaining balance stays on the card.
                </p>

                <p style="font-size:13px;color:#777;line-height:1.55;margin:0 0 22px">
                  Gift card amount: <strong>${escapeHtml(amountText)}</strong>
                </p>

                <div style="text-align:center;margin:26px 0 8px">
                  <a href="${escapeHtml(SITE_URL)}" style="display:inline-block;background:#141414;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:6px;font-size:14px;font-weight:bold">
                    Shop Gremier Coffee
                  </a>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 22px 24px;text-align:center;color:#888;font-size:12px;line-height:1.5">
                Gremier Coffee Co. · Premium cold brew delivered fresh
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildGiftCardEmailText(opts: {
  code: string;
  amount: number;
  recipientName?: string | null;
  message?: string | null;
}) {
  const amountText = formatAmount(opts.amount);
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : 'Hi,';

  return [
    greeting,
    '',
    `You've received a Gremier Coffee gift card worth ${amountText}.`,
    '',
    opts.message ? `Message: "${opts.message}"` : '',
    '',
    `Gift card code: ${opts.code}`,
    '',
    `Redeem it at ${SITE_URL}.`,
    'It does not need to be used all at once — the remaining balance stays on the card.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendGiftEmail(
  to: string | null | undefined,
  code: string,
  amount: number,
  recipientName?: string | null,
  message?: string | null,
) {
  if (!RESEND_KEY || !to) return false;

  const html = buildGiftCardEmailHtml({
    code,
    amount,
    recipientName,
    message,
  });

  const text = buildGiftCardEmailText({
    code,
    amount,
    recipientName,
    message,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: `Your Gremier Coffee Gift Card — ${formatAmount(amount)}`,
      html,
      text,
    }),
  });

  if (!res.ok) {
    console.error('Resend gift card email failed:', res.status, await res.text());
  }

  return res.ok;
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

      // Idempotency: already issued for this order?
      const { data: existing } = await sb
        .from('gift_cards')
        .select('id, code')
        .eq('purchase_order_id', order.id)
        .maybeSingle();

      if (existing) return json({ ok: true, already: true, code: existing.code });

      // Gift card details come from order.delivery_info.gift_card
      const gcInfo = order.delivery_info?.gift_card || {};

      // This is the actual gift card value ordered.
      const amount = Number(gcInfo.amount) || Number(order.total) || 0;

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
          message: gcInfo.message || null,
          purchase_order_id: order.id,
        })
        .select('*')
        .single();

      if (error) return json({ error: error.message }, 400);

      const emailed = await sendGiftEmail(
        card.recipient_email,
        code,
        amount,
        card.recipient_name,
        card.message,
      );

      return json({ ok: true, code, amount, emailed });
    }

    // ── Mode 2: admin manual issue ──
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    const {
      data: { user },
    } = await sb.auth.getUser(token);

    if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
      return json({ error: 'admin_only' }, 403);
    }

    const amount = Number(body.amount);
    if (!amount || amount <= 0) return json({ error: 'invalid_amount' }, 400);

    const code = body.code || makeCode();

    const { data: card, error } = await sb
      .from('gift_cards')
      .insert({
        code,
        initial_amount: amount,
        balance: amount,
        purchased_by_email: user.email,
        recipient_email: body.recipient_email || null,
        recipient_name: body.recipient_name || null,
        message: body.message || null,
        expires_at: body.expires_at || null,
      })
      .select('*')
      .single();

    if (error) return json({ error: error.message }, 400);

    let emailed = false;

    if (body.recipient_email) {
      emailed = await sendGiftEmail(
        body.recipient_email,
        code,
        amount,
        body.recipient_name,
        body.message,
      );
    }

    return json({ ok: true, code, amount, emailed });
  } catch (err) {
    console.error('issue-gift-card server error:', err);
    return json({ error: 'server_error', message: String(err) }, 500);
  }
});
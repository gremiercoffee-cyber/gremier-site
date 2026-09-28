// supabase/functions/redeem-codes/index.ts
// Called server-side AFTER a payment is confirmed paid.
// Atomically consumes a coupon and/or debits a gift card for the order.
// IMPORTANT: call this from confirm-payment-return once payment is verified,
// passing the order_id. Re-running is safe (idempotent via coupon_redemptions /
// gift_card_transactions order_id guards).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
function getServiceRoleKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (!raw) return "";
    const keys = JSON.parse(raw) as Record<string, unknown>;
    return String(keys.default || keys.service_role || Object.values(keys)[0] || "");
  } catch {
    return "";
  }
}
const SERVICE_KEY = getServiceRoleKey();

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const { order_id } = await req.json();
    if (!order_id) return json({ error: 'no_order_id' }, 400);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: order } = await sb.from('orders').select('*').eq('id', order_id).maybeSingle();
    if (!order) return json({ error: 'order_not_found' }, 404);
    if (order.payment_status !== 'paid') return json({ skipped: 'not_paid' });

    const result: Record<string, unknown> = {};

    // ── COUPON ──
    if (order.coupon_code) {
      const { data: coupon } = await sb.from('coupons').select('*').ilike('code', order.coupon_code).maybeSingle();
      if (coupon) {
        // Idempotency: have we already logged this order for this coupon?
        const { data: already } = await sb.from('coupon_redemptions')
          .select('id').eq('coupon_id', coupon.id).eq('order_id', order_id).maybeSingle();
        if (!already) {
          await sb.from('coupon_redemptions').insert({
            coupon_id: coupon.id,
            order_id,
            user_id: order.user_id || null,
            email: order.customer_email ? order.customer_email.toLowerCase() : null,
          });
          await sb.from('coupons').update({
            uses_count: (coupon.uses_count || 0) + 1,
            updated_at: new Date().toISOString(),
            // Deactivate single-use loyalty/global coupons that are now exhausted
            is_active: coupon.max_uses != null && (coupon.uses_count + 1) >= coupon.max_uses ? false : coupon.is_active,
          }).eq('id', coupon.id);

          // If this was the member's loyalty coupon, clear their coupon_available flag
          if (coupon.user_id) {
            await sb.from('profiles').update({ coupon_available: false }).eq('id', coupon.user_id);
          }
          result.coupon_redeemed = coupon.code;
        } else {
          result.coupon = 'already_redeemed';
        }
      }
    }

    // ── GIFT CARD ──
    if (order.gift_card_code && Number(order.gift_card_discount) > 0) {
      const { data: gc } = await sb.from('gift_cards').select('*').ilike('code', order.gift_card_code).maybeSingle();
      if (gc) {
        const { data: already } = await sb.from('gift_card_transactions')
          .select('id').eq('gift_card_id', gc.id).eq('order_id', order_id).maybeSingle();
        if (!already) {
          const amountUsed = Math.min(Number(order.gift_card_discount), Number(gc.balance));
          const newBalance = Number(gc.balance) - amountUsed;
          await sb.from('gift_card_transactions').insert({
            gift_card_id: gc.id,
            order_id,
            amount_used: amountUsed,
            balance_after: newBalance,
            note: `Order #${order.order_number || ''}`,
          });
          await sb.from('gift_cards').update({
            balance: newBalance,
            is_active: newBalance > 0,
            updated_at: new Date().toISOString(),
          }).eq('id', gc.id);
          result.gift_card_debited = amountUsed;
          result.gift_card_balance = newBalance;
        } else {
          result.gift_card = 'already_redeemed';
        }
      }
    }

    return json({ ok: true, ...result });
  } catch (err) {
    return json({ error: 'server_error', message: String(err) }, 500);
  }
});
// supabase/functions/validate-coupon/index.ts
// Validates a coupon code against a cart. Returns the discount it would apply.
// Public-callable (anon key) — never trusts the client for the discount math.

import { referralProblem } from "../_shared/engage.ts";
import { couponDiscount } from "../_shared/coupon-math.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
/** Case-insensitive EXACT match: escape LIKE wildcards so "%" / "_" can't enumerate codes. */
function likeLiteral(v: string): string { return v.replace(/[\\%_]/g, (m) => "\\" + m); }


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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const { code, cart_total, items, user_id, email, subscription } = await req.json();
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return json({ valid: false, error: 'no_code' });
    // Codes are letters/digits/dashes/underscores only — no LIKE wildcards.
    if (!/^[A-Z0-9_-]{2,40}$/.test(cleanCode)) return json({ valid: false, error: 'not_found', message: 'Coupon not found' });

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: coupon } = await sb
      .from('coupons')
      .select('*')
      .ilike('code', likeLiteral(cleanCode))
      .maybeSingle();

    if (!coupon) return json({ valid: false, error: 'not_found', message: 'Coupon not found' });
    if (!coupon.is_active) return json({ valid: false, error: 'inactive', message: 'This coupon is no longer active' });
    // Not yet (a birthday code works only in the birthday month).
    if (coupon.starts_at && new Date(coupon.starts_at) > new Date()) {
      const from = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long' }).format(new Date(coupon.starts_at));
      return json({ valid: false, error: 'not_started', message: /^BDAY-/.test(cleanCode)
        ? `This is your birthday code. It works from ${from}, during your birthday month (one order).`
        : `This code works from ${from}.` });
    }

    // On a subscription only codes allowed for subscriptions work (their discount is on every charge).
    if (subscription && !coupon.for_subscriptions) {
      return json({ valid: false, error: 'not_for_subscriptions', message: "This code can't be used on a subscription" });
    }

    // Expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return json({ valid: false, error: 'expired', message: coupon.kind === 'voucher' ? 'This voucher has expired' : 'This coupon has expired' });
    }

    // Global max uses
    if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
      return json({ valid: false, error: 'used_up', message: coupon.kind === 'voucher' ? 'This voucher has already been used' : 'This coupon has reached its usage limit' });
    }

    // Tied to a specific user (loyalty coupon)
    if (coupon.user_id && user_id && coupon.user_id !== user_id) {
      return json({ valid: false, error: 'not_yours', message: 'This coupon belongs to another account' });
    }
    if (coupon.user_id && !user_id) {
      // Allow email match as fallback
      if (!coupon.customer_email || coupon.customer_email.toLowerCase() !== String(email || '').toLowerCase()) {
        return json({ valid: false, error: 'sign_in_required', message: 'Sign in to use this coupon' });
      }
    }

    // A code made for one email (e.g. a birthday code) works only with that email.
    if (!coupon.user_id && coupon.customer_email && coupon.customer_email.toLowerCase() !== String(email || '').trim().toLowerCase()) {
      return json({ valid: false, error: 'not_yours', message: email ? 'This code is for a different email' : 'Enter your email first: this code is personal' });
    }

    // Referral (friend) codes: first paid order only, and not the person who shared it.
    const refProblem = await referralProblem(sb, cleanCode, email || null);
    if (refProblem) return json({ valid: false, error: 'referral', message: refProblem });

    // One-time-per-user check
    if (coupon.one_time_per_user) {
      let q = sb.from('coupon_redemptions').select('id', { count: 'exact', head: true }).eq('coupon_id', coupon.id);
      if (user_id) q = q.eq('user_id', user_id);
      else if (email) q = q.eq('email', String(email).toLowerCase());
      const { count } = await q;
      if ((count || 0) > 0) {
        return json({ valid: false, error: 'already_used', message: 'You have already used this coupon' });
      }
    }

    // Min order amount
    const cartTotal = Number(cart_total) || 0;
    if (coupon.min_order_amount && cartTotal < coupon.min_order_amount) {
      return json({
        valid: false, error: 'min_order',
        message: `Minimum order of ₪${coupon.min_order_amount} required`,
      });
    }

    // The product a voucher (or product coupon) is for, to name it in the message.
    let productName = '';
    if (coupon.applies_to === 'specific_products' && coupon.product_ids?.length) {
      const { data: p } = await sb.from('products').select('name_en').eq('id', coupon.product_ids[0]).maybeSingle();
      productName = p?.name_en || '';
    }
    const { discount, eligibleTotal } = couponDiscount(coupon, items || [], cartTotal);
    // (A free-delivery code can take nothing off the items and still apply.)
    if (!(eligibleTotal > 0) || (coupon.discount_type === 'free_item' && !(discount > 0))) {
      return json({ valid: false, error: 'not_applicable', message: productName
        ? `Add ${productName} to your cart to use this ${coupon.kind === 'voucher' ? 'voucher' : 'code'}`
        : 'No eligible items in your cart for this coupon' });
    }
    const freeQty = Math.max(1, Number(coupon.free_qty) || 1);
    const what = coupon.discount_type === 'free_item' ? `Free ${freeQty > 1 ? freeQty + ' × ' : ''}${productName || 'item'} applied`
      : coupon.discount_type === 'percent' ? `${coupon.discount_value}% off${productName ? ' ' + productName : ''} applied`
      : `₪${coupon.discount_value} off${productName ? ' ' + productName : ''} applied`;

    return json({
      valid: true,
      coupon_id: coupon.id,
      code: coupon.code,
      discount,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      applies_to: coupon.applies_to,
      subscription: !!subscription,
      free_delivery: !!coupon.free_delivery,
      kind: coupon.kind || 'coupon',
      message: what + (coupon.free_delivery ? ' + free delivery' : '') + (subscription ? ' to every charge' : ''),
    });
  } catch (err) {
    return json({ valid: false, error: 'server_error', message: String(err) }, 500);
  }
});
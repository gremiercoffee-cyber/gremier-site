// supabase/functions/validate-coupon/index.ts
// Validates a coupon code against a cart. Returns the discount it would apply.
// Public-callable (anon key) — never trusts the client for the discount math.

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
    const { code, cart_total, items, user_id, email } = await req.json();
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return json({ valid: false, error: 'no_code' });

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: coupon } = await sb
      .from('coupons')
      .select('*')
      .ilike('code', cleanCode)
      .maybeSingle();

    if (!coupon) return json({ valid: false, error: 'not_found', message: 'Coupon not found' });
    if (!coupon.is_active) return json({ valid: false, error: 'inactive', message: 'This coupon is no longer active' });

    // Expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return json({ valid: false, error: 'expired', message: 'This coupon has expired' });
    }

    // Global max uses
    if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
      return json({ valid: false, error: 'used_up', message: 'This coupon has reached its usage limit' });
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

    // Compute eligible subtotal based on scope
    let eligibleTotal = cartTotal;
    if (coupon.applies_to === 'specific_products' && Array.isArray(coupon.product_ids)) {
      eligibleTotal = (items || [])
        .filter((i: any) => coupon.product_ids.includes(i.product_id || i.base_product_id || i.id))
        .reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    } else if (coupon.applies_to === 'category' && coupon.category) {
      eligibleTotal = (items || [])
        .filter((i: any) => i.category === coupon.category)
        .reduce((s: number, i: any) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
    }

    if (eligibleTotal <= 0) {
      return json({ valid: false, error: 'not_applicable', message: 'No eligible items in your cart for this coupon' });
    }

    // Discount math
    let discount = 0;
    if (coupon.discount_type === 'percent') {
      discount = Math.round(eligibleTotal * (Number(coupon.discount_value) / 100));
    } else {
      discount = Math.min(Number(coupon.discount_value), eligibleTotal);
    }
    discount = Math.max(0, Math.min(discount, cartTotal));

    return json({
      valid: true,
      coupon_id: coupon.id,
      code: coupon.code,
      discount,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      applies_to: coupon.applies_to,
      message: coupon.discount_type === 'percent'
        ? `${coupon.discount_value}% off applied`
        : `₪${coupon.discount_value} off applied`,
    });
  } catch (err) {
    return json({ valid: false, error: 'server_error', message: String(err) }, 500);
  }
});
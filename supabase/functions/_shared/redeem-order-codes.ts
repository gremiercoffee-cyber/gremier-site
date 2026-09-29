import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
/** Case-insensitive EXACT match: escape LIKE wildcards so "%" / "_" can't enumerate codes. */
function likeLiteral(v: string): string { return v.replace(/[\\%_]/g, (m) => "\\" + m); }


type SupabaseClient = ReturnType<typeof createClient>;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return !!e && (e.code === "23505" || /duplicate key|unique/i.test(e.message || ""));
}

/**
 * Consume the order's coupon and debit its gift card, once, after payment is confirmed.
 * Previously this only ran for orders fully covered by a gift card, so a gift card that
 * partly covered a card-paid order was never debited (reusable forever) and coupons on
 * card-paid orders were never counted (max_uses / single-use never enforced).
 *
 * Safe to call repeatedly / concurrently: each redemption row is claimed first under a
 * unique index (coupon_id+order_id, gift_card_id+order_id); only the caller that wins
 * the claim changes balances. The card debit itself is atomic (redeem_gift_card locks the row).
 */
export async function redeemOrderCodes(
  supabase: SupabaseClient,
  orderId: string,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, user_id, customer_email, payment_status, coupon_code, gift_card_code, gift_card_discount")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.payment_status !== "paid") return { skipped: "not_paid" };

  // ── Coupon ──
  if (order.coupon_code) {
    const { data: coupon } = await supabase.from("coupons").select("*").ilike("code", likeLiteral(String(order.coupon_code))).maybeSingle();
    if (coupon) {
      const { error: claimErr } = await supabase.from("coupon_redemptions").insert({
        coupon_id: coupon.id,
        order_id: order.id,
        user_id: order.user_id || null,
        email: order.customer_email ? String(order.customer_email).toLowerCase() : null,
      });
      if (!claimErr) {
        const uses = (Number(coupon.uses_count) || 0) + 1;
        await supabase.from("coupons").update({
          uses_count: uses,
          is_active: coupon.max_uses != null && uses >= Number(coupon.max_uses) ? false : coupon.is_active,
          updated_at: new Date().toISOString(),
        }).eq("id", coupon.id);
        if (coupon.user_id) {
          await supabase.from("profiles").update({ coupon_available: false }).eq("id", coupon.user_id);
        }
        result.coupon_redeemed = coupon.code;
      } else if (isUniqueViolation(claimErr)) {
        result.coupon = "already_redeemed";
      } else {
        console.error("redeemOrderCodes: coupon claim failed", claimErr);
      }
    }
  }

  // ── Gift card ──
  const discount = Number(order.gift_card_discount) || 0;
  if (order.gift_card_code && discount > 0) {
    const { data: gc } = await supabase.from("gift_cards").select("id, balance").ilike("code", likeLiteral(String(order.gift_card_code))).maybeSingle();
    if (gc) {
      const amount = Math.min(discount, Number(gc.balance) || 0);
      const { data: claim, error: claimErr } = await supabase.from("gift_card_transactions").insert({
        gift_card_id: gc.id,
        order_id: order.id,
        amount_used: amount > 0 ? amount : discount,
        // NOT NULL column: record the expected balance now, corrected after the debit.
        balance_after: Math.max(0, (Number(gc.balance) || 0) - Math.max(0, amount)),
        note: `Order #${order.order_number || ""}`,
      }).select("id").single();
      if (claimErr) {
        if (isUniqueViolation(claimErr)) result.gift_card = "already_redeemed";
        else console.error("redeemOrderCodes: gift card claim failed", claimErr);
      } else if (amount <= 0) {
        // Card was emptied elsewhere between checkout and payment — record it, flag it.
        console.error("redeemOrderCodes: gift card", order.gift_card_code, "had no balance left for order", order.id);
        result.gift_card = "no_balance";
      } else {
        const { data: newBalance, error: rpcErr } = await supabase.rpc("redeem_gift_card", {
          p_gift_card_id: gc.id,
          p_amount: amount,
        });
        if (rpcErr) {
          console.error("redeemOrderCodes: redeem_gift_card failed", rpcErr);
          result.gift_card = "debit_failed";
        } else {
          await supabase.from("gift_card_transactions").update({ balance_after: newBalance }).eq("id", claim.id);
          result.gift_card_debited = amount;
          result.gift_card_balance = newBalance;
        }
      }
    }
  }
  return result;
}

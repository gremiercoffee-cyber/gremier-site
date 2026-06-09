import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Md5 } from "https://deno.land/std@0.168.0/hash/md5.ts";
import { encodeHex } from "https://deno.land/std@0.168.0/encoding/hex.ts";

type OrderRow = {
  id: string;
  user_id?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  payment_status?: string | null;
  delivery_info?: Record<string, unknown> | null;
};

type PaymePayload = Record<string, unknown>;

function md5Hex(text: string): string {
  return encodeHex(new Md5().update(text).digest());
}

function verifySignature(payload: PaymePayload, secret: string): boolean {
  const signature = String(payload.payme_signature || "");
  const txnId = String(payload.payme_transaction_id || "");
  const saleId = String(payload.payme_sale_id || "");
  if (!signature || !txnId || !saleId) return true;
  return md5Hex(`${secret}${txnId}${saleId}`) === signature;
}

function isPaidEvent(payload: PaymePayload): boolean {
  const notifyType = String(payload.notify_type || "").toLowerCase();
  const saleStatus = String(payload.sale_status || payload.payme_sale_status || "").toLowerCase();
  const paymeStatus = String(payload.payme_status || "").toLowerCase();

  if (notifyType === "sale-complete" || notifyType === "sale_complete") return true;
  if (saleStatus === "completed") return true;
  if (paymeStatus === "success" || paymeStatus === "completed") return true;
  return false;
}

async function awardPoints(supabase: ReturnType<typeof createClient>, userId: string, subtotal: number) {
  const earned = Math.floor(subtotal / 10);
  if (earned <= 0) return;

  const { data: profile } = await supabase.from("profiles").select("points, coupon_available").eq("id", userId).single();
  if (!profile) return;

  const currentPoints = Number(profile.points) || 0;
  const hadCoupon = !!profile.coupon_available;
  const newPoints = currentPoints + earned;
  const newCoupon = hadCoupon || newPoints >= 200;
  const finalPoints = newCoupon && !hadCoupon ? newPoints - 200 : newPoints;

  await supabase.from("profiles").update({
    points: finalPoints,
    coupon_available: newCoupon,
  }).eq("id", userId);
}

async function redeemCouponIfUsed(supabase: ReturnType<typeof createClient>, userId: string, discount: number) {
  if (!userId || !(Number(discount) > 0)) return;
  await supabase.from("profiles").update({ coupon_available: false }).eq("id", userId);
}

async function findOrder(
  supabase: ReturnType<typeof createClient>,
  payload: PaymePayload,
): Promise<OrderRow | null> {
  const orderId = String(payload.transaction_id || "");
  if (orderId) {
    const { data } = await supabase
      .from("orders")
      .select("id, user_id, subtotal, discount, payment_status, delivery_info")
      .eq("id", orderId)
      .maybeSingle();
    if (data) return data as OrderRow;
  }

  const saleId = String(payload.payme_sale_id || "");
  if (!saleId) return null;

  const { data: orders } = await supabase
    .from("orders")
    .select("id, user_id, subtotal, discount, payment_status, delivery_info")
    .eq("payment_method", "payme")
    .order("created_at", { ascending: false })
    .limit(50);

  return (orders as OrderRow[] | null)?.find((o) => {
    const info = o.delivery_info && typeof o.delivery_info === "object" ? o.delivery_info : {};
    return String(info.payme_sale_id || "") === saleId;
  }) ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok");
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let payload: PaymePayload;

    if (contentType.includes("application/json")) {
      payload = await req.json();
    } else {
      const raw = await req.text();
      payload = Object.fromEntries(new URLSearchParams(raw));
    }

    const secret = Deno.env.get("PAYME_SELLER_ID") || "";
    if (secret && !verifySignature(payload, secret)) {
      console.error("PayMe webhook signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }

    if (!isPaidEvent(payload)) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const order = await findOrder(supabase, payload);
    if (!order) {
      console.error("PayMe webhook: order not found", payload);
      return new Response(JSON.stringify({ ok: false, error: "order_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (order.payment_status === "paid") {
      return new Response(JSON.stringify({ ok: true, already_paid: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const deliveryInfo = {
      ...(order.delivery_info && typeof order.delivery_info === "object" ? order.delivery_info : {}),
      payme_sale_id: String(payload.payme_sale_id || ""),
      payme_transaction_id: String(payload.payme_transaction_id || ""),
    };

    await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        status: "confirmed",
        delivery_info: deliveryInfo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (order.user_id) {
      await awardPoints(supabase, order.user_id, Number(order.subtotal) || 0);
      await redeemCouponIfUsed(supabase, order.user_id, Number(order.discount) || 0);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("PayMe webhook error:", err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

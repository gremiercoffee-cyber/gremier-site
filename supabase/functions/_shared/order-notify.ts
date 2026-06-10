import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type OrderNotifyRow = {
  id: string;
  order_number?: number | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  items?: Array<{ name_en?: string; name_he?: string; qty?: number; price?: number }> | null;
  subtotal?: number | null;
  discount?: number | null;
  total?: number | null;
  source?: string | null;
  notes?: string | null;
};

function formatItems(items: OrderNotifyRow["items"]): string {
  if (!Array.isArray(items) || !items.length) return "—";
  return items
    .map((i) => `${i.qty || 1}× ${i.name_en || i.name_he || "Item"} — ₪${Number(i.price) || 0}`)
    .join("\n");
}

function buildOrderPayload(order: OrderNotifyRow) {
  const adminUrl = `${(Deno.env.get("SITE_URL") || "https://gremier-site.vercel.app").replace(/\/$/, "")}/admin.html`;
  const orderLabel = order.order_number ? String(order.order_number) : order.id.slice(0, 8);
  return {
    order_id: order.id,
    order_number: order.order_number ?? null,
    order_label: orderLabel,
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || "",
    customer_email: order.customer_email || "",
    delivery_address: order.delivery_address || "",
    items_summary: formatItems(order.items),
    subtotal: Number(order.subtotal) || 0,
    discount: Number(order.discount) || 0,
    total: Number(order.total) || 0,
    source: order.source || "",
    notes: order.notes || "",
    admin_url: adminUrl,
    paid_at: new Date().toISOString(),
  };
}

function buildOrderMessage(order: OrderNotifyRow) {
  const payload = buildOrderPayload(order);
  const orderLabel = order.order_number ? `#${order.order_number}` : order.id.slice(0, 8);
  const subject = `New paid order ${orderLabel} — ₪${Number(order.total) || 0}`;
  const text = [
    "New payment received!",
    "",
    `Order: ${orderLabel}`,
    `Customer: ${payload.customer_name || "—"}`,
    `Phone: ${payload.customer_phone || "—"}`,
    `Email: ${payload.customer_email || "—"}`,
    `Address: ${payload.delivery_address || "—"}`,
    "",
    "Items:",
    payload.items_summary,
    "",
    `Subtotal: ₪${payload.subtotal}`,
    payload.discount > 0 ? `Discount: -₪${payload.discount}` : null,
    `Total: ₪${payload.total}`,
    payload.notes ? `Notes: ${payload.notes}` : null,
    payload.source ? `Source: ${payload.source}` : null,
    "",
    `Admin: ${payload.admin_url}`,
  ].filter((line) => line !== null).join("\n");
  return { subject, text, payload };
}

/** Google Apps Script returns 302 — must re-POST to the redirect URL or doPost never runs. */
async function postToGoogleAppsScript(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
  const normalizedUrl = url.replace(/\/dev(\?|$)/, "/exec$1");
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    redirect: "manual",
  };

  let res = await fetch(normalizedUrl, init);
  for (let i = 0; i < 5; i++) {
    if (![301, 302, 303, 307, 308].includes(res.status)) break;
    const location = res.headers.get("location");
    if (!location) break;
    console.log("Google Apps Script redirect — re-POSTing to:", location);
    res = await fetch(location, init);
  }

  const text = await res.text();
  let parsedOk = res.ok;
  if (text.includes('"ok":true') || text.includes('"ok": true')) {
    parsedOk = true;
  }
  try {
    const json = JSON.parse(text) as { ok?: boolean; error?: string };
    if (json.ok === true) parsedOk = true;
    if (json.ok === false) parsedOk = false;
  } catch {
    if (text.includes("<!DOCTYPE html") || text.includes("<html")) parsedOk = false;
  }
  return { ok: parsedOk, text };
}

/** POST order to Google Apps Script web app → sheet row + email via MailApp. */
async function sendViaGoogleSheet(
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; detail?: string }> {
  const url = (Deno.env.get("GOOGLE_ORDER_WEBHOOK_URL") || "").trim().replace(/^["']+|["']+$/g, "");
  if (!url) {
    console.warn("GOOGLE_ORDER_WEBHOOK_URL not set — skipping sheet notification");
    return { ok: false, detail: "GOOGLE_ORDER_WEBHOOK_URL not set in Supabase secrets" };
  }

  const secret = (Deno.env.get("GOOGLE_ORDER_WEBHOOK_SECRET") || "").trim().replace(/^["']+|["']+$/g, "");
  const body = secret ? { ...payload, secret } : payload;
  const { ok, text } = await postToGoogleAppsScript(url, body);
  if (!ok) {
    console.error("Google Sheet webhook failed:", text);
    let detail = text.slice(0, 300);
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error === "unauthorized") {
        detail = "Secret mismatch — GOOGLE_ORDER_WEBHOOK_SECRET must match WEBHOOK_SECRET in Apps Script";
      } else if (json.error) {
        detail = json.error;
      }
    } catch { /* use raw text */ }
    if (detail.includes("<!DOCTYPE html") || detail.includes("<html")) {
      detail = "Google returned a login page — redeploy Apps Script with Who has access: Anyone";
    }
    return { ok: false, detail };
  }
  console.log("Google Sheet webhook OK:", text.slice(0, 120));
  return { ok: true };
}

async function sendViaPushover(title: string, message: string): Promise<boolean> {
  const user = Deno.env.get("PUSHOVER_USER_KEY");
  const token = Deno.env.get("PUSHOVER_API_TOKEN");
  if (!user || !token) return false;

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      user,
      title,
      message: message.slice(0, 1024),
      priority: 1,
    }),
  });

  if (!res.ok) {
    console.error("Pushover order notification failed:", await res.text());
    return false;
  }
  return true;
}

/** Notify when an order is paid. Google Sheet webhook first, Pushover fallback. */
export async function sendOrderPaidNotification(order: OrderNotifyRow): Promise<{ ok: boolean; detail?: string }> {
  const { subject, text, payload } = buildOrderMessage(order);
  try {
    const sheet = await sendViaGoogleSheet(payload);
    if (sheet.ok) return { ok: true };
    const pushed = await sendViaPushover(`💳 ${subject}`, text);
    if (pushed) return { ok: true };
    return { ok: false, detail: sheet.detail || "Google webhook and Pushover both failed" };
  } catch (err) {
    console.error("Order notification error:", err);
    return { ok: false, detail: String(err) };
  }
}

type SupabaseClient = ReturnType<typeof createClient>;

/** Send sheet/email once per paid order (safe to call multiple times). */
export async function notifyPaidOrderOnce(
  supabase: SupabaseClient,
  orderId: string,
  options?: { force?: boolean },
): Promise<{ sent: boolean; skipped?: string; error?: string; detail?: string }> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, customer_name, customer_email, customer_phone, delivery_address, items, subtotal, discount, total, source, notes, payment_status, delivery_info")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { sent: false, skipped: "order_not_found" };
  if (order.payment_status !== "paid") return { sent: false, skipped: "not_paid" };

  const info = order.delivery_info && typeof order.delivery_info === "object"
    ? order.delivery_info as Record<string, unknown>
    : {};
  if (info.order_notified_at && !options?.force) return { sent: true, skipped: "already_notified" };

  const result = await sendOrderPaidNotification(order as OrderNotifyRow);
  if (!result.ok) {
    const hasUrl = !!Deno.env.get("GOOGLE_ORDER_WEBHOOK_URL");
    return {
      sent: false,
      error: hasUrl ? "webhook_failed" : "GOOGLE_ORDER_WEBHOOK_URL not set in Supabase secrets",
      detail: result.detail,
    };
  }

  await supabase
    .from("orders")
    .update({
      delivery_info: { ...info, order_notified_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  return { sent: true };
}

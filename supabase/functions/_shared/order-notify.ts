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
  const itemsSummary = formatItems(order.items);
  const orderLabel = order.order_number ? String(order.order_number) : order.id.slice(0, 8);

  return {
    order_id: order.id,
    order_number: order.order_number ?? null,
    order_label: orderLabel,
    customer_name: order.customer_name || "",
    customer_phone: order.customer_phone || "",
    customer_email: order.customer_email || "",
    delivery_address: order.delivery_address || "",
    items_summary: itemsSummary,
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

/** POST order to Google Apps Script web app → sheet row + email via MailApp. */
async function sendViaGoogleSheet(payload: Record<string, unknown>): Promise<boolean> {
  const url = Deno.env.get("GOOGLE_ORDER_WEBHOOK_URL");
  if (!url) return false;

  const secret = Deno.env.get("GOOGLE_ORDER_WEBHOOK_SECRET");
  const body = secret ? { ...payload, secret } : payload;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error("Google Sheet webhook failed:", await res.text());
    return false;
  }
  return true;
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
export async function sendOrderPaidNotification(order: OrderNotifyRow): Promise<void> {
  const { subject, text, payload } = buildOrderMessage(order);

  try {
    const sheeted = await sendViaGoogleSheet(payload);
    if (!sheeted) {
      const pushed = await sendViaPushover(`💳 ${subject}`, text);
      if (!pushed) {
        console.warn(
          "Order paid but no notification sent — set GOOGLE_ORDER_WEBHOOK_URL (recommended) or PUSHOVER keys",
        );
      }
    }
  } catch (err) {
    console.error("Order notification error:", err);
  }
}

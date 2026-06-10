/** Optional transactional email from Supabase (Resend). Set RESEND_API_KEY + NOTIFY_EMAIL secrets. */

function ownerEmail(): string {
  return (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").trim();
}

function fromAddress(): string {
  return (Deno.env.get("ORDER_EMAIL_FROM") || "Gremier Coffee <onboarding@resend.dev>").trim();
}

export async function sendOrderEmails(params: {
  ownerSubject: string;
  ownerText: string;
  customerEmail?: string | null;
  customerName?: string | null;
  customerSubject?: string;
  customerText?: string;
  force?: boolean;
}): Promise<{ ok: boolean; detail?: string }> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") || "").trim();
  if (!apiKey) {
    return { ok: false, detail: "RESEND_API_KEY not set" };
  }

  const owner = ownerEmail();
  const sent: string[] = [];
  const errors: string[] = [];

  async function sendOne(to: string, subject: string, text: string): Promise<boolean> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: fromAddress(), to: [to], subject, text }),
      });
      if (!res.ok) {
        errors.push(`${to}: ${(await res.text()).slice(0, 120)}`);
        return false;
      }
      sent.push(to);
      return true;
    } catch (err) {
      errors.push(`${to}: ${String(err)}`);
      return false;
    }
  }

  await sendOne(owner, params.ownerSubject, params.ownerText);

  const customer = String(params.customerEmail || "").trim();
  if (customer && customer.toLowerCase() !== owner.toLowerCase()) {
    if (params.customerSubject && params.customerText) {
      await sendOne(customer, params.customerSubject, params.customerText);
    }
  }

  if (sent.length) return { ok: true };
  return { ok: false, detail: errors.join("; ") || "no recipients" };
}

export function buildCustomerReceiptText(order: {
  order_number?: number | null;
  customer_name?: string | null;
  items_summary: string;
  subtotal: number;
  discount: number;
  total: number;
  delivery_address?: string | null;
  notes?: string | null;
}): { subject: string; text: string } {
  const label = order.order_number ? `#${order.order_number}` : "your order";
  const name = order.customer_name || "there";
  const subject = `Gremier Coffee — order ${label} confirmed — ₪${order.total}`;
  const text = [
    `Hi ${name},`,
    "",
    "Thank you! We received your payment.",
    "",
    `Order: ${label}`,
    "",
    "Items:",
    order.items_summary,
    "",
    `Subtotal: ₪${order.subtotal}`,
    order.discount > 0 ? `Discount: -₪${order.discount}` : null,
    `Total: ₪${order.total}`,
    order.delivery_address ? `Delivery: ${order.delivery_address}` : null,
    order.notes ? `Notes: ${order.notes}` : null,
    "",
    "We'll be in touch shortly about delivery.",
    "",
    "— Gremier Coffee Co.",
    "https://gremier-site.vercel.app",
  ].filter((line) => line !== null).join("\n");
  return { subject, text };
}

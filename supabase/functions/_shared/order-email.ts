/** Order email via Resend (Supabase secrets: RESEND_API_KEY, NOTIFY_EMAIL, ORDER_EMAIL_FROM).

 * NOTIFY_EMAIL = where owner alerts are delivered (e.g. gremiercoffee@gmail.com).

 * ORDER_EMAIL_FROM = Resend-verified sender (your domain). Cannot be @gmail.com — verify a domain in Resend. */



function ownerEmail(): string {

  return (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").trim();

}



function fromAddress(): string {

  const custom = (Deno.env.get("ORDER_EMAIL_FROM") || "").trim();

  if (custom) return custom;

  return "Gremier Coffee <onboarding@resend.dev>";

}



export async function sendOrderEmails(params: {

  ownerSubject: string;

  ownerText: string;

  customerEmail?: string | null;

  customerName?: string | null;

  customerSubject?: string;

  customerText?: string;

  force?: boolean;

  skipOwner?: boolean;

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

        body: JSON.stringify({

          from: fromAddress(),

          to: [to],

          reply_to: owner,

          subject,

          text,

        }),

      });

      if (!res.ok) {

        errors.push(`${to}: ${(await res.text()).slice(0, 200)}`);

        return false;

      }

      sent.push(to);

      return true;

    } catch (err) {

      errors.push(`${to}: ${String(err)}`);

      return false;

    }

  }



  if (!params.skipOwner) {
    await sendOne(owner, params.ownerSubject, params.ownerText);
  }

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

export function buildFulfillmentEmailText(order: {
  order_number?: number | null;
  customer_name?: string | null;
  delivery_address?: string | null;
}): { subject: string; text: string } {
  const label = order.order_number ? `#${order.order_number}` : "your order";
  const name = order.customer_name || "there";
  const subject = `Gremier Coffee — order ${label} fulfilled`;
  const text = [
    `Hi ${name},`,
    "",
    "Great news — your order has been fulfilled!",
    "",
    `Order: ${label}`,
    order.delivery_address ? `Delivery address: ${order.delivery_address}` : null,
    "",
    "Thank you for choosing Gremier Coffee. Enjoy!",
    "",
    "— Gremier Coffee Co.",
    "https://gremier-site.vercel.app",
  ].filter((line) => line !== null).join("\n");
  return { subject, text };
}

export async function sendFulfillmentEmail(order: {
  customer_email?: string | null;
  customer_name?: string | null;
  order_number?: number | null;
  delivery_address?: string | null;
}): Promise<{ ok: boolean; emailed: boolean; detail?: string }> {
  const customer = String(order.customer_email || "").trim();
  if (!customer) return { ok: true, emailed: false, detail: "no customer email" };
  const { subject, text } = buildFulfillmentEmailText(order);
  const res = await sendOrderEmails({
    ownerSubject: "",
    ownerText: "",
    skipOwner: true,
    customerEmail: customer,
    customerName: order.customer_name,
    customerSubject: subject,
    customerText: text,
  });
  return { ok: res.ok, emailed: res.ok, detail: res.detail };
}

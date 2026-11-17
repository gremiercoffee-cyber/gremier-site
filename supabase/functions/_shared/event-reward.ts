// Event (pop-up shop) reward: a paid order that used an event coupon during its reward hours gets a personal
// one-time code for the next order (e.g. ELLE Fitness: 10% off), emailed to the customer. Issued once per order.
import { sendOrderEmails } from "./order-email.ts";
import { designedEmailHtml } from "./email-design.ts";

const SITE = "https://gremiercoffee.co.il";
const newCode = (prefix: string) =>
  prefix + "-" + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

export async function issueEventReward(sb: any, orderId: string, now = new Date()): Promise<{ status: string; code?: string }> {
  const { data: o } = await sb.from("orders").select("id, coupon_code, customer_email, customer_name, payment_status, items, delivery_info")
    .eq("id", orderId).maybeSingle();
  if (!o || o.payment_status !== "paid" || !o.coupon_code || !o.customer_email) return { status: "not_applicable" };
  const { data: c } = await sb.from("coupons").select("code, event_name, product_ids, reward_percent, reward_from, reward_until, reward_days")
    .eq("code", o.coupon_code).maybeSingle();
  if (!c?.event_name || !(Number(c.reward_percent) > 0)) return { status: "not_applicable" };
  // Only orders paid during the reward hours, that include at least one of the event's products.
  if ((c.reward_from && now < new Date(c.reward_from)) || (c.reward_until && now > new Date(c.reward_until))) return { status: "outside_hours" };
  const ids = new Set((c.product_ids || []).map(String));
  if (!(o.items || []).some((i: any) => ids.has(String(i.product_id)))) return { status: "no_event_items" };

  const tag = `Event reward · ${c.event_name} · order ${orderId}`;
  const { data: had } = await sb.from("coupons").select("code").eq("description", tag).maybeSingle();
  if (had) return { status: "exists", code: had.code };

  const pct = Number(c.reward_percent), days = Number(c.reward_days) || 30;
  const email = String(o.customer_email).trim().toLowerCase();
  const code = newCode(String(c.event_name).split(" ")[0].replace(/[^A-Za-z]/g, "").slice(0, 8).toUpperCase() || "EVENT");
  const expires = new Date(now.getTime() + days * 864e5);
  const { error } = await sb.from("coupons").insert({ code, discount_type: "percent", discount_value: pct, applies_to: "all", max_uses: 1, uses_count: 0,
    one_time_per_user: true, is_active: true, expires_at: expires.toISOString(), customer_email: email, description: tag });
  if (error) { console.error("event reward coupon", error.message); return { status: "failed" }; }

  const he = o.delivery_info?.site_lang === "he";
  const until = new Intl.DateTimeFormat(he ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", day: "numeric", month: "long" }).format(expires);
  const subject = he ? `🎁 ${pct}% הנחה על ההזמנה הבאה, מ-${c.event_name}` : `🎁 ${pct}% off your next order, from ${c.event_name}`;
  const lead = he ? `תודה שקניתם אצלנו ב-${c.event_name}! הנה ${pct}% הנחה על ההזמנה הבאה שלכם באתר.` : `Thanks for buying from us at ${c.event_name}! Here's ${pct}% off your next order on our website.`;
  const rule = he ? `בתוקף עד ${until} · להזמנה אחת` : `Valid until ${until} · one order`;
  const text = `${lead}\n\n${code}\n\n${rule}\n${he ? "מזינים את הקוד בקופה" : "Enter the code at checkout"}: ${SITE}\n\n${he ? "באהבה,\nגרמיר קפה" : "With love,\nGremier Coffee"}`;
  const html = designedEmailHtml({ he, image: null, preheader: rule, hello: he ? "תודה! 🎉" : "Thank you! 🎉", lead,
    card: { label: he ? "להזמנה הבאה" : "For your next order", big: `${pct}%`, codeLabel: he ? "הקוד שלכם" : "Your code", code, note: rule },
    cta: { label: he ? "לחנות" : "Shop now", url: `${SITE}/#shop` },
    small: [he ? "הקוד אישי ולשימוש חד־פעמי." : "The code is personal and single-use."],
    sign: he ? "באהבה, גרמיר קפה" : "With love, Gremier Coffee" });
  const owner = (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").toLowerCase();
  const res: any = await sendOrderEmails({ idempotencyKey: `event-reward-${orderId}`, customerHtml: html, ownerSubject: subject, ownerText: text,
    skipOwner: email !== owner, customerEmail: email, customerSubject: subject, customerText: text } as any);
  if (!res?.ok) console.error("event reward email", res?.detail);
  return { status: res?.ok ? "issued" : "issued_email_failed", code };
}

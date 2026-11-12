// supabase/functions/send-voucher/index.ts
// Admin only: emails a voucher (a one-time code from the Vouchers screen) to someone, in the gift card
// email's design: the item's photo, a card showing "FREE" or the amount off, the code, and a button that
// opens the site with the code ready to apply (and the item open, for an item voucher).
// Body: { id, email, name?, lang?: 'en'|'he', note? }. The voucher isn't tied to that email: it can be passed on.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceOrAdmin } from "../_shared/security.ts";
import { designedEmailHtml } from "../_shared/email-design.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, unknown>;
    return String(keys.default || keys.service_role || Object.values(keys)[0] || "");
  } catch { return ""; }
}
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("GIFT_FROM_EMAIL") || "Gremier Coffee <orders@gremiercoffee.co.il>";
const SITE = (Deno.env.get("SITE_URL") || "https://gremiercoffee.co.il").replace(/\/$/, "");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const slug = (name: string) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const money = (n: number) => `₪${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`;

/** What the voucher gives, in words: shared with the Vouchers screen's printed cards. */
export function voucherWords(v: Record<string, any>, product: Record<string, any> | null, he: boolean) {
  const name = product ? (he ? product.name_he || product.name_en : product.name_en || product.name_he) || "" : "";
  const qty = Math.max(1, Number(v.free_qty) || 1);
  if (v.discount_type === "free_item") return { big: he ? "חינם" : "FREE", what: (qty > 1 ? `${qty} × ` : "") + name };
  const amount = v.discount_type === "percent" ? `${Number(v.discount_value)}%` : money(Number(v.discount_value));
  return { big: he ? `${amount} הנחה` : `${amount} OFF`, what: name || (he ? "כל הזמנה" : "any order") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!(await isServiceOrAdmin(req))) return json({ error: "admin_only" }, 403);
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
    if (!RESEND_KEY) return json({ error: "Email isn't set up" }, 500);
    const he = body.lang === "he";
    const recipient = String(body.name || "").trim().slice(0, 60);
    const note = String(body.note || "").trim().slice(0, 600);

    const sb = createClient(SUPABASE_URL, serviceKey());
    const { data: v, error } = await sb.from("coupons").select("*").eq("id", String(body.id || "")).eq("kind", "voucher").maybeSingle();
    if (error) throw error;
    if (!v) return json({ error: "Voucher not found" }, 404);
    if (!v.is_active || (v.max_uses != null && Number(v.uses_count) >= Number(v.max_uses))) return json({ error: "This voucher was already used or turned off" }, 400);
    if (v.expires_at && new Date(v.expires_at) < new Date()) return json({ error: "This voucher has expired" }, 400);

    const pid = v.applies_to === "specific_products" && v.product_ids?.length ? String(v.product_ids[0]) : "";
    const { data: product } = pid ? await sb.from("products").select("id,name_en,name_he,images").eq("id", pid).maybeSingle() : { data: null };
    const { big, what } = voucherWords(v, product, he);
    const until = v.expires_at ? new Intl.DateTimeFormat(he ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", day: "numeric", month: "long", year: "numeric" }).format(new Date(v.expires_at)) : "";
    const url = `${SITE}/?coupon=${encodeURIComponent(v.code)}${product ? `#product=${slug(product.name_en)}` : ""}`;
    const free = v.discount_type === "free_item";

    const hello = recipient ? (he ? `${recipient}, יש לך שובר!` : `${recipient}, here's a voucher for you`) : (he ? "יש לך שובר!" : "Here's a voucher for you");
    const lead = free ? (he ? `${what} עלינו.` : `${what}, on us.`) : (he ? `${big} על ${what}.` : `${big.replace(" OFF", " off")} ${product ? what : "your next order"}.`);
    const howTo = product
      ? (he ? `איך משתמשים: מוסיפים את ${product.name_he || product.name_en} לסל באתר ומזינים את הקוד בקופה, או פשוט לוחצים על הכפתור.` : `How to use it: add ${product.name_en} to your cart on our site and enter the code at checkout, or just tap the button.`)
      : (he ? "איך משתמשים: מזינים את הקוד בקופה באתר, או פשוט לוחצים על הכפתור." : "How to use it: enter the code at checkout on our site, or just tap the button.");
    const html = designedEmailHtml({
      he,
      preheader: lead,
      hello,
      lead,
      image: product?.images?.[0] || null,
      card: {
        label: he ? "שובר" : "Voucher",
        big,
        codeLabel: he ? "הקוד שלך" : "Your code",
        code: v.code,
        note: [what, he ? "לשימוש חד־פעמי" : "One-time use", until ? (he ? `בתוקף עד ${until}` : `Valid until ${until}`) : ""].filter(Boolean).join(" · "),
      },
      body: [note, howTo].filter(Boolean),
      cta: { label: he ? "למימוש השובר" : "Use my voucher", url },
      sign: he ? "גרמיר קפה" : "Gremier Coffee Co.",
    });
    const text = [hello, lead, `${he ? "קוד" : "Code"}: ${v.code}`, until ? (he ? `בתוקף עד ${until}` : `Valid until ${until}`) : "", note, howTo, url].filter(Boolean).join("\n\n");
    const subject = free ? (he ? `שובר: ${what} חינם` : `Your voucher: free ${what}`) : (he ? `שובר: ${big}` : `Your voucher: ${big.replace(" OFF", " off")}`);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: email, subject, html, text }),
    });
    if (!res.ok) { console.error("send-voucher: Resend failed", res.status, await res.text()); return json({ error: "The email could not be sent" }, 502); }
    await sb.from("coupons").update({ emailed_at: new Date().toISOString(), emailed_to: email, recipient_name: recipient || v.recipient_name || null, updated_at: new Date().toISOString() }).eq("id", v.id);
    return json({ ok: true });
  } catch (err) {
    console.error("send-voucher:", err);
    return json({ error: "Something went wrong" }, 500);
  }
});

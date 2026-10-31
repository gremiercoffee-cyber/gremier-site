// Daily: everyone whose birthday month it is (and who hasn't had this year's code) gets a personal,
// single-use 5% code valid until the end of the month, by email in their language. Service only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceOrAdmin } from "../_shared/security.ts";
import { sendOrderEmails } from "../_shared/order-email.ts";
import { designedEmailHtml } from "../_shared/email-design.ts";

const SITE = "https://gremiercoffee.co.il";
function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || k.service_role || ""; } catch { return ""; }
}
const jerusalem = () => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { year: v("year"), month: v("month"), day: v("day") };
};
const code = () => "BDAY-" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });
  if (!await isServiceOrAdmin(req)) return new Response("Forbidden", { status: 403 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const now = jerusalem();
  // A test run sends to one address only (an existing birthday row), and never marks it sent.
  const only = typeof body.only_email === "string" ? body.only_email.toLowerCase() : null;
  let q = sb.from("customer_birthdays").select("*").eq("month", now.month);
  if (only) q = q.eq("email", only); else q = q.or(`last_sent_year.is.null,last_sent_year.lt.${now.year}`);
  const { data: rows, error } = await q.limit(200);
  if (error) return Response.json({ error: "load_failed" }, { status: 500 });
  // A product photo for the email (a liter bottle of coffee).
  const { data: shots } = await sb.from("products").select("name_en, images").eq("is_active", true).eq("category", "bottles").order("sort_order").limit(10);
  const image = (shots || []).find((p: any) => /classic dark|house blend|colomb/i.test(p.name_en || "") && p.images?.[0])?.images?.[0] || null;
  const expires = new Date(Date.UTC(now.year, now.month, 1) - 1000).toISOString();   // end of the month
  let sent = 0;
  for (const r of rows || []) {
    const c = code();
    const { error: cErr } = await sb.from("coupons").insert({ code: c, discount_type: "percent", discount_value: 5, applies_to: "all", max_uses: 1, uses_count: 0,
      one_time_per_user: true, is_active: true, expires_at: expires, customer_email: r.email, description: `Birthday ${now.year} · ${r.email}` });
    if (cErr) { console.error("birthday coupon", cErr.message); continue; }
    const he = r.lang !== "en", month = he ? MONTHS_HE[now.month - 1] : MONTHS_EN[now.month - 1];
    const subject = he ? "🎂 יום הולדת שמח מגרמיר! 5% מתנה" : "🎂 Happy birthday from Gremier! A 5% gift";
    const text = he
      ? `יום הולדת שמח! 🎉\n\nלכבוד יום ההולדת, הנה 5% הנחה על ההזמנה הבאה שלכם, בתוקף כל ${month}:\n\n${c}\n\nמזינים את הקוד בקופה: ${SITE}\n\nבאהבה,\nגרמיר קפה`
      : `Happy birthday! 🎉\n\nTo celebrate, here's 5% off your next order, valid all of ${month}:\n\n${c}\n\nEnter the code at checkout: ${SITE}\n\nWith love,\nGremier Coffee`;
    const html = designedEmailHtml({ he, image,
      preheader: he ? `5% הנחה מתנה, בתוקף כל ${month}` : `5% off as a gift, valid all of ${month}`,
      hello: he ? "יום הולדת שמח! 🎉" : "Happy birthday! 🎉",
      lead: he ? "לכבוד יום ההולדת, הקפה הבא עלינו (קצת)." : "To celebrate, your next coffee is (a little) on us.",
      card: { label: he ? "מתנת יום הולדת" : "Birthday gift", big: "5%", codeLabel: he ? "הקוד שלכם" : "Your code", code: c, note: he ? `בתוקף עד סוף ${month}` : `Valid until the end of ${month}` },
      cta: { label: he ? "לחנות" : "Shop now", url: "https://gremiercoffee.co.il/#shop" },
      small: [he ? "מזינים את הקוד בקופה. הקוד אישי, לשימוש אחד." : "Enter the code at checkout. It's personal, for one order."],
      sign: he ? "באהבה, גרמיר קפה" : "With love, Gremier Coffee" });
    const res = await sendOrderEmails({ customerHtml: html, ownerSubject: subject, ownerText: text, skipOwner: r.email !== (Deno.env.get('NOTIFY_EMAIL') || 'gremiercoffee@gmail.com').toLowerCase(), customerEmail: r.email, customerSubject: subject, customerText: text });
    if (!res.ok) { await sb.from("coupons").update({ is_active: false }).eq("code", c); console.error("birthday email", res.detail); continue; }
    if (!only) await sb.from("customer_birthdays").update({ last_sent_year: now.year, last_code: c, updated_at: new Date().toISOString() }).eq("email", r.email);
    sent++;
  }
  return Response.json({ month: now.month, candidates: (rows || []).length, sent });
});

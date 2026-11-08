// Birthday codes: 5% off ONE order, usable only during the customer's birthday month.
// The code is made and emailed as soon as the birthday is saved (for the next birthday month), and a
// reminder goes out when that month starts. Each year's code is made by the daily birthday-codes job.
import { sendOrderEmails } from "./order-email.ts";
import { designedEmailHtml } from "./email-design.ts";

const SITE = "https://gremiercoffee.co.il";
export const MONTHS_HE = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
export const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function jerusalemToday(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const v = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { year: v("year"), month: v("month"), day: v("day") };
}

/** Midnight in Jerusalem (including DST) at the start of a month; month 13 is January of the next year. */
function jerusalemMonthStart(year: number, month: number): number {
  const utc = Date.UTC(year, month - 1, 1);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" })
    .formatToParts(new Date(utc)).find((p) => p.type === "timeZoneName")?.value || "GMT+2";
  const m = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part);
  if (!m) throw new Error("Could not determine Jerusalem timezone offset");
  const minutes = (Number(m[2]) * 60 + Number(m[3] || 0)) * (m[1] === "+" ? 1 : -1);
  return utc - minutes * 60_000;
}

/** The next birthday month (this month if it is the birthday month): when the code starts and ends. */
export function birthdayWindow(month: number, now = new Date()) {
  const today = jerusalemToday(now);
  const year = month >= today.month ? today.year : today.year + 1;
  return {
    year,
    current: month === today.month,
    startsAt: new Date(jerusalemMonthStart(year, month)).toISOString(),
    expiresAt: new Date(jerusalemMonthStart(year, month + 1) - 1000).toISOString(),
  };
}

export const newBirthdayCode = () =>
  "BDAY-" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

async function emailImage(sb: any): Promise<string | null> {
  const { data } = await sb.from("products").select("name_en, images").eq("is_active", true).eq("category", "bottles").order("sort_order").limit(10);
  return (data || []).find((p: any) => /classic dark|house blend|colomb/i.test(p.name_en || "") && p.images?.[0])?.images?.[0] || null;
}

function birthdayEmail(kind: "issued" | "reminder", he: boolean, code: string, month: number, current: boolean, image: string | null) {
  const name = he ? MONTHS_HE[month - 1] : MONTHS_EN[month - 1];
  const rule = he
    ? `הקוד בתוקף רק בחודש ${name}, להזמנה אחת בלבד.`
    : `It works only during ${name}, for one order.`;
  const subject = kind === "reminder"
    ? (he ? `🎂 חודש יום ההולדת הגיע! קוד ה-5% שלכם מחכה` : `🎂 Your birthday month is here: your 5% code is ready`)
    : current
      ? (he ? "🎂 יום הולדת שמח מגרמיר! 5% מתנה" : "🎂 Happy birthday from Gremier! A 5% gift")
      : (he ? "🎂 קוד יום ההולדת שלכם מגרמיר" : "🎂 Your Gremier birthday code");
  const hello = kind === "issued" && !current ? (he ? "מתנה ליום ההולדת 🎁" : "A birthday gift 🎁") : (he ? "יום הולדת שמח! 🎉" : "Happy birthday! 🎉");
  const lead = kind === "reminder"
    ? (he ? `תזכורת: יש לכם קוד יום הולדת. 5% הנחה על הזמנה אחת, החודש.` : `A reminder: you have a birthday code. 5% off one order, this month.`)
    : current
      ? (he ? "לכבוד יום ההולדת, הנה 5% הנחה על הזמנה אחת." : "To celebrate, here's 5% off one order.")
      : (he ? `יום ההולדת שלכם ב${name}, אז הכנו לכם מתנה: 5% הנחה על הזמנה אחת. שמרו את הקוד.` : `Your birthday is in ${name}, so here's a gift waiting for you: 5% off one order. Keep this code.`);
  const text = `${hello}\n\n${lead}\n\n${code}\n\n${rule}\n${he ? "מזינים את הקוד בקופה" : "Enter the code at checkout"}: ${SITE}\n\n${he ? "באהבה,\nגרמיר קפה" : "With love,\nGremier Coffee"}`;
  const html = designedEmailHtml({ he, image,
    preheader: rule, hello, lead,
    card: { label: he ? "מתנת יום הולדת" : "Birthday gift", big: "5%", codeLabel: he ? "הקוד שלכם" : "Your code", code,
      note: he ? `בתוקף רק ב${name} · להזמנה אחת` : `Valid only in ${name} · one order` },
    cta: { label: he ? "לחנות" : "Shop now", url: `${SITE}/#shop` },
    small: [he ? "הקוד אישי ולשימוש חד־פעמי: הוא לא חל על כל ההזמנות בחודש." : "The code is personal and single-use: it doesn't apply to every order that month."],
    sign: he ? "באהבה, גרמיר קפה" : "With love, Gremier Coffee" });
  return { subject, text, html };
}

async function send(sb: any, email: string, mail: { subject: string; text: string; html: string }, key: string) {
  const owner = (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").toLowerCase();
  return await sendOrderEmails({ idempotencyKey: key, customerHtml: mail.html, ownerSubject: mail.subject, ownerText: mail.text,
    skipOwner: email !== owner, customerEmail: email, customerSubject: mail.subject, customerText: mail.text } as any);
}

type Row = { email: string; month: number; lang: string; last_sent_year?: number | null; last_code?: string | null; reminded_year?: number | null };

/** Makes (or keeps) the code for the next birthday month and emails it. Never gives a second code for the
 *  same year, and never a new one if a birthday code was used in the last 11 months. */
export async function issueBirthdayCode(sb: any, row: Row, opts: { now?: Date; markRow?: boolean } = {}) {
  const w = birthdayWindow(row.month, opts.now);
  const he = row.lang !== "en";
  if (row.last_code) {
    const { data: prev } = await sb.from("coupons").select("id, starts_at, uses_count, is_active").eq("code", row.last_code).maybeSingle();
    if (prev && prev.is_active && prev.starts_at === null && row.last_sent_year === w.year) return { status: "exists" as const, code: row.last_code };
    if (prev && prev.is_active && prev.starts_at && new Date(prev.starts_at).getTime() === new Date(w.startsAt).getTime()) return { status: "exists" as const, code: row.last_code };
    // A different month now: the unused old code goes, so there's only ever one.
    if (prev && prev.is_active && !(Number(prev.uses_count) > 0)) await sb.from("coupons").update({ is_active: false }).eq("id", prev.id);
  }
  const { data: used } = await sb.from("coupons").select("id").like("code", "BDAY-%").eq("customer_email", row.email).gt("uses_count", 0)
    .gt("created_at", new Date(Date.now() - 335 * 864e5).toISOString()).limit(1);
  if (used?.length) return { status: "recently_used" as const };
  if (row.last_sent_year === w.year && !row.last_code) return { status: "already_handled" as const };
  const code = newBirthdayCode();
  const { error } = await sb.from("coupons").insert({ code, discount_type: "percent", discount_value: 5, applies_to: "all", max_uses: 1, uses_count: 0,
    one_time_per_user: true, is_active: true, starts_at: w.startsAt, expires_at: w.expiresAt, customer_email: row.email,
    description: `Birthday ${w.year} · ${row.email}` });
  if (error) { console.error("birthday coupon", error.message); return { status: "failed" as const }; }
  const res = await send(sb, row.email, birthdayEmail("issued", he, code, row.month, w.current, await emailImage(sb)), `bday-issued-${code}`);
  if (!res?.ok) { await sb.from("coupons").update({ is_active: false }).eq("code", code); console.error("birthday email", res?.detail); return { status: "email_failed" as const }; }
  if (opts.markRow !== false) await sb.from("customer_birthdays").update({ last_sent_year: w.year, last_code: code, reminded_year: w.current ? w.year : null, updated_at: new Date().toISOString() }).eq("email", row.email);
  return { status: "issued" as const, code };
}

/** At the start of the birthday month: a reminder of the code made earlier, if it's still unused. */
export async function remindBirthdayCode(sb: any, row: Row, year: number) {
  if (!row.last_code) return { status: "no_code" as const };
  const { data: c } = await sb.from("coupons").select("code, uses_count, is_active, expires_at").eq("code", row.last_code).maybeSingle();
  let status: "reminded" | "skipped" | "email_failed" = "skipped";
  if (c && c.is_active && !(Number(c.uses_count) > 0) && (!c.expires_at || new Date(c.expires_at) > new Date())) {
    const res = await send(sb, row.email, birthdayEmail("reminder", row.lang !== "en", c.code, row.month, true, await emailImage(sb)), `bday-reminder-${c.code}`);
    if (!res?.ok) return { status: "email_failed" as const };
    status = "reminded";
  }
  await sb.from("customer_birthdays").update({ reminded_year: year, updated_at: new Date().toISOString() }).eq("email", row.email);
  return { status };
}

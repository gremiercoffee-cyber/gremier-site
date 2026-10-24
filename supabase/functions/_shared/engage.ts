// Referrals ("give ₪20, get ₪20") and post-delivery feedback, shared by engage, admin-tools,
// validate-coupon, create-website-order and the paid-order step.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendOrderEmails } from "./order-email.ts";
import { pushToCustomer } from "./customer-push.ts";

type Sb = ReturnType<typeof createClient>;

export const SITE = "https://gremiercoffee.co.il";
export const REFERRAL_AMOUNT = 20;

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    return keys.default || keys.service_role || Object.values(keys)[0] || "";
  } catch {
    return "";
  }
}

/** Short signature for links in emails (feedback, opt-out), so nobody can forge them. */
export async function signToken(label: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(serviceKey() + ":" + label), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** An email to the owner only (NOTIFY_EMAIL), e.g. "a referral link was opened". */
export async function notifyOwner(subject: string, text: string): Promise<void> {
  try {
    await sendOrderEmails({ ownerSubject: subject, ownerText: text });
  } catch (e) {
    console.error("notifyOwner:", e);
  }
}

const likeExact = (v: string) => v.replace(/[\\%_]/g, (c) => "\\" + c);
export const normCode = (code: unknown) => String(code || "").trim().toUpperCase();

export async function referralByCode(sb: Sb, code: unknown): Promise<{ code: string; email: string } | null> {
  const c = normCode(code);
  if (!/^REF-[A-Z0-9]{4,10}$/.test(c)) return null;
  const { data } = await sb.from("referral_codes").select("code, email").eq("code", c).maybeSingle();
  return data as { code: string; email: string } | null;
}

/** Why this buyer can't use the referral code, or null when they can (first paid order, not their own code). */
export async function referralProblem(sb: Sb, code: unknown, buyerEmail: unknown): Promise<string | null> {
  const ref = await referralByCode(sb, code);
  if (!ref) return null;   // not a referral code: normal coupon rules apply
  const email = String(buyerEmail || "").trim().toLowerCase();
  if (!email) return "Enter your email first — this friend code is for a first order";
  if (email === ref.email.toLowerCase()) return "This is your own referral code — share it with a friend";
  const { data: paid } = await sb.from("orders").select("id").ilike("customer_email", likeExact(email)).eq("payment_status", "paid").limit(1);
  if (paid?.length) return "Friend codes are for a first order";
  return null;
}

export async function logReferralEvent(sb: Sb, code: string, kind: string, orderId?: string | null, detail?: Record<string, unknown>) {
  await sb.from("referral_events").insert({ code, kind, order_id: orderId || null, detail: detail || null }).then(() => {}, () => {});
}

function giftCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => alphabet[b % alphabet.length]).join("");
  return `GIFT-${block()}-${block()}`;
}

/** Once a referred friend's order is paid: a ₪20 gift card for the person who shared the link. */
export async function settleReferral(sb: Sb, orderId: string): Promise<void> {
  const { data: order } = await sb.from("orders").select("id, order_number, customer_name, customer_email, coupon_code, payment_status").eq("id", orderId).maybeSingle();
  if (!order || order.payment_status !== "paid" || !order.coupon_code) return;
  const ref = await referralByCode(sb, order.coupon_code);
  if (!ref) return;
  const { data: first } = await sb.rpc("claim_order_step", { p_order_id: orderId, p_step: "referral_rewarded_at" });
  if (first !== true) return;
  const code = giftCode();
  const { error } = await sb.from("gift_cards").insert({
    code, initial_amount: REFERRAL_AMOUNT, balance: REFERRAL_AMOUNT, is_active: true,
    purchased_by_email: "referral@gremiercoffee.co.il", recipient_email: ref.email,
    message: `Thanks for referring ${order.customer_name || "a friend"}!`,
  });
  if (error) { console.error("referral gift card:", error.message); return; }
  await logReferralEvent(sb, ref.code, "reward", orderId, { gift_card: code });
  await sendOrderEmails({
    ownerSubject: "", ownerText: "", skipOwner: true,
    customerEmail: ref.email,
    customerSubject: "Your friend ordered — here's ₪20 from Gremier Coffee ☕",
    customerText: `Thank you for sharing Gremier Coffee!\n\nYour friend just placed their first order, so here's a ₪${REFERRAL_AMOUNT} gift card for your next one:\n\n${code}\n\nEnter it at checkout under "Coupon or gift card".\n${SITE}\n\nתודה ששיתפת! החבר/ה שלך הזמינו בפעם הראשונה, אז הנה כרטיס מתנה של ₪${REFERRAL_AMOUNT} להזמנה הבאה שלך:\n${code}\n\nGremier Coffee`,
  });
  // The shop app: one tap opens the site with the card saved (it applies at checkout).
  await pushToCustomer(sb, { email: ref.email }, {
    he: { title: `🎉 קיבלת ₪${REFERRAL_AMOUNT}!`, body: "חבר/ה שהזמנת הזמינו לראשונה. כרטיס המתנה שלך מחכה בקופה." },
    en: { title: `🎉 You got ₪${REFERRAL_AMOUNT}!`, body: "Your friend placed their first order. Your gift card is waiting at checkout." },
    url: `/?gift=${encodeURIComponent(code)}`, tag: "referral-reward",
  });
  await notifyOwner(
    `🎁 Referral paid off: order #${order.order_number}`,
    `${order.customer_name || "A new customer"} (${order.customer_email}) paid their first order #${order.order_number} with ${ref.email}'s referral code ${ref.code}.\n\n₪${REFERRAL_AMOUNT} gift card ${code} was emailed to ${ref.email}.`,
  );
}

function newReferralCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "REF-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => alphabet[b % alphabet.length]).join("");
}

/** The customer's referral code, created on first use. It is also a coupon: ₪20 off, once per customer. */
export async function ensureReferralCode(sb: Sb, emailIn: string): Promise<string | null> {
  const email = String(emailIn || "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) return null;
  const { data: existing } = await sb.from("referral_codes").select("code").eq("email", email).maybeSingle();
  if (existing) return existing.code as string;
  for (let i = 0; i < 5; i++) {
    const code = newReferralCode();
    const { error } = await sb.from("referral_codes").insert({ code, email });
    if (error) {
      // Taken code, or a parallel request created this customer's code first.
      const { data: again } = await sb.from("referral_codes").select("code").eq("email", email).maybeSingle();
      if (again) return again.code as string;
      continue;
    }
    await sb.from("coupons").insert({ code, discount_type: "fixed", discount_value: REFERRAL_AMOUNT, applies_to: "all", one_time_per_user: true, is_active: true, description: `Referral code of ${email}` });
    return code;
  }
  return null;
}

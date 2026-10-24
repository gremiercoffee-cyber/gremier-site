import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** One notification in both languages; each device gets the one its shop is set to. */
export type CustomerPush = {
  he: { title: string; body: string };
  en: { title: string; body: string };
  url?: string;      // where a tap opens, e.g. "/#myorders"
  tag?: string;      // same tag replaces the previous notification (e.g. one per order)
  image?: string;
};

/**
 * Send a notification to the shop-app devices of one customer (by email and/or login).
 * Best-effort, never throws; expired devices are removed. Admin devices are a separate list.
 */
export async function pushToCustomer(
  sb: SupabaseClient,
  who: { email?: string | null; userId?: string | null },
  msg: CustomerPush,
): Promise<{ sent: number }> {
  const publicKey = Deno.env.get("PUSH_VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("PUSH_VAPID_PRIVATE_KEY") || "";
  const email = String(who.email || "").trim().toLowerCase();
  if (!publicKey || !privateKey || (!email && !who.userId)) return { sent: 0 };
  try {
    webpush.setVapidDetails("mailto:gremiercoffee@gmail.com", publicKey, privateKey);
    // By email (exact, case-insensitive: "_" and "%" are not wildcards) and by login; each device once.
    const cols = "id, endpoint, p256dh, auth, lang";
    const [byEmail, byUser] = await Promise.all([
      email ? sb.from("customer_push_subscriptions").select(cols).ilike("email", email.replace(/[\\%_]/g, (c) => "\\" + c)) : Promise.resolve({ data: [] }),
      who.userId ? sb.from("customer_push_subscriptions").select(cols).eq("user_id", who.userId) : Promise.resolve({ data: [] }),
    ]);
    const subs = [...new Map([...(byEmail.data || []), ...(byUser.data || [])].map((x) => [x.id, x])).values()];
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      const t = s.lang === "en" ? msg.en : msg.he;
      const payload = JSON.stringify({ audience: "customer", title: t.title, body: t.body, url: msg.url || "/", tag: msg.tag, image: msg.image });
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { urgency: "high", TTL: 86400 });
        sent++;
        await sb.from("customer_push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) await sb.from("customer_push_subscriptions").delete().eq("id", s.id);
        else console.error("customer push failed:", status, e);
      }
    }));
    return { sent };
  } catch (e) {
    console.error("pushToCustomer:", e);
    return { sent: 0 };
  }
}

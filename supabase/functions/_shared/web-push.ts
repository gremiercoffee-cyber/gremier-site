import webpush from "npm:web-push@3.6.7";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Send a Web Push notification to every stored admin subscription.
 * Best-effort: never throws; dead subscriptions (410/404) are pruned.
 */
export async function sendWebPushToAdmins(
  supabase: SupabaseClient,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<{ sent: number; failed: number; detail?: string }> {
  const publicKey = Deno.env.get("PUSH_VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("PUSH_VAPID_PRIVATE_KEY") || "";
  if (!publicKey || !privateKey) {
    console.warn("web-push: VAPID keys not configured — skipping");
    return { sent: 0, failed: 0, detail: "VAPID keys not configured on the server" };
  }
  try {
    webpush.setVapidDetails("mailto:gremiercoffee@gmail.com", publicKey, privateKey);
  } catch (e) {
    console.error("web-push: setVapidDetails failed:", e);
    return { sent: 0, failed: 0, detail: `VAPID setup failed: ${e instanceof Error ? e.message : e}` };
  }

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth");
  if (error) {
    console.error("web-push: could not load subscriptions:", error.message);
    return { sent: 0, failed: 0, detail: `Could not read subscriptions: ${error.message}` };
  }
  if (!subs?.length) {
    return { sent: 0, failed: 0, detail: "No devices are subscribed to notifications yet" };
  }

  let sent = 0;
  let failed = 0;
  let lastError = "";
  const body = JSON.stringify(payload);

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
      );
      sent++;
      await supabase
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", sub.id);
    } catch (e) {
      failed++;
      const status = (e as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        console.log("web-push: pruned dead subscription", sub.id);
        lastError = "Subscription expired — re-enable notifications on that device";
      } else {
        console.error("web-push: send failed:", status, e);
        lastError = `${status || ""} ${e instanceof Error ? e.message : String(e)}`.trim();
      }
    }
  }));

  return { sent, failed, detail: lastError || undefined };
}

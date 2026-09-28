import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Same list as public.is_gremier_admin() in the database. */
export const ADMIN_EMAILS = ["gremiercoffee@gmail.com", "yonigrey@gmail.com"];

/**
 * The only delivery fields a customer may choose. Everything else in delivery_info
 * (fees, zone, gift card / subscription / payment-link / PayMe markers) is set by the
 * server — accepting arbitrary client keys let a customer inject e.g. another order's
 * payment_link_code (whose paid sale would then "confirm" their order) or a fake
 * gift_card amount (minting a card worth more than they paid).
 */
const DELIVERY_CHOICE_KEYS = [
  "delivery_type",
  "priority_type",
  "delivery_date",
  "date_requested",
  "event_time",
  "city_en",
  "city_he",
  "city_code",
  "region",
] as const;

export function pickDeliveryChoice(raw: unknown): Record<string, unknown> {
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  for (const k of DELIVERY_CHOICE_KEYS) {
    const v = src[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function serviceKeys(): string[] {
  const keys: string[] = [];
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) keys.push(legacy);
  try {
    const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
    if (raw) for (const v of Object.values(JSON.parse(raw) as Record<string, unknown>)) if (v) keys.push(String(v));
  } catch { /* ignore */ }
  return keys;
}

/**
 * True for our own server/cron (exact service key) or a signed-in admin (verified email).
 * NOTE: a function's verify_jwt=true is NOT enough — the public website (anon) key is a
 * valid JWT, so without this anyone could call admin-only functions.
 */
export async function isServiceOrAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (serviceKeys().includes(token)) return true;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anon || token === anon) return false;
  try {
    const client = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await client.auth.getUser();
    return !!user && ADMIN_EMAILS.includes(String(user.email || "").toLowerCase());
  } catch {
    return false;
  }
}

export function forbidden(cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: "admin_only" }), {
    status: 403,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

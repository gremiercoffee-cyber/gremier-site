// Read-only, aggregate-only data for the Status Assistant (gremier-status, docs/BACKEND_CONTRACT.md there).
// Never returns customer names, phones, addresses or order ids — only per-product daily totals.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HubError } from "./hub-ops.ts";
import { buildWebIdToOps } from "./sync-ops-delivery.ts";

type Sb = ReturnType<typeof createClient>;
const TZ = "Asia/Jerusalem";
const SITE = "https://gremiercoffee.co.il";
const isDate = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const israelDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function marketingProducts(sb: Sb) {
  const { data, error } = await sb.from("products").select("id, name_en, name_he, description_en, price, is_active, category, is_subscription, images");
  if (error) throw error;
  return (data || []).map((p: any) => ({
    externalId: String(p.id),
    name: p.name_en || p.name_he || String(p.id),
    nameHe: p.name_he || null,
    category: p.is_subscription ? "subscription" : (p.category || null),
    price: p.price != null ? Number(p.price) : null,
    active: p.is_active !== false,
    // The product's own page on the website (readable form; the site resolves it — same slug rule as index.html).
    url: p.name_en ? `${SITE}/#product=${slugify(String(p.name_en))}` : `${SITE}/#product=${p.id}`,
    // The real product photos from the website (used so generated ads show the actual product).
    images: (Array.isArray(p.images) ? p.images : []).filter((u: unknown) => typeof u === "string" && (u as string).startsWith("https://")).slice(0, 3),
    description: p.description_en ? String(p.description_en).slice(0, 400) : null,
  }));
}

/** Paid website orders → units / revenue / orders per product per Israel day. Max 120 days per call. */
export async function marketingSales(sb: Sb, args: { from?: string; to?: string }) {
  if (!isDate(args.from) || !isDate(args.to)) throw new HubError("bad_range", "from and to (YYYY-MM-DD) are required");
  const from = String(args.from), to = String(args.to);
  if ((Date.parse(to) - Date.parse(from)) / 86400e3 > 120) throw new HubError("bad_range", "at most 120 days per call");
  // Pad a day each side for the timezone, then bucket by Israel date.
  const start = new Date(Date.parse(from) - 86400e3).toISOString();
  const end = new Date(Date.parse(to) + 2 * 86400e3).toISOString();
  const { data, error } = await sb.from("orders").select("created_at, items, customer_name")
    .eq("payment_status", "paid").neq("status", "cancelled").gte("created_at", start).lt("created_at", end).limit(5000);
  if (error) throw error;
  const buckets = new Map<string, { date: string; externalProductId: string; units: number; revenue: number; orders: number }>();
  for (const o of data || []) {
    if (/^TEST/i.test(String((o as any).customer_name || ""))) continue;
    const date = israelDate((o as any).created_at);
    if (date < from || date > to) continue;
    const seen = new Set<string>();
    for (const it of ((o as any).items || []) as any[]) {
      const pid = String(it?.product_id || "").trim();
      if (!pid) continue;
      const qty = Math.max(1, Number(it.qty) || 1);
      const key = `${date}|${pid}`;
      const b = buckets.get(key) || { date, externalProductId: pid, units: 0, revenue: 0, orders: 0 };
      b.units += qty;
      b.revenue += qty * (Number(it.price) || 0);
      if (!seen.has(pid)) { b.orders += 1; seen.add(pid); }
      buckets.set(key, b);
    }
  }
  return [...buckets.values()].map((b) => ({ ...b, revenue: Math.round(b.revenue * 100) / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.externalProductId.localeCompare(b.externalProductId));
}

/** Bottled stock per website product (via the same name → ops-key mapping the delivery sync uses). */
export async function marketingInventory(sb: Sb) {
  const [idToOps, inv] = await Promise.all([buildWebIdToOps(sb as any), sb.from("inventory").select("product, qty")]);
  const qtyByKey = new Map((inv.data || []).map((r: any) => [String(r.product), Number(r.qty) || 0]));
  return Object.entries(idToOps)
    .filter(([, key]) => qtyByKey.has(key))
    .map(([externalProductId, key]) => ({ externalProductId, qty: qtyByKey.get(key)! }));
}

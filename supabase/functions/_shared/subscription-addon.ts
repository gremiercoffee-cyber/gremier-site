// A one-time extra for a subscriber: paid now as its own order at the normal price, and delivered with
// their next subscription box, so it carries no delivery fee. Or added to every box at 10% off, which changes the recurring charge.
import { describe, ownsSubscription, paymeSubscription, setSubscriptionPrice } from "./subscription-control.ts";
import { loadDeliveryPricingTables, quoteDeliveryFee } from "./delivery-pricing.ts";
import "./subscription-model.js";
import { subscriptionDeliveryTarget } from "./subscription-delivery.ts";
import { pickDeliveryChoice } from "./security.ts";
import { pickAddress } from "./delivery-address.ts";

// deno-lint-ignore no-explicit-any
type Sb = any;
// deno-lint-ignore no-explicit-any
const model = () => (globalThis as any).GremierSubscriptionModel;
const money = (n: number) => Math.round(n * 100) / 100;
const israelToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
const plusDays = (day: string, n: number) => new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

/** When the next box arrives: a box already paid for and not yet delivered, otherwise the one after the next charge. */
export async function nextBoxDate(sb: Sb, subId: string, parentInfo: Record<string, unknown>, nextCharge: string | null) {
  const today = israelToday();
  const { data } = await sb.from("orders").select("order_number, delivery_info")
    .eq("delivery_info->>payme_subscription_id", subId).eq("payment_status", "paid")
    .not("status", "in", "(fulfilled,cancelled,refunded)").order("created_at", { ascending: false }).limit(1);
  const open = data?.[0];
  if (open) return { date: subscriptionDeliveryTarget(open.delivery_info || {}, today) || plusDays(today, 2), order_number: open.order_number ?? null };
  if (!nextCharge) return null;
  return { date: subscriptionDeliveryTarget({ ...parentInfo, recurring_child: true }, nextCharge) || nextCharge, order_number: null };
}

/** The signed-in owner's details and delivery for the add-on, taken from the subscription and never from the browser. */
export async function subscriptionAddonOrder(sb: Sb, req: Request, subId: string) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt && jwt !== Deno.env.get("SUPABASE_ANON_KEY") ? await sb.auth.getUser(jwt).catch(() => ({ data: { user: null } })) : { data: { user: null } };
  const email = auth?.user?.email?.toLowerCase();
  if (!email) throw new Error("Please sign in to add to your subscription.");
  if (!await ownsSubscription(sb, subId, { id: auth.user.id, email })) throw new Error("Subscription not found.");
  const summary = await describe(sb, subId) as Record<string, any> | null;
  if (!summary?.active) throw new Error("You can add to a subscription while it's active.");
  const { data: parent } = await sb.from("orders").select("order_number, customer_name, customer_email, customer_phone, delivery_address, delivery_info").eq("id", summary.order_id).maybeSingle();
  if (!parent) throw new Error("Subscription not found.");
  const info = (parent.delivery_info || {}) as Record<string, unknown>;
  const target = await nextBoxDate(sb, subId, info, summary.next_date);
  if (!target) throw new Error("We couldn't find your next delivery. Please try again.");
  const pickup = info.delivery_type === "pickup";
  const deliveryInfo: Record<string, unknown> = {
    ...pickDeliveryChoice(info), ...(pickup ? {} : pickAddress(info)),
    delivery_type: pickup ? "pickup" : "regular", delivery_date: target.date,
    subscription_addon: { sub_payme_id: subId, parent_order_id: summary.order_id, box_order_number: target.order_number ?? parent.order_number ?? null },
  };
  delete deliveryInfo.priority_type;
  delete deliveryInfo.event_time;
  const box = target.order_number ?? parent.order_number;
  return {
    customerName: parent.customer_name || "", customerEmail: parent.customer_email || "", customerPhone: parent.customer_phone || "",
    deliveryAddress: parent.delivery_address || "", deliveryInfo,
    note: `➕ One-time add-on: pack with the subscription box${box ? ` (subscription order #${box})` : ""} around ${target.date}`,
  };
}

/** New items at the subscription price: 10% off coffee, syrups at full price, as in the original box. */
export function priceAddedItems(raw: unknown, products: Record<string, any>[]) {
  const wanted = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  if (!wanted.length || wanted.length > 12) throw new Error("Choose what to add.");
  const byId = new Map(products.map((p) => [String(p.id), p]));
  let added = 0, regular = 0;
  const lines = wanted.map((w) => {
    const p = byId.get(String(w.product_id || "")), qty = Number(w.qty);
    if (!model().eligible(p) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("That item can't be added to a subscription.");
    const full = Number(p!.price), price = model().syrup(p) ? full : money(full * .9);
    added += price * qty; regular += full * qty;
    return { product_id: String(p!.id), name_en: p!.name_en, name_he: p!.name_he || p!.name_en, price, regular_price: full, qty };
  });
  return { lines, added: money(added), regular: money(regular) };
}

/** The items and amounts each renewal copies. The first order stays as it was paid, for the books. */
export function currentBox(parent: Record<string, any>) {
  const info = parent.delivery_info || {}, now = info.subscription_current;
  return now
    ? { items: now.items, subtotal: Number(now.subtotal), total: Number(now.total), fee: Number(now.delivery_fee) || 0 }
    : { items: parent.items, subtotal: Number(parent.subtotal), total: Number(parent.total), fee: Number(info.delivery_fee) || 0 };
}

/** Add items to every future box at 10% off. Without `commit` it only works out the new price, for the customer to confirm. */
export async function addToEveryBox(sb: Sb, subId: string, rawItems: unknown, opts: { commit: boolean; expected?: number }) {
  try {
    const summary = await describe(sb, subId) as Record<string, any> | null;
    if (!summary?.active) return { ok: false, error: "You can add to a subscription while it's active." };
    const { data: parent } = await sb.from("orders").select("id, items, subtotal, total, delivery_info").eq("id", summary.order_id).maybeSingle();
    const box = parent && currentBox(parent), line = box?.items?.[0];
    if (!Array.isArray(line?.subscription_items) || !line.subscription_items.length) return { ok: false, error: "This subscription can't be changed online. Please message us on WhatsApp." };
    const live = await paymeSubscription(subId);
    if (!live) return { ok: false, error: "Couldn't reach PayMe. Try again in a minute." };
    const { data: products } = await sb.from("products").select("id,name_en,name_he,price,is_active,variations,is_subscription,is_coffee_bar,category").eq("is_active", true);
    const { lines, added, regular } = priceAddedItems(rawItems, products || []);

    // Reaching the area's free-delivery amount (before discount) makes delivery free from now on. An unchanged fee stays as agreed.
    const contents = line.subscription_items as Record<string, any>[];
    const regularTotal = contents.reduce((s, c) => s + Number(c.regular_price ?? c.price) * Number(c.qty), 0) + regular;
    let fee = box.fee;
    if (fee > 0) {
      const { zones, settings } = await loadDeliveryPricingTables(sb);
      if (quoteDeliveryFee({ ...parent.delivery_info, delivery_type: "regular" }, zones, settings, regularTotal).fee === 0) fee = 0;
    }
    const current = Number(live.sub_price) / 100, next = money(current + added + fee - box.fee);
    const preview = { ok: true, current, next, added, delivery_became_free: box.fee > 0 && fee === 0, next_charge: summary.next_date };
    if (!opts.commit) return preview;
    if (opts.expected !== next) return { ok: false, error: "The price changed. Please try again." };

    const change = await setSubscriptionPrice(subId, Math.round(next * 100));
    if (!change.ok) return { ok: false, error: change.error };
    const merged = contents.map((c) => ({ ...c }));
    for (const l of lines) {
      const same = merged.find((c) => String(c.product_id) === l.product_id);
      if (same) same.qty = Number(same.qty) + l.qty; else merged.push(l);
    }
    const subtotal = money(box.subtotal + added);
    const { error } = await sb.from("orders").update({ delivery_info: { ...parent.delivery_info,
      subscription_current: { items: [{ ...line, price: subtotal, subscription_items: merged }, ...box.items.slice(1)], subtotal, total: next, delivery_fee: fee, changed_at: new Date().toISOString() } } }).eq("id", parent.id);
    if (error) return { ok: true, ...preview, record_failed: error.message };
    return preview;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

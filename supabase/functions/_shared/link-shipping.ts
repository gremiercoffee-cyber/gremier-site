// Shipping chosen by the admin when making a payment link (admin "Shipping" picker).
//
// payment_links.delivery_info = { shipping_set_by_admin: true, delivery_type, delivery_label,
//   zone_name, city_en, city_he, delivery_date, event_time, delivery_fee }
// and the fee itself is a normal line item (category "delivery_fee"), already inside the link total.
//
// The admin's choice is only a pre-filled default: the customer can change it on the pay page. While
// it stays as set, the link total stands. If it changes, the fee line comes off and the new choice is
// priced on the rest, so delivery is never charged twice. Older links that carry a manual
// "Delivery Fee" line count as set too.

type Row = { delivery_info?: unknown; items?: unknown };

const KEYS = ["delivery_type", "delivery_label", "zone_name", "city_en", "city_he", "delivery_date", "event_time", "delivery_fee"] as const;

export function hasDeliveryFeeLine(items: unknown): boolean {
  return Array.isArray(items) && items.some((i) => i && typeof i === "object" && (i as Record<string, unknown>).category === "delivery_fee");
}

const money = (n: number) => Math.round(n * 100) / 100;

/** What the delivery fee lines add to the link total. */
export function deliveryFeeLinesTotal(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return money(items.reduce((sum, i) => {
    const line = (i && typeof i === "object" ? i : {}) as Record<string, unknown>;
    return line.category === "delivery_fee" ? sum + (Number(line.price) || 0) * (Number(line.qty) || 1) : sum;
  }, 0));
}

/** The link total without any delivery the admin added. */
export function linkTotalWithoutDelivery(link: Row & { total?: unknown }): number {
  return money(Math.max(0, (Number(link.total) || 0) - deliveryFeeLinesTotal(link.items)));
}

/** True when the customer's pay-page choice is the delivery the admin set (older "delivery" means regular). */
export function choiceMatchesAdminShipping(link: Row, choice: Record<string, unknown>): boolean {
  if (!shippingSetByAdmin(link)) return false;
  const info = (link.delivery_info && typeof link.delivery_info === "object" ? link.delivery_info : {}) as Record<string, unknown>;
  const rawType = String(info.delivery_type || "");
  const adminType = !rawType || rawType === "delivery" ? "regular" : rawType;
  if (String(choice.delivery_type || "") !== adminType) return false;
  if (adminType === "pickup") return true;
  const norm = (v: unknown) => String(v || "").toLowerCase().trim();
  const hasAdminCity = !!(norm(info.city_en) || norm(info.city_he));
  const hasChosenCity = !!(norm(choice.city_en) || norm(choice.city_he));
  if (!hasAdminCity || !hasChosenCity) return true;
  return (!!norm(info.city_en) && norm(info.city_en) === norm(choice.city_en))
    || (!!norm(info.city_he) && norm(info.city_he) === norm(choice.city_he));
}

/** True when the admin already decided the shipping for this link. */
export function shippingSetByAdmin(link: Row): boolean {
  const info = link.delivery_info && typeof link.delivery_info === "object" ? link.delivery_info as Record<string, unknown> : {};
  return info.shipping_set_by_admin === true || hasDeliveryFeeLine(link.items);
}

/** The admin's shipping choice, safe to copy onto the order's delivery_info. */
export function adminShippingInfo(link: Row): Record<string, unknown> {
  if (!shippingSetByAdmin(link)) return {};
  const info = link.delivery_info && typeof link.delivery_info === "object" ? link.delivery_info as Record<string, unknown> : {};
  const out: Record<string, unknown> = { shipping_set_by_admin: true };
  for (const k of KEYS) {
    const v = info[k];
    if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

// Shipping chosen by the admin when making a payment link (admin "Shipping" picker).
//
// payment_links.delivery_info = { shipping_set_by_admin: true, delivery_type, delivery_label,
//   zone_name, city_en, city_he, delivery_date, event_time, delivery_fee }
// and the fee itself is a normal line item (category "delivery_fee"), already inside the link total.
//
// Such a link must never be priced again from the customer's pay-page choice (that would charge
// delivery twice). Older links that carry a manual "Delivery Fee" line count as set too.

type Row = { delivery_info?: unknown; items?: unknown };

const KEYS = ["delivery_type", "delivery_label", "zone_name", "city_en", "city_he", "delivery_date", "event_time", "delivery_fee"] as const;

export function hasDeliveryFeeLine(items: unknown): boolean {
  return Array.isArray(items) && items.some((i) => i && typeof i === "object" && (i as Record<string, unknown>).category === "delivery_fee");
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

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Delivery pricing shared by the website checkout and payment links, so both
 * charge the same amount for the same city + delivery option.
 */

export function normalizeCityName(value: unknown): string {
  return String(value || "").toLowerCase().trim().replace(/['"`]/g, "").replace(/\s+/g, " ");
}

export type DeliveryQuote = {
  fee: number;
  source: "zone" | "default" | "none";
  zone: Record<string, unknown> | null;
  typeLabel: string;
};

/** Human label for a delivery choice, matching the storefront wording. */
export function deliveryTypeLabel(type: string, priorityType?: string): string {
  if (type === "pickup") return "Pickup — no delivery";
  if (type === "event") return "Event delivery";
  if (type === "expedited") {
    return priorityType === "specific_date" ? "Expedited — specific date" : "Expedited (next day)";
  }
  return "Regular (within 2 days)";
}

/**
 * Price one delivery. `subtotal` only matters for a zone's free-above threshold.
 * Returns fee 0 for pickup.
 */
export function quoteDeliveryFee(
  deliveryInfo: Record<string, unknown>,
  deliveryZones: Record<string, unknown>[],
  settings: Record<string, unknown> | null,
  subtotal = 0,
): DeliveryQuote {
  const rawType = String(deliveryInfo.delivery_type || "regular");
  if (rawType === "pickup" || rawType === "none") {
    return { fee: 0, source: "none", zone: null, typeLabel: deliveryTypeLabel("pickup") };
  }
  const shipType = rawType === "expedited" ? "expedited" : rawType === "event" ? "event" : "regular";

  const cityCode = String(deliveryInfo.city_code || "").trim();
  const cityEn = normalizeCityName(deliveryInfo.city_en);
  const cityHe = String(deliveryInfo.city_he || "").trim();
  const zone = deliveryZones.find((z) => {
    if (cityCode && z.city_code && String(z.city_code) === cityCode) return true;
    const zoneEn = normalizeCityName(z.name_en);
    return (zoneEn && cityEn && (zoneEn === cityEn || zoneEn.includes(cityEn) || cityEn.includes(zoneEn)))
      || (!!cityHe && String(z.name_he || "").trim() === cityHe);
  }) || null;

  const regular = zone ? Number(zone.regular_price) || 0 : (Number(settings?.default_regular_price) || 30);
  const expedited = zone ? Number(zone.expedited_price) || 0 : (Number(settings?.default_expedited_price) || 50);
  const eventPrice = zone
    ? (zone.event_price != null ? Number(zone.event_price) : expedited)
    : (Number(settings?.default_event_price) || 80);
  const freeAbove = zone?.free_above ? Number(zone.free_above) : null;

  const freeByThreshold = freeAbove != null && subtotal >= freeAbove;
  const fee = shipType === "expedited"
    ? expedited
    : shipType === "event"
    ? eventPrice
    : (freeByThreshold ? 0 : regular);

  return {
    fee,
    source: zone ? "zone" : "default",
    zone,
    typeLabel: deliveryTypeLabel(shipType, String(deliveryInfo.priority_type || "")),
  };
}

/** Load zones + settings once, for callers that need to price a delivery. */
export async function loadDeliveryPricingTables(
  supabase: SupabaseClient,
): Promise<{ zones: Record<string, unknown>[]; settings: Record<string, unknown> | null }> {
  const [zonesRes, settingsRes] = await Promise.all([
    supabase.from("delivery_zones").select("*").eq("is_active", true),
    supabase.from("delivery_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (zonesRes.error) console.error("delivery zones load failed:", zonesRes.error.message);
  if (settingsRes.error) console.error("delivery settings load failed:", settingsRes.error.message);
  return { zones: zonesRes.data || [], settings: settingsRes.data || null };
}

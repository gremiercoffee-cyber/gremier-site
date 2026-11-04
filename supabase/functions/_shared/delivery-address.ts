// Customer delivery address pieces sent with a website order (see address-picker.js), checked on the server.
//   address_entered: the street the customer typed / confirmed (their own words)
//   address_place:   the Google place they selected { source:'google', id, label, precision, locality, confirmed, at }
//                    or a location they confirmed themselves { source:'pin', lat, lng, confirmed, at }
//   address_details: { apartment, floor, entrance, instructions } (never sent to Google Maps)
// Anything else is dropped. A missing / invalid place just means "needs review" later; never a guess.

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const text = (v: unknown, n: number) => String(v ?? "").replace(/[<>"`]/g, "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, n);
const isoOrNow = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : new Date().toISOString());

export type AddressPlace =
  | { source: "google"; id: string; label: string; precision: "building" | "approximate"; locality: string; confirmed: boolean; at: string }
  | { source: "pin"; lat: number; lng: number; confirmed: boolean; at: string };

export function cleanPlace(raw: unknown): AddressPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.source === "google" && PLACE_ID.test(String(p.id || ""))) {
    const precision = p.precision === "building" ? "building" : "approximate";
    return { source: "google", id: String(p.id), label: text(p.label, 200), precision, locality: text(p.locality, 80), confirmed: precision === "building" || p.confirmed === true, at: isoOrNow(p.at) };
  }
  if (p.source === "pin") {
    const lat = Number(p.lat), lng = Number(p.lng);
    // Pins are only accepted around Israel and the West Bank (our delivery area and then some).
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat > 29 && lat < 33.5 && lng > 34 && lng < 36) {
      return { source: "pin", lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, confirmed: p.confirmed === true, at: isoOrNow(p.at) };
    }
  }
  return null;
}

export function cleanDetails(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, n] of [["apartment", 20], ["floor", 20], ["entrance", 40], ["instructions", 200]] as const) {
    const v = text(d[k], n);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The address fields allowed into orders.delivery_info. */
export function pickAddress(info: unknown): Record<string, unknown> {
  const src = info && typeof info === "object" ? info as Record<string, unknown> : {};
  const out: Record<string, unknown> = {};
  const entered = text(src.address_entered, 120);
  if (entered) out.address_entered = entered;
  const place = cleanPlace(src.address_place);
  if (place) out.address_place = place;
  const details = cleanDetails(src.address_details);
  if (details) out.address_details = details;
  return out;
}

/** jobs columns (migration 20261104200000) for a delivery made from an order. */
export function addressColumns(info: unknown): Record<string, unknown> {
  const a = pickAddress(info);
  return { ...(a.address_place ? { delivery_location: a.address_place } : {}), ...(a.address_details ? { delivery_details: a.address_details } : {}) };
}

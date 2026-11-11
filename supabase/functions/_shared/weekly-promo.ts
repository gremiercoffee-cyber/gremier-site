/** Tuesday and Wednesday (Israel time): a regular-delivery order to Jerusalem or Beit Shemesh is
 *  guaranteed to arrive before Shabbat, at the usual delivery price (free or paid). Same rule as the
 *  website's shabbatPromoActive() / shabbatGuaranteedZone() in index.html. */
export function shabbatPromoActive(now = new Date()): boolean {
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Jerusalem" }).format(now);
  return day === "Tue" || day === "Wed";
}

/** The delivery zones where arrival before Shabbat is guaranteed. */
export function shabbatGuaranteedZone(zoneName: unknown): boolean {
  return /jerusalem|be(i)?t shemesh/i.test(String(zoneName || ""));
}

/** Free regular delivery to Beit Shemesh on these Israel-time days (orders placed then). One-off promo
 *  for the week of 11 November 2026; it ends by itself. Same list as BEIT_SHEMESH_FREE_DAYS in index.html. */
export const BEIT_SHEMESH_FREE_DAYS = ["2026-11-11", "2026-11-12"];
export function beitShemeshFreeDelivery(zoneName: unknown, now = new Date()): boolean {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return BEIT_SHEMESH_FREE_DAYS.includes(day) && /be(i)?t shemesh/i.test(String(zoneName || ""));
}

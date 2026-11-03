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

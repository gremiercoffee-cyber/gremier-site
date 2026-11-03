/** Tuesday and Wednesday (Israel time): an order that already qualifies for free regular delivery
 *  is guaranteed to arrive before Shabbat. Delivery prices don't change. Same rule as the website's
 *  shabbatPromoActive() in index.html. */
export function shabbatPromoActive(now = new Date()): boolean {
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Jerusalem" }).format(now);
  return day === "Tue" || day === "Wed";
}

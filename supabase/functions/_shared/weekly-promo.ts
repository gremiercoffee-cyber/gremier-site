/** Tuesday and Wednesday (Israel time): regular delivery is free and arrives before Shabbat
 *  (guaranteed in Jerusalem and Beit Shemesh; elsewhere best effort). Same rule as the website's
 *  shabbatPromoActive() in index.html. */
export function shabbatPromoActive(now = new Date()): boolean {
  const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Jerusalem" }).format(now);
  return day === "Tue" || day === "Wed";
}

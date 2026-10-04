/**
 * Shabbat quiet time: from 18 minutes before Friday sunset until 42 minutes after Saturday sunset.
 * Sunset comes from the standard sunrise equation (accurate to a minute or two), for Jerusalem
 * unless the time zone says otherwise. No network calls.
 */
const RAD = Math.PI / 180;
const LOCATIONS: Record<string, [number, number]> = {
  "Asia/Jerusalem": [31.778, 35.235],
  "Asia/Tel_Aviv": [32.08, 34.78],
  "America/New_York": [40.71, -74.0],
  "Europe/London": [51.51, -0.13],
};

/** Sunset (UTC instant) for the calendar day `ymd` at lat/lon. */
function sunset(ymd: string, lat: number, lon: number): Date {
  const noonUtc = Date.parse(`${ymd}T12:00:00Z`);
  const jd = noonUtc / 86400000 + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = n - lon / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD);
  const sinDec = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDec) / (Math.cos(lat * RAD) * cosDec);
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / RAD;
  return new Date((jTransit + w / 360 - 2440587.5) * 86400000);
}

function localDay(tz: string, d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, weekday: p.weekday as string };
}

export function shabbatWindow(tz: string, at = new Date()) {
  const [lat, lon] = LOCATIONS[tz] ?? LOCATIONS["Asia/Jerusalem"];
  const { ymd, weekday } = localDay(tz, at);
  const fri = weekday === "Fri" ? ymd : weekday === "Sat" ? shift(ymd, -1) : null;
  if (!fri) return null;
  const start = new Date(sunset(fri, lat, lon).getTime() - 18 * 60_000);
  const end = new Date(sunset(shift(fri, 1), lat, lon).getTime() + 42 * 60_000);
  return { start, end };
}

export function isShabbat(tz: string, at = new Date()) {
  const w = shabbatWindow(tz, at);
  return !!w && at >= w.start && at < w.end;
}

/** True during the first few hours after Shabbat ends (for the "while you were away" summary). */
export function justAfterShabbat(tz: string, at = new Date()) {
  const w = shabbatWindow(tz, at);
  return !!w && at >= w.end && at.getTime() - w.end.getTime() < 3 * 3600_000;
}

function shift(ymd: string, days: number) {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

// supabase/functions/places/index.ts
// Address search for checkout, admin delivery scheduling and the route planner.
// A thin proxy to Google Places API (New), so the Google key stays on the server.
//
//   POST { action: "autocomplete", input, session, lang }  → { suggestions: [{ placeId, main, secondary }] }
//   POST { action: "details", placeId, session, lang }      → { place: { id, label, precision, locality } }
//
// Billing: autocomplete calls that end in a details call with the same `session` token are billed as one
// session (Place Details Essentials). Only the fields below are requested.
// Coverage: our delivery area crosses Google's IL/PS labels (Beitar Illit is often labelled PS), so both
// region codes are allowed and results are biased (not restricted) to a circle around Jerusalem.
// Storage: callers keep the place ID (allowed indefinitely). The Google label is for showing the customer
// what they picked; long-term records keep the customer's own address text instead.
// Secret: GOOGLE_PLACES_API_KEY (see docs/DELIVERY_ROUTES.md).

const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?gremiercoffee\.co\.il$/, /^https:\/\/[a-z0-9-]+\.gremier-site\.pages\.dev$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const REGION_CODES = ["il", "ps"];
const BIAS = { circle: { center: { latitude: 31.74, longitude: 35.08 }, radius: 50000 } };   // Jerusalem · Beit Shemesh · Beitar Illit
const BUILDING_TYPES = new Set(["street_address", "premise", "subpremise"]);

function corsFor(origin: string | null) {
  const ok = !!origin && ALLOWED_ORIGINS.some((re) => re.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://gremiercoffee.co.il",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const SESSION = /^[A-Za-z0-9_-]{8,64}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/** "building" when Google matched a specific street number / building, otherwise "approximate". */
export function precisionOf(place: { types?: string[]; addressComponents?: { types?: string[] }[] }): "building" | "approximate" {
  if ((place.types || []).some((t) => BUILDING_TYPES.has(t))) return "building";
  if ((place.addressComponents || []).some((c) => (c.types || []).includes("street_number"))) return "building";
  return "approximate";
}

Deno.serve(async (req) => {
  const cors = corsFor(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.some((re) => re.test(origin))) return json({ error: "origin_not_allowed" }, 403);
  const key = (Deno.env.get("GOOGLE_PLACES_API_KEY") || "").trim();
  if (!key) return json({ error: "not_configured" }, 503);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const lang = body.lang === "he" ? "he" : "en";
  const session = SESSION.test(String(body.session || "")) ? String(body.session) : undefined;
  const google = (url: string, init: RequestInit, fields: string) =>
    fetch(url, { ...init, headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields }, signal: AbortSignal.timeout(8000) });

  try {
    if (body.action === "autocomplete") {
      const input = String(body.input || "").trim().slice(0, 120);
      if (input.length < 2) return json({ suggestions: [] });
      const res = await google("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        body: JSON.stringify({ input, sessionToken: session, languageCode: lang, includedRegionCodes: REGION_CODES, locationBias: BIAS }),
      }, "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat");
      if (!res.ok) { console.error("places autocomplete", res.status, await res.text()); return json({ error: "lookup_failed" }, 502); }
      const data = await res.json() as { suggestions?: { placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] };
      const suggestions = (data.suggestions || []).map((s) => s.placePrediction).filter((p) => p?.placeId).slice(0, 6)
        .map((p) => ({ placeId: p!.placeId, main: p!.structuredFormat?.mainText?.text || "", secondary: p!.structuredFormat?.secondaryText?.text || "" }));
      return json({ suggestions });
    }
    if (body.action === "details") {
      const placeId = String(body.placeId || "");
      if (!PLACE_ID.test(placeId)) return json({ error: "bad_place" }, 400);
      const qs = new URLSearchParams({ languageCode: lang, ...(session ? { sessionToken: session } : {}) });
      const res = await google(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${qs}`, { method: "GET" }, "id,formattedAddress,types,addressComponents");
      if (!res.ok) { console.error("places details", res.status, await res.text()); return json({ error: "lookup_failed" }, 502); }
      const p = await res.json() as { id: string; formattedAddress?: string; types?: string[]; addressComponents?: { longText?: string; types?: string[] }[] };
      const locality = (p.addressComponents || []).find((c) => (c.types || []).includes("locality"))?.longText || "";
      return json({ place: { id: p.id, label: p.formattedAddress || "", precision: precisionOf(p), locality } });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("places error", e);
    return json({ error: "lookup_failed" }, 502);
  }
});

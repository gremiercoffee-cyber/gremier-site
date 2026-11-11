// A tracked WhatsApp link: count the click, then send the person to the page the post was promoting.
// WhatsApp fetches links itself to draw the preview, and that must not count as a click.
// Owner and test browsers carry the gremier_internal cookie (set by storefront-journeys.js) and aren't counted.
// The click is recorded in the background so a slow lookup never loses it; the destination is cached per link,
// and if it isn't known within 2.5 seconds the person goes to the homepage rather than waiting.
const API = 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/site-journeys';
const KEY = 'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn';
const NOT_A_PERSON = /bot|spider|crawler|preview|facebookexternalhit|whatsapp|telegram|slack|headless/i;

export async function onRequestGet({ request, params, waitUntil }) {
  const code = String(params.code || '').toLowerCase();
  const home = new URL('/', request.url);
  if (!/^[a-z0-9]{6,12}$/.test(code)) return go(home);
  const internal = /(?:^|;\s*)gremier_internal=1(?:;|$)/.test(request.headers.get('cookie') || '');
  const count = !internal && !NOT_A_PERSON.test(request.headers.get('user-agent') || '');
  const cache = caches.default, cacheKey = new Request(new URL('/__go-target/' + code, request.url));

  const lookup = fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ action: 'link_click', code, count }),
    signal: AbortSignal.timeout(10000),
  }).then((r) => r.json()).then(async (data) => {
    if (data && data.target) await cache.put(cacheKey, new Response(data.target, { headers: { 'Cache-Control': 'max-age=86400' } }));
    return data && data.target;
  }).catch(() => null);
  waitUntil(lookup);   // the click is counted even after the person has been sent on

  let target = await cache.match(cacheKey).then((r) => (r ? r.text() : null)).catch(() => null);
  if (!target) target = await Promise.race([lookup, new Promise((resolve) => setTimeout(() => resolve(null), 2500))]);
  let destination = home;
  try { if (target) destination = new URL(target); } catch (_) { /* bad target: homepage */ }
  destination.searchParams.set('l', code);
  return go(destination);
}
const go = (url) => new Response(null, { status: 302, headers: { Location: url.toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

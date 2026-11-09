// A tracked WhatsApp link: count the click, then send the person to the page the post was promoting.
// WhatsApp fetches links itself to draw the preview, and that must not count as a click.
const API = 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/site-journeys';
const KEY = 'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn';
const NOT_A_PERSON = /bot|spider|crawler|preview|facebookexternalhit|whatsapp|telegram|slack|headless/i;

export async function onRequestGet({ request, params }) {
  const code = String(params.code || '').toLowerCase();
  const home = new URL('/', request.url);
  let destination = home;
  if (/^[a-z0-9]{6,12}$/.test(code)) {
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ action: 'link_click', code, count: !NOT_A_PERSON.test(request.headers.get('user-agent') || '') }),
        signal: AbortSignal.timeout(1500),
      });
      const data = await response.json();
      if (data.target) destination = new URL(data.target);
    } catch (_) { /* the customer still reaches the site */ }
    destination.searchParams.set('l', code);
  }
  return new Response(null, { status: 302, headers: { Location: destination.toString(), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

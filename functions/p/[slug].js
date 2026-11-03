// /p/<product> — the same shop page (the product opens in its drawer), but with that product's title,
// description, preview image and price data in the page itself, so Google and link previews see it.
import { SITE, products, slug, esc, image } from '../_catalog.js';

export async function onRequestGet({ params, request, env }) {
  const page = await env.ASSETS.fetch(new URL('/', request.url));
  let p = null;
  try { p = (await products()).find((x) => slug(x.name_en) === String(params.slug || '').toLowerCase() || String(x.id) === params.slug); } catch (_) {}
  if (!p) {   // links from before the cups were renamed "XL cups"
    const old = (await products().catch(() => [])).find((x) => slug(x.name_en).replace('-xl-', '-') === String(params.slug || '').toLowerCase());
    if (old) return Response.redirect(`${SITE}/p/${slug(old.name_en)}`, 301);
  }
  if (!p) return new Response(page.body, { status: 404, headers: page.headers });
  const url = `${SITE}/p/${slug(p.name_en)}`;
  const title = `${p.name_en}${p.name_he ? ' · ' + p.name_he : ''} | Gremier Coffee`;
  const desc = [p.description_en, p.description_he].filter(Boolean).join(' · ') || `${p.name_en}: cold brew from Gremier Coffee, delivered in Israel.`;
  const price = Number((p.variations || []).find((v) => v.type === 'guest_count')?.options?.[0]?.price) || Number(p.price);
  const data = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.name_en, alternateName: p.name_he || undefined,
    description: desc, image: (p.images || []).slice(0, 4).map((u) => image(u)), url,
    brand: { '@type': 'Brand', name: 'Gremier Coffee' }, sku: String(p.id),
    offers: { '@type': 'Offer', url, priceCurrency: 'ILS', price: price.toFixed(2), availability: 'https://schema.org/InStock', seller: { '@type': 'Organization', name: 'Gremier Coffee Co.' } },
  };
  const meta = `<link rel="canonical" href="${esc(url)}">
<meta name="description" content="${esc(desc.slice(0, 300))}">
<meta property="og:type" content="product"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc.slice(0, 300))}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image(p.images?.[0]))}">
<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
  return new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"], link[rel="canonical"], meta[property^="og:"]', { element(e) { e.remove(); } })
    .on('head', { element(e) { e.append(meta, { html: true }); } })
    .transform(new Response(page.body, { status: 200, headers: page.headers }));
}

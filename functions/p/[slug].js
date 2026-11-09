// /p/<product> — the same shop page (the product opens in its drawer), but with that product's title,
// description, preview image and price data in the page itself, so Google and link previews see it.
import { SITE, products, slug, esc, image } from '../_catalog.js';

const LEGACY_MINI_LINKS = new Map([
  ['5l-classic-dark-roast', 'ef3b8323-14ee-43f2-a9a1-1614d00ad01a'],
  ['5l-colombia-light-roast', '925b8f32-1c0d-4f5f-896a-04a0e1835032'],
  ['5l-house-blend', 'd8cf4c7e-916c-41f2-b27b-af5f9ac865c2'],
  ['3-5l-classic-dark-roast', '7fce55f8-6612-48e2-8f78-0b755acaf648'],

  ['caramel-cremier-4-pack', '1c28055f-79b8-4d99-b7f2-38c270b47af7'],
  ['vanilla-cremier-4-pack', '72aede63-74a3-4ea5-b638-6c91705b62e1'],
  ['original-cremier-4-pack', '5349f657-09bb-4624-8f55-96a694e1b08d'],
]);

export async function onRequestGet({ params, request, env }) {
  const page = await env.ASSETS.fetch(new URL('/', request.url));
  const key = String(params.slug || '').toLowerCase();
  const catalogue = await products().catch(() => []);
  const p = catalogue.find(x => slug(x.name_en) === key || String(x.id) === key);
  if (!p) {
    const legacyId = LEGACY_MINI_LINKS.get(key);
    const old = catalogue.find(x => String(x.id) === legacyId)
      || catalogue.find(x => slug(x.name_en).replace('-xl-', '-') === key);
    if (old) {
      const destination = new URL(`/p/${slug(old.name_en)}`, SITE);
      destination.search = new URL(request.url).search;
      return Response.redirect(destination, 301);
    }
  }
  if (!p) return new Response(page.body, { status: 404, headers: page.headers });
  const url = `${SITE}/p/${slug(p.name_en)}`;
  // Coffee pages say "cold brew" in the title and heading, in both languages, so they can match those searches.
  const isBrew = ['bottles', 'minis', 'bulk'].includes(p.category) && !/syrup/i.test(p.name_en);
  const heading = isBrew ? `${p.name_en} Cold Brew${p.name_he ? ' · קולד ברו ' + p.name_he : ''}` : `${p.name_en}${p.name_he ? ' · ' + p.name_he : ''}`;
  const title = `${heading} | Gremier Coffee`;
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
    .on('meta[name="description"], link[rel="canonical"], link[rel="alternate"][hreflang], meta[property^="og:"]', { element(e) { e.remove(); } })
    // The page's main heading is this product; the shop's own slogan stays on screen as ordinary text.
    .on('h1#t-hero-title', { element(e) {
      e.tagName = 'div';
      e.before(`<h1 style="margin:0 0 6px;font:500 .95rem 'DM Sans',sans-serif;color:#1a1a1a">${esc(heading)}</h1>`, { html: true });
    } })
    .on('head', { element(e) { e.append(meta, { html: true }); } })
    .transform(new Response(page.body, { status: 200, headers: page.headers }));
}

// The sitemap Google reads: the home page, every product's own link, and the delivery-area pages.
import { SITE, products, zones, slug, cityName } from './_catalog.js';
import { guidePaths } from './_guides.js';

export async function onRequestGet() {
  let ps = [], zs = [];
  try { [ps, zs] = await Promise.all([products(), zones()]); } catch (_) {}
  const urls = [`${SITE}/`, `${SITE}/he`, `${SITE}/terms`, `${SITE}/where-to-buy`, ...guidePaths().map((p) => SITE + p), ...ps.map((p) => `${SITE}/p/${slug(p.name_en)}`), ...zs.map((z) => `${SITE}/delivery/${slug(cityName(z))}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

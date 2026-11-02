// /delivery/<city> — a short page per delivery area ("cold brew delivery in Jerusalem"), in Hebrew and
// English, with that area's delivery price and free-delivery amount, the coffees and coffee bars.
import { SITE, products, zones, slug, esc, cityName, image } from '../_catalog.js';

export async function onRequestGet({ params }) {
  let zone = null, list = [];
  try { const [zs, ps] = await Promise.all([zones(), products()]); zone = zs.find((z) => slug(cityName(z)) === String(params.city || '').toLowerCase()); list = ps; } catch (_) {}
  if (!zone) return Response.redirect(SITE + '/', 302);
  const en = cityName(zone), he = zone.name_he || en, url = `${SITE}/delivery/${slug(en)}`;
  const price = Number(zone.regular_price) || 0, free = Number(zone.free_above) || 0;
  const delEn = price === 0 ? `Delivery to ${en} is free.` : `Delivery to ${en} is ₪${price}${free ? `, free on orders from ₪${free}` : ''}.`;
  const delHe = price === 0 ? `המשלוח ל${he} חינם.` : `משלוח ל${he}: ₪${price}${free ? `, חינם בהזמנה מ-₪${free}` : ''}.`;
  const coffees = list.filter((p) => ['bottles', 'minis', 'bulk'].includes(p.category)).slice(0, 12);
  const card = (p) => `<a class="p" href="/p/${slug(p.name_en)}"><img src="${esc(image(p.images?.[0], 400))}" alt="" loading="lazy"><b>${esc(p.name_en)}</b><span dir="rtl">${esc(p.name_he || '')}</span><i>₪${Number(p.price)}</i></a>`;
  const title = `Cold brew delivery in ${en} · קולד ברו עם משלוח ב${he} | Gremier Coffee`;
  const desc = `Slow-brewed cold brew delivered in ${en}: liter bottles, minis, 5L jerry cans and coffee bars for events. ${delEn} · קולד ברו עם משלוח ב${he}. ${delHe}`;
  const data = { '@context': 'https://schema.org', '@type': 'Store', name: 'Gremier Coffee Co.', url: SITE, image: `${SITE}/icon-512.png`, areaServed: { '@type': 'City', name: en }, priceRange: '₪₪' };
  const html = `<!doctype html><html lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${SITE}/icon-512.png">
<link rel="icon" href="/icon-192.png"><script type="application/ld+json">${JSON.stringify(data)}</script>
<style>
body{margin:0;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1a1a1a;background:#faf8f5}
main{max-width:920px;margin:0 auto;padding:28px 16px 60px}
header{display:flex;align-items:center;gap:10px;margin-bottom:24px}header img{width:44px;height:44px;border-radius:50%}header a{color:inherit;text-decoration:none;font-weight:700}
h1{font-size:1.7rem;line-height:1.25;margin:0 0 6px}h2{font-size:1.15rem;margin:30px 0 10px}
.he{direction:rtl;text-align:right}.lead{color:#555}.box{background:#fff;border:1px solid #e6e4df;border-radius:16px;padding:18px 20px;margin:16px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.p{display:grid;gap:3px;background:#fff;border:1px solid #e6e4df;border-radius:14px;padding:10px;text-decoration:none;color:inherit}.p img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#f2efea}
.p b{font-size:.88rem}.p span{font-size:.82rem;color:#666}.p i{font-style:normal;font-weight:600}
.cta{display:inline-block;margin:8px 8px 0 0;padding:12px 20px;border-radius:999px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600}.cta.alt{background:#fff;color:#1a1a1a;border:1.5px solid #1a1a1a}
</style><link rel="stylesheet" href="/storefront-journeys.css?v=20261102-2"></head><body><main>
<header><img src="/icon-192.png" alt=""><a href="/">Gremier Coffee Co.</a></header>
<section class="he"><h1>קולד ברו עם משלוח ב${esc(he)}</h1><p class="lead">קולד ברו בחליטה איטית, חלק ובלי מרירות, לבית, למשרד ולאירועים ב${esc(he)}.</p>
<div class="box">${esc(delHe)} אפשר לבחור משלוח רגיל או מהיר, וגם תאריך.</div>
<a class="cta" href="/#shop">לחנות</a><a class="cta alt" href="/#coffeebars">בר קפה לאירוע ב${esc(he)}</a></section>
<section><h2>Cold brew delivery in ${esc(en)}</h2><p class="lead">Slow-brewed cold brew, smooth and never bitter, for home, the office and events in ${esc(en)}.</p>
<div class="box">${esc(delEn)} Choose regular or expedited delivery, or pick a date.</div>
<a class="cta" href="/#shop">Shop the coffee</a><a class="cta alt" href="/#coffeebars">Coffee bar for an event in ${esc(en)}</a></section>
<h2>Our coffee · הקפה שלנו</h2><div class="grid">${coffees.map(card).join('')}</div>
<div class="box he">☕ נחלט טרי באצוות קטנות · כשר בהשגחת הרב שמואל ויינער</div>
</main><script src="/storefront-journeys.js?v=20261102-4"></script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' } });
}

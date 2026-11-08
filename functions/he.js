// /he: the same shop, opened in Hebrew, with a Hebrew title, description and link of its own, so Google can
// list a Hebrew page for Hebrew searches ("קולד ברו") next to the English home page.
import { SITE } from './_catalog.js';

const TITLE = 'קולד ברו בישראל | גרמיר קפה · Gremier Coffee';
const DESC = 'קולד ברו בחליטה איטית בירושלים, חלק ובלי מרירות, עם משלוח לכל הארץ: בקבוקי ליטר, מיני, ג׳ריקנים של 5 ליטר ובר קפה לאירועים. כשר.';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export async function onRequestGet({ request, env }) {
  const page = await env.ASSETS.fetch(new URL('/', request.url));
  const url = `${SITE}/he`;
  const meta = `<link rel="canonical" href="${url}">
<meta name="description" content="${esc(DESC)}">
<meta property="og:type" content="website"><meta property="og:locale" content="he_IL"><meta property="og:title" content="${esc(TITLE)}"><meta property="og:description" content="${esc(DESC)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/icon-512.png">
<script>window.GREMIER_FORCE_LANG='he';</script>`;
  return new HTMLRewriter()
    .on('html', { element(e) { e.setAttribute('lang', 'he'); } })
    .on('title', { element(e) { e.setInnerContent(TITLE); } })
    .on('meta[name="description"], link[rel="canonical"], meta[property^="og:"]', { element(e) { e.remove(); } })
    .on('head', { element(e) { e.append(meta, { html: true }); } })
    .transform(new Response(page.body, { status: 200, headers: page.headers }));
}

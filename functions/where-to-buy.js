// /where-to-buy — the stores that carry Gremier: a map with a pin per store, the list with addresses,
// and Directions (Google Maps / Waze). Hebrew and English. Reads the public store_locations view.
import { SITE, esc } from './_catalog.js';
const SUPABASE_URL = 'https://ayuzmwpmhncxrugsyxmw.supabase.co';
const KEY = 'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn';

export async function onRequestGet() {
  let stores = [];
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/store_locations?select=name,address,city,lat,lng&order=city,name`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) stores = await r.json();
  } catch (_) {}
  const nav = (s) => ({ g: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, w: `https://waze.com/ul?ll=${s.lat},${s.lng}&navigate=yes` });
  const title = 'Where to buy Gremier · איפה קונים גרמיר | Gremier Coffee';
  const desc = `Gremier cold brew in stores in ${[...new Set(stores.map((s) => s.city))].join(', ') || 'Jerusalem'}. · קולד ברו גרמיר בחנויות: ${stores.map((s) => s.name).join(', ')}.`;
  const data = { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Stores that carry Gremier Coffee', itemListElement: stores.map((s, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Store', name: s.name, address: { '@type': 'PostalAddress', streetAddress: s.address, addressLocality: s.city, addressCountry: 'IL' }, geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lng } } })) };
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}/where-to-buy">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE}/where-to-buy"><meta property="og:image" content="${SITE}/icon-512.png">
<link rel="icon" href="/icon-192.png"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<style>
body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1a1a1a;background:#faf8f5}
main{max-width:980px;margin:0 auto;padding:24px 16px 60px}
header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:18px}header a{color:inherit;text-decoration:none;font-weight:700;display:flex;align-items:center;gap:10px}header img{width:42px;height:42px;border-radius:50%}
.lang{font-size:.85rem;color:#6b7178}
h1{font-size:1.7rem;margin:0 0 4px}.en{direction:ltr;text-align:left;color:#555;margin:0 0 16px}
#map{height:420px;border-radius:18px;border:1px solid #e6e4df;overflow:hidden;background:#eee}
.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:18px}
.s{background:#fff;border:1px solid #e6e4df;border-radius:16px;padding:14px 16px;cursor:pointer}.s b{display:block;font-size:1.02rem}.s span{color:#666;font-size:.9rem}
.go{display:flex;gap:8px;margin-top:10px}.go a{flex:1;text-align:center;padding:8px 10px;border-radius:999px;border:1.5px solid #1a1a1a;color:#1a1a1a;text-decoration:none;font-size:.85rem;font-weight:600}.go a.w{background:#1a1a1a;color:#fff}
.cta{margin-top:26px;background:#fff;border:1px solid #e6e4df;border-radius:16px;padding:18px;text-align:center}.cta a{display:inline-block;margin-top:8px;padding:12px 22px;border-radius:999px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600}
.leaflet-popup-content{font:14px/1.5 system-ui,Arial,sans-serif;direction:rtl;text-align:right}
@media(max-width:600px){#map{height:320px}h1{font-size:1.4rem}}
</style></head><body><main>
<header><a href="/"><img src="/icon-192.png" alt="">Gremier Coffee Co.</a><a class="lang" href="/">← לאתר · Back to the shop</a></header>
<h1>איפה קונים גרמיר</h1><p class="en">Where to buy Gremier cold brew: the stores that carry it.</p>
<div id="map" role="img" aria-label="מפת החנויות · Store map"></div>
<div class="list">${stores.map((s, i) => { const n = nav(s); return `<div class="s" data-i="${i}"><b>${esc(s.name)}</b><span>${esc(s.address || '')}${s.city ? ', ' + esc(s.city) : ''}</span><div class="go"><a href="${n.w}" class="w" target="_blank" rel="noopener">Waze</a><a href="${n.g}" target="_blank" rel="noopener">Google Maps</a></div></div>`; }).join('') || '<p>בקרוב · Coming soon</p>'}</div>
<div class="cta">לא ליד אחת מהחנויות? אנחנו גם שולחים. · Not near one? We deliver too.<br><a href="/#shop">לחנות באתר · Shop online</a></div>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
const stores=${JSON.stringify(stores.map((s) => ({ name: s.name, address: [s.address, s.city].filter(Boolean).join(', '), lat: s.lat, lng: s.lng })) ).replace(/</g, '\\u003c')};
if(window.L&&stores.length){
  const map=L.map('map',{scrollWheelZoom:false});
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const markers=stores.map(s=>L.marker([s.lat,s.lng]).addTo(map).bindPopup('<b>'+esc(s.name)+'</b><br>'+esc(s.address)+'<br><a target="_blank" rel="noopener" href="https://waze.com/ul?ll='+s.lat+','+s.lng+'&navigate=yes">Waze</a> · <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination='+s.lat+','+s.lng+'">Google Maps</a>'));
  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15));
  document.querySelectorAll('.s').forEach(el=>el.addEventListener('click',e=>{if(e.target.closest('a'))return;const m=markers[+el.dataset.i];map.setView(m.getLatLng(),16);m.openPopup();document.getElementById('map').scrollIntoView({behavior:'smooth',block:'center'});}));
}
</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' } });
}

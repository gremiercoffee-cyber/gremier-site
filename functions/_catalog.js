// Shared by the Cloudflare Pages functions that give Google real pages: product links, city pages
// and the sitemap. Reads the public catalogue with the site's public (publishable) key.
export const SITE = 'https://gremiercoffee.co.il';
const SUPABASE_URL = 'https://ayuzmwpmhncxrugsyxmw.supabase.co';
const KEY = 'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn';

export const slug = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error('catalog ' + r.status);
  return r.json();
}
// Products people can buy on their own (no internal or test items).
export async function products() {
  const list = await rest('products?select=id,name_en,name_he,description_en,description_he,price,images,category,is_active,is_coffee_bar,variations&is_active=eq.true&order=sort_order');
  return list.filter((p) => p.name_en && !/^test$/i.test(p.name_en) && Number(p.price) > 0 && p.category !== 'subscriptions');
}
export async function zones() {
  return (await rest('delivery_zones?select=name_en,name_he,regular_price,expedited_price,free_above,is_active')).filter((z) => z.is_active !== false && z.name_en);
}
export const cityName = (z) => z.name_en === z.name_en.toUpperCase() ? z.name_en.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : z.name_en;
export const image = (url, w = 1200) => (url && url.includes('/upload/') ? url.replace('/upload/', `/upload/f_auto,q_auto,w_${w}/`) : url || `${SITE}/icon-512.png`);

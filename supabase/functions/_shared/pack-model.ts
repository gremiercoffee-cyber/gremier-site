// Build-your-own packs: a pack product (variation {type:'pack', size, pool, discount}) holds the bottles
// the customer chose. Its price is the chosen bottles' own prices less the discount (5% for 6), in whole
// shekels. Minis are sold in 4-packs, so one mini is a quarter of its 4-pack's price.
export const packConfig = (p: any) => (Array.isArray(p?.variations) ? p.variations : []).find((v: any) => v?.type === 'pack') || null;
export function unitsPerProduct(p: any): number {
  const ops = (Array.isArray(p?.variations) ? p.variations : []).find((v: any) => v?.type === 'ops_settings');
  return Number(ops?.pack_size) || Number((String(p?.name_en || '').match(/(\d+)\s*-?\s*pack/i) || [])[1]) || 1;
}
export function inPool(p: any, pool: string): boolean {
  if (!p || p.is_active === false || packConfig(p)) return false;
  if (pool === 'bottles') return p.category === 'bottles' && !/syrup|סירופ/i.test(`${p.name_en || ''} ${p.name_he || ''}`);
  if (pool === 'minis') return p.category === 'minis';
  return false;
}
export function quotePack(pack: any, chosen: unknown, byId: Map<string, any>) {
  const cfg = packConfig(pack);
  if (!cfg) throw new Error('Not a pack');
  const size = Number(cfg.size) || 6, discount = Number(cfg.discount) || 0;
  const counts = new Map<string, number>();
  for (const raw of Array.isArray(chosen) ? chosen.slice(0, 20) : []) {
    const id = String((raw as any)?.product_id || '').trim(), n = Number((raw as any)?.qty);
    if (!id || !Number.isInteger(n) || n < 1 || n > size) throw new Error('Invalid pack item');
    counts.set(id, (counts.get(id) || 0) + n);
  }
  const units = [...counts.values()].reduce((s, n) => s + n, 0);
  if (units !== size) throw new Error(`Choose exactly ${size} for the pack`);
  let full = 0;
  const contents = [...counts].map(([id, qty]) => {
    const p = byId.get(id);
    if (!inPool(p, String(cfg.pool))) throw new Error('Invalid pack item');
    const per = unitsPerProduct(p);
    full += (Number(p.price) / per) * qty;
    return { product_id: String(p.id), name_en: p.name_en || null, name_he: p.name_he || null, qty, per_product: per, price: Number(p.price) };
  });
  const total = Math.round(full * (1 - discount));
  // Minis go in one by one, so the label names single bottles, not their 4-packs.
  const single = contents.some((c) => c.per_product > 1);
  const label = (n: string | null) => String(n || '').replace(/\s*\d+\s*-?\s*pack\b/i, '').replace(/\s*רביעייה/, '').trim();
  return { total, full: Math.round(full * 100) / 100, contents,
    label_en: contents.map((c) => `${c.qty}× ${label(c.name_en)}`).join(', ') + (single ? ' (single minis)' : ''),
    label_he: contents.map((c) => `${c.qty}× ${label(c.name_he || c.name_en)}`).join(', ') + (single ? ' (מיני בודדים)' : '') };
}

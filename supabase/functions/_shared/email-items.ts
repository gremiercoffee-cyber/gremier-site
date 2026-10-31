// Order or cart lines as email items with their product photos (a pack or a subscription box shows
// as itself; names follow the email's language).
import type { EmailItem } from "./email-design.ts";
export async function emailItems(sb: any, items: unknown, he: boolean): Promise<EmailItem[]> {
  const list = (Array.isArray(items) ? items : []) as Array<Record<string, any>>;
  const id = (i: Record<string, any>) => String(i.base_product_id || i.product_id || i.id || "").split("_")[0];
  const ids = [...new Set(list.map(id).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const images: Record<string, string> = {};
  if (ids.length) {
    const { data } = await sb.from("products").select("id, images").in("id", ids);
    for (const p of data || []) if (Array.isArray(p.images) && p.images[0]) images[String(p.id)] = p.images[0];
  }
  return list.map((i) => ({ name: String((he ? i.name_he || i.name_en : i.name_en || i.name_he) || i.name || "Item"), qty: Number(i.qty ?? i.quantity) || 1, image: images[id(i)] || null }));
}

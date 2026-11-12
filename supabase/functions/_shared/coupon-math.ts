// How much a coupon or voucher takes off a cart. Shared by validate-coupon (what the shopper sees)
// and create-website-order (what is charged), so the two always agree.
//  - applies_to 'all': the whole cart; 'specific_products' / 'category': only the matching lines.
//  - 'percent' / 'fixed': off the matching lines; 'free_item': free_qty units of the product are free
//    (the dearest matching units first, e.g. a larger size).

type Line = {
  product_id?: unknown; base_product_id?: unknown; id?: unknown;
  price?: unknown; qty?: unknown; category?: unknown;
  component_ids?: unknown[]; subscription_items?: { product_id?: unknown }[] | null;
};
type Coupon = {
  discount_type: string; discount_value?: unknown; applies_to?: string | null;
  product_ids?: unknown[] | null; category?: string | null; free_qty?: unknown;
};

const directId = (i: Line) => String(i.product_id || i.base_product_id || i.id || "");
const allIds = (i: Line) => [directId(i), ...(i.component_ids || []).map(String), ...((i.subscription_items || []).map((c) => String(c?.product_id || "")))].filter(Boolean);
const lineTotal = (i: Line) => (Number(i.price) || 0) * (Number(i.qty) || 1);

export function couponDiscount(coupon: Coupon, items: Line[], cartTotal: number): { discount: number; eligibleTotal: number } {
  const ids = (coupon.product_ids || []).map(String);
  const scoped = coupon.applies_to === "specific_products" || coupon.applies_to === "category";
  const matches = (i: Line) => coupon.applies_to === "specific_products" ? allIds(i).some((id) => ids.includes(id))
    : coupon.applies_to === "category" ? String(i.category || "") === String(coupon.category || "") : true;
  const eligibleTotal = scoped ? (items || []).filter(matches).reduce((s, i) => s + lineTotal(i), 0) : cartTotal;
  if (!(eligibleTotal > 0)) return { discount: 0, eligibleTotal: 0 };

  let discount = 0;
  if (coupon.discount_type === "free_item") {
    // Only the product itself (not a subscription box that happens to contain it).
    const units = (items || []).filter((i) => ids.includes(directId(i)))
      .flatMap((i) => Array.from({ length: Math.max(1, Math.min(99, Math.floor(Number(i.qty) || 1))) }, () => Number(i.price) || 0))
      .sort((a, b) => b - a);
    discount = units.slice(0, Math.max(1, Math.floor(Number(coupon.free_qty) || 1))).reduce((s, p) => s + p, 0);
  } else if (coupon.discount_type === "percent") {
    discount = Math.round(eligibleTotal * (Number(coupon.discount_value) / 100));
  } else {
    discount = Math.min(Number(coupon.discount_value) || 0, eligibleTotal);
  }
  return { discount: Math.max(0, Math.min(discount, cartTotal)), eligibleTotal };
}

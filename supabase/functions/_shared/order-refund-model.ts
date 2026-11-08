// Pure rules for admin refunds (no network): how much can still be refunded, whether a חשבונית זיכוי
// goes with it, and the FinBot payload for that credit invoice.
import {israelDate,websiteDocType} from './finbot-receipt-model.ts';
import {priceBeforeVat} from './vat.ts';

/** PayMe refuses partial refunds under ₪5; a full refund of an untouched sale has no minimum. */
export const PAYME_MIN_PARTIAL_MINOR = 500;

/** Refunds that took money (or may have): everything except a refusal. */
export const countsAgainstSale = (r: { status: string }) => r.status !== 'failed';

export type RefundDocument =
  | { kind: 'credit'; invoice_number: string | null; link_serial: string | null }
  | { kind: 'none'; why: 'receipt_before_vat' | 'no_receipt' | 'receipt_not_ready' };

/** Which document a refund of this order gets. A credit invoice only offsets a tax invoice
 *  (חשבונית מס קבלה, paid on/after the VAT date); a קבלה from before can't be credited in FinBot. */
export function refundDocument(order: any, receipt: any): RefundDocument {
  if (!receipt || !['issued', 'external'].includes(receipt.status)) return { kind: 'none', why: receipt ? 'receipt_not_ready' : 'no_receipt' };
  if (websiteDocType(order) !== '2') return { kind: 'none', why: 'receipt_before_vat' };
  return { kind: 'credit', invoice_number: receipt.document_reference ? String(receipt.document_reference) : null, link_serial: linkSerial(receipt.document_url) };
}

/** FinBot links a credit invoice by the document's internal serial number, which is the start of
 *  its link: …show_doc.php?auth/<serial><10-digit issue time><4 digits>. (Confirmed by FinBot support.) */
export function linkSerial(documentUrl: unknown): string | null {
  const m = /auth\/(\d{15,26})$/.exec(String(documentUrl || ''));
  return m ? m[1].slice(0, -14) : null;
}

export function refundPlan(saleMinor: number, refunds: Array<{ status: string; amount_minor: number }>) {
  const refunded = refunds.filter(countsAgainstSale).reduce((s, r) => s + Number(r.amount_minor), 0);
  const left = Math.max(0, saleMinor - refunded);
  const unclear = refunds.some((r) => r.status === 'needs_review' || r.status === 'refunding');
  return { sale_minor: saleMinor, refunded_minor: refunded, left_minor: left, untouched: refunded === 0, blocked: unclear ? 'refund_needs_review' : null };
}

/** Throws a short code when this amount can't be refunded now. Returns whether it's a full refund. */
export function checkRefundAmount(plan: ReturnType<typeof refundPlan>, amountMinor: number): { full: boolean } {
  if (plan.blocked) throw Error(plan.blocked);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw Error('invalid_amount');
  if (amountMinor > plan.left_minor) throw Error('more_than_left');
  const full = plan.untouched && amountMinor === plan.sale_minor;
  if (!full && amountMinor < PAYME_MIN_PARTIAL_MINOR) throw Error('payme_minimum_5');
  return { full };
}

const fmt = (iso: string) => iso.split('-').reverse().join('/');
/** FinBot type 4, linked by the original invoice's serial number (linkSerial, not the printed
 *  invoice number); price before VAT, so the
 *  document total (with VAT) is exactly the amount refunded. */
export function creditPayload(order: any, amountMinor: number, serial: string, reason: string | null, now = new Date()) {
  if (!/^\d{1,12}$/.test(serial)) throw Error('invalid_link_serial');
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw Error('invalid_amount');
  const n = order.order_number || order.id;
  const phone = String(order.customer_phone || '').trim().replace(/[\s().-]/g, '');
  const name = String(order.customer_name || '').trim().slice(0, 100);
  if (!name) throw Error('missing_customer_name');
  return {
    type: '4', date: fmt(israelDate(now)), language: 'HE', currency: 'ILS', vatType: true, rounding: false,
    title: `Gremier order ${n}`,
    description: `זיכוי עבור הזמנה ${n}`,
    remark: `החזר לכרטיס האשראי עבור הזמנה מספר ${n}${reason ? ` · ${reason.slice(0, 150)}` : ''}`,
    customer: { name, ...(/^\+?\d{7,15}$/.test(phone) ? { phone } : {}), save: false },
    items: [{ name: `זיכוי עבור הזמנה ${n}`, amount: 1, price: priceBeforeVat(amountMinor), save: false }],
    payments: [],
    linkedDocument: serial,
    credit: amountMinor / 100,
  };
}

export const shekels = (minor: number) => '₪' + (minor / 100).toFixed(minor % 100 ? 2 : 0);

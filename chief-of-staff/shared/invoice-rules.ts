/** Which emails are invoices or receipts (Hebrew or English). Pure: no I/O, so it is easy to test.
 * It leans towards asking: a wrong "Invoice ?" costs one tap, a missed invoice costs money. */
export const INVOICE_ACCOUNT = "gremiercoffee@gmail.com";
export const INVOICE_TO = "gremiercoffee+expenses@gmail.com";
export const FLAG_AT = 4, MAYBE_AT = 2;

export interface InvoiceFacts {
  subject: string; from: string; to: string; text: string;
  attachments: { name: string; type: string }[];
  newsletter: boolean; approvedBefore?: number; rejectedBefore?: number;
}

const HEB = "א-ת";
const STRONG = [
  /חשבוני(?:ת|ות)/,                                                         // invoice(s)
  new RegExp(`(?:^|[^${HEB}])[והבל]?קבל(?:ה|ות)(?![${HEB}])`),              // receipt(s), but not "התקבלה"
  /חשבון\s*עסקה/, /אישור\s*תשלום/, /חיוב\s*(?:חודשי|כרטיס|בכרטיס)/,
  /\binvoices?\b/i, /\breceipts?\b/i, /\btax\s*invoice\b/i, /\bbilling\s*statement\b/i,
  /\bpayment\s*(?:confirmation|received|receipt)\b/i, /\byour\s*(?:bill|statement)\b/i,
];
const WEAK = [
  /סה["״'׳]?כ/, /מע["״'׳]?מ/, /עוסק\s*מורשה|ח\.?\s?פ\.?\s|ע\.?\s?מ\.?\s/, /תשלום|שולם/, /אישור\s*הזמנה/,
  /₪|\bILS\b|\bNIS\b|ש["״]ח|\$\s?\d|€\s?\d/, /\btotal\b/i, /\bamount\s*(?:due|paid|charged)\b/i,
  /\bVAT\b/i, /\bpaid\b/i, /\border\s*(?:confirmation|confirmed)\b/i, /\bsubscription\b/i, /\bcharged?\b/i,
];
/** Invoice and payment services: a link to one means "this is a document". */
const DOC_HOSTS = /icount|greeninvoice|morning\.co|ezcount|finbotai|rivhit|invoice4u|tranzila|hyp\.co\.il|cardcom|sumit|yeshinvoice|invoice\.stripe|pay\.stripe|paypal\.com\/invoice/i;
const OWN_NAMES = /gremier|גרמיר/i;

export const addressOf = (from: string) => ((from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase());
export const nameOf = (from: string) => from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || addressOf(from);

/** Sent by Gremier itself (the owner, the website, FinBot documents in Gremier's name) or already sent to the invoices address. */
export function ownMail(f: Pick<InvoiceFacts, "from" | "to">) {
  return addressOf(f.from) === INVOICE_ACCOUNT || OWN_NAMES.test(nameOf(f.from)) || f.to.toLowerCase().includes(INVOICE_TO);
}

const isDoc = (a: { name: string; type: string }) => /pdf|image\//i.test(a.type) || /\.(pdf|jpe?g|png|webp|heic)$/i.test(a.name);

export function invoiceScore(f: InvoiceFacts): { score: number; reasons: string[] } {
  if (ownMail(f)) return { score: -99, reasons: ["sent by Gremier"] };
  const text = f.text.slice(0, 20000), names = f.attachments.map((a) => a.name).join(" ");
  const strongSubject = STRONG.some((r) => r.test(f.subject));
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => { score += n; reasons.push(why); };
  if (strongSubject) add(3, "subject");
  if (STRONG.some((r) => r.test(names))) add(3, "attachment name");
  if (STRONG.some((r) => r.test(text))) add(2, "email text");
  if (f.attachments.some(isDoc)) add(1, "PDF/photo attached");
  if (DOC_HOSTS.test(text) || DOC_HOSTS.test(f.from)) add(2, "invoice service");
  const weak = WEAK.filter((r) => r.test(f.subject + "\n" + text)).length;
  if (weak) add(Math.min(3, weak), "amount/VAT words");
  if (f.approvedBefore) add(5, "you forwarded this sender before");
  if ((f.rejectedBefore ?? 0) >= 2 && !f.approvedBefore) add(-4, "you said no to this sender twice");
  if (f.newsletter && !f.attachments.some(isDoc) && !strongSubject) add(-2, "newsletter");
  return { score, reasons };
}

export function invoiceAmount(text: string): string {
  const m = text.match(/(?:סה["״'׳]?כ(?:\s*לתשלום)?|total(?:\s*(?:due|paid))?|amount(?:\s*(?:due|paid|charged))?)[^\d₪$€]{0,20}([₪$€]?\s?\d[\d,]*(?:\.\d{1,2})?\s?(?:₪|ש["״]ח|ILS|NIS)?)/i)
    ?? text.match(/(₪\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:₪|ש["״]ח)|\$\s?\d[\d,]*(?:\.\d{1,2})?|€\s?\d[\d,]*(?:\.\d{1,2})?)/);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

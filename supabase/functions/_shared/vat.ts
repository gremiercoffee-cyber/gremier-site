// Osek Morshe from the moment website receipts were paused (the date reported to the accountant
// as passing the exempt threshold). Payments after it are taxable: website prices include VAT;
// store prices get VAT on top.
export const VAT_RATE = 0.18;
export const VAT_FROM = '2026-10-22T12:08:54Z';
export const vatApplies = (when: string | Date | null | undefined) => !!when && new Date(when).getTime() >= Date.parse(VAT_FROM);
// VAT on a pre-VAT amount, in agorot.
export const vatOn = (netMinor: number) => Math.round(netMinor * VAT_RATE * 100 / 100);
// The pre-VAT price whose VAT brings it back to exactly this total (FinBot takes prices before VAT).
export function netForGross(grossMinor: number): number | null {
  const guess = Math.round(grossMinor / (1 + VAT_RATE));
  for (const net of [guess, guess - 1, guess + 1, guess - 2, guess + 2]) if (net > 0 && net + vatOn(net) === grossMinor) return net;
  return null;
}
// FinBot price (shekels, before VAT) for a VAT-inclusive total: whole agorot when one adds up
// exactly; otherwise four decimals, which FinBot's VAT brings back to the same total.
export function priceBeforeVat(grossMinor: number): number {
  const net = netForGross(grossMinor);
  return net !== null ? net / 100 : Math.round(grossMinor / (1 + VAT_RATE) * 100) / 10000;
}
// Each month's share of an invoice: its net plus VAT, with the rounding left on the last month,
// so the shares add up to exactly the invoice total.
export function invoiceShares(bills: Array<{ id: string; net_minor: number }>) {
  const net = bills.reduce((s, b) => s + b.net_minor, 0), vat = vatOn(net);
  let given = 0;
  const shares = bills.map((b, i) => {
    const v = i === bills.length - 1 ? vat - given : vatOn(b.net_minor);
    given += v;
    return { billing_id: b.id, net_minor: b.net_minor, gross_minor: b.net_minor + v };
  });
  return { net_minor: net, vat_minor: vat, gross_minor: net + vat, shares };
}

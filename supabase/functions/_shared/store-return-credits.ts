// Store returns come off the monthly bill, oldest first. A credit bigger than the bill carries over to the next one.
// deno-lint-ignore no-explicit-any
type Sb = any;
type Return = { id: string; amount_minor: number | string };
type Credit = { return_id: string; year: number; month: number; amount_minor: number | string };

export function allocateCredits(returns: Return[], credits: Credit[], year: number, month: number, billMinor: number) {
  let left = Math.max(0, billMinor);
  const lines: { return_id: string; amount_minor: number }[] = [];
  for (const r of returns) {
    const usedElsewhere = credits.filter((c) => c.return_id === r.id && !(c.year === year && c.month === month))
      .reduce((sum, c) => sum + Number(c.amount_minor), 0);
    const take = Math.min(left, Math.max(0, Number(r.amount_minor) - usedElsewhere));
    if (take > 0) { lines.push({ return_id: r.id, amount_minor: take }); left -= take; }
  }
  return lines;
}

/** The credit on this store's bill for this month, in agorot. A bill already sent or paid keeps the credit it had. */
export async function applyReturnCredits(sb: Sb, storeId: string, year: number, month: number, endDate: string, billMinor: number, frozen: boolean) {
  const [returns, credits] = await Promise.all([
    sb.from("store_returns").select("id,amount_minor").eq("store_id", storeId).is("cancelled_at", null).lt("return_date", endDate)
      .order("return_date").order("created_at"),
    sb.from("store_return_credits").select("return_id,year,month,amount_minor").eq("store_id", storeId),
  ]);
  if (returns.error || credits.error) throw new Error("Could not load store returns: " + (returns.error || credits.error).message);
  const sum = (rows: { amount_minor: number | string }[]) => rows.reduce((total, row) => total + Number(row.amount_minor), 0);
  if (frozen) return sum((credits.data || []).filter((c: Credit) => c.year === year && c.month === month));

  const lines = allocateCredits(returns.data || [], credits.data || [], year, month, billMinor);
  const cleared = await sb.from("store_return_credits").delete().eq("store_id", storeId).eq("year", year).eq("month", month);
  if (cleared.error) throw new Error("Could not update store returns: " + cleared.error.message);
  if (lines.length) {
    const saved = await sb.from("store_return_credits").insert(lines.map((l) => ({ ...l, store_id: storeId, year, month })));
    if (saved.error) throw new Error("Could not save store returns: " + saved.error.message);
  }
  return sum(lines);
}

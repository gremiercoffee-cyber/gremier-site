// Production outlook: when to brew, worked out from what actually goes out (deliveries), not from stock counts
// typed in by hand. Bottles only cover their own product: 30 Classic liters on the shelf don't help the jerry cans
// and minis that go out every week, which are filled from the concentrate. So, day by day, each product uses its
// own bottles first (at its usual delivery pace, or its scheduled deliveries if more), and only what they can't
// cover draws on the concentrate. The day the concentrate can't keep up is when you run out → "brew by Sunday".
// For each bottled product: bottles on hand against the scheduled deliveries and the usual pace → "bottle 18".
// The owner's rules (from Chief of Staff) come in as args.rules: a coffee brewed only to order ("decaf": mode
// on_demand) ignores its past pace and only counts scheduled orders; "keep" = bottles to always have on hand.
// Read-only (hub action "outlook"). Same recipe numbers as hub-ops.ts (BOTTLES, ratios, liters per brew).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOTTLES, KG_TO_LITERS, todayISO } from "./hub-ops.ts";

type Sb = ReturnType<typeof createClient>;
const NAMES: Record<string, string> = { classic: "Classic", unfiltered: "Unfiltered", houseBlend: "House Blend", colombia: "Colombia", decaf: "Decaf" };
const RATIO: Record<string, number> = { classic: 0.43, unfiltered: 0.4, houseBlend: 0.5, colombia: 0.5, decaf: 0.5 };
const FLAVORED_MINIS = new Set(["vanilla_mini", "original_mini", "caramel_mini"]);
// Store deliveries are sometimes logged as totals ("18 small") without the flavor.
const AGGREGATE: Record<string, string> = { _agg_small: "classic_mini", _agg_large: "classic_liter", _agg_unfiltered: "unfiltered_liter", _agg_dairy_free: "dairy_free_mini" };
const JERRY: Record<string, string> = { classic: "jerry_can", unfiltered: "jerry_can_unfiltered", houseBlend: "jerry_can_houseblend", colombia: "jerry_can_colombia", decaf: "jerry_can_decaf" };
/** A brew takes about a day to steep and drain before it can be bottled. */
const BREW_LEAD_DAYS = 2;
/** Keep this much extra so a surprise order doesn't run you out. */
const SAFETY_DAYS = 4;

function meta(product: string) {
  if (BOTTLES[product]) return BOTTLES[product];
  if (/dairy/.test(product)) return { label: "Dairy-free mini", category: "mini" as const, concentrate: "classic" };
  return null;
}
/** Liters of concentrate in one unit of a bottled product. */
function concentrateIn(product: string) {
  const m = meta(product);
  if (!m) return 0;
  const liters = m.category === "mini" ? 0.25 : m.category === "jerry" ? 5 : 1;
  const ratio = FLAVORED_MINIS.has(product) ? 0.29 : RATIO[m.concentrate] ?? 0.43;
  return liters * ratio;
}
function units(job: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(job.quantities || {})) {
    const key = AGGREGATE[k] ?? k, n = Number(v) || 0;
    if (n > 0 && meta(key)) out[key] = (out[key] || 0) + n;
  }
  for (const type of job.jerry_cans || []) { const key = JERRY[type]; if (key) out[key] = (out[key] || 0) + 1; }
  return out;
}
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400e3);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400e3).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;
/** "Classic liters", "Vanilla minis", "Classic jerry cans" */
const plural = (product: string, label: string) => meta(product)?.category === "liter" ? `${label} liters` : `${label.replace(/ mini$/, " minis").replace(/ can$/, " cans")}`;
const dayName = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

type Rule = { mode?: string; keep?: number; note?: string };
export async function readOutlook(sb: Sb, args: { weeks?: number; horizon_days?: number; rules?: Record<string, Rule> }) {
  const rules = (args.rules && typeof args.rules === "object" ? args.rules : {}) as Record<string, Rule>;
  const onDemand = (coffee: string) => rules[coffee]?.mode === "on_demand";
  const today = todayISO();
  const weeks = Math.min(16, Math.max(2, Number(args.weeks) || 8));
  const horizon = Math.min(30, Math.max(3, Number(args.horizon_days) || 14));
  const since = addDays(today, -weeks * 7);
  const [inv, conc, beans, past, open] = await Promise.all([
    sb.from("inventory").select("product, qty"),
    sb.from("concentrate").select("type, liters"),
    sb.from("beans").select("type, kg, ordered"),
    sb.from("jobs").select("type, date, product, kg, quantities, jerry_cans").eq("done", true).gte("date", since).lte("date", today),
    sb.from("jobs").select("id, type, date, product, kg, liters, quantities, jerry_cans, store_name, private_name, cb_name, label, source_brew_id").eq("done", false).lte("date", addDays(today, horizon)),
  ]);
  for (const r of [inv, conc, beans, past, open]) if (r.error) throw new Error(r.error.message);

  // What went out, per product, over the window (from the first delivery in it, so a new product isn't diluted).
  const used: Record<string, number> = {};
  let first = today;
  const brewedKg: Record<string, number> = {};
  for (const j of past.data || []) {
    if (j.type === "delivery") { for (const [k, n] of Object.entries(units(j))) used[k] = (used[k] || 0) + n; if (j.date < first) first = j.date; }
    if (j.type === "brew" && j.product) { const bean = j.product === "unfiltered" ? "classic" : j.product; brewedKg[bean] = (brewedKg[bean] || 0) + Number(j.kg || 0); }
  }
  const days = Math.max(7, dayDiff(first, today) + 1);
  // Scheduled to go out (overdue ones included), and production already planned.
  const upcoming: Record<string, number> = {}, nextWeek: Record<string, number> = {};
  const scheduledOn: Record<string, { day: number; n: number }[]> = {};
  const incomingL: Record<string, number> = {}, bottlingPlanned: Record<string, number> = {};
  const deliveries: { date: string; who: string; items: string }[] = [];
  for (const j of open.data || []) {
    if (j.type === "delivery") {
      const u = units(j);
      for (const [k, n] of Object.entries(u)) {
        upcoming[k] = (upcoming[k] || 0) + n;
        if (j.date <= addDays(today, 7)) nextWeek[k] = (nextWeek[k] || 0) + n;
        (scheduledOn[k] ??= []).push({ day: Math.max(0, dayDiff(today, j.date)), n });
      }
      deliveries.push({ date: j.date, who: j.store_name || j.cb_name || j.private_name || j.label || "delivery", items: Object.entries(u).map(([k, n]) => `${n}× ${meta(k)?.label ?? k}`).join(", ") });
    }
    const drainsLater = (open.data || []).some((d: any) => d.type === "drain" && d.source_brew_id && d.source_brew_id === j.id);
    if ((j.type === "drain" || (j.type === "brew" && !drainsLater)) && j.product) incomingL[j.product] = (incomingL[j.product] || 0) + (KG_TO_LITERS[String(Number(j.kg || 3))] || 0);
    if (j.type === "bottling" && j.product) bottlingPlanned[j.product] = (bottlingPlanned[j.product] || 0) + Number(j.liters || 0);
  }
  const onHand = Object.fromEntries((inv.data || []).map((r: any) => [r.product, Math.max(0, Number(r.qty) || 0)]));

  // Each bottled product: what's on hand vs. what's coming up and the usual pace.
  const products = Object.keys(BOTTLES).concat("dairy_free_mini").map((p) => {
    const coffee = meta(p)!.concentrate, toOrder = onDemand(coffee);
    // Brewed to order: the past pace doesn't predict anything, only scheduled orders (and the stock kept) count.
    const perDay = (used[p] || 0) / days, pace = toOrder ? 0 : perDay;
    const keep = Math.max(0, Number(rules[p]?.keep ?? (toOrder && meta(p)!.category === "liter" ? rules[coffee]?.keep : 0) ?? 0) || 0);
    const have = onHand[p] || 0, need = upcoming[p] || 0;
    const coverDays = pace > 0 ? Math.floor(Math.max(0, have - need - keep) / pace) : null;
    // Bottle when scheduled deliveries (plus what you keep) need more than is on hand, or a regular seller (3+ a week)
    // is about to run out; jerry cans are filled to order, so only for deliveries. Enough for those plus a week's pace.
    const regular = !toOrder && meta(p)!.category !== "jerry" && pace * 7 >= 3;
    const toBottle = Math.max(0, Math.ceil(need + keep + (regular ? pace * 7 : 0) - have));
    return { product: p, label: meta(p)!.label, coffee, on_hand: have, per_week: r1(perDay * 7), pace_per_week: r1(pace * 7), on_demand: toOrder, keep,
      scheduled: need, scheduled_7d: nextWeek[p] || 0, days_left_after_scheduled: coverDays,
      bottle_now: (need + keep > have || (regular && coverDays !== null && coverDays < 3)) && toBottle > 0 ? toBottle : 0 };
  }).filter((p) => p.on_hand || p.per_week || p.scheduled || p.keep);

  // Each coffee, day by day: every product uses its own bottles first; what they can't cover comes from the
  // concentrate (plus what's brewing). The first day it can't is when this coffee runs out.
  const MAX_DAYS = 60;
  const coffees = (conc.data || []).map((c: any) => {
    const type = c.type, mine = products.filter((p) => p.coffee === type);
    const concentrate = Math.max(0, Number(c.liters) || 0), incoming = incomingL[type] || 0, available = concentrate + incoming;
    const demand = (p: typeof mine[number], d: number) => p.keep + Math.max((scheduledOn[p.product] || []).filter((x) => x.day <= d).reduce((t, x) => t + x.n, 0), Math.floor((p.pace_per_week / 7) * d)); // whole bottles / cans
    const fromConcentrate = (p: typeof mine[number], d: number) => Math.max(0, demand(p, d) - p.on_hand) * concentrateIn(p.product);
    const draw = (d: number) => mine.reduce((t, p) => t + fromConcentrate(p, d), 0);
    const name = NAMES[type] || type;
    const toOrder = onDemand(type);
    const active = mine.some((p) => p.pace_per_week > 0 || p.scheduled > 0 || p.keep > 0);
    let daysLeft: number | null = null;
    if (active) { daysLeft = MAX_DAYS; for (let d = 0; d <= MAX_DAYS; d++) if (draw(d) > available + 1e-9) { daysLeft = Math.max(0, d - 1); break; } }
    // What's eating the concentrate (by then), and what's already bottled for longer.
    const at = Math.min(MAX_DAYS, (daysLeft ?? 0) + 1);
    const drivers = mine.map((p) => ({ p, l: fromConcentrate(p, at) })).filter((x) => x.l > 0).sort((x, y) => y.l - x.l).slice(0, 2)
      .map(({ p }) => `${plural(p.product, p.label)} (${p.on_demand ? `${p.scheduled} ordered${p.keep ? `, keeping ${p.keep}` : ""}` : `~${p.per_week}/week`}${p.on_hand ? `, ${p.on_hand} bottled` : ", none bottled"})`);
    const shelf = mine.filter((p) => p.on_hand > 0 && p.pace_per_week > 0 && p.on_hand / (p.pace_per_week / 7) > (daysLeft ?? 0) + 3)
      .sort((x, y) => y.on_hand * concentrateIn(y.product) - x.on_hand * concentrateIn(x.product)).slice(0, 1)
      .map((p) => `You have ${p.on_hand} ${plural(p.product, p.label)} bottled (~${Math.round(p.on_hand / (p.pace_per_week / 7))} days), but `)[0] ?? "";
    let verdict: "brew_now" | "brew_soon" | "ok" | "idle";
    if (daysLeft === null) verdict = toOrder ? "ok" : "idle";
    else if (daysLeft <= BREW_LEAD_DAYS + 1) verdict = "brew_now";
    else if (daysLeft <= BREW_LEAD_DAYS + SAFETY_DAYS + 3) verdict = "brew_soon";
    else verdict = "ok";
    const brewBy = verdict === "brew_now" ? today : verdict === "idle" ? null : addDays(today, Math.max(0, daysLeft! - BREW_LEAD_DAYS - SAFETY_DAYS));
    const from = `${r1(concentrate)}L concentrate${incoming ? ` + ${r1(incoming)}L brewing` : ""}`;
    const what = drivers.join(" and ") || "deliveries";
    const line = verdict === "brew_now" ? `${name}: brew now. ${shelf}${what} come from the ${from}, which ${daysLeft ? `only lasts ~${daysLeft} day${daysLeft > 1 ? "s" : ""}` : "doesn't cover what's going out"}.`
      : verdict === "brew_soon" ? `${name}: brew by ${brewBy === today ? "today" : dayName(brewBy!)}. ${shelf}${what} come from the ${from}, which lasts ~${daysLeft} days.`
      : verdict === "ok" && toOrder ? `${name}: brewed to order. Nothing scheduled needs more than you have${mine.some((p) => p.keep) ? " (including what you keep on hand)" : ""}.`
      : verdict === "ok" ? `${name}: fine for ${daysLeft! >= MAX_DAYS ? "2+ months" : `~${daysLeft} days`}${daysLeft! < 21 ? ` (brew around ${dayName(brewBy!)})` : ""}.`
      : `${name}: no recent use${concentrate ? ` (${r1(concentrate)}L on hand)` : ""}.`;
    const bottled = mine.reduce((t, p) => t + p.on_hand * concentrateIn(p.product), 0);
    return { coffee: type, name, brewed_to_order: toOrder, concentrate_l: r1(concentrate), brewing_l: r1(incoming), bottled_l: r1(bottled),
      concentrate_l_per_week: r1(draw(7)), days_left: daysLeft, verdict, brew_by: brewBy, drivers, line };
  });

  // Beans: kg left vs. what the brews used per week.
  const beansOut = (beans.data || []).map((b: any) => {
    const perWeek = ((brewedKg[b.type] || 0) / days) * 7, kg = Number(b.kg) || 0;
    const weeks = perWeek > 0 ? kg / perWeek : null;
    return { type: b.type, name: NAMES[b.type] || b.type, kg, used_kg_per_week: r1(perWeek), weeks_left: weeks === null ? null : r1(weeks), ordered: !!b.ordered,
      order_now: !b.ordered && weeks !== null && weeks < 2 };
  });

  const toDo = [
    ...coffees.filter((c) => c.verdict === "brew_now" || c.verdict === "brew_soon").map((c) => c.line),
    ...products.filter((p) => p.bottle_now).map((p) => `Bottle ${p.bottle_now} ${p.label}: ${p.on_hand} on hand${p.scheduled ? `, ${p.scheduled} scheduled to go out` : ""}${p.keep ? `, you keep ${p.keep}` : ""}.`),
    ...beansOut.filter((b) => b.order_now).map((b) => `Order ${b.name} beans: ${b.kg}kg left, ~${b.weeks_left} weeks at the usual pace.`),
  ];
  return {
    as_of: today, based_on: `deliveries over the last ${days} days`,
    summary: toDo.length ? toDo : ["All good: no brewing, bottling or bean orders needed right now."],
    rules_applied: rules,
    coffees, products, beans: beansOut,
    upcoming_deliveries: deliveries.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 15),
    planned_bottling: bottlingPlanned,
  };
}

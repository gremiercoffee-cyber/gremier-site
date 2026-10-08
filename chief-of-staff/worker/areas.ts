/**
 * Life areas ("categories"): Coffee, Yeshiva, Personal to start, and whatever the user adds.
 * Stored as one settings row; everything that files things into an area reads this list.
 */
import type { Env } from "./env";
import { first, run } from "./db";

export interface Area { key: string; label: string; icon: string; about: string }

export const DEFAULT_AREAS: Area[] = [
  { key: "coffee", label: "Coffee", icon: "☕", about: "Gremier Coffee business: roasting, orders, deliveries, suppliers, customers" },
  { key: "yeshiva", label: "Yeshiva", icon: "📚", about: "the yeshiva: rabbis, students, classes, staff" },
  { key: "personal", label: "Personal", icon: "🏠", about: "family, home, health, money, errands" },
];

/** A valid area key looks like a short slug; whether it exists is checked against the list where it matters. */
export const isAreaKey = (k: unknown) => typeof k === "string" && /^[a-z0-9-]{2,24}$/.test(k);

export async function getAreas(env: Env): Promise<Area[]> {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'areas'");
  try { const list = row ? (JSON.parse(row.value) as Area[]) : null; if (list?.length) return list; } catch { /* default */ }
  return DEFAULT_AREAS;
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").replace(/[^a-z0-9-]/g, "").slice(0, 24);

/** Add or change an area (matched by key, or by name). */
export async function saveArea(env: Env, input: { key?: string; label?: string; icon?: string; about?: string }) {
  const areas = await getAreas(env);
  const label = String(input.label ?? "").trim().slice(0, 30);
  const existing = areas.find((a) => a.key === input.key || (label && a.label.toLowerCase() === label.toLowerCase()));
  if (existing) {
    if (label) existing.label = label;
    if (input.icon) existing.icon = String(input.icon).slice(0, 8);
    if (input.about !== undefined) existing.about = String(input.about).slice(0, 200);
  } else {
    if (!label) throw new Error("What should the area be called?");
    let key = slug(input.key || label) || `area-${areas.length + 1}`;
    while (areas.some((a) => a.key === key)) key = `${key}-2`.slice(0, 24);
    areas.push({ key, label, icon: String(input.icon ?? "🏷️").slice(0, 8), about: String(input.about ?? "").slice(0, 200) });
  }
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('areas', ?)", JSON.stringify(areas));
  return areas;
}

/** Remove an area. Things filed under it simply become "no area" (they're not deleted). */
export async function removeArea(env: Env, key: string) {
  const areas = (await getAreas(env)).filter((a) => a.key !== key);
  if (!areas.length) throw new Error("Keep at least one area.");
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('areas', ?)", JSON.stringify(areas));
  await run(env, "UPDATE items SET category = NULL WHERE category = ?", key);
  return areas;
}

/** For prompts: `"coffee"|"yeshiva"|"personal"` and a one-line description of each. */
export async function areaKeysJson(env: Env) {
  return (await getAreas(env)).map((a) => `"${a.key}"`).join("|");
}
/** The user's own fixes ("that was a favor: personal, not yeshiva"), for anything that picks an area. */
export async function areaCorrections(env: Env) {
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'area_corrections'");
  const list = (row ? JSON.parse(row.value) : []) as { title: string; person: string | null; from: string; to: string }[];
  return list.length ? `The user corrected these areas before; file similar things the same way:\n${list.slice(0, 12).map((c) => `- "${c.title}"${c.person ? ` (${c.person})` : ""}: ${c.from} → ${c.to}`).join("\n")}` : "";
}
export async function areasText(env: Env) {
  const corr = await areaCorrections(env);
  return (await getAreas(env)).map((a) => `- ${a.key} (${a.icon} ${a.label})${a.about ? `: ${a.about}` : ""}`).join("\n") + (corr ? `\n${corr}` : "");
}

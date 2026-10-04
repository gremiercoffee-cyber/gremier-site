/**
 * Long-term memory: an address book of people plus searchable memories.
 *
 * Cost model: every message carries a small, stable "core profile" (key people and top preferences,
 * which OpenAI's prompt caching discounts), plus the handful of memories that match what the user
 * just said, found with SQLite full-text search (free). Memory can grow without every message
 * getting more expensive.
 */
import type { Memory } from "../shared/types";
import type { Env } from "./env";
import { all, first, now, run, uid } from "./db";

export interface Person {
  id: string; name: string; role: string; aliases: string; email: string | null; phone: string | null;
  whatsapp_name: string | null; preferred_channel: string | null; channel_counts: string; notes: string;
  last_contact_at: string | null; created_at: string; updated_at: string;
}

const CORE_PEOPLE = 40;
const CORE_MEMORIES = 20;
const RECALLED = 10;

/** Usual channel: what the user said, else a clear learned habit (3+ uses and twice the alternative). */
export function usualChannel(p: Person): string | null {
  if (p.preferred_channel) return p.preferred_channel;
  const c = safeJson(p.channel_counts) as Record<string, number>;
  const [best, second] = Object.entries(c).sort((a, b) => b[1] - a[1]);
  if (best && best[1] >= 3 && (!second || best[1] >= 2 * second[1])) return best[0];
  return null;
}

function personLine(p: Person) {
  const bits = [p.role && `role: ${p.role}`, p.aliases && `aka ${p.aliases}`, p.email && `email ${p.email}`,
    p.phone && `phone ${p.phone}`, p.whatsapp_name && `WhatsApp "${p.whatsapp_name}"`].filter(Boolean);
  const usual = usualChannel(p);
  if (usual) bits.push(`usually via ${usual}${p.preferred_channel ? "" : " (learned)"}`);
  if (p.notes) bits.push(p.notes);
  return `- ${p.name} (${bits.join("; ")}; id ${p.id})`;
}

/** FTS5 query from free text: significant words, OR-ed, prefix-matched. */
function ftsQuery(text: string) {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)).slice(0, 12);
  return words.length ? words.map((w) => `"${w}"*`).join(" OR ") : null;
}
const STOP = new Set("the and for you your with that this what when can have from about just need want please tell".split(" "));

export async function recallMemories(env: Env, text: string, limit = RECALLED): Promise<Memory[]> {
  const q = ftsQuery(text);
  if (!q) return [];
  try {
    return await all<Memory>(env,
      `SELECT m.* FROM memories_fts f JOIN memories m ON m.rowid = f.rowid WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?`, q, limit);
  } catch {
    return [];
  }
}

export async function findPeople(env: Env, text: string, limit = 8): Promise<Person[]> {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}@.]{2,}/gu) ?? []).slice(0, 10);
  if (!words.length) return [];
  const where = words.map(() => "(lower(name) LIKE ? OR lower(role) LIKE ? OR lower(aliases) LIKE ? OR lower(email) LIKE ? OR lower(whatsapp_name) LIKE ?)").join(" OR ");
  const binds = words.flatMap((w) => Array(5).fill(`%${w}%`));
  return all<Person>(env, `SELECT * FROM people WHERE ${where} ORDER BY updated_at DESC LIMIT ?`, ...binds, limit);
}

/**
 * The memory part of the context. Core first (stable, cache-friendly), then what's relevant to `query`.
 */
export async function memoryContext(env: Env, query = ""): Promise<string> {
  const [people, core] = await Promise.all([
    all<Person>(env, "SELECT * FROM people ORDER BY (role != '') DESC, COALESCE(last_contact_at, updated_at) DESC LIMIT ?", CORE_PEOPLE),
    all<Memory>(env, "SELECT * FROM memories ORDER BY importance ASC, updated_at DESC LIMIT ?", CORE_MEMORIES),
  ]);
  const coreIds = new Set(core.map((m) => m.id));
  const recalled = query ? (await recallMemories(env, query)).filter((m) => !coreIds.has(m.id)) : [];
  const total = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM memories");

  const lines = ["## People you know"];
  lines.push(people.length ? people.map(personLine).join("\n") : "- (none saved yet)");
  lines.push("", "## Memory: key facts and preferences");
  lines.push(core.length ? core.map((m) => `- [${m.category}] ${m.content} (id ${m.id})`).join("\n") : "- (nothing yet)");
  if (recalled.length) {
    lines.push("", "## Memory: related to this message");
    lines.push(recalled.map((m) => `- [${m.category}] ${m.content} (id ${m.id})`).join("\n"));
  }
  if ((total?.n ?? 0) > core.length + recalled.length) lines.push(`(More memories exist; use recall to search them.)`);
  return lines.join("\n");
}

export async function savePerson(env: Env, input: Record<string, unknown>) {
  const s = (k: string) => (input[k] === undefined || input[k] === null ? undefined : String(input[k]).trim());
  const id = s("id");
  const name = s("name");
  let existing: Person | null = null;
  if (id) existing = await first<Person>(env, "SELECT * FROM people WHERE id = ?", id);
  if (!existing && name) existing = await first<Person>(env, "SELECT * FROM people WHERE lower(name) = lower(?)", name);
  const t = now();
  const merged = {
    name: name || existing?.name || "",
    role: s("role") ?? existing?.role ?? "",
    aliases: s("aliases") ?? existing?.aliases ?? "",
    email: s("email") ?? existing?.email ?? null,
    phone: s("phone") ?? existing?.phone ?? null,
    whatsapp_name: s("whatsapp_name") ?? existing?.whatsapp_name ?? null,
    preferred_channel: s("preferred_channel") ?? existing?.preferred_channel ?? null,
    notes: s("notes") ?? existing?.notes ?? "",
  };
  if (!merged.name) throw new Error("A person needs a name.");
  if (existing) {
    await run(env, `UPDATE people SET name=?, role=?, aliases=?, email=?, phone=?, whatsapp_name=?, preferred_channel=?, notes=?, updated_at=? WHERE id=?`,
      merged.name, merged.role, merged.aliases, merged.email, merged.phone, merged.whatsapp_name, merged.preferred_channel, merged.notes, t, existing.id);
    return { id: existing.id, updated: true, ...merged };
  }
  const newId = uid();
  await run(env, `INSERT INTO people (id, name, role, aliases, email, phone, whatsapp_name, preferred_channel, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId, merged.name, merged.role, merged.aliases, merged.email, merged.phone, merged.whatsapp_name, merged.preferred_channel, merged.notes, t, t);
  return { id: newId, created: true, ...merged };
}

/** Learn the habit: called whenever a message/draft goes to someone through a channel. */
export async function noteContact(env: Env, who: string, channel: "email" | "whatsapp") {
  const key = who.toLowerCase().trim();
  const p = await first<Person>(env,
    "SELECT * FROM people WHERE lower(name) = ? OR lower(email) = ? OR lower(whatsapp_name) = ? OR (email IS NOT NULL AND ? LIKE '%' || lower(email) || '%')",
    key, key, key, key);
  if (!p) return;
  const c = safeJson(p.channel_counts) as Record<string, number>;
  c[channel] = (c[channel] ?? 0) + 1;
  await run(env, "UPDATE people SET channel_counts = ?, last_contact_at = ? WHERE id = ?", JSON.stringify(c), now(), p.id);
}

function safeJson(s: string) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

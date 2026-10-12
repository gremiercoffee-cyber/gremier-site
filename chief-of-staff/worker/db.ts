import type { Item, ItemKind, Project, Settings } from "../shared/types";
import type { Env } from "./env";

export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

/** Normalise any date string the model or UI sends to UTC ISO, so string comparison works. */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function all<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> {
  const r = await env.DB.prepare(sql).bind(...binds).all<T>();
  return r.results ?? [];
}
export async function first<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...binds).first<T>()) ?? null;
}
export async function run(env: Env, sql: string, ...binds: unknown[]) {
  return env.DB.prepare(sql).bind(...binds).run();
}

const KINDS: ItemKind[] = ["task", "reminder", "idea", "commitment", "waiting"];

export interface ItemInput {
  kind?: string;
  title?: string;
  notes?: string;
  status?: string;
  priority?: number;
  due_at?: string | null;
  person?: string | null;
  project_id?: string | null;
  source?: string;
  category?: string | null;
}

export const CATEGORIES = ["coffee", "yeshiva", "personal"];
const validCategory = (c: unknown) => (typeof c === "string" && /^[a-z0-9-]{2,24}$/.test(c.toLowerCase()) ? c.toLowerCase() : null);

/** Remember which area a person belongs to, so their next requests are filed without asking. */
export async function learnCategory(env: Env, person: string | null | undefined, category: string) {
  if (!person) return;
  const p = await first<{ id: string }>(env, "SELECT id FROM people WHERE lower(name) = lower(?) OR lower(whatsapp_name) = lower(?)", person, person);
  const t = now();
  if (p) await run(env, "UPDATE people SET category = ?, updated_at = ? WHERE id = ?", category, t, p.id);
  else await run(env, "INSERT INTO people (id, name, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", uid(), person, category, t, t);
}

export async function createItem(env: Env, input: ItemInput): Promise<Item> {
  const kind = (KINDS.includes(input.kind as ItemKind) ? input.kind : "task") as ItemKind;
  if (!validCategory(input.category) && input.person) {
    const p = await first<{ category: string | null }>(env, "SELECT category FROM people WHERE lower(name) = lower(?) OR lower(whatsapp_name) = lower(?)", input.person, input.person);
    if (p?.category) input = { ...input, category: p.category };
  }
  const title = (input.title ?? "").trim();
  if (!title) throw new HttpError(400, "title is required");
  // The same thing twice (same words, ignoring case and punctuation) → the open one already there is used,
  // filled in with anything new (a project, a time), instead of a second copy.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (norm(title).length >= 4) {
    const same = (await all<Item>(env, "SELECT * FROM items WHERE status = 'open' AND kind = ? ORDER BY created_at DESC LIMIT 200", kind)).find((o) => norm(o.title) === norm(title));
    if (same) {
      const fill: ItemInput = {};
      if (!same.project_id && input.project_id) fill.project_id = input.project_id;
      if (!same.due_at && input.due_at) fill.due_at = input.due_at;
      if (!same.category && validCategory(input.category)) fill.category = input.category;
      return Object.keys(fill).length ? updateItem(env, same.id, fill) : same;
    }
  }
  const t = now();
  const item: Item = {
    id: uid(),
    kind,
    title,
    notes: input.notes ?? "",
    status: "open",
    priority: clampPriority(input.priority),
    due_at: toIso(input.due_at),
    person: input.person || null,
    project_id: input.project_id || null,
    source: input.source ?? "manual",
    category: validCategory(input.category),
    completed_at: null,
    created_at: t,
    updated_at: t,
  };
  await run(
    env,
    `INSERT INTO items (id, kind, title, notes, status, priority, due_at, person, project_id, source, category, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.id, item.kind, item.title, item.notes, item.status, item.priority, item.due_at,
    item.person, item.project_id, item.source, item.category, item.created_at, item.updated_at,
  );
  await syncProject(env, item.project_id);
  return item;
}

/**
 * Projects tidy themselves: when the last open item in a project is finished, the project is archived
 * (status "done"); if something new is added to an archived project, it comes back. Projects with no
 * finished item at all are left alone (an empty or brand-new project isn't "done").
 */
export async function syncProject(env: Env, projectId: string | null | undefined) {
  if (!projectId) return;
  const p = await first<{ status: string }>(env, "SELECT status FROM projects WHERE id = ?", projectId);
  if (!p || p.status === "paused") return;
  const c = await first<{ open: number; done: number }>(env,
    "SELECT SUM(status = 'open') AS open, SUM(status = 'done') AS done FROM items WHERE project_id = ?", projectId);
  const open = c?.open ?? 0, done = c?.done ?? 0;
  if (p.status === "active" && open === 0 && done > 0) await run(env, "UPDATE projects SET status = 'done', celebrate_at = ?, updated_at = ? WHERE id = ?", now(), now(), projectId);
  else if (p.status === "done" && open > 0) await run(env, "UPDATE projects SET status = 'active', celebrate_at = NULL, updated_at = ? WHERE id = ?", now(), projectId);
}

/** Cron safety net for items closed outside updateItem (e.g. "you replied on WhatsApp"). Archives only. */
export async function archiveFinishedProjects(env: Env) {
  await run(env, `UPDATE projects SET status = 'done', celebrate_at = ?, updated_at = ? WHERE status = 'active'
    AND EXISTS (SELECT 1 FROM items WHERE project_id = projects.id AND status = 'done')
    AND NOT EXISTS (SELECT 1 FROM items WHERE project_id = projects.id AND status = 'open')`, now(), now());
}

export async function updateItem(env: Env, id: string, input: ItemInput): Promise<Item> {
  const existing = await first<Item>(env, "SELECT * FROM items WHERE id = ?", id);
  if (!existing) throw new HttpError(404, "item not found");
  const next: Item = { ...existing };
  if (input.kind !== undefined && KINDS.includes(input.kind as ItemKind)) next.kind = input.kind as ItemKind;
  if (input.title !== undefined && input.title.trim()) next.title = input.title.trim();
  if (input.notes !== undefined) next.notes = input.notes;
  if (input.priority !== undefined) next.priority = clampPriority(input.priority);
  if (input.due_at !== undefined) next.due_at = toIso(input.due_at);
  if (input.person !== undefined) next.person = input.person || null;
  if (input.project_id !== undefined) next.project_id = input.project_id || null;
  if (input.category !== undefined) {
    next.category = validCategory(input.category);
    // The user moved it to another area: remember, so similar things are filed right next time.
    if (existing.category && next.category && existing.category !== next.category) {
      const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'area_corrections'");
      const list = (row ? JSON.parse(row.value) : []) as unknown[];
      list.unshift({ title: next.title.slice(0, 80), person: next.person, from: existing.category, to: next.category });
      await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('area_corrections', ?)", JSON.stringify(list.slice(0, 20)));
    }
  }
  if (input.status !== undefined && ["open", "done", "dropped"].includes(input.status)) {
    next.status = input.status as Item["status"];
    next.completed_at = next.status === "done" ? now() : null;
  }
  next.updated_at = now();
  if (next.status !== "open" && existing.status === "open") {
    await run(env, "UPDATE nudges SET dismissed = 1 WHERE item_id = ?", id);
  }
  // A rescheduled item should be able to remind again, at the new time (not right away).
  const resetReminder = input.due_at !== undefined && next.due_at !== existing.due_at;
  const later = resetReminder && !!next.due_at && next.due_at > now();
  // Moved to later: the reminder on screen about it goes away, and the "get back to them" check
  // (which has its own timer) waits for the new time too, instead of coming straight back.
  if (later) await run(env, "UPDATE nudges SET dismissed = 1 WHERE item_id = ? AND dismissed = 0", id);
  // Pushed later after it had already come due (or was about to): that's a postponement.
  const postponed = resetReminder && !!existing.due_at && !!next.due_at && next.due_at > existing.due_at
    && new Date(existing.due_at).getTime() <= Date.now() + 3600_000;
  await run(
    env,
    `UPDATE items SET kind=?, title=?, notes=?, status=?, priority=?, due_at=?, person=?, project_id=?, category=?,
       completed_at=?, updated_at=?, reminded_at = CASE WHEN ? THEN NULL ELSE reminded_at END,
       heads_up_at = CASE WHEN ? THEN NULL ELSE heads_up_at END, nudge_after = CASE WHEN ? THEN ? ELSE nudge_after END,
       snooze_count = snooze_count + ? WHERE id=?`,
    next.kind, next.title, next.notes, next.status, next.priority, next.due_at, next.person,
    next.project_id, next.category ?? null, next.completed_at, next.updated_at, resetReminder ? 1 : 0, resetReminder ? 1 : 0,
    resetReminder ? 1 : 0, later ? next.due_at : null, postponed ? 1 : 0, id,
  );
  await syncProject(env, next.project_id);
  if (existing.project_id !== next.project_id) await syncProject(env, existing.project_id);
  return next;
}

export async function createProject(env: Env, input: Partial<Project>): Promise<Project> {
  const name = (input.name ?? "").trim();
  if (!name) throw new HttpError(400, "name is required");
  const t = now();
  const p: Project = {
    id: uid(),
    name,
    description: input.description ?? "",
    area: input.area === "business" ? "business" : "personal",
    status: "active",
    created_at: t,
    updated_at: t,
  };
  await run(
    env,
    "INSERT INTO projects (id, name, description, area, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    p.id, p.name, p.description, p.area, p.status, p.created_at, p.updated_at,
  );
  return p;
}

/** Resolve a project by id or (case-insensitive) name — the model usually knows names. */
export async function resolveProjectId(env: Env, ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const byId = await first<{ id: string }>(env, "SELECT id FROM projects WHERE id = ?", ref);
  if (byId) return byId.id;
  const byName = await first<{ id: string }>(env, "SELECT id FROM projects WHERE lower(name) = lower(?)", ref);
  return byName?.id ?? null;
}

const DEFAULT_SETTINGS = (env: Env): Settings => ({
  name: "",
  timezone: env.TIMEZONE || "UTC",
  briefing_hour: 7,
  voice_name: "",
  proactive: true,
});

export async function getSettings(env: Env): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(env, "SELECT key, value FROM settings");
  const s = DEFAULT_SETTINGS(env) as unknown as Record<string, unknown>;
  for (const r of rows) {
    if (!(r.key in s)) continue; // skip internal markers such as "briefing:<date>"
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore malformed */
    }
  }
  return s as unknown as Settings;
}

export async function saveSettings(env: Env, patch: Partial<Settings>) {
  const allowed: (keyof Settings)[] = ["name", "timezone", "briefing_hour", "voice_name", "proactive"];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    await run(
      env,
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key, JSON.stringify(patch[key]),
    );
  }
  return getSettings(env);
}

function clampPriority(p: unknown): number {
  const n = Number(p);
  return n === 1 || n === 3 ? n : 2;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Local wall-clock pieces for a timezone, used for "today" and the briefing hour. */
export function localParts(tz: string, d = new Date()) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false });
  }
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** UTC instant at which the local day containing `d` ends. */
export function endOfLocalDay(tz: string, d = new Date()): string {
  const today = localParts(tz, d).date;
  // Step forward hour by hour until the local date changes (handles any offset/DST).
  let t = new Date(d.getTime());
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 26 && localParts(tz, t).date === today; i++) t = new Date(t.getTime() + 3600_000);
  return t.toISOString();
}

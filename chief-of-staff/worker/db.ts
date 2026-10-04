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
const validCategory = (c: unknown) => (typeof c === "string" && CATEGORIES.includes(c.toLowerCase()) ? c.toLowerCase() : null);

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
  return item;
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
  if (input.category !== undefined) next.category = validCategory(input.category);
  if (input.status !== undefined && ["open", "done", "dropped"].includes(input.status)) {
    next.status = input.status as Item["status"];
    next.completed_at = next.status === "done" ? now() : null;
  }
  next.updated_at = now();
  // A rescheduled item should be able to remind again.
  const resetReminder = input.due_at !== undefined && next.due_at !== existing.due_at;
  await run(
    env,
    `UPDATE items SET kind=?, title=?, notes=?, status=?, priority=?, due_at=?, person=?, project_id=?, category=?,
       completed_at=?, updated_at=?, reminded_at = CASE WHEN ? THEN NULL ELSE reminded_at END WHERE id=?`,
    next.kind, next.title, next.notes, next.status, next.priority, next.due_at, next.person,
    next.project_id, next.category ?? null, next.completed_at, next.updated_at, resetReminder ? 1 : 0, id,
  );
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

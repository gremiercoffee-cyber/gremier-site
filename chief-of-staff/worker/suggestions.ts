/**
 * "I just saw this on your WhatsApp: add it?" Nothing from WhatsApp lands in the To-do list or the
 * Schedule until the user taps Yes, so a wrong guess costs nothing. If it looks like part of a project,
 * the question says so (clear match) or offers the likely projects as buttons (unsure).
 */
import type { Env } from "./env";
import { createItem, first, now, run, uid } from "./db";
import { notify } from "./push";
import { saveSituation } from "./situations";

export interface ItemSuggestion {
  title: string; kind?: string; due_at?: string | null; category?: string | null; person?: string; notes?: string; priority?: number;
  /** Clearly part of this project: used when the user says Yes. */
  project_id?: string | null;
  /** Might be part of one of these: offered as buttons. */
  candidates?: { id: string; name: string }[];
}
export interface MeetingSuggestion { name: string; date: string; start_time: string; end_time: string; keywords: string; category?: string; note?: string; existing_id?: string }

export async function suggest(env: Env, kind: "item" | "meeting", payload: ItemSuggestion | MeetingSuggestion, chat: string, title: string, body: string) {
  const id = uid();
  await run(env, "INSERT INTO suggestions (id, kind, payload, chat, created_at) VALUES (?, ?, ?, ?, ?)", id, kind, JSON.stringify(payload), chat, now());
  await notify(env, "suggest", title, body, id, "/");
  return id;
}

export async function suggestionChoices(env: Env, id: string): Promise<{ project_id: string | null; project: string | null; candidates: { id: string; name: string }[] }> {
  const s = await first<{ kind: string; payload: string; status: string }>(env, "SELECT kind, payload, status FROM suggestions WHERE id = ?", id);
  if (!s || s.kind !== "item" || s.status !== "pending") return { project_id: null, project: null, candidates: [] };
  const p = JSON.parse(s.payload) as ItemSuggestion;
  const name = p.project_id ? (await first<{ name: string }>(env, "SELECT name FROM projects WHERE id = ?", p.project_id))?.name ?? null : null;
  return { project_id: p.project_id ?? null, project: name, candidates: p.candidates ?? [] };
}

export async function decideSuggestion(env: Env, id: string, yes: boolean, projectId?: string | null): Promise<string> {
  const s = await first<{ kind: string; payload: string; status: string }>(env, "SELECT kind, payload, status FROM suggestions WHERE id = ?", id);
  if (!s || s.status !== "pending") return "Already handled.";
  await run(env, "UPDATE suggestions SET status = ? WHERE id = ?", yes ? "accepted" : "declined", id);
  if (!yes) return "OK, left it.";
  if (s.kind === "meeting") {
    const m = JSON.parse(s.payload) as MeetingSuggestion;
    await saveSituation(env, { ...(m.existing_id ? { id: m.existing_id } : {}), name: m.name, date: m.date, start_time: m.start_time, end_time: m.end_time,
      keywords: m.keywords, category: m.category, note: m.note ?? "", mode: "start" });
    return `📅 In your Schedule: ${m.name}, ${m.start_time}.`;
  }
  const p = JSON.parse(s.payload) as ItemSuggestion;
  // "none" = added without a project; otherwise the project they tapped, else the clear match.
  const project_id = projectId === "none" ? null : projectId ?? p.project_id ?? null;
  const item = await createItem(env, { kind: p.due_at ? "reminder" : p.kind === "commitment" ? "commitment" : "task", title: p.title, due_at: p.due_at ?? null,
    category: p.category ?? null, person: p.person ?? null, priority: p.priority, project_id, source: "whatsapp_ok", notes: p.notes ?? "" });
  const proj = project_id ? (await first<{ name: string }>(env, "SELECT name FROM projects WHERE id = ?", project_id))?.name : null;
  return `Added: ${item.title}${proj ? ` (in ${proj})` : ""}`;
}

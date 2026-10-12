/**
 * Which project does this belong to? Everything that gets filed for the user (from WhatsApp, meeting
 * notes…) is checked against their active projects. Clearly part of one → filed there without asking.
 * Maybe part of a few → the user is asked ("Is this for A or B?"), with one tap per answer.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, now, run, uid } from "./db";
import { notify } from "./push";

export interface ProjectLite { id: string; name: string; description: string; samples: string[] }

/** Active projects with a couple of their open items, as context for deciding membership. */
export async function activeProjects(env: Env, limit = 20): Promise<ProjectLite[]> {
  const ps = await all<{ id: string; name: string; description: string }>(env,
    "SELECT id, name, description FROM projects WHERE status = 'active' ORDER BY updated_at DESC LIMIT ?", limit);
  if (!ps.length) return [];
  const items = await all<{ project_id: string; title: string }>(env,
    `SELECT project_id, title FROM items WHERE status = 'open' AND project_id IN (${ps.map(() => "?").join(",")}) ORDER BY created_at DESC`, ...ps.map((p) => p.id));
  return ps.map((p) => ({ ...p, samples: items.filter((i) => i.project_id === p.id).slice(0, 3).map((i) => i.title.slice(0, 50)) }));
}

export const projectsForPrompt = (ps: ProjectLite[]) =>
  ps.map((p) => `${p.id} | ${p.name}${p.description ? ` — ${p.description.slice(0, 80)}` : ""}${p.samples.length ? ` | e.g. ${p.samples.join("; ")}` : ""}`).join("\n");

/** One small AI call (skipped when there are no projects). `project` only when it's clear; `maybe` when it could be one of a few. */
export async function matchProject(env: Env, q: { title: string; text?: string; person?: string | null }, projects?: ProjectLite[]) {
  const ps = projects ?? await activeProjects(env);
  if (!ps.length) return { project_id: null as string | null, maybe: [] as { id: string; name: string }[] };
  let v: { project?: string | null; maybe?: string[] } = {};
  try {
    const out = await getProvider(env).complete({
      tier: "fast", purpose: "project_match", maxTokens: 120,
      system: `Decide whether a to-do belongs to one of the user's projects. Projects (id | name | e.g. open items):\n${projectsForPrompt(ps)}
"project": the id ONLY if it is clearly part of that project: the project is named, or it is obviously a step of it (same goal, product, supplier, person or subject). "maybe": up to 3 ids that it plausibly belongs to when you're not sure (leave "project" null then). Most things belong to none: then both are empty. Reply ONLY JSON: {"project": id|null, "maybe": [ids]}`,
      prompt: `To-do: ${q.title}${q.person ? `\nPerson: ${q.person}` : ""}${q.text ? `\nContext: ${q.text.slice(0, 400)}` : ""}`,
    });
    v = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  } catch (e) { console.error("project match", e); }
  const byId = new Map(ps.map((p) => [p.id, p]));
  if (v.project && byId.has(v.project)) return { project_id: v.project, maybe: [] };
  const maybe = [...new Set(v.maybe ?? [])].filter((id) => byId.has(id)).slice(0, 3).map((id) => ({ id, name: byId.get(id)!.name }));
  return { project_id: null, maybe };
}

/** Ask "which project?" about items already filed without one. Answered with one tap (actions.ts). */
export async function askProject(env: Env, items: { id: string; title: string }[], candidates: { id: string; name: string }[], subject: string) {
  if (!items.length || !candidates.length) return null;
  const id = uid();
  await run(env, "INSERT INTO project_asks (id, item_ids, candidates, created_at) VALUES (?, ?, ?, ?)", id, JSON.stringify(items.map((i) => i.id)), JSON.stringify(candidates), now());
  await notify(env, "project_ask", `🗂️ Part of a project? ${subject.slice(0, 70)}`,
    items.length > 1 ? items.map((i) => `• ${i.title}`).join("\n") : "", id, "/");
  return id;
}

/** Put items into a project (and let it come back from the archive if needed). */
export async function assignProject(env: Env, itemIds: string[], projectId: string | null) {
  for (const id of itemIds) await run(env, "UPDATE items SET project_id = ?, updated_at = ? WHERE id = ?", projectId, now(), id);
  if (projectId) await run(env, "UPDATE projects SET status = CASE WHEN status = 'done' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?", now(), projectId);
  return first<{ name: string }>(env, "SELECT name FROM projects WHERE id = ?", projectId ?? "");
}

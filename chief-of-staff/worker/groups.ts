/** Contact groups ("the rabbis", "wholesale customers"): who is in them, for searching email and WhatsApp by group. */
import type { Env } from "./env";
import { all, first, now, run, uid } from "./db";
import { savePerson, type Person } from "./memory";

export interface Group { id: string; name: string; description: string; created_at: string; updated_at: string }
type MemberInput = { name?: string; email?: string; phone?: string; id?: string };

export async function findGroup(env: Env, ref: string) {
  return first<Group>(env, "SELECT * FROM contact_groups WHERE id = ? OR lower(name) = lower(?) OR lower(name) LIKE lower(?) ORDER BY updated_at DESC", ref, ref, `%${ref}%`);
}

export async function members(env: Env, groupId: string) {
  return all<Person>(env, "SELECT p.* FROM group_members g JOIN people p ON p.id = g.person_id WHERE g.group_id = ? ORDER BY p.name", groupId);
}

async function addMember(env: Env, groupId: string, m: MemberInput) {
  let id = m.id;
  if (!id) {
    if (!m.name && !m.email) return;
    const p = await savePerson(env, {
      name: m.name || m.email, ...(m.email ? { email: m.email.trim() } : {}), ...(m.phone ? { phone: m.phone.trim() } : {}),
    });
    id = p.id;
  }
  await run(env, "INSERT OR IGNORE INTO group_members (group_id, person_id) VALUES (?, ?)", groupId, id);
}

export async function saveGroup(env: Env, input: { id?: string; name?: string; description?: string; add?: MemberInput[]; remove?: string[] }) {
  const existing = input.id ? await findGroup(env, input.id) : input.name ? await first<Group>(env, "SELECT * FROM contact_groups WHERE lower(name) = lower(?)", input.name) : null;
  const t = now();
  let id = existing?.id;
  if (existing) {
    await run(env, "UPDATE contact_groups SET name = ?, description = ?, updated_at = ? WHERE id = ?",
      (input.name ?? existing.name).slice(0, 80), (input.description ?? existing.description).slice(0, 400), t, existing.id);
  } else {
    if (!input.name) throw new Error("What should the group be called?");
    id = uid();
    await run(env, "INSERT INTO contact_groups (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", id, input.name.slice(0, 80), (input.description ?? "").slice(0, 400), t, t);
  }
  for (const m of input.add ?? []) await addMember(env, id!, m);
  for (const r of input.remove ?? []) {
    await run(env, `DELETE FROM group_members WHERE group_id = ? AND person_id IN
      (SELECT id FROM people WHERE id = ? OR lower(name) = lower(?) OR lower(email) = lower(?))`, id, r, r, r);
  }
  const g = (await first<Group>(env, "SELECT * FROM contact_groups WHERE id = ?", id))!;
  return { ...g, members: await members(env, g.id) };
}

export async function groupsSummary(env: Env) {
  const gs = await all<Group & { n: number }>(env,
    "SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS n FROM contact_groups g ORDER BY g.name");
  return gs.map((g) => `- ${g.name} (id ${g.id}; ${g.n} people${g.description ? `; ${g.description}` : ""})`).join("\n");
}

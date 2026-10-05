/**
 * Contact groups and group messages. The assistant (or the user) writes one message for a group;
 * nothing goes out until the user taps "Send email" on it in the app. Each person gets their own
 * email ({first_name} is filled in). WhatsApp can't mass-send, so the app offers the same text
 * preloaded in WhatsApp, one tap per person or group chat.
 */
import type { Env } from "./env";
import { all, first, now, run, uid } from "./db";
import { savePerson, type Person } from "./memory";
import { sendEmail } from "./google";

export interface Group { id: string; name: string; description: string; created_at: string; updated_at: string }
export interface Broadcast {
  id: string; group_id: string; subject: string; body: string; from_account: string | null; status: string; results: string;
  created_at: string; sent_at: string | null;
}
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

export async function draftBroadcast(env: Env, input: { group: string; subject?: string; body: string; from_account?: string; id?: string }) {
  const g = await findGroup(env, input.group);
  if (!g) throw new Error(`No group called "${input.group}". Create it first.`);
  if (input.id) {
    await run(env, "UPDATE broadcasts SET subject = ?, body = ?, from_account = COALESCE(?, from_account) WHERE id = ? AND status = 'draft'",
      (input.subject ?? "").slice(0, 200), input.body.slice(0, 20000), input.from_account ?? null, input.id);
    return (await first<Broadcast>(env, "SELECT * FROM broadcasts WHERE id = ?", input.id))!;
  }
  const id = uid();
  await run(env, "INSERT INTO broadcasts (id, group_id, subject, body, from_account, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, g.id, (input.subject ?? "").slice(0, 200), input.body.slice(0, 20000), input.from_account ?? null, now());
  return (await first<Broadcast>(env, "SELECT * FROM broadcasts WHERE id = ?", id))!;
}

/** "Hi {first_name}" → "Hi Avi". */
export function personalize(text: string, p: { name: string }) {
  const first = /^(rabbi|rav|harav|reb|mr|mrs|ms|dr|prof)\.?\s/i.test(p.name) ? p.name : p.name.split(/\s+/)[0] ?? p.name;
  return text.replace(/\{first_name\}/gi, first).replace(/\{name\}/gi, p.name);
}

/** Only called from the user's own tap on "Send email" in the app. */
export async function sendBroadcast(env: Env, id: string) {
  const b = await first<Broadcast>(env, "SELECT * FROM broadcasts WHERE id = ?", id);
  if (!b) throw new Error("message not found");
  if (b.status !== "draft") throw new Error("This message was already sent.");
  await run(env, "UPDATE broadcasts SET status = 'sending' WHERE id = ?", id);
  const people = await members(env, b.group_id);
  const results: { name: string; email: string | null; ok: boolean; error?: string }[] = [];
  for (const p of people) {
    if (!p.email) { results.push({ name: p.name, email: null, ok: false, error: "no email" }); continue; }
    try {
      await sendEmail(env, { to: p.email, subject: personalize(b.subject, p), body: personalize(b.body, p), account: b.from_account ?? undefined });
      results.push({ name: p.name, email: p.email, ok: true });
    } catch (e) {
      results.push({ name: p.name, email: p.email, ok: false, error: (e as Error).message.slice(0, 160) });
    }
  }
  await run(env, "UPDATE broadcasts SET status = 'sent', results = ?, sent_at = ? WHERE id = ?", JSON.stringify(results), now(), id);
  return { sent: results.filter((r) => r.ok).length, skipped: results.filter((r) => !r.ok), total: people.length };
}

export async function groupsSummary(env: Env) {
  const gs = await all<Group & { n: number }>(env,
    "SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS n FROM contact_groups g ORDER BY g.name");
  return gs.map((g) => `- ${g.name} (id ${g.id}; ${g.n} people${g.description ? `; ${g.description}` : ""})`).join("\n");
}

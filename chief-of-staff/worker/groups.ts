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
import { greetingName } from "../shared/greeting";
import { saveTracker } from "./trackers";

export interface Group { id: string; name: string; description: string; created_at: string; updated_at: string }
export interface Broadcast {
  id: string; group_id: string; subject: string; body: string; from_account: string | null; status: string; results: string;
  created_at: string; sent_at: string | null; archived_at?:string|null;
  collect_expecting?: string | null; collect?: number | null; tracker_id?: string | null;
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

export async function draftBroadcast(env: Env, input: { group: string; subject?: string; body: string; from_account?: string; id?: string; collecting?: string; collect?: boolean }) {
  const g = await findGroup(env, input.group);
  if (!g) throw new Error(`No group called "${input.group}". Create it first.`);
  if (input.id) {
    const b=await first<Broadcast>(env,'SELECT * FROM broadcasts WHERE id=?',input.id);
    if(!b||b.group_id!==g.id)throw new Error('This draft does not belong to that group.');
    if(b.status!=='draft'||b.archived_at)throw new Error('Only unsent drafts can be edited.');
    if(!input.body.trim())throw new Error('Write a message first.');
    if(input.collecting!==undefined||input.collect!==undefined)await setCollect(env,input.id,{collect:input.collect,expecting:input.collecting});
    await run(env,"UPDATE broadcasts SET subject=?,body=?,from_account=COALESCE(?,from_account) WHERE id=? AND status='draft' AND archived_at IS NULL",(input.subject??'').slice(0,200),input.body.slice(0,20000),input.from_account??null,input.id);
    return (await first<Broadcast>(env,'SELECT * FROM broadcasts WHERE id=?',input.id))!;
  }
  if(!input.body?.trim())throw new Error('Write a message first.');
  const id = uid();
  await run(env, "INSERT INTO broadcasts (id, group_id, subject, body, from_account, created_at, collect_expecting, collect) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, g.id, (input.subject ?? "").slice(0, 200), input.body.slice(0, 20000), input.from_account ?? null, now(),
    input.collecting ? String(input.collecting).slice(0, 600) : null, input.collect === undefined ? null : input.collect ? 1 : 0);
  return (await first<Broadcast>(env, "SELECT * FROM broadcasts WHERE id = ?", id))!;
}

/** "Hi {first_name}" → "Hi Avi". */
export function personalize(text: string, p: { name: string }) {
  const first = greetingName(p.name); // "R' Heyman" stays whole; "Avi Cohen" → "Avi"
  return text.replace(/\{first_name\}/gi, first).replace(/\{name\}/gi, p.name);
}

/** Only called from the user's own tap on "Send email" in the app. */
export async function sendBroadcast(env: Env, id: string, edit?:{subject?:string;body?:string;force?:boolean}) {
  let b = await first<Broadcast>(env, "SELECT * FROM broadcasts WHERE id = ?", id);
  if (!b) throw new Error("message not found");
  if (b.status !== "draft"||b.archived_at) throw new Error("This message was already handled.");
  // A second email to the same group within 2 minutes is almost always a mis-tap (e.g. an older draft that slid
  // into place after the first send). It goes out only if the user confirms it.
  if (!edit?.force) {
    const recent = await first<{ sent_at: string; subject: string }>(env,
      "SELECT sent_at, subject FROM broadcasts WHERE group_id = ? AND id != ? AND sent_at > ? ORDER BY sent_at DESC LIMIT 1",
      b.group_id, id, new Date(Date.now() - 120_000).toISOString());
    if (recent) throw new Error(`RECENT_SEND: You sent "${recent.subject || "a message"}" to this group ${Math.max(1, Math.round((Date.now() - Date.parse(recent.sent_at)) / 1000))} seconds ago. Send this one too?`);
  }
  const people = await members(env, b.group_id);
  if(!people.some(p=>p.email))throw new Error('This group has no email recipients. Use WhatsApp.');
  const body=(edit?.body??b.body).trim(),subject=edit?.subject??b.subject;
  if(!body||body.length>20000||subject.length>200)throw new Error('Check the subject and message length.');
  const claim=await run(env,"UPDATE broadcasts SET status='sending',body=?,subject=? WHERE id=? AND status='draft' AND archived_at IS NULL",body,subject,id);
  if(!claim.meta.changes)throw new Error('This message is already being sent.');
  b={...b,body,subject};
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
  const failures=results.some(r=>r.email&&!r.ok),sent=results.some(r=>r.ok),t=now();
  await run(env,"UPDATE broadcasts SET status=?,results=?,sent_at=?,archived_at=? WHERE id=?",failures?(sent?'partial':'failed'):'sent',JSON.stringify(results),t,sent?t:null,id);
  // "Collect their answers" was on: start collecting from this group, from now (email replies and WhatsApp).
  if (sent && b.collect === 1 && !b.tracker_id) {
    try {
      const g = await first<{ name: string }>(env, "SELECT name FROM contact_groups WHERE id = ?", b.group_id);
      const tr = await saveTracker(env, { name: (b.subject || b.collect_expecting || "Answers").slice(0, 80), group: g?.name ?? b.group_id,
        expecting: b.collect_expecting || `Their reply to: ${b.subject || body.slice(0, 120)}`, sources: "gmail,whatsapp", backfill_days: 0 });
      await run(env, "UPDATE trackers SET broadcast_id = ? WHERE id = ?", id, tr.id);
      await run(env, "UPDATE broadcasts SET tracker_id = ? WHERE id = ?", tr.id, id);
    } catch (e) { console.error("collection", e); }
  }
  // Copies of what was just sent (the same text saved twice) are finished too: they must not be sendable again.
  if (sent) {
    const same = (s: string) => s.replace(/\{(?:first_)?name\}/gi, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    for (const d of await all<{ id: string; body: string }>(env, "SELECT id, body FROM broadcasts WHERE group_id = ? AND id != ? AND status = 'draft' AND archived_at IS NULL", b.group_id, id))
      if (same(d.body) === same(body)) await run(env, "UPDATE broadcasts SET archived_at = ? WHERE id = ?", t, d.id);
  }
  return { sent: results.filter((r) => r.ok).length, skipped: results.filter((r) => !r.ok), total: people.length };
}

export async function groupsSummary(env: Env) {
  const gs = await all<Group & { n: number }>(env,
    "SELECT g.*, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS n FROM contact_groups g ORDER BY g.name");
  return gs.map((g) => `- ${g.name} (id ${g.id}; ${g.n} people${g.description ? `; ${g.description}` : ""})`).join("\n");
}

export async function archiveBroadcast(env:Env,id:string){await run(env,"UPDATE broadcasts SET archived_at=? WHERE id=? AND status!='sending'",now(),id);return {ok:true};}

/** Collect their answers? (the switch on a group draft). */
export async function setCollect(env: Env, id: string, p: { collect?: boolean; expecting?: string }) {
  const b = await first<Broadcast>(env, "SELECT * FROM broadcasts WHERE id = ?", id);
  if (!b) throw new Error("message not found");
  if (b.status !== "draft") throw new Error("This message was already sent.");
  await run(env, "UPDATE broadcasts SET collect = COALESCE(?, collect), collect_expecting = COALESCE(?, collect_expecting) WHERE id = ?",
    p.collect === undefined ? null : p.collect ? 1 : 0, p.expecting === undefined ? null : String(p.expecting).slice(0, 600), id);
  return first<Broadcast>(env, "SELECT * FROM broadcasts WHERE id = ?", id);
}

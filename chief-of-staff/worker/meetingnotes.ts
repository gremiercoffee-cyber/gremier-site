/**
 * Meetings, before and after.
 *
 * After: the user types notes to their own WhatsApp chat during a meeting ("Meeting with Avi about the
 * new labels: …"). Once they've stopped for a while, a burst of notes that says it's from a meeting is
 * turned into a Google Doc of meeting notes plus to-dos/reminders, filed under the right area.
 *
 * Preparation is kept separately as user-confirmed, in-app agenda notes in meeting-prep.ts.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, createItem, first, getSettings, now, run, uid } from "./db";
import { areaKeysJson } from "./areas";
import { createDoc } from "./gworkspace";
import { notify } from "./push";
import { askProject, matchProject } from "./projectmatch";

const QUIET_MS = 30 * 60_000;   // notes stop for this long → the meeting is over
const SESSION_GAP_MS = 45 * 60_000;
// The user says in the notes that it's a meeting; only then do we spend an AI call.
const MEETING_RE = /\b(meeting|mtg|met with|call with|sit ?down|notes from)\b|פגישה|פגישת|ישיבה עם|שיחה עם|נפגשתי/i;

export async function saveSelfNote(env: Env, m: { text?: string; t?: number }) {
  const text = String(m.text ?? "").trim().slice(0, 4000);
  if (!text) return { ok: false };
  const at = m.t ? new Date(m.t * 1000).toISOString() : now();
  if (await first(env, "SELECT 1 FROM self_notes WHERE text = ? AND sent_at = ?", text, at)) return { ok: true, duplicate: true };
  await run(env, "INSERT INTO self_notes (id, text, sent_at) VALUES (?, ?, ?)", uid(), text, at);
  return { ok: true };
}

/** Cron: turn finished bursts of self-notes that are meeting notes into a Doc + to-dos. */
export async function processSelfNotes(env: Env) {
  const notes = await all<{ id: string; text: string; sent_at: string }>(env,
    "SELECT id, text, sent_at FROM self_notes WHERE processed = 0 ORDER BY sent_at LIMIT 200");
  if (!notes.length) return;
  const sessions: (typeof notes)[] = [];
  for (const n of notes) {
    const cur = sessions[sessions.length - 1];
    if (cur && Date.parse(n.sent_at) - Date.parse(cur[cur.length - 1].sent_at) < SESSION_GAP_MS) cur.push(n);
    else sessions.push([n]);
  }
  for (const s of sessions) {
    if (Date.now() - Date.parse(s[s.length - 1].sent_at) < QUIET_MS) continue; // still writing
    await run(env, `UPDATE self_notes SET processed = 1 WHERE id IN (${s.map(() => "?").join(",")})`, ...s.map((n) => n.id));
    if (!s.some((n) => MEETING_RE.test(n.text))) continue;
    await meetingNotes(env, s).catch((e) => console.error("meeting notes", e));
  }
}

async function meetingNotes(env: Env, notes: { text: string; sent_at: string }[]) {
  const tz = (await getSettings(env)).timezone || "Asia/Jerusalem";
  const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const out = await getProvider(env).complete({
    tier: "main", purpose: "meeting_notes", maxTokens: 1500,
    system: `These are notes the user typed to themselves on WhatsApp. Decide if they are notes FROM A MEETING (they say so: "meeting with…", "פגישה עם…"). If yes, turn them into clean meeting notes. Keep their content and language; don't invent anything. Now: ${fmt(now())} (${tz}).
Reply ONLY JSON: {"is_meeting": true|false, "title": "Meeting with X: topic", "with": "who" , "area": AREA_KEYS|null,
"notes_md": "## Summary\\n…\\n## Discussed\\n- …\\n## Decisions\\n- …\\n## Follow-ups\\n- …",
"todos": [{"title": "something the USER must do, written to them", "due_at": "ISO 8601 with offset, only if a time/date was said, else null", "person": "name or null"}]}`
      .replace("AREA_KEYS", await areaKeysJson(env)),
    prompt: notes.map((n) => `[${fmt(n.sent_at)}] ${n.text}`).join("\n"),
  });
  const v = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as {
    is_meeting?: boolean; title?: string; with?: string; area?: string | null; notes_md?: string; todos?: { title?: string; due_at?: string | null; person?: string | null }[];
  };
  if (!v.is_meeting) return;
  const title = String(v.title || "Meeting notes").slice(0, 100);
  const date = new Date(notes[0].sent_at).toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" });
  let link: string | null = null;
  try {
    const d = await createDoc(env, `${title} · ${date}`, `# ${title}\n${date}${v.with ? ` · with ${v.with}` : ""}\n\n${v.notes_md ?? ""}\n\n## Your original notes\n${notes.map((n) => `- ${n.text.replace(/\n+/g, " ")}`).join("\n")}`);
    link = d.link;
  } catch (e) { console.error("meeting doc", e); }
  // Is the meeting about one of the user's projects? Clear → its to-dos go there; unsure → asked once for all of them.
  const todos = (v.todos ?? []).filter((t) => t.title).slice(0, 12);
  const pm = todos.length ? await matchProject(env, { title, text: `${v.notes_md ?? ""}`, person: v.with }).catch(() => ({ project_id: null as string | null, maybe: [] as { id: string; name: string }[] })) : { project_id: null, maybe: [] };
  let added = 0;
  const made: { id: string; title: string }[] = [];
  for (const t of todos) {
    const item = await createItem(env, { kind: t.due_at ? "reminder" : "task", title: t.title!, due_at: t.due_at ?? null, person: t.person ?? v.with ?? null,
      category: v.area ?? null, project_id: pm.project_id, source: "meeting", notes: `From your notes: ${title}${link ? `\n${link}` : ""}` });
    made.push({ id: item.id, title: item.title });
    added++;
  }
  if (!pm.project_id && pm.maybe.length) await askProject(env, made, pm.maybe, title);
  await notify(env, "meeting_notes", `📝 ${title}`,
    `${link ? "Your notes are in a Google Doc." : "I couldn't make the Doc (Google not connected)."}${added ? ` ${added} to-do${added > 1 ? "s" : ""} added.` : ""}`, null, link ?? "/");
}

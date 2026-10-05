/**
 * Learning: every so often, read what's new (what the user said, brain dumps, WhatsApp, email
 * subjects, calendar) and propose what it reveals about their life: facts, who people/companies
 * are to them, routines. Nothing is trusted until the user accepts it in Memory → To review.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, getSettings, now, run, uid } from "./db";
import { savePerson } from "./memory";
import { saveSituation } from "./situations";
import { notify } from "./push";

const KEY = "learn_since";
const MIN_GAP_MS = 25 * 60_000;

async function setting(env: Env, key: string) {
  return (await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = ?", key))?.value ?? null;
}
async function put(env: Env, key: string, value: string) {
  await run(env, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}

interface Suggestion {
  kind?: string; content?: string; area?: string | null; about?: string | null; question?: string | null; evidence?: string | null;
  person?: { name?: string; role?: string; notes?: string }; schedule?: Record<string, unknown>;
}

export async function learnPass(env: Env, force = false) {
  const last = await setting(env, "learn_last_run");
  if (!force && last && Date.now() - Date.parse(last) < MIN_GAP_MS) return { skipped: "too soon" };
  const since = (await setting(env, KEY)) ?? new Date(Date.now() - 3 * 86400_000).toISOString();
  const started = now();
  await put(env, "learn_last_run", started);

  const [said, dumps, wa, mail, cal] = await Promise.all([
    all<{ content: string }>(env, "SELECT content FROM messages WHERE role = 'user' AND created_at > ? ORDER BY created_at LIMIT 40", since),
    all<{ raw: string }>(env, "SELECT raw FROM brain_dumps WHERE created_at > ? LIMIT 10", since),
    all<{ chat: string; sender: string; text: string }>(env, "SELECT chat, sender, text FROM whatsapp_inbox WHERE received_at > ? ORDER BY received_at LIMIT 40", since),
    all<{ subject: string; counterpart: string }>(env, "SELECT subject, counterpart FROM gmail_threads WHERE updated_at > ? LIMIT 25", since),
    all<{ summary: string; start_at: string; location: string | null }>(env, "SELECT summary, start_at, location FROM calendar_events WHERE updated_at > ? LIMIT 25", since),
  ]);
  const tz = (await getSettings(env)).timezone;
  const cut = (s: string, n = 400) => s.replace(/\s+/g, " ").slice(0, n);
  const snippets = [
    ...said.map((m) => `[user said] ${cut(m.content, 800)}`),
    ...dumps.map((d) => `[brain dump] ${cut(d.raw, 1200)}`),
    ...wa.map((m) => `[WhatsApp ${m.chat}${m.sender !== m.chat ? ` / ${m.sender}` : ""}] ${cut(m.text)}`),
    ...mail.map((m) => `[email with ${m.counterpart}] ${cut(m.subject, 150)}`),
    ...cal.map((e) => `[calendar ${localTime(e.start_at, tz)}] ${cut(e.summary, 150)}${e.location ? ` @ ${e.location}` : ""}`),
  ];
  if (!snippets.length) { await put(env, KEY, started); return { learned: 0 }; }

  const [known, people] = await Promise.all([
    all<{ content: string; status: string }>(env, "SELECT content, status FROM memories ORDER BY updated_at DESC LIMIT 200"),
    all<{ name: string; role: string }>(env, "SELECT name, role FROM people LIMIT 150"),
  ]);
  const system = `You are the learning engine of a personal Chief of Staff. The user runs a coffee business (Gremier Coffee), works at a yeshiva, and has a personal/family life. All times below are the user's local time (${tz}); use them as given. From the new material below, pick out what reveals something LASTING about their life worth remembering: who a person or company is to them (e.g. "Bottle company X supplies the bottles for your coffee business"), suppliers, customers, colleagues, family, roles, routines and weekly schedule, preferences, ongoing commitments, places, prices, how things work in their businesses. Be selective and minimalist: propose only what is ESSENTIAL and LASTING, things that will matter again and again. Not every person who writes is worth remembering: propose a person only if they clearly play an ongoing role (seen repeatedly, or a supplier/customer/colleague/family member), and set person.key=true only if they are central to the user's life. Prefer one summarizing fact over many small ones (e.g. "You oversee the Night Seder rabbis: A, B, C" instead of one suggestion per rabbi). Nothing one-off (a single errand or a single message is not a memory) and nothing already known. When you are guessing, say so in "question" (e.g. "Is X your bottle supplier for the coffee business?").
Already known (don't repeat, don't re-propose ignored ones):
${known.map((k) => `- ${k.status === "ignored" ? "(ignored) " : ""}${k.content.slice(0, 160)}`).join("\n") || "- nothing yet"}
People already known: ${people.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join("; ") || "none"}

Reply with ONLY JSON: {"suggestions":[{"kind":"fact|person|schedule|preference","content":"one plain sentence addressed to the user","area":"coffee|yeshiva|personal|null","about":"name of the person/company/thing or null","question":"short question if unsure, else null","evidence":"a few words of where you saw it","person":{"name":"","role":"","notes":"","key":false},"schedule":{"name":"","category":"coffee|yeshiva|personal","weekdays":[0],"start_time":"HH:MM","end_time":"HH:MM"}}]}
"person" only for kind person; "schedule" only for kind schedule (a recurring weekly block, Sunday=0). At most 5, fewer is better. Empty list if nothing essential.`;
  let out: string;
  try {
    out = await getProvider(env).complete({ tier: "fast", purpose: "learn", maxTokens: 1500, system, prompt: snippets.join("\n").slice(0, 24000) });
  } catch (e) { console.error("learn", e); return { error: String(e) }; }
  await put(env, KEY, started);

  let list: Suggestion[] = [];
  try { list = (JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).suggestions ?? []) as Suggestion[]; } catch { return { learned: 0 }; }
  const seen = new Set(known.map((k) => k.content.toLowerCase().trim()));
  let added = 0;
  for (const s of list.slice(0, 5)) {
    const content = String(s.content ?? "").trim().slice(0, 400);
    if (!content || seen.has(content.toLowerCase())) continue;
    seen.add(content.toLowerCase());
    const kind = ["fact", "person", "schedule", "preference"].includes(String(s.kind)) ? String(s.kind) : "fact";
    const data = kind === "person" ? s.person : kind === "schedule" ? s.schedule : null;
    const t = now();
    await run(env, `INSERT INTO memories (id, category, content, importance, status, area, about, question, evidence, data, created_at, updated_at)
       VALUES (?, ?, ?, 2, 'suggested', ?, ?, ?, ?, ?, ?, ?)`,
      uid(), kind, content, ["coffee", "yeshiva", "personal"].includes(String(s.area)) ? String(s.area) : null,
      s.about ? String(s.about).slice(0, 80) : null, s.question ? String(s.question).slice(0, 200) : null,
      s.evidence ? String(s.evidence).slice(0, 200) : null, data ? JSON.stringify(data) : null, t, t);
    added++;
  }
  if (added) await maybeNotify(env);
  return { learned: added };
}

/** At most every 4 hours: "I picked up N things about your life". */
async function maybeNotify(env: Env) {
  const lastN = await setting(env, "learn_notified_at");
  if (lastN && Date.now() - Date.parse(lastN) < 4 * 3600_000) return;
  const n = (await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM memories WHERE status = 'suggested'"))?.n ?? 0;
  if (n < 2) return;
  await put(env, "learn_notified_at", now());
  await run(env, "DELETE FROM nudges WHERE type = 'learn'");
  await notify(env, "learn", `I picked up ${n} things about your life`, "Tap to review them: That's right, Change or Ignore.", null, "/?tab=review");
}

/** The user's verdict on a suggestion: accept, edit (accept with their wording) or ignore. */
export async function reviewMemory(env: Env, id: string, action: string, content?: string) {
  const m = await first<{ id: string; category: string; content: string; about: string | null; data: string | null }>(env, "SELECT * FROM memories WHERE id = ?", id);
  if (!m) throw new Error("not found");
  if (action === "ignore") {
    await run(env, "UPDATE memories SET status = 'ignored', updated_at = ? WHERE id = ?", now(), id);
  } else {
    const edited = action === "edit" && !!content && content.trim() !== m.content;
    const text = edited ? content!.trim().slice(0, 600) : m.content;
    let data: Record<string, unknown> | null = null;
    try { data = m.data ? JSON.parse(m.data) : null; } catch { /* plain fact */ }
    // Structured suggestions also update People / the schedule.
    if (m.category === "person" && (data?.name || m.about)) {
      await savePerson(env, edited ? { name: m.about ?? data?.name, notes: text } : { name: data?.name || m.about, role: data?.role, notes: data?.notes || text, key: !!data?.key });
    }
    if (m.category === "schedule" && data && !edited) {
      try { await saveSituation(env, { ...data, mode: "start" }); } catch (e) { console.error("learn schedule", e); }
    }
    await run(env, "UPDATE memories SET status = 'confirmed', content = ?, question = NULL, updated_at = ? WHERE id = ?", text, now(), id);
  }
  if (!(await first(env, "SELECT 1 FROM memories WHERE status = 'suggested'"))) await run(env, "DELETE FROM nudges WHERE type = 'learn'");
  return { ok: true };
}

/** "Thu 12:05" in the user's time zone (calendar times are stored in UTC). All-day dates pass through. */
function localTime(iso: string, tz: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

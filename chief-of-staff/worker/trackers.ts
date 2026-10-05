/**
 * Trackers: "I asked the Night Seder rabbis for their lists of guys who aren't showing up — collect
 * what comes in", or "collect everything the rabbis say about X".
 *
 * A tracker follows people (a contact group and/or names) and/or keywords, on WhatsApp (via the
 * add-on) and Gmail (searched here every 15 minutes, and back over the last couple of weeks when it's
 * set up). Following people means EVERY message from them is considered, not only ones with the
 * right words: a rabbi replying with just a list of names still counts. A lenient check, told what
 * you asked for, drops only clear small talk. Each kept message is stored, appended to the tracker's
 * Google Doc, and credited to the person, so you can see who has answered and who hasn't.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, now, run, uid } from "./db";
import { appendToDoc, createDoc } from "./gworkspace";
import { readThread, searchEmail, triageBudget } from "./google";
import { findGroup, members } from "./groups";
import { notify } from "./push";

export interface Tracker {
  id: string; name: string; topic: string; keywords: string; people: string; accounts: string; include_mine: number;
  doc_id: string | null; doc_link: string | null; doc_account: string | null; active: number; backfill_days: number; backfilled: string;
  group_id: string | null; expecting: string; sources: string; gmail_checked_at: string | null;
  created_at: string; updated_at: string;
}
interface Who { name: string; aliases: string[]; email: string | null }

const list = (s: string) => (s ?? "").split(",").map((w) => w.trim()).filter(Boolean);

/** Everyone the tracker follows: the group's members plus any names listed. */
export async function trackedPeople(env: Env, t: Tracker): Promise<Who[]> {
  const out: Who[] = [];
  if (t.group_id) {
    for (const m of await members(env, t.group_id)) {
      const last = m.name.trim().split(/\s+/).slice(1).join(" ");
      out.push({ name: m.name, email: m.email, aliases: [m.name, m.whatsapp_name, ...list(m.aliases), ...(last.length >= 4 ? [last] : [])].filter(Boolean) as string[] });
    }
  }
  for (const n of list(t.people)) if (!out.some((w) => w.name.toLowerCase() === n.toLowerCase())) out.push({ name: n, email: null, aliases: [n] });
  return out;
}

const whoSent = (people: Who[], from: string) => {
  const f = from.toLowerCase();
  return people.find((p) => (p.email && f.includes(p.email.toLowerCase())) || p.aliases.some((a) => a.length > 2 && f.includes(a.toLowerCase())));
};

export async function saveTracker(env: Env, input: Record<string, unknown>) {
  const existing = input.id ? await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ?", String(input.id)) : null;
  const str = (k: string, d = "") => (input[k] === undefined ? (existing as unknown as Record<string, string> | null)?.[k] ?? d : String(input[k] ?? ""));
  let groupId = existing?.group_id ?? null;
  if (input.group !== undefined) {
    if (!input.group) groupId = null;
    else {
      const g = await findGroup(env, String(input.group));
      if (!g) throw new Error(`No contact group called "${input.group}". Create it first (save_group) or list the people.`);
      groupId = g.id;
    }
  }
  const t = now();
  const expecting = str("expecting").slice(0, 600);
  const tr = {
    id: existing?.id ?? uid(),
    name: str("name", "Tracker").slice(0, 80),
    topic: (str("topic") || expecting).slice(0, 600),
    keywords: str("keywords"),
    people: str("people"),
    expecting,
    sources: input.sources ? (Array.isArray(input.sources) ? (input.sources as string[]).join(",") : String(input.sources)) : existing?.sources ?? "whatsapp,gmail",
    accounts: ["personal", "business", "both"].includes(String(input.accounts)) ? String(input.accounts) : existing?.accounts ?? "both",
    include_mine: input.include_mine === undefined ? existing?.include_mine ?? 0 : input.include_mine ? 1 : 0,
    active: input.active === undefined ? existing?.active ?? 1 : input.active ? 1 : 0,
    backfill_days: Math.min(90, Math.max(0, Number(input.backfill_days ?? existing?.backfill_days ?? (groupId || input.people ? 14 : 0)) || 0)),
  };
  if (!tr.topic) throw new Error("What should this tracker collect?");
  if (!list(tr.keywords).length && !list(tr.people).length && !groupId) throw new Error("Who should I follow (a group or people), or which keywords should I look for?");
  if (existing) {
    await run(env, `UPDATE trackers SET name=?, topic=?, keywords=?, people=?, group_id=?, expecting=?, sources=?, accounts=?, include_mine=?, active=?, backfill_days=?, updated_at=? WHERE id=?`,
      tr.name, tr.topic, tr.keywords, tr.people, groupId, tr.expecting, tr.sources, tr.accounts, tr.include_mine, tr.active, tr.backfill_days, t, tr.id);
  } else {
    await run(env, `INSERT INTO trackers (id, name, topic, keywords, people, group_id, expecting, sources, accounts, include_mine, active, backfill_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tr.id, tr.name, tr.topic, tr.keywords, tr.people, groupId, tr.expecting, tr.sources, tr.accounts, tr.include_mine, tr.active, tr.backfill_days, t, t);
    try {
      const d = await createDoc(env, `Tracker: ${tr.name}`,
        `# ${tr.name}\n${tr.expecting || tr.topic}\n\n${tr.keywords ? `Keywords: ${tr.keywords}\n` : ""}\n## Collected messages`);
      await run(env, "UPDATE trackers SET doc_id = ?, doc_link = ?, doc_account = ? WHERE id = ?", d.file_id, d.link, d.account, tr.id);
    } catch (e) { console.error("tracker doc", e); }
  }
  const saved = (await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ?", tr.id))!;
  // Look back right away through Gmail (WhatsApp history is searched by the add-on).
  if (!existing && saved.sources.includes("gmail")) await checkTrackerEmail(env, saved).catch((e) => console.error("tracker gmail backfill", e));
  return saved;
}

/** What the add-on needs. When a tracker follows people, every message from them is sent (no keyword filter). */
export async function trackersForBridge(env: Env, account: string) {
  const ts = (await all<Tracker>(env, "SELECT * FROM trackers WHERE active = 1")).filter((t) => (t.sources ?? "whatsapp").includes("whatsapp"));
  const out = [];
  for (const t of ts.filter((x) => x.accounts === "both" || x.accounts === account)) {
    const people = (await trackedPeople(env, t)).flatMap((p) => p.aliases).map((a) => a.toLowerCase()).filter((a) => a.length > 2);
    out.push({
      id: t.id, people, keywords: people.length ? [] : list(t.keywords).map((k) => k.toLowerCase()),
      include_mine: !!t.include_mine,
      backfill_days: t.backfill_days && !list(t.backfilled).includes(account) ? t.backfill_days : 0,
    });
  }
  return out;
}

export async function markBackfilled(env: Env, id: string, account: string) {
  const t = await first<Tracker>(env, "SELECT backfilled FROM trackers WHERE id = ?", id);
  if (!t) return;
  const done = new Set(list(t.backfilled)); done.add(account);
  await run(env, "UPDATE trackers SET backfilled = ? WHERE id = ?", [...done].join(","), id);
}

async function sha(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Is this message part of what the tracker is collecting? Lenient: only clear small talk is dropped. */
async function relevant(env: Env, t: Tracker, sender: string, text: string) {
  if (text.length < 4) return false;
  const budget = await triageBudget(env);
  if (budget.used >= budget.cap * 3) return true; // over budget: keep rather than lose answers
  const what = t.expecting || t.topic;
  try {
    const out = await getProvider(env).complete({
      tier: "fast", purpose: "tracker_check", maxTokens: 5,
      system: `Answer only "yes" or "no". The user is collecting: ${what}
Does this message contain, or relate to, that? Count it as yes if it is an answer, a partial answer, a bare list of names or items (even with no explanation), a correction, an attachment/file mention, a question about the request, or a promise to send it. Answer no only for clearly unrelated small talk or a different subject.`,
      prompt: `${sender}: ${text.slice(0, 2000)}`,
    });
    return !/^\s*no/i.test(out);
  } catch { return true; }
}

/** A message for a tracker, from the add-on (WhatsApp) or the Gmail check. */
export async function capture(env: Env, m: { tracker_id?: string; chat?: string; sender?: string; text?: string; at?: string; account?: string; source?: string }) {
  const t = m.tracker_id ? await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ? AND active = 1", m.tracker_id) : null;
  const text = (m.text ?? "").trim().slice(0, 6000);
  if (!t || !text) return { kept: false, reason: "no tracker or empty" };
  const chat = (m.chat ?? "").slice(0, 160), sender = (m.sender ?? chat).slice(0, 160);
  const source = m.source === "gmail" ? "gmail" : "whatsapp";
  const account = m.account === "business" ? "business" : "personal";
  const hash = await sha(`${source}|${sender}|${text}`);
  if (await first(env, "SELECT 1 FROM tracker_entries WHERE tracker_id = ? AND hash = ?", t.id, hash)) return { kept: false, reason: "duplicate" };
  if (!(await relevant(env, t, sender, text))) return { kept: false, reason: "not about it" };

  const person = whoSent(await trackedPeople(env, t), `${sender} ${chat}`)?.name ?? null;
  const said = m.at && !isNaN(Date.parse(m.at)) ? new Date(m.at).toISOString() : now();
  await run(env, `INSERT INTO tracker_entries (id, tracker_id, hash, account, chat, sender, text, said_at, created_at, source, person) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid(), t.id, hash, account, chat, sender, text, said, now(), source, person);
  if (t.doc_id) {
    const when = new Date(said).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    try { await appendToDoc(env, t.doc_id, `\n${when} · ${person ?? sender} (${source === "gmail" ? `email: ${chat}` : chat !== sender ? `WhatsApp, in ${chat}` : "WhatsApp"})\n${text}\n`, t.doc_account ?? undefined); }
    catch (e) { console.error("tracker append", e); }
  }
  return { kept: true, person };
}

/** Gmail side: new emails from the tracked people since the last check (first time: back backfill_days). */
export async function checkTrackerEmail(env: Env, t: Tracker, report?: { threads: number; fromThem: number; kept: number; skipped: string[] }) {
  const people = await trackedPeople(env, t);
  const emails = people.map((p) => p.email).filter(Boolean) as string[];
  if (!emails.length) { report?.skipped.push("Nobody being followed has an email saved."); return 0; }
  const since = t.gmail_checked_at ? Date.parse(t.gmail_checked_at) - 3600_000 : Date.now() - Math.max(1, t.backfill_days || 14) * 86400_000;
  const started = now();
  const after = `after:${Math.floor(since / 1000)}`;
  const [fromThem, toThem] = await Promise.all([
    searchEmail(env, `{${emails.map((e) => `from:${e}`).join(" ")}} ${after}`, undefined, 25),
    searchEmail(env, `from:me {${emails.map((e) => `to:${e} cc:${e} bcc:${e}`).join(" ")}} ${after}`, undefined, 15).catch(() => []),
  ]);
  const askedThreads = new Set(toThem.map((th) => th.thread_id));
  const threads = [...new Map([...fromThem, ...toThem].map((th) => [th.thread_id, th])).values()];
  let kept = 0;
  if (report) report.threads = threads.length;
  for (const th of threads) {
    const full = await readThread(env, th.thread_id, th.account).catch(() => null);
    if (!full) continue;
    for (const msg of full.messages) {
      if (msg.from_user || Date.parse(msg.date) < since) continue;
      // Known address or name; in a thread where you asked them, any reply counts (they may write from another address).
      const who = whoSent(people, msg.from) ?? (askedThreads.has(th.thread_id) ? { name: msg.from.replace(/<.*>/, "").replace(/"/g, "").trim() || msg.from, email: null, aliases: [] } : null);
      if (!who) continue;
      if (report) report.fromThem++;
      const body = msg.text.replace(/\n>.*$/gs, "").replace(/\nOn .{10,80}wrote:[\s\S]*$/, "").trim(); // drop quoted history
      const r = await capture(env, { tracker_id: t.id, source: "gmail", chat: full.subject || "(no subject)", sender: who.name, text: `${full.subject ? `Subject: ${full.subject}\n` : ""}${body}`, at: msg.date });
      if (r.kept) kept++;
      else if (report && r.reason !== "duplicate") report.skipped.push(`${who.name}: ${r.reason} — "${body.slice(0, 80).replace(/\s+/g, " ")}"`);
    }
  }
  await run(env, "UPDATE trackers SET gmail_checked_at = ? WHERE id = ?", started, t.id);
  return kept;
}

/** "Check now" from the app: run the Gmail search immediately and say what happened. */
export async function checkTrackerNow(env: Env, id: string, lookBackDays?: number) {
  const t = await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ?", id);
  if (!t) throw new Error("tracker not found");
  if (lookBackDays) t.gmail_checked_at = null, t.backfill_days = lookBackDays;
  const report = { threads: 0, fromThem: 0, kept: 0, skipped: [] as string[] };
  report.kept = await checkTrackerEmail(env, t, report);
  return { ...report, status: await trackerStatus(env, t) };
}

/** Cron: check Gmail for every active tracker that follows people; tell the user when answers come in. */
export async function runTrackerEmail(env: Env) {
  const ts = (await all<Tracker>(env, "SELECT * FROM trackers WHERE active = 1")).filter((t) => (t.sources ?? "").includes("gmail") && (t.group_id || t.people));
  for (const t of ts) {
    if (!t.doc_id) {
      try {
        const d = await createDoc(env, `Tracker: ${t.name}`, `# ${t.name}
${t.expecting || t.topic}

## Collected messages`);
        await run(env, "UPDATE trackers SET doc_id = ?, doc_link = ?, doc_account = ? WHERE id = ?", d.file_id, d.link, d.account, t.id);
        t.doc_id = d.file_id; t.doc_account = d.account;
      } catch (e) { console.error("tracker doc", e); }
    }
    const n = await checkTrackerEmail(env, t).catch((e) => { console.error("tracker gmail", e); return 0; });
    if (n) {
      const st = await trackerStatus(env, t);
      await notify(env, "tracker", `🗂 ${t.name}: ${n} new ${n === 1 ? "reply" : "replies"}`,
        st.total ? `${st.answered.length}/${st.total} have answered${st.waiting.length ? ` · still waiting on ${st.waiting.slice(0, 4).join(", ")}${st.waiting.length > 4 ? "…" : ""}` : ""}` : "", null, "/?tab=trackers");
    }
  }
}

/**
 * The add-on reports the user's WhatsApp chat names. For tracked people with no WhatsApp name yet,
 * one small AI call matches them (Hebrew/English, titles, nicknames: "הרב זילבר" = Jacob Silber),
 * saves it on the person, and asks the add-on to search history again for those trackers.
 */
export async function matchWhatsappNames(env: Env, account: string, names: string[]) {
  const chats = [...new Set(names.map((n) => String(n).trim()).filter((n) => n.length > 1))].slice(0, 600);
  if (!chats.length) return { matched: 0 };
  const ts = await all<Tracker>(env, "SELECT * FROM trackers WHERE active = 1 AND group_id IS NOT NULL");
  const missing = new Map<string, { id: string; name: string; email: string | null }>();
  for (const t of ts) {
    for (const m of await members(env, t.group_id!)) if (!m.whatsapp_name) missing.set(m.id, { id: m.id, name: m.name, email: m.email });
  }
  if (!missing.size) return { matched: 0 };
  const key = `wa_match:${account}:${[...missing.keys()].sort().join(",")}:${chats.length}`;
  if (await first(env, "SELECT 1 FROM settings WHERE key = ?", key)) return { matched: 0, skipped: "already tried" };
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, now());
  let map: Record<string, string> = {};
  try {
    const out = await getProvider(env).complete({
      tier: "fast", purpose: "wa_match", maxTokens: 600,
      system: `Match people to WhatsApp chat names. Names may be in Hebrew or English, with titles (Rabbi, R', Rav, הרב), first or last name only, or nicknames. Only match when you're fairly sure; leave out anyone you can't find. Reply with ONLY JSON: {"matches": {"<person id>": "<exact chat name>"}}`,
      prompt: `People:\n${[...missing.values()].map((p) => `- ${p.id}: ${p.name}${p.email ? ` (${p.email})` : ""}`).join("\n")}\n\nWhatsApp chat names:\n${chats.join("\n")}`,
    });
    map = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).matches ?? {};
  } catch (e) { console.error("wa match", e); return { matched: 0 }; }
  let matched = 0;
  for (const [id, chat] of Object.entries(map)) {
    if (!missing.has(id) || !chats.includes(String(chat))) continue;
    await run(env, "UPDATE people SET whatsapp_name = ?, updated_at = ? WHERE id = ?", String(chat), now(), id);
    matched++;
  }
  // New names → search the loaded WhatsApp history again for these trackers.
  if (matched) await run(env, "UPDATE trackers SET backfilled = '' WHERE active = 1 AND group_id IS NOT NULL");
  return { matched };
}

/** Who has answered so far (for trackers that follow people). */
export async function trackerStatus(env: Env, t: Tracker) {
  const people = await trackedPeople(env, t);
  const got = new Set((await all<{ person: string }>(env, "SELECT DISTINCT person FROM tracker_entries WHERE tracker_id = ? AND person IS NOT NULL", t.id)).map((r) => r.person));
  return { total: people.length, answered: people.filter((p) => got.has(p.name)).map((p) => p.name), waiting: people.filter((p) => !got.has(p.name)).map((p) => p.name) };
}

/** For the assistant: everything collected, plus who has / hasn't answered. */
export async function trackerEntries(env: Env, ref: string, limit = 400) {
  const t = await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ? OR lower(name) = lower(?) OR lower(name) LIKE lower(?)", ref, ref, `%${ref}%`);
  if (!t) return { error: "tracker not found" };
  const entries = await all<{ person: string | null; source: string; chat: string; sender: string; text: string; said_at: string }>(env,
    "SELECT person, source, chat, sender, text, said_at FROM tracker_entries WHERE tracker_id = ? ORDER BY said_at LIMIT ?", t.id, limit);
  return { name: t.name, collecting: t.expecting || t.topic, doc_link: t.doc_link, status: await trackerStatus(env, t), count: entries.length, entries };
}

export async function trackersSummary(env: Env) {
  const ts = await all<Tracker & { n: number }>(env,
    "SELECT t.*, (SELECT COUNT(*) FROM tracker_entries e WHERE e.tracker_id = t.id) AS n FROM trackers t ORDER BY t.created_at");
  return ts.map((t) => `- ${t.name} (id ${t.id}; ${t.active ? "collecting" : "paused"}; ${t.n} messages; ${t.expecting ? `expecting: ${t.expecting}` : `topic: ${t.topic}`}${t.keywords ? `; keywords: ${t.keywords}` : ""}${t.people ? `; from: ${t.people}` : ""}${t.group_id ? "; follows a contact group" : ""})`).join("\n");
}

/** Count of entries collected today per tracker, for the end-of-day wrap. */
export async function trackersToday(env: Env, since: string) {
  return all<{ name: string; n: number }>(env,
    "SELECT t.name, COUNT(e.id) AS n FROM trackers t JOIN tracker_entries e ON e.tracker_id = t.id WHERE e.created_at >= ? GROUP BY t.id", since);
}

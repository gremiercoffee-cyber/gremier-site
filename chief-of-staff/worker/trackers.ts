/**
 * Trackers: "collect everything the rabbis say about X". The WhatsApp add-on downloads the active
 * trackers (keywords, people, accounts) and forwards every message that matches; here a cheap
 * relevance check keeps passing mentions out, and each kept message is stored and appended to the
 * tracker's Google Doc. Analysis happens on request (assistant reads the entries) or via a Task.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, now, run, uid } from "./db";
import { appendToDoc, createDoc } from "./gworkspace";
import { triageBudget } from "./google";

export interface Tracker {
  id: string; name: string; topic: string; keywords: string; people: string; accounts: string; include_mine: number;
  doc_id: string | null; doc_link: string | null; doc_account: string | null; active: number; backfill_days: number; backfilled: string;
  created_at: string; updated_at: string;
}

const list = (s: string) => s.split(",").map((w) => w.trim()).filter(Boolean);

export async function saveTracker(env: Env, input: Record<string, unknown>) {
  const existing = input.id ? await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ?", String(input.id)) : null;
  const str = (k: string, d = "") => (input[k] === undefined ? (existing as unknown as Record<string, string> | null)?.[k] ?? d : String(input[k] ?? ""));
  const t = now();
  const tr = {
    id: existing?.id ?? uid(),
    name: str("name", "Tracker").slice(0, 80),
    topic: str("topic").slice(0, 600),
    keywords: str("keywords"),
    people: str("people"),
    accounts: ["personal", "business", "both"].includes(String(input.accounts)) ? String(input.accounts) : existing?.accounts ?? "both",
    include_mine: input.include_mine === undefined ? existing?.include_mine ?? 0 : input.include_mine ? 1 : 0,
    active: input.active === undefined ? existing?.active ?? 1 : input.active ? 1 : 0,
    backfill_days: Math.min(90, Math.max(0, Number(input.backfill_days ?? existing?.backfill_days ?? 0) || 0)),
  };
  if (!tr.topic) throw new Error("What should this tracker collect?");
  if (!list(tr.keywords).length && !list(tr.people).length) throw new Error("Give it some keywords (Hebrew and/or English) or people/groups to watch.");
  if (existing) {
    await run(env, `UPDATE trackers SET name=?, topic=?, keywords=?, people=?, accounts=?, include_mine=?, active=?, backfill_days=?, updated_at=? WHERE id=?`,
      tr.name, tr.topic, tr.keywords, tr.people, tr.accounts, tr.include_mine, tr.active, tr.backfill_days, t, tr.id);
  } else {
    await run(env, `INSERT INTO trackers (id, name, topic, keywords, people, accounts, include_mine, active, backfill_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      tr.id, tr.name, tr.topic, tr.keywords, tr.people, tr.accounts, tr.include_mine, tr.active, tr.backfill_days, t, t);
    // The collecting Doc (if Google Docs access is set up; otherwise everything is still in the app).
    try {
      const d = await createDoc(env, `Tracker: ${tr.name}`,
        `# ${tr.name}\n${tr.topic}\n\nKeywords: ${tr.keywords || "—"}${tr.people ? `\nFrom: ${tr.people}` : ""}\n\n## Collected messages`);
      await run(env, "UPDATE trackers SET doc_id = ?, doc_link = ?, doc_account = ? WHERE id = ?", d.file_id, d.link, d.account, tr.id);
    } catch (e) { console.error("tracker doc", e); }
  }
  const saved = await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ?", tr.id);
  return saved!;
}

/** What the add-on needs: active trackers and whether to search history for this account. */
export async function trackersForBridge(env: Env, account: string) {
  const ts = await all<Tracker>(env, "SELECT * FROM trackers WHERE active = 1");
  return ts.filter((t) => t.accounts === "both" || t.accounts === account).map((t) => ({
    id: t.id, keywords: list(t.keywords).map((k) => k.toLowerCase()), people: list(t.people).map((p) => p.toLowerCase()),
    include_mine: !!t.include_mine,
    backfill_days: t.backfill_days && !list(t.backfilled).includes(account) ? t.backfill_days : 0,
  }));
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

/** A forwarded match from the add-on. */
export async function capture(env: Env, m: { tracker_id?: string; chat?: string; sender?: string; text?: string; at?: string; account?: string }) {
  const t = m.tracker_id ? await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ? AND active = 1", m.tracker_id) : null;
  const text = (m.text ?? "").trim().slice(0, 4000);
  if (!t || !text) return { kept: false, reason: "no tracker or empty" };
  const chat = (m.chat ?? "").slice(0, 120), sender = (m.sender ?? chat).slice(0, 120);
  const account = m.account === "business" ? "business" : "personal";
  const hash = await sha(`${chat}|${sender}|${text}`);
  if (await first(env, "SELECT 1 FROM tracker_entries WHERE tracker_id = ? AND hash = ?", t.id, hash)) return { kept: false, reason: "duplicate" };

  // Relevance: keyword matches can be passing mentions. One tiny check (counts toward the daily background cap).
  const budget = await triageBudget(env);
  if (budget.used < budget.cap * 2 && text.length > 12) {
    try {
      const out = await getProvider(env).complete({
        tier: "fast", purpose: "tracker_check", maxTokens: 5,
        system: `Answer only "yes" or "no". Is this message substantively about the topic (an answer, opinion, ruling, fact, decision or question about it), not just a passing mention?\nTopic: ${t.topic}`,
        prompt: `${sender}: ${text.slice(0, 1500)}`,
      });
      if (/^\s*no/i.test(out)) return { kept: false, reason: "not about the topic" };
    } catch { /* no AI available: keep it */ }
  }

  const said = m.at && !isNaN(Date.parse(m.at)) ? new Date(m.at).toISOString() : now();
  await run(env, `INSERT INTO tracker_entries (id, tracker_id, hash, account, chat, sender, text, said_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid(), t.id, hash, account, chat, sender, text, said, now());
  if (t.doc_id) {
    const when = new Date(said).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    try { await appendToDoc(env, t.doc_id, `\n${when} · ${sender}${chat !== sender ? ` (in ${chat})` : ""}\n${text}\n`, t.doc_account ?? undefined); }
    catch (e) { console.error("tracker append", e); }
  }
  return { kept: true };
}

/** For the assistant: everything collected, to analyze. */
export async function trackerEntries(env: Env, ref: string, limit = 400) {
  const t = await first<Tracker>(env, "SELECT * FROM trackers WHERE id = ? OR lower(name) = lower(?) OR lower(name) LIKE lower(?)", ref, ref, `%${ref}%`);
  if (!t) return { error: "tracker not found" };
  const entries = await all<{ chat: string; sender: string; text: string; said_at: string }>(env,
    "SELECT chat, sender, text, said_at FROM tracker_entries WHERE tracker_id = ? ORDER BY said_at LIMIT ?", t.id, limit);
  return { name: t.name, topic: t.topic, doc_link: t.doc_link, count: entries.length, entries };
}

export async function trackersSummary(env: Env) {
  const ts = await all<Tracker & { n: number }>(env,
    "SELECT t.*, (SELECT COUNT(*) FROM tracker_entries e WHERE e.tracker_id = t.id) AS n FROM trackers t ORDER BY t.created_at");
  return ts.map((t) => `- ${t.name} (id ${t.id}; ${t.active ? "collecting" : "paused"}; ${t.n} messages; topic: ${t.topic}; keywords: ${t.keywords}${t.people ? `; from: ${t.people}` : ""})`).join("\n");
}

/** Count of entries collected today per tracker, for the end-of-day wrap. */
export async function trackersToday(env: Env, since: string) {
  return all<{ name: string; n: number }>(env,
    "SELECT t.name, COUNT(e.id) AS n FROM trackers t JOIN tracker_entries e ON e.tracker_id = t.id WHERE e.created_at >= ? GROUP BY t.id", since);
}

/**
 * Watch rules: the user tells the assistant, in plain words, what to look out for on WhatsApp
 * ("anyone who says they want to come back to yeshiva") and what to do about it (a To-do, or just a
 * heads-up). A cheap keyword pre-filter picks candidate messages; one small AI call decides each one.
 */
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, first, now, run, uid } from "./db";
import { notify } from "./push";
import { suggest } from "./suggestions";

export interface Watch { id: string; instruction: string; action: string; todo_title: string | null; category: string | null; keywords: string; active: number; hits: number; created_at: string }

const parse = (s: string) => { try { return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)); } catch { return {}; } };

export async function saveWatch(env: Env, w: { id?: string; instruction?: string; action?: string; todo_title?: string; category?: string; keywords?: string[]; active?: boolean; scan_days?: number }) {
  const old = w.id ? await first<Watch>(env, "SELECT * FROM watches WHERE id = ?", w.id) : null;
  const instruction = String(w.instruction ?? old?.instruction ?? "").trim();
  if (!instruction) throw new Error("instruction is required");
  let keywords: string[] = w.keywords?.length ? w.keywords : old && !w.instruction ? JSON.parse(old.keywords) : [];
  if (!keywords.length) {
    const out = await getProvider(env).complete({
      tier: "fast", purpose: "watch_keywords", maxTokens: 400,
      system: `The user wants their WhatsApp watched for: "${instruction}". List 20-40 short lowercase words/phrases (English AND Hebrew, plus common slang, transliterations and misspellings) such that almost any matching message contains at least one. Prefer short stems (e.g. "come back", "coming back", "חוזר", "לחזור", "winter", "חורף", "zman"). Be generous: missing a match is worse than an extra check. Reply ONLY JSON: {"keywords": [...]}`,
      prompt: instruction,
    });
    keywords = (parse(out).keywords ?? []) as string[];
  }
  keywords = [...new Set(keywords.map((k) => String(k).toLowerCase().trim()).filter((k) => k.length >= 2))].slice(0, 50);
  const id = old?.id ?? uid();
  await run(env, `INSERT INTO watches (id, instruction, action, todo_title, category, keywords, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET instruction = excluded.instruction, action = excluded.action, todo_title = excluded.todo_title,
      category = excluded.category, keywords = excluded.keywords, active = excluded.active`,
    id, instruction, w.action === "notify" ? "notify" : w.action === "todo" ? "todo" : old?.action ?? "todo",
    w.todo_title ?? old?.todo_title ?? null, w.category ?? old?.category ?? null, JSON.stringify(keywords),
    w.active === false ? 0 : 1, old?.created_at ?? now());
  const watch = (await first<Watch>(env, "SELECT * FROM watches WHERE id = ?", id))!;
  const scanned = w.scan_days ? await scanWatch(env, watch, w.scan_days) : null;
  return { watch: { ...watch, keywords }, scanned };
}

export const listWatches = (env: Env) => all<Watch>(env, "SELECT * FROM watches ORDER BY active DESC, created_at DESC");

export async function deleteWatch(env: Env, id: string) {
  await run(env, "DELETE FROM watches WHERE id = ?", id);
  await run(env, "DELETE FROM watch_hits WHERE watch_id = ?", id);
}

const hitsKeywords = (w: Watch, text: string) => {
  const t = text.toLowerCase();
  try { return (JSON.parse(w.keywords) as string[]).some((k) => t.includes(k)); } catch { return false; }
};

/** One WhatsApp message (already saved in whatsapp_inbox) against the active rules. */
export async function checkWatches(env: Env, m: { inbox_id: string; chat: string; sender: string; text: string }, watches?: Watch[], quiet = false) {
  const list = watches ?? await all<Watch>(env, "SELECT * FROM watches WHERE active = 1");
  let found = 0;
  for (const w of list) {
    if (!hitsKeywords(w, m.text)) continue;
    if (await first(env, "SELECT 1 FROM watch_hits WHERE watch_id = ? AND inbox_id = ?", w.id, m.inbox_id)) continue;
    let v: { match?: boolean; name?: string; summary?: string; when?: string | null } = {};
    try {
      v = parse(await getProvider(env).complete({
        tier: "fast", purpose: "watch_check", maxTokens: 150,
        system: `The user asked to be told about WhatsApp messages where: "${w.instruction}". Does this message match? Judge the meaning, in any language. A passing mention, a joke, a question about someone else, or a clear "no" doesn't count. Reply ONLY JSON: {"match": true|false, "name": "who it's about (the sender unless the message says otherwise)", "summary": "under 12 words, in English", "when": "dates/period mentioned, or null"}`,
        prompt: `Chat: ${m.chat}\nFrom: ${m.sender}\nMessage: ${m.text.slice(0, 1200)}`,
      }));
    } catch (e) { console.error("watch check", e); continue; }
    if (!v.match) { await run(env, "INSERT OR IGNORE INTO watch_hits (watch_id, inbox_id, created_at) VALUES (?, ?, ?)", w.id, m.inbox_id, now()); continue; }
    const name = String(v.name || m.sender).slice(0, 60);
    let itemId: string | null = null;
    if (w.action === "todo") {
      // Ask first: "add it?" with Yes / No. Nothing lands in the To-do until Yes.
      const title = (w.todo_title || `${w.instruction.slice(0, 50)}: {name}`).replace(/\{name\}/gi, name) + (v.when ? ` (${v.when})` : "");
      itemId = await suggest(env, "item", { title: title.slice(0, 140), person: name, category: w.category ?? null,
        notes: `WhatsApp from ${m.sender}${m.chat !== m.sender ? ` in ${m.chat}` : ""}: "${m.text.slice(0, 500)}"` },
        m.chat, `👀 ${name}: ${v.summary ?? "matches your watch"}. ${title}?`, `"${m.text.slice(0, 160)}"`);
    }
    await run(env, "INSERT OR REPLACE INTO watch_hits (watch_id, inbox_id, item_id, created_at) VALUES (?, ?, ?, ?)", w.id, m.inbox_id, itemId, now());
    await run(env, "UPDATE watches SET hits = hits + 1 WHERE id = ?", w.id);
    found++;
    if (!quiet && w.action !== "todo") await notify(env, "watch", `👀 ${name}: ${v.summary ?? "matches your watch"}`,
      `${v.when ? `${v.when}\n` : ""}"${m.text.slice(0, 160)}"${itemId ? "\nAdded to your To-do." : ""}`, itemId, "/");
  }
  return found;
}

/** Look back through WhatsApp already received (right after a rule is made). */
export async function scanWatch(env: Env, w: Watch, days = 60) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = await all<{ id: string; chat: string; sender: string; text: string }>(env,
    "SELECT id, chat, sender, text FROM whatsapp_inbox WHERE received_at > ? ORDER BY received_at", since);
  const cands = rows.filter((r) => hitsKeywords(w, r.text)).slice(-80);
  let found = 0;
  for (const r of cands) found += await checkWatches(env, { inbox_id: r.id, chat: r.chat, sender: r.sender, text: r.text }, [w], true);
  if (found) await notify(env, "watch", `👀 Found ${found} in past WhatsApps: ${w.instruction.slice(0, 60)}`, w.action === "todo" ? "Each one is waiting for your Yes / No." : "", null, "/");
  return { checked: cands.length, found };
}

/** Cron: a newly added rule looks back through the last 60 days once. */
export async function scanNewWatches(env: Env) {
  for (const w of await all<Watch>(env, "SELECT * FROM watches WHERE active = 1 AND scanned = 0")) {
    await run(env, "UPDATE watches SET scanned = 1 WHERE id = ?", w.id);
    await scanWatch(env, w, 60);
  }
}

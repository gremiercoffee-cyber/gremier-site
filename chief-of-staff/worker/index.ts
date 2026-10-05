import type { CalendarEvent, Conversation, Dashboard, Item, Memory, Message, Nudge, PendingAction, Project } from "../shared/types";
import type { Env } from "./env";
import { getProvider } from "./ai";
import { ProviderUnavailable } from "./ai";
import { chat, executeApproved } from "./assistant";
import { processBrainDump } from "./braindump";
import {
  HttpError, all, createItem, createProject, endOfLocalDay, first, getSettings, learnCategory, now, run, saveSettings, updateItem,
} from "./db";
import { runProactive } from "./proactive";
import { learnPass, reviewMemory } from "./learn";
import { tidyConversations } from "./tidy";
import { getAreas, removeArea, saveArea } from "./areas";
import { hubConfigured } from "./hub";
import { draftBroadcast, members, saveGroup, sendBroadcast, type Broadcast, type Group } from "./groups";
import { ideaStep, runIdeaResearch, updateIdea, type Idea } from "./ideas";
import { actionsFor, applyAction, tomorrowMorning, verifyNudge } from "./actions";
import { bridgeAuthorised, bridgeStatus, handleIncoming, handleReplied, reportOutbox, takeOutbox } from "./whatsapp";
import { pushConfigured, sendPush } from "./push";
import { findPeople, recallMemories } from "./memory";
import { updateMission } from "./missions";
import { replyQueue, sendReply, draftReply } from "./replies";
import { describeSchedule, normalizeSchedule, runRoutine, saveRoutine, type Routine, tellRoutine, advanceRoutineRuns } from "./routines";
import { currentBlock, describeSituation, saveSituation, type Situation } from "./situations";
import { capture, checkTrackerNow, judgeEntry, knownChats, linkWhatsapp, matchWhatsappNames, markBackfilled, saveTracker, trackerEntries, trackersForBridge, trackerStatus, type Tracker } from "./trackers";
import { GoogleAuthError, disconnectGoogle, finishGoogleAuth, googleStatus, startGoogleAuth, syncGoogle } from "./google";
import { createRealtimeSession, logRealtimeMessage, runRealtimeTool } from "./realtime";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

/** Constant-time comparison of the bearer token against the configured passcode. */
function authorised(req: Request, env: Env): boolean {
  const expected = env.COS_ACCESS_TOKEN;
  if (!expected) return false;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = new TextEncoder().encode(got);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

type Handler = (req: Request, env: Env, params: string[], ctx: ExecutionContext) => Promise<Response>;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp("^" + path.replace(/:\w+/g, "([^/]+)") + "$"), h]);

// ---- Dashboard -------------------------------------------------------------
route("GET", "/api/dashboard", async (_req, env) => {
  const settings = await getSettings(env);
  const t = now();
  const endOfDay = endOfLocalDay(settings.timezone);
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(new Date());
  const startOfDay = endOfLocalDay(settings.timezone, new Date(Date.now() - 86400_000));
  const [today, overdue, waiting, nudges, pending, projects, counts, events] = await Promise.all([
    all<Item>(env, `SELECT * FROM items WHERE status='open' AND kind != 'waiting' AND due_at > ? AND due_at <= ? ORDER BY due_at`, t, endOfDay),
    all<Item>(env, `SELECT * FROM items WHERE status='open' AND kind IN ('task','reminder','commitment') AND due_at <= ? ORDER BY due_at`, t),
    all<Item>(env, `SELECT * FROM items WHERE status='open' AND kind='waiting' ORDER BY created_at LIMIT 10`),
    // Only what still needs you: no "done/sent/progress" notes, nothing about finished items.
    all<Nudge>(env, `SELECT n.*, i.category AS area FROM nudges n LEFT JOIN items i ON i.id = n.item_id
      WHERE n.dismissed = 0 AND n.type NOT IN ('auto_done','wa_sent','mission_progress','mission_done')
        AND (i.id IS NULL OR i.status = 'open')
      ORDER BY n.created_at DESC LIMIT 20`),
    all<PendingAction>(env, `SELECT * FROM pending_actions WHERE status='pending' ORDER BY created_at DESC`),
    all<Project>(env, `SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id AND i.status='open') AS open_count
                       FROM projects p WHERE p.status='active' ORDER BY p.updated_at DESC LIMIT 6`),
    all<{ kind: string; n: number }>(env, `SELECT kind, COUNT(*) AS n FROM items WHERE status='open' GROUP BY kind`),
    all<CalendarEvent>(env, `SELECT id, summary, start_at, end_at, all_day, location, html_link FROM calendar_events
       WHERE hidden = 0 AND ((all_day = 0 AND start_at >= ? AND start_at < ?) OR (all_day = 1 AND start_at <= ? AND end_at > ?))
       GROUP BY summary, start_at ORDER BY all_day DESC, start_at`, startOfDay, endOfDay, localDate, localDate),
  ]);
  const nowBlock = await currentBlock(env);
  const todo = await all<Item>(env, `SELECT * FROM items WHERE status='open' AND kind IN ('task','commitment','reminder')
      AND (due_at IS NULL OR due_at > ?) ORDER BY due_at IS NULL, due_at, priority, created_at LIMIT 60`, endOfDay);
  const listIds = [...new Set(todo.map((i) => i.project_id).filter(Boolean))] as string[];
  const lists = listIds.length ? await all<{ id: string; name: string }>(env,
    `SELECT id, name FROM projects WHERE id IN (${listIds.map(() => "?").join(",")})`, ...listIds) : [];
  // One row per to-do: the newest reminder about it wins.
  const seenItems = new Set<string>();
  const liveAll = await liveNudges(env, nudges);
  // A to-do already listed in a "Now" card (time block) doesn't also get its own row.
  const inBlocks = new Set(liveAll.flatMap((n) => (n.items ?? []).map((i) => i.id)));
  const live = liveAll.filter((n) => !n.item_id || (!inBlocks.has(n.item_id) && (seenItems.has(n.item_id) ? false : (seenItems.add(n.item_id), true))));
  const data: Dashboard = {
    now_block: nowBlock,
    today, overdue, waiting, pending, projects, events, todo, lists,
    nudges: live.map((n) => ({ ...n, actions: actionsFor(n) })),
    counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
  };
  return json(data);
});

// ---- Chat (text, live voice and dictation share one conversation) -----------
route("GET", "/api/conversations", async (req, env) => {
  const archived = new URL(req.url).searchParams.get("archived") === "1" ? 1 : 0;
  return json(await all<Conversation>(env, "SELECT * FROM conversations WHERE archived = ? ORDER BY pinned DESC, last_message_at DESC LIMIT 100", archived));
});
route("POST", "/api/conversations/:id/pin", async (req, env, [id]) => {
  const b = await body<{ pinned?: boolean }>(req);
  await run(env, "UPDATE conversations SET pinned = ?, archived = 0 WHERE id = ?", b.pinned ? 1 : 0, id);
  return json({ ok: true });
});
route("GET", "/api/areas", async (_req, env) => json(await getAreas(env)));
route("POST", "/api/areas", async (req, env) => {
  try { return json(await saveArea(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("DELETE", "/api/areas/:key", async (_req, env, [key]) => {
  try { return json(await removeArea(env, key)); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
// A short spoken rundown of the next few hours, for the speaker button on the home screen.
route("GET", "/api/rundown", async (_req, env) => {
  const tz = (await getSettings(env)).timezone || "UTC";
  const until = new Date(Date.now() + 5 * 3600_000).toISOString();
  const [block, events, due, overdue] = await Promise.all([
    currentBlock(env),
    all<{ summary: string; start_at: string }>(env, "SELECT summary, start_at FROM calendar_events WHERE hidden = 0 AND all_day = 0 AND start_at BETWEEN ? AND ? GROUP BY summary, start_at ORDER BY start_at LIMIT 6", now(), until),
    all<{ title: string; due_at: string; person: string | null }>(env, "SELECT title, due_at, person FROM items WHERE status = 'open' AND kind != 'idea' AND due_at BETWEEN ? AND ? ORDER BY due_at LIMIT 8", now(), until),
    all<{ title: string }>(env, "SELECT title FROM items WHERE status = 'open' AND kind != 'idea' AND due_at < ? ORDER BY priority, due_at LIMIT 5", now()),
  ]);
  const t = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const facts = [
    `Local time: ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date())}`,
    block ? `Right now: ${block.name}${block.until ? ` until ${block.until}` : ""}; things for this block: ${block.items.map((i) => i.title).join("; ") || "none"}` : "No time block right now.",
    events.length ? `Meetings: ${events.map((e) => `${t(e.start_at)} ${e.summary}`).join("; ")}` : "No meetings in the next few hours.",
    due.length ? `Due soon: ${due.map((d) => `${t(d.due_at)} ${d.title}${d.person ? ` (${d.person})` : ""}`).join("; ")}` : "",
    overdue.length ? `Overdue: ${overdue.map((o) => o.title).join("; ")}` : "",
  ].filter(Boolean).join("\n");
  let text: string;
  try {
    text = await getProvider(env).complete({
      tier: "fast", purpose: "rundown", maxTokens: 220,
      system: "You are the user's chief of staff giving them a quick spoken briefing. In about 70-110 words: what they're in now, what's coming up today and in the next few hours (meetings, what's due), and the one or two overdue things that matter most. Natural spoken sentences, warm and direct, no lists, no emoji, no markdown. Group and prioritize; don't read every item. End with one suggestion of what to do first.",
      prompt: facts,
    });
  } catch { text = facts.replace(/\n/g, ". "); }
  return json({ text: text.trim() });
});
// Spoken briefing in a natural voice (OpenAI text-to-speech); the app falls back to the phone's voice.
route("POST", "/api/speak", async (req, env) => {
  const { text } = await body<{ text?: string }>(req);
  if (!text?.trim() || !env.OPENAI_API_KEY) throw new HttpError(400, "nothing to say");
  const res = await fetch(`${(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "")}/audio/speech`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.TTS_MODEL || "gpt-4o-mini-tts", voice: env.TTS_VOICE || "marin", input: text.slice(0, 3000), response_format: "mp3",
      instructions: "Speak like a warm, calm, capable chief of staff giving a quick spoken update to their boss. Natural pace, friendly, not robotic.",
    }),
  });
  if (!res.ok) throw new HttpError(502, `voice unavailable: ${(await res.text()).slice(0, 200)}`);
  return new Response(res.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
});

// Health check: is everything connected and working?
route("GET", "/api/status", async (_req, env) => {
  const val = async (k: string) => (await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = ?", k))?.value ?? null;
  const parse = (v: string | null) => { try { return v ? JSON.parse(v) : null; } catch { return v; } };
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [personal, business, accounts, pushSubs, usage, runs, lastCron, hubOk] = await Promise.all([
    val("addon_diag"), val("addon_diag_business"),
    all<{ email: string; last_sync_at: string | null; last_error: string | null }>(env, "SELECT email, last_sync_at, last_error FROM google_accounts"),
    first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM push_subscriptions"),
    first<{ calls: number; input: number; output: number; cached: number }>(env, "SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output, COALESCE(SUM(cached_tokens),0) AS cached FROM usage_log WHERE created_at >= ?", weekAgo),
    all<{ status: string; n: number }>(env, "SELECT status, COUNT(*) AS n FROM routine_runs WHERE started_at >= ? GROUP BY status", weekAgo),
    val("last_cron"), val("hub_last_ok"),
  ]);
  return json({
    whatsapp: { personal: parse(personal), business: parse(business) },
    google: accounts, push_devices: pushSubs?.n ?? 0, ai_week: usage, reports_week: runs,
    last_background_run: lastCron, coffee_app: { connected: hubConfigured(env), last_ok: hubOk },
  });
});
route("POST", "/api/conversations/tidy", async (req, env) => {
  const b = await body<{ keep?: string | null }>(req).catch(() => ({} as { keep?: string | null }));
  return json(await tidyConversations(env, { force: true, keepId: b.keep ?? null }));
});
// Clean up: archive, restore or delete one or many conversations.
route("POST", "/api/conversations/bulk", async (req, env) => {
  const b = await body<{ ids?: string[]; action?: string }>(req);
  const ids = (b.ids ?? []).filter((x) => typeof x === "string").slice(0, 200);
  if (!ids.length) return json({ ok: true, count: 0 });
  const marks = ids.map(() => "?").join(",");
  if (b.action === "archive" || b.action === "restore") {
    await run(env, `UPDATE conversations SET archived = ? WHERE id IN (${marks})`, b.action === "archive" ? 1 : 0, ...ids);
  } else if (b.action === "delete") {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM messages WHERE conversation_id IN (${marks})`).bind(...ids),
      env.DB.prepare(`DELETE FROM conversations WHERE id IN (${marks})`).bind(...ids),
    ]);
  } else throw new HttpError(400, "action must be archive, restore or delete");
  return json({ ok: true, count: ids.length });
});
route("GET", "/api/conversations/:id/messages", async (_req, env, [id]) =>
  json(await all<Message>(env, "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at LIMIT 400", id)));
route("DELETE", "/api/conversations/:id", async (_req, env, [id]) => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(id),
    env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
});
route("POST", "/api/chat", async (req, env) => {
  const b = await body<{ text?: string; mode?: string; conversation_id?: string | null }>(req);
  const text = (b.text ?? "").trim();
  if (!text) throw new HttpError(400, "text is required");
  if (text.length > 20000) throw new HttpError(413, "message too long");
  const mode = b.mode === "voice" || b.mode === "dictation" ? b.mode : "text";
  return json(await chat(env, text, mode, b.conversation_id));
});

// Live voice (OpenAI Realtime over WebRTC).
route("POST", "/api/realtime/session", async (_req, env) => json(await createRealtimeSession(env)));
route("POST", "/api/realtime/tool", async (req, env) => {
  const b = await body<{ name?: string; arguments?: string }>(req);
  return json(await runRealtimeTool(env, String(b.name ?? ""), String(b.arguments ?? "{}")));
});
route("POST", "/api/realtime/log", async (req, env) => {
  const b = await body<{ role?: string; content?: string; actions?: []; conversation_id?: string | null }>(req);
  return json(await logRealtimeMessage(env, String(b.role), String(b.content ?? ""), b.actions ?? [], b.conversation_id));
});

// Batch dictation: audio in, transcript out, via OpenAI transcription. If it is unavailable
// the client falls back to on-device speech recognition.
route("POST", "/api/transcribe", async (req, env) => {
  if (!env.OPENAI_API_KEY) throw new HttpError(501, "server transcription not configured");
  const form = await req.formData();
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") throw new HttpError(400, "audio file required");
  if (audio.size > 24 * 1024 * 1024) throw new HttpError(413, "audio too large");
  const out = new FormData();
  out.append("file", audio, audio.name || "dictation.webm");
  out.append("model", env.TRANSCRIBE_MODEL || "gpt-transcribe");
  const r = await fetch(`${env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: out,
  });
  if (!r.ok) throw new HttpError(502, `transcription failed (${r.status})`);
  const data = (await r.json()) as { text: string };
  return json({ text: data.text });
});

// ---- Brain dump ------------------------------------------------------------
route("GET", "/api/braindumps", async (_req, env) =>
  json(await all(env, "SELECT * FROM brain_dumps ORDER BY created_at DESC LIMIT 20")));
route("POST", "/api/braindumps", async (req, env) => {
  const b = await body<{ text?: string }>(req);
  const text = (b.text ?? "").trim();
  if (!text) throw new HttpError(400, "text is required");
  return json(await processBrainDump(env, text));
});

// ---- Items -----------------------------------------------------------------
route("GET", "/api/items", async (req, env) => {
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const key of ["kind", "status", "project_id"]) {
    const v = q.get(key);
    if (v && v !== "all") (where.push(`${key} = ?`), binds.push(v));
  }
  const sql = `SELECT * FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY status = 'open' DESC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, priority, created_at DESC LIMIT 300`;
  return json(await all<Item>(env, sql, ...binds));
});
route("POST", "/api/items", async (req, env) => json(await createItem(env, await body(req)), 201));
route("PATCH", "/api/items/:id", async (req, env, [id]) => json(await updateItem(env, id, await body(req))));
// Deleting from the UI is the user's own explicit action, so no approval round-trip.
route("DELETE", "/api/items/:id", async (_req, env, [id]) => {
  await run(env, "DELETE FROM items WHERE id = ?", id);
  return json({ ok: true });
});

// ---- Projects --------------------------------------------------------------
route("GET", "/api/projects", async (_req, env) =>
  json(await all<Project>(env, `SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id AND i.status='open') AS open_count
     FROM projects p ORDER BY p.status='active' DESC, p.updated_at DESC`)));
route("POST", "/api/projects", async (req, env) => json(await createProject(env, await body(req)), 201));
route("PATCH", "/api/projects/:id", async (req, env, [id]) => {
  const p = await first<Project>(env, "SELECT * FROM projects WHERE id = ?", id);
  if (!p) throw new HttpError(404, "project not found");
  const b = await body<Partial<Project>>(req);
  const next = {
    name: b.name?.trim() || p.name,
    description: b.description ?? p.description,
    area: b.area === "business" || b.area === "personal" ? b.area : p.area,
    status: b.status && ["active", "paused", "done"].includes(b.status) ? b.status : p.status,
  };
  await run(env, "UPDATE projects SET name=?, description=?, area=?, status=?, updated_at=? WHERE id=?",
    next.name, next.description, next.area, next.status, now(), id);
  return json({ ...p, ...next });
});
route("DELETE", "/api/projects/:id", async (_req, env, [id]) => {
  await run(env, "DELETE FROM projects WHERE id = ?", id);
  return json({ ok: true });
});

// ---- Memory ----------------------------------------------------------------
route("GET", "/api/memories", async (_req, env) =>
  json(await all<Memory>(env, "SELECT * FROM memories WHERE status != 'ignored' ORDER BY status = 'suggested' DESC, area, updated_at DESC")));
route("POST", "/api/memories/:id/review", async (req, env, [id]) => {
  const b = await body<{ action?: string; content?: string }>(req);
  return json(await reviewMemory(env, id, String(b.action), b.content));
});
route("GET", "/api/ideas", async (_req, env) =>
  json(await all<Idea>(env, "SELECT * FROM ideas WHERE status != 'dropped' ORDER BY status IN ('done', 'parked'), updated_at DESC")));
/** An idea that's dropped, done or deleted takes its home-screen cards with it. */
async function clearIdeaCards(env: Env, title: string) {
  await run(env, "UPDATE nudges SET dismissed = 1 WHERE dismissed = 0 AND type = 'idea' AND title LIKE ?", `%${title.slice(0, 60)}%`);
}
route("POST", "/api/ideas/:id", async (req, env, [id]) => {
  const i = await updateIdea(env, id, await body(req));
  if (i.status === "dropped" || i.status === "done") await clearIdeaCards(env, i.title);
  return json(i);
});
route("POST", "/api/ideas/:id/steps/:step", async (req, env, [id, step], ctx) => {
  const b = await body<{ action?: string; when?: string }>(req);
  const r = await ideaStep(env, id, step, b.action === "dismiss" ? "dismiss" : "do", { when: b.when });
  if ((r as { queued?: boolean }).queued) ctx.waitUntil(runIdeaResearch(env, id).catch((e) => console.error("idea research", e)));
  return json(r);
});
route("DELETE", "/api/ideas/:id", async (_req, env, [id]) => {
  const i = await first<{ title: string }>(env, "SELECT title FROM ideas WHERE id = ?", id);
  await run(env, "DELETE FROM ideas WHERE id = ?", id);
  if (i) await clearIdeaCards(env, i.title);
  return json({ ok: true });
});
route("GET", "/api/groups", async (_req, env) => {
  const gs = await all<Group>(env, "SELECT * FROM contact_groups ORDER BY name");
  return json(await Promise.all(gs.map(async (g) => ({ ...g, members: await members(env, g.id) }))));
});
route("POST", "/api/groups", async (req, env) => {
  try { return json(await saveGroup(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("DELETE", "/api/groups/:id", async (_req, env, [id]) => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM group_members WHERE group_id = ?").bind(id),
    env.DB.prepare("DELETE FROM broadcasts WHERE group_id = ?").bind(id),
    env.DB.prepare("DELETE FROM contact_groups WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
});
route("GET", "/api/groups/:id/messages", async (_req, env, [id]) =>
  json(await all<Broadcast>(env, "SELECT * FROM broadcasts WHERE group_id = ? ORDER BY created_at DESC LIMIT 30", id)));
route("POST", "/api/broadcasts", async (req, env) => {
  try { return json(await draftBroadcast(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("POST", "/api/broadcasts/:id/send", async (_req, env, [id]) => {
  try { return json(await sendBroadcast(env, id)); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("DELETE", "/api/broadcasts/:id", async (_req, env, [id]) => { await run(env, "DELETE FROM broadcasts WHERE id = ? AND status = 'draft'", id); return json({ ok: true }); });
route("POST", "/api/learn", async (_req, env) => json(await learnPass(env, true)));
route("GET", "/api/people", async (_req, env) => json(await all(env, "SELECT * FROM people ORDER BY name")));
route("POST", "/api/people/:id", async (req, env, [id]) => {
  const b = await body<{ key?: boolean }>(req);
  if (b.key !== undefined) await run(env, "UPDATE people SET key = ?, updated_at = ? WHERE id = ?", b.key ? 1 : 0, now(), id);
  return json({ ok: true });
});
route("DELETE", "/api/people/:id", async (_req, env, [id]) => {
  await run(env, "DELETE FROM people WHERE id = ?", id);
  return json({ ok: true });
});
route("DELETE", "/api/memories/:id", async (_req, env, [id]) => {
  await run(env, "DELETE FROM memories WHERE id = ?", id);
  return json({ ok: true });
});

// ---- Proactive: nudges and approvals ---------------------------------------
route("POST", "/api/nudges/:id/dismiss", async (_req, env, [id]) => {
  await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", id);
  return json({ ok: true });
});
// ---- Trackers ----------------------------------------------------------------------
route("GET", "/api/trackers", async (_req, env) => {
  const ts = await all<Tracker & { n: number; last: string | null }>(env,
    `SELECT t.*, (SELECT COUNT(*) FROM tracker_entries e WHERE e.tracker_id = t.id) AS n,
            (SELECT MAX(said_at) FROM tracker_entries e WHERE e.tracker_id = t.id) AS last
     FROM trackers t ORDER BY t.active DESC, t.created_at DESC`);
  return json(await Promise.all(ts.map(async (t) => ({ ...t, status: await trackerStatus(env, t) }))));
});
route("POST", "/api/trackers", async (req, env) => {
  try { return json(await saveTracker(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("POST", "/api/trackers/:id/check", async (req, env, [id]) => {
  const b = await body<{ days?: number }>(req).catch(() => ({} as { days?: number }));
  try { return json(await checkTrackerNow(env, id, b.days)); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("POST", "/api/tracker-entries/:id/verdict", async (req, env, [id]) => {
  const b = await body<{ verdict?: string }>(req);
  return json(await judgeEntry(env, id, b.verdict === "good" ? "good" : "bad"));
});
route("GET", "/api/whatsapp/chats", async (_req, env) => json(await knownChats(env)));
route("POST", "/api/people/:id/whatsapp", async (req, env, [id]) => {
  const b = await body<{ chat?: string }>(req);
  if (!b.chat) throw new HttpError(400, "chat required");
  return json(await linkWhatsapp(env, id, b.chat));
});
route("GET", "/api/trackers/:id/entries", async (_req, env, [id]) => json(await trackerEntries(env, id, 500)));
route("DELETE", "/api/trackers/:id", async (_req, env, [id]) => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM tracker_entries WHERE tracker_id = ?").bind(id),
    env.DB.prepare("DELETE FROM trackers WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
});

// ---- Situations (time/place reminders) ---------------------------------------------
route("GET", "/api/situations", async (_req, env) => {
  const list = await all<Situation>(env, "SELECT * FROM situations ORDER BY active DESC, created_at");
  return json(list.map((s) => ({ ...s, when: describeSituation(s) })));
});
route("POST", "/api/situations", async (req, env) => {
  try { return json(await saveSituation(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("DELETE", "/api/situations/:id", async (_req, env, [id]) => {
  await run(env, "DELETE FROM situations WHERE id = ?", id);
  return json({ ok: true });
});

// ---- Tasks (recurring agent jobs) -----------------------------------------------------
route("GET", "/api/routines", async (_req, env) => {
  await advanceRoutineRuns(env).catch((e) => console.error("advance runs", e));
  const rs = await all<Routine>(env, "SELECT * FROM routines ORDER BY active DESC, created_at");
  const runs = await all<{ routine_id: string; status: string; state: string | null; error: string | null }>(env, `SELECT id, routine_id, started_at, finished_at, status, summary, report, sources, searches, doc_link, error, state
    FROM routine_runs WHERE routine_id IN (SELECT id FROM routines) ORDER BY started_at DESC LIMIT 60`);
  // Progress for runs in flight, in plain words.
  const progress = (x: { status: string; state: string | null; error: string | null }) => {
    if (x.status !== "running") return null;
    if (!x.state) return x.error ?? "Planning the research…";
    try {
      const st = JSON.parse(x.state) as { jobs: { text?: string; failed?: string; id?: string | null }[]; write_id?: string | null };
      const done = st.jobs.filter((j) => j.text !== undefined).length;
      if (done === st.jobs.length || st.write_id) return "Writing the report…";
      return `Researching: ${done} of ${st.jobs.length} parts done`;
    } catch { return null; }
  };
  return json(rs.map((r) => ({
    ...r, schedule: normalizeSchedule(r.schedule), schedule_text: describeSchedule(normalizeSchedule(r.schedule)),
    runs: runs.filter((x) => x.routine_id === r.id).slice(0, 8).map(({ state, ...x }) => ({ ...x, progress: progress({ ...x, state }) })),
  })));
});
route("POST", "/api/routines", async (req, env) => {
  try { return json(await saveRoutine(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("GET", "/api/routine-runs/:id", async (_req, env, [id]) => {
  const r = await first(env, `SELECT rr.id, rr.routine_id, rr.started_at, rr.summary, rr.report, rr.sources, rr.doc_link, r.name
    FROM routine_runs rr JOIN routines r ON r.id = rr.routine_id WHERE rr.id = ?`, id);
  if (!r) throw new HttpError(404, "report not found");
  return json(r);
});
route("DELETE", "/api/routines/:id", async (_req, env, [id]) => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM routine_runs WHERE routine_id = ?").bind(id),
    env.DB.prepare("DELETE FROM routines WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
});
route("POST", "/api/routines/:id/tell", async (req, env, [id]) => {
  const b = await body<{ text?: string }>(req);
  if (!b.text?.trim()) throw new HttpError(400, "Say what to change.");
  try { return json(await tellRoutine(env, id, b.text.trim().slice(0, 2000))); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("POST", "/api/routines/:id/run", async (_req, env, [id], ctx) => {
  const r = await first<Routine>(env, "SELECT * FROM routines WHERE id = ?", id);
  if (!r) throw new HttpError(404, "task not found");
  await run(env, "UPDATE routine_runs SET status = 'failed', finished_at = ?, error = 'Replaced by a new run.' WHERE routine_id = ? AND status = 'running'", now(), id);
  await runRoutine(env, r); // plans and hands the research to OpenAI; finishes in the background
  void ctx;
  return json({ ok: true, message: "Started. Researching now — the report usually lands within 10–20 minutes, and you'll get a notification." });
});

// ---- Replies: consolidated catch-up ------------------------------------------------
route("GET", "/api/replies", async (_req, env) => json(await replyQueue(env)));
route("POST", "/api/replies/:id/draft", async (req, env, [id]) => {
  const { guidance } = await body<{ guidance?: string }>(req);
  try { return json(await draftReply(env, id, String(guidance ?? "").trim())); }
  catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("POST", "/api/replies/:id/send", async (req, env, [id]) => {
  const { text } = await body<{ text?: string }>(req);
  try { return json(await sendReply(env, id, String(text ?? ""))); }
  catch (e) { throw new HttpError(400, (e as Error).message); }
});

// ---- Missions ----------------------------------------------------------------------
route("GET", "/api/missions", async (_req, env) =>
  json(await all(env, "SELECT * FROM missions ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC LIMIT 50")));
route("POST", "/api/missions/:id", async (req, env, [id]) => {
  const b = await body<{ status?: string }>(req);
  return json(await updateMission(env, id, { status: b.status, note: b.status ? `You set it to ${b.status}.` : undefined }));
});

// ---- Search everything ----------------------------------------------------------
route("GET", "/api/search", async (req, env) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return json({ q, items: [], memories: [], people: [], conversations: [], brain_dumps: [], projects: [], events: [] });
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const [items, memLike, memFts, people, conversations, dumps, projects, events] = await Promise.all([
    all<Item>(env, `SELECT * FROM items WHERE title LIKE ? OR notes LIKE ? OR person LIKE ?
      ORDER BY status = 'open' DESC, updated_at DESC LIMIT 25`, like, like, like),
    all<Memory>(env, "SELECT * FROM memories WHERE content LIKE ? ORDER BY updated_at DESC LIMIT 15", like),
    recallMemories(env, q, 15),
    findPeople(env, q, 10),
    all(env, `SELECT m.conversation_id, c.title, m.role, m.content, m.created_at FROM messages m
      LEFT JOIN conversations c ON c.id = m.conversation_id WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT 15`, like),
    all(env, "SELECT id, raw, summary, created_at FROM brain_dumps WHERE raw LIKE ? OR summary LIKE ? ORDER BY created_at DESC LIMIT 8", like, like),
    all<Project>(env, "SELECT * FROM projects WHERE name LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT 8", like, like),
    all<CalendarEvent>(env, `SELECT id, summary, start_at, end_at, all_day, location, html_link FROM calendar_events
      WHERE summary LIKE ? OR location LIKE ? GROUP BY summary, start_at ORDER BY start_at LIMIT 10`, like, like),
  ]);
  const seen = new Set<string>();
  const memories = [...memLike, ...memFts].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, 15);
  return json({ q, items, memories, people, conversations, brain_dumps: dumps, projects, events });
});

route("POST", "/api/nudges/:id/act", async (req, env, [id]) => {
  const { action } = await body<{ action?: string }>(req);
  return json(await applyAction(env, id, String(action ?? "")));
});
route("POST", "/api/nudges/:id/undo", async (_req, env, [id]) => {
  const n = await first<Nudge>(env, "SELECT * FROM nudges WHERE id = ?", id);
  if (n?.item_id) await updateItem(env, n.item_id, { status: "open" });
  await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", id);
  return json({ ok: true });
});
route("POST", "/api/proactive/run", async (req, env) => {
  const b = await body<{ briefing?: boolean }>(req).catch(() => ({ briefing: false }));
  return json(await runProactive(env, { forceBriefing: !!b.briefing }));
});
route("POST", "/api/actions/:id/:decision", async (_req, env, [id, decision]) => {
  const a = await first<PendingAction>(env, "SELECT * FROM pending_actions WHERE id = ? AND status = 'pending'", id);
  if (!a) throw new HttpError(404, "no pending action");
  let outcome = "rejected";
  if (decision === "approve") outcome = await executeApproved(env, a.action, JSON.parse(a.payload || "{}"));
  else if (decision !== "reject") throw new HttpError(400, "decision must be approve or reject");
  await run(env, "UPDATE pending_actions SET status = ?, resolved_at = ? WHERE id = ?",
    decision === "approve" ? "approved" : "rejected", now(), id);
  return json({ ok: true, outcome });
});

// ---- Settings, usage, notifications foundation ------------------------------
route("GET", "/api/settings", async (_req, env) => json(await getSettings(env)));
route("PUT", "/api/settings", async (req, env) => json(await saveSettings(env, await body(req))));
route("GET", "/api/usage", async (_req, env) =>
  json(await all(env, `SELECT model, purpose, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cached_tokens) AS cached_tokens
     FROM usage_log WHERE created_at >= ? GROUP BY model, purpose ORDER BY calls DESC`,
    new Date(Date.now() - 30 * 86400_000).toISOString())));
route("POST", "/api/push/subscribe", async (req, env) => {
  const sub = await body<{ endpoint?: string }>(req);
  if (!sub.endpoint) throw new HttpError(400, "endpoint required");
  await run(env, "INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?)",
    sub.endpoint, JSON.stringify(sub), now());
  return json({ ok: true });
});
route("GET", "/api/push/key", async (_req, env) => json({ key: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null }));
route("POST", "/api/push/test", async (_req, env) =>
  json(await sendPush(env, { title: "Notifications are on", body: "This is how your reminders will arrive.", url: "/?tab=today", tag: "test" })));
// ---- Google (Calendar + Gmail) ---------------------------------------------
route("GET", "/api/google/status", async (_req, env) => json(await googleStatus(env)));
route("GET", "/api/bridge-status", async (_req, env) => json(await bridgeStatus(env)));
route("POST", "/api/google/connect", async (req, env) => {
  try { return json({ url: await startGoogleAuth(env, req) }); }
  catch (e) { if (e instanceof GoogleAuthError) throw new HttpError(400, e.message); throw e; }
});
route("POST", "/api/google/disconnect", async (req, env) => {
  const { email } = await body<{ email?: string }>(req);
  if (!email) throw new HttpError(400, "email required");
  await disconnectGoogle(env, email);
  return json({ ok: true });
});
route("POST", "/api/google/area", async (req, env) => {
  const b = await body<{ email?: string; category?: string }>(req);
  if (!b.email || !(await getAreas(env)).some((a) => a.key === b.category)) throw new HttpError(400, "email and category required");
  await run(env, "UPDATE google_accounts SET category = ? WHERE email = ?", b.category, b.email);
  return json({ ok: true });
});
route("POST", "/api/google/sync", async (_req, env) => json(await syncGoogle(env)));

route("GET", "/api/export", async (_req, env) => {
  const [items, projects, memories, messages] = await Promise.all([
    all(env, "SELECT * FROM items"), all(env, "SELECT * FROM projects"),
    all(env, "SELECT * FROM memories"), all(env, "SELECT * FROM messages ORDER BY created_at"),
  ]);
  return json({ exported_at: now(), items, projects, memories, messages });
});

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (url.pathname === "/api/health") {
      return json({ ok: true, configured: !!env.COS_ACCESS_TOKEN, model: !!env.OPENAI_API_KEY, transcription: !!env.OPENAI_API_KEY, push: pushConfigured(env) });
    }
    // Google redirects the browser here without our bearer token; the single-use state is the check.
    if (url.pathname === "/api/google/callback" && req.method === "GET") return finishGoogleAuth(env, req);
    // Desktop WhatsApp bridge: its own key, its own three routes.
    if (url.pathname.startsWith("/api/bridge/")) {
      if (!bridgeAuthorised(req, env)) return json({ error: "unauthorised" }, 401);
      if (url.pathname === "/api/bridge/incoming" && req.method === "POST") return json(await handleIncoming(env, await req.json()));
      if (url.pathname === "/api/bridge/diag" && req.method === "POST") {
        const raw = (await req.json().catch(() => ({}))) as { account?: string };
        const key = raw.account === "business" ? "addon_diag_business" : "addon_diag";
        await run(env, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(raw).slice(0, 2000));
        return json({ ok: true });
      }
      if (url.pathname === "/api/bridge/trackers" && req.method === "GET") {
        return json(await trackersForBridge(env, url.searchParams.get("account") === "business" ? "business" : "personal"));
      }
      if (url.pathname === "/api/bridge/track" && req.method === "POST") return json(await capture(env, await req.json()));
      if (url.pathname === "/api/bridge/chats" && req.method === "POST") {
        const b = (await req.json().catch(() => ({}))) as { account?: string; names?: string[] };
        return json(await matchWhatsappNames(env, b.account === "business" ? "business" : "personal", Array.isArray(b.names) ? b.names : []));
      }
      const bf = url.pathname.match(/^\/api\/bridge\/trackers\/([\w-]+)\/backfilled$/);
      if (bf && req.method === "POST") {
        const b = (await req.json().catch(() => ({}))) as { account?: string };
        await markBackfilled(env, bf[1], b.account === "business" ? "business" : "personal");
        return json({ ok: true });
      }
      if (url.pathname === "/api/bridge/replied" && req.method === "POST") return json(await handleReplied(env, await req.json()));
      if (url.pathname === "/api/bridge/outbox" && req.method === "GET") return json(await takeOutbox(env));
      const m = url.pathname.match(/^\/api\/bridge\/outbox\/([\w-]+)$/);
      if (m && req.method === "POST") {
        const b = (await req.json().catch(() => ({}))) as { ok?: boolean; detail?: string };
        return json(await reportOutbox(env, m[1], !!b.ok, String(b.detail ?? "")));
      }
      return json({ error: "not found" }, 404);
    }
    // Lock-screen notification buttons: authorised by a per-nudge signature instead of the passcode.
    if (url.pathname === "/api/act" && req.method === "POST" && env.COS_ACCESS_TOKEN) {
      const b = await req.json().catch(() => ({})) as { n?: string; a?: string; sig?: string };
      if (!b.n || !b.sig || !(await verifyNudge(env, b.n, b.sig))) return json({ error: "unauthorised" }, 401);
      return json(await applyAction(env, b.n, String(b.a ?? "")));
    }
    if (!env.COS_ACCESS_TOKEN) return json({ error: "Server not configured: set the COS_ACCESS_TOKEN secret." }, 503);
    if (!authorised(req, env)) return json({ error: "unauthorised" }, 401);

    for (const [method, re, handler] of routes) {
      const m = url.pathname.match(re);
      if (m && method === req.method) {
        try {
          return await handler(req, env, m.slice(1).map(decodeURIComponent), ctx);
        } catch (e) {
          if (e instanceof HttpError) return json({ error: e.message }, e.status);
          if (e instanceof ProviderUnavailable) return json({ error: e.message }, 503);
          console.error(e);
          return json({ error: "Something went wrong on the server." }, 500);
        }
      }
    }
    return json({ error: "not found" }, 404);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Pull Google first so new emails and meetings are in place before reminders and the briefing.
    ctx.waitUntil(syncGoogle(env).catch((e) => console.error("google sync", e)).then(() => runProactive(env))
      .then(() => learnPass(env)).catch((e) => console.error("learn", e)).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

/**
 * Reminders and briefings that list to-dos stay current: finished items drop off (and a block
 * reminder disappears once everything in it is done); briefings lose the lines for things done since.
 */
async function liveNudges(env: Env, nudges: (Nudge & { item_ids?: string | null })[]) {
  const out: (Nudge & { items?: { id: string; title: string; person: string | null }[] })[] = [];
  for (const n of nudges) {
    if (n.item_ids) {
      let ids: string[] = [];
      try { ids = JSON.parse(n.item_ids); } catch { /* none */ }
      const open = ids.length ? await all<{ id: string; title: string; person: string | null }>(env,
        `SELECT id, title, person FROM items WHERE status = 'open' AND id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
      const ordered = ids.map((id) => open.find((o) => o.id === id)).filter(Boolean) as typeof open;
      if (!ordered.length) { await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", n.id); continue; }
      const note = n.body.split("\n").filter((l) => l.startsWith("📝"));
      out.push({
        ...n, items: ordered,
        title: n.title.replace(/\d+ things?( for now)?/, `${ordered.length} thing${ordered.length > 1 ? "s" : ""}$1`),
        body: [...note, ...ordered.map((i) => `• ${i.title}${i.person ? ` (${i.person})` : ""}`)].join("\n"),
      });
      continue;
    }
    if (n.type === "briefing") {
      const closed = await all<{ title: string }>(env, "SELECT title FROM items WHERE status != 'open' AND updated_at >= ?", n.created_at);
      const keys = closed.map((c) => c.title.toLowerCase().slice(0, 30)).filter((k) => k.length >= 6);
      if (keys.length) {
        const body = n.body.split("\n").filter((l) => !(/^\s*([-*•]|\d+\.)\s/.test(l) && keys.some((k) => l.toLowerCase().includes(k)))).join("\n");
        out.push({ ...n, body });
        continue;
      }
    }
    out.push(n);
  }
  return out;
}

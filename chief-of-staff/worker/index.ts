import {alumniStatus,processAlumni,backfillAlumniInbox,decideAlumni,prepareAlumniWriteCheck,confirmAlumniWriteCheck} from './alumni-visits';
import {assistantTaskBrief} from './assistant-quick';
import {healthAIRunnerRoute} from './daynote-ai';
import {agentChatsRoute} from './agent-chats';
import {chatgptRelayRoute} from './chatgpt-relay';
import {briefHistory,linkJobProject,refreshBrief,jobContext} from './job-briefs';
import {HEALTH_ORIGIN} from '../shared/health-origin';
import {androidDeviceRoute} from './daynote-android';
import {redeemDaynoteLogin} from './daynote-login';
import {finishWhoopAuth,syncWhoop} from './daynote-whoop';
import {daynoteRoute,healthReminders} from './daynote';
import {finishHealthAuth,healthSync} from './daynote-google';
import {hashgachaCampaigns,syncHashgacha} from './hashgacha';
import {autopilotPreview,runHashgachaAutopilot,saveAutopilot} from './hashgacha-autopilot';
import { transcribeAudio } from "./transcribe";
import { jobChat, listJobChats, messageJob, nextCodexRun, pressButton, replyWithToken, runResult, setPinned, tickJobs, type Job } from "./jobs";
import { createJob, decideJob, expireJobs, finishJob, helperSeen, jobStatus, listJobs, nextAction, nextJob } from './browser';
import { checkPlacement, chooseFile, deleteVault, fileBytes, fillForm, listVault, prepareSignedFile, recentFiles, recentSigned, saveVault, signFile, signedFileBytes, uploadFile } from './documents';
import {homeAttention} from './home-attention';
import {homeWork} from './home-work';
import {attentionState,actionableItem,actionableNotice,actionableNoticeItem} from './attention';
import {organizeProjects} from './projectorganization';
import type { CalendarEvent, Conversation, Dashboard, Item, Memory, Message, Nudge, PendingAction, Project } from "../shared/types";
import type { Env } from "./env";
import { recurringReminders, saveRecurringReminder, syncRecurringReminders } from './reminders';
import { addShoppingItems, captureShopping, deleteShoppingItem, deleteShoppingList, processPendingShopping, saveShoppingConfig, saveShoppingList, shoppingConfig, shoppingState, updateShoppingItem } from './shopping';
import { getProvider } from "./ai";
import { modelRoute } from "./ai-routing";
import { ProviderUnavailable } from "./ai";
import { chat, decidePendingAction } from "./assistant";
import {
  HttpError, all, archiveFinishedProjects, createItem, createProject, endOfLocalDay, first, getSettings, learnCategory, now, run, saveSettings, syncProject, updateItem,
} from "./db";
import { runProactive } from "./proactive";
import { learnPass, reviewMemory } from "./learn";
import { scanNewWatches } from "./watches";
import { processSelfNotes, saveSelfNote } from "./meetingnotes";
import { tidyConversations } from "./tidy";
import { getAreas, removeArea, saveArea } from "./areas";
import { hubConfigured } from "./hub";
import { members, saveGroup, type Group } from "./groups";
import { actionsForNudge, applyAction, tomorrowMorning, verifyNudge } from "./actions";
import { bridgeAuthorised, bridgeStatus, handleIncoming, handleReplied, reportOutbox, takeOutbox } from "./whatsapp";
import { ALLOWED_NOTIFICATIONS, pushConfigured, sendPush } from "./push";
import { activeNotificationIds, reconcileNotificationGroups } from "./notifications";
import { findPeople, recallMemories } from "./memory";
import { batchReplyInstructions, dismissReply,saveReplyDraft,markWhatsAppReplied,replyQueue, sendReply, draftReply } from "./replies";
import { currentBlock, nowChecklist, describeSituation, saveSituation, type Situation } from "./situations";
import { bridgeWatches, capture, knownChats, linkWhatsapp, markBackfilled, saveChatNames } from "./wa-bridge";
import { GoogleAuthError, disconnectGoogle, finishGoogleAuth, googleStatus, startGoogleAuth, syncGoogle } from "./google";
import { contactsStatus, openWhatsApps, syncContacts, syncContactsDaily } from "./contacts";
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

/** Constant-time string comparison (for keys). */
function safeEqual(got: string, expected: string) {
  const a = new TextEncoder().encode(got), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
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

// ---- My details, files found in email, signed copies (nothing here sends anything anywhere) ----
const fileResponse = (bytes: Uint8Array, filename: string, mime: string) =>
  new Response(bytes, { headers: { "content-type": mime, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`, "cache-control": "private, no-store" } });
// Research chats (jobs): the side panel's pinned list and the Tasks tab, one chat, talking to it, pin/unpin, buttons.
route("GET", "/api/jobs", async (_req, env) => json(await listJobChats(env)));
route("GET", "/api/jobs/:id", async (_req, env, [id]) => { try { return json(await jobChat(env, id)); } catch (e) { throw new HttpError(404, (e as Error).message); } });
route("POST", "/api/jobs/:id/message", async (req, env, [id]) => {
  const j = await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", id);
  if (!j) throw new HttpError(404, "That research chat isn't there any more.");
  const text = String((await body<{ text?: string }>(req)).text ?? "").trim().slice(0, 2000);
  if (!text) throw new HttpError(400, "Type a message.");
  return json({ reply: await messageJob(env, j, text, "app") });
});
route("GET", "/api/jobs/:id/brief/history", async (_req,env,[id])=>json(await briefHistory(env,id)));
route("POST", "/api/jobs/:id/brief/refresh", async (_req,env,[id])=>{await refreshBrief(env,id);return json({ok:true});});
route("POST", "/api/jobs/:id/project", async (req,env,[id])=>json(await linkJobProject(env,id,(await body<{project_id:string|null}>(req)).project_id)));
route("POST", "/api/jobs/:id/pin", async (req, env, [id]) => json(await setPinned(env, id, !!(await body<{ pinned?: boolean }>(req)).pinned)));
route("POST", "/api/jobs/button", async (req, env) => { await pressButton(env, String((await body<{ data?: string }>(req)).data ?? "")); return json({ ok: true }); });
route("GET", "/api/helper/jobs", async (_req, env) => json(await listJobs(env)));
route("GET", "/api/helper/status", async (_req, env) => json(await helperSeen(env)));
route("POST", "/api/helper/jobs", async (req, env) => { try { return json(await createJob(env, { ...(await body<{ instruction: string; start_url?: string }>(req)), source: "you" })); } catch (e) { throw new HttpError(400, (e as Error).message); } });
route("POST", "/api/helper/jobs/:id/:decision", async (req, env, [id, decision]) => {
  if (!["approve", "cancel", "answer"].includes(decision)) throw new HttpError(404, "not found");
  const b = await body<{ answer?: string }>(req).catch(() => ({} as { answer?: string }));
  try { return json(await decideJob(env, id, decision as "approve", b.answer)); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("GET", "/api/vault", async (_req, env) => json(await listVault(env)));
route("POST", "/api/vault", async (req, env) => { try { return json(await saveVault(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); } });
route("DELETE", "/api/vault/:id", async (_req, env, [id]) => { await deleteVault(env, id); return json({ ok: true }); });
route("GET", "/api/files", async (req, env) => {
  const since = new URL(req.url).searchParams.get("since") || new Date(Date.now() - 86400_000).toISOString();
  return json({ files: await recentFiles(env, since), signed: await recentSigned(env, since) });
});
route("GET", "/api/files/:id", async (_req, env, [id]) => {
  try { const f = await fileBytes(env, id); return fileResponse(f.bytes, f.filename, f.mime); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("POST", "/api/files/upload", async (req, env) => {
  const form = await req.formData();
  const f = form.get("file");
  if (!f || typeof f === "string") throw new HttpError(400, "Choose a file.");
  try { return json(await uploadFile(env, { filename: f.name || "file", mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()), purpose: String(form.get("purpose") ?? "") || undefined })); }
  catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("POST", "/api/files/:id/choose", async (_req, env, [id]) => { try { return json(await chooseFile(env, id)); } catch (e) { throw new HttpError(400, (e as Error).message); } });
route("POST", "/api/files/:id/sign", async (req, env, [id]) => { try { return json(await signFile(env, { ...(await body<{ signatures?: string[]; position?: string }>(req)), file_id: id })); } catch (e) { throw new HttpError(400, (e as Error).message); } });
route("POST", "/api/files/:id/check", async (req, env, [id]) => { try { return json(await checkPlacement(env, id, (await body<{ images?: string[] }>(req)).images ?? [])); } catch (e) { throw new HttpError(400, (e as Error).message); } });
route("POST", "/api/files/:id/fill", async (req, env, [id]) => { try { return json(await fillForm(env, { ...(await body<{ instructions?: string }>(req)), file_id: id })); } catch (e) { throw new HttpError(400, (e as Error).message); } });
route("POST", "/api/signed", async (req, env) => { try { return json(await prepareSignedFile(env, await body(req))); } catch (e) { throw new HttpError(400, (e as Error).message); } });
route("GET", "/api/signed/:id", async (_req, env, [id]) => {
  try { const f = await signedFileBytes(env, id); return fileResponse(f.bytes, f.filename, "application/pdf"); } catch (e) { throw new HttpError(400, (e as Error).message); }
});

route('GET','/api/hashgacha',async(_req,env)=>json(await hashgachaCampaigns(env)));
route('POST','/api/hashgacha/refresh',async(_req,env)=>{await syncHashgacha(env,{remind:false});return json(await hashgachaCampaigns(env));});

// ---- Dashboard -------------------------------------------------------------
route("GET", "/api/dashboard", async (_req, env) => {
  await reconcileNotificationGroups(env);
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
      ORDER BY COALESCE(n.updated_at,n.created_at) DESC, n.created_at DESC LIMIT 20`),
    all<PendingAction>(env, `SELECT * FROM pending_actions WHERE status='pending' ORDER BY created_at DESC`),
    // Active projects that still have something open, for the home screen (finished ones archive themselves).
    all<Project>(env, `SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id AND i.status='open') AS open_count,
                         (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id AND i.status='done') AS done_count
                       FROM projects p WHERE p.status='active'
                       ORDER BY p.updated_at DESC LIMIT 12`),
    all<{ kind: string; n: number }>(env, `SELECT kind, COUNT(*) AS n FROM items WHERE status='open' GROUP BY kind`),
    all<CalendarEvent>(env, `SELECT id, summary, start_at, end_at, all_day, location, html_link FROM calendar_events
       WHERE hidden = 0 AND ((all_day = 0 AND (end_at > ? OR (end_at IS NULL AND start_at >= ?)) AND start_at < ?) OR (all_day = 1 AND start_at <= ? AND end_at > ?))
       GROUP BY summary, start_at ORDER BY all_day DESC, start_at`, t, t, endOfDay, localDate, localDate),
  ]);
  const attention = await attentionState(env);
  const eligible=(i:Item)=>actionableItem(i,attention.blocks,attention.tz,attention.at);
  const nowBlock = await nowChecklist(env,attention);
  const browseEligible=(i:Item)=>eligible(i.kind==='reminder'?i:{...i,block_id:null} as Item);
  const work=await homeWork(env);

  if (projects.length) {
    const open = await all<{ id: string; title: string; due_at: string | null; category: string | null; project_id: string }>(env,
      `SELECT * FROM items WHERE status='open' AND project_id IN (${projects.map(() => "?").join(",")})
       ORDER BY due_at IS NULL, due_at, priority, created_at`, ...projects.map((p) => p.id));
    for (const p of projects) {
      p.categories=[...new Set(open.filter(i=>i.project_id===p.id).map(i=>i.category))];
      p.items = open.filter((i) => i.project_id === p.id && browseEligible(attention.items.get(i.id)!)).map(({ project_id: _p, ...i }) => i);
    }
  }
  const todo = await all<Item>(env, `SELECT * FROM items WHERE status='open' AND kind IN ('task','commitment','reminder')
      AND (due_at IS NULL OR due_at > ?) ORDER BY due_at IS NULL, due_at, priority, created_at LIMIT 60`, endOfDay);
  const listIds = [...new Set(todo.map((i) => i.project_id).filter(Boolean))] as string[];
  const lists = listIds.length ? await all<{ id: string; name: string }>(env,
    `SELECT id, name FROM projects WHERE id IN (${listIds.map(() => "?").join(",")})`, ...listIds) : [];
  // One row per to-do: the newest reminder about it wins.
  const seenItems = new Set<string>();
  const liveAll = await liveNudges(env, nudges.filter(n=>ALLOWED_NOTIFICATIONS.has(n.type)&&actionableNotice(n,attention)));
  // A to-do already listed in a "Now" card (time block) doesn't also get its own row.
  const inBlocks = new Set(liveAll.flatMap((n) => (n.items ?? []).map((i) => i.id)));
  const live = liveAll.filter((n) => !n.item_id || (!inBlocks.has(n.item_id) && (seenItems.has(n.item_id) ? false : (seenItems.add(n.item_id), true))));
  // Projects that just finished and haven't been celebrated yet (recent only, so nothing old pops up).
  const celebrate = await all<{ id: string; name: string; done: number }>(env,
    `SELECT p.id, p.name, (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.status = 'done') AS done
     FROM projects p WHERE p.celebrate_at IS NOT NULL AND p.celebrate_at > ? ORDER BY p.celebrate_at`, new Date(Date.now() - 3 * 86400_000).toISOString());
  const data: Dashboard = {
    hashgacha:await hashgachaCampaigns(env),now_block: nowBlock, celebrate, attention_cards:await homeAttention(env,attention,pending),
    today, overdue:overdue.filter(browseEligible), waiting, pending, projects, events, home_tasks:work.tasks, home_projects:work.projects, timezone:settings.timezone, todo:todo.filter(browseEligible), lists,
    nudges: await Promise.all(live.map(async (n) => ({ ...n, actions: await actionsForNudge(env, n) }))),
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
    ai_routing: { brain: modelRoute(env, 'judgment').model, writer: modelRoute(env, 'chat_wording').model, fixed_reminders: 'code' },
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
route("POST", "/api/chat", async (req, env, _p, ctx) => {
  const b = await body<{ text?: string; mode?: string; conversation_id?: string | null; files?: string[] }>(req);
  const files = Array.isArray(b.files) ? b.files.map(String).slice(0, 6) : [];
  const text = (b.text ?? "").trim() || (files.length ? "Here's a file." : "");
  if (!text) throw new HttpError(400, "text is required");
  if (text.length > 20000) throw new HttpError(413, "message too long");
  const mode = b.mode === "voice" || b.mode === "dictation" ? b.mode : "text";
  return json(await chat(env, text, mode, b.conversation_id, { defer: (p) => ctx.waitUntil(p), files }));
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
  if (!env.OPENAI_API_KEY && !env.GROQ_API_KEY) throw new HttpError(501, "server transcription not configured");
  const form = await req.formData();
  const audio = form.get("audio");
  if (!audio || typeof audio === "string") throw new HttpError(400, "audio file required");
  if (audio.size > 24 * 1024 * 1024) throw new HttpError(413, "audio too large");
  const t0 = Date.now();
  const data = await transcribeAudio(env, audio, audio.name || "dictation.webm").catch((e) => { throw new HttpError(502, (e as Error).message); });
  const groq = data.via === "groq";
  // How long transcription takes (for tuning; last 20 kept).
  try {
    const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'transcribe_ms'");
    const list = (row ? JSON.parse(row.value) : []) as { ms: number; kb: number }[];
    list.unshift({ ms: Date.now() - t0, kb: Math.round(audio.size / 1024), via: groq ? "groq" : "openai" } as never);
    await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('transcribe_ms', ?)", JSON.stringify(list.slice(0, 20)));
  } catch { /* timing only */ }
  return json({ text: data.text });
});

route('GET','/api/assistant/brief',async(req,env)=>{const q=new URL(req.url).searchParams,c=q.get('category');if(c&&!['coffee','yeshiva','personal'].includes(c))throw new HttpError(400,'Unknown category.');return json(await assistantTaskBrief(env,c,Number(q.get('limit'))||12));});
// ---- Items -----------------------------------------------------------------
route("GET", "/api/items", async (req, env) => {
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  for (const key of ["kind", "status", "project_id", "category"]) {
    const v = q.get(key);
    if(key==="project_id"&&v==="none"){where.push("project_id IS NULL");continue;}
    if (v && v !== "all") (where.push(`${key} = ?`), binds.push(v));
  }
  const sql = `SELECT * FROM items ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY status = 'open' DESC, CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, priority, created_at DESC LIMIT 300`;
  return json(await all<Item>(env, sql, ...binds));
});
route('GET', '/api/recurring-reminders', async (_req, env) => { await syncRecurringReminders(env); return json(await recurringReminders(env)); });
route('POST', '/api/recurring-reminders', async (req, env) => json(await saveRecurringReminder(env, await body(req))));
route("POST", "/api/items", async (req, env) => json(await createItem(env, await body(req)), 201));
route("PATCH", "/api/items/:id", async (req, env, [id]) => json(await updateItem(env, id, await body(req))));
// Deleting from the UI is the user's own explicit action, so no approval round-trip.
route("DELETE", "/api/items/:id", async (_req, env, [id]) => {
  const gone = await first<{ project_id: string | null }>(env, "SELECT project_id FROM items WHERE id = ?", id);
  await run(env, "DELETE FROM items WHERE id = ?", id);
  await syncProject(env, gone?.project_id);
  return json({ ok: true });
});

// ---- Projects --------------------------------------------------------------
route("GET", "/api/projects", async (_req, env) =>
  json(await all<Project>(env, `SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id AND i.status='open') AS open_count
     FROM projects p ORDER BY p.status='active' DESC, p.updated_at DESC`)));
route("POST", "/api/projects/organize",async (_req,env)=>json(await organizeProjects(env,{force:true})));
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
route("POST", "/api/projects/:id/celebrated", async (_req, env, [id]) => {
  await run(env, "UPDATE projects SET celebrate_at = NULL WHERE id = ?", id);
  return json({ ok: true });
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
    env.DB.prepare("DELETE FROM contact_groups WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
});
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
route("POST", "/api/push/state", async (req, env) => {
  const body = await req.json().catch(() => ({})) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((id): id is string => typeof id === "string" && id.length <= 100))].slice(0,100) : [];
  const active_ids=await activeNotificationIds(env,ids);
  const updates=active_ids.length ? await all<{id:string;title:string;body:string;revision:number}>(env,
    `SELECT id,title,body,revision FROM nudges WHERE id IN (${active_ids.map(()=>"?").join(",")})
      AND type IN ('digest','sweep','situation','wrapup')`,...active_ids) : [];
  return json({active_ids,updates});
});
route("POST", "/api/nudges/:id/dismiss", async (_req, env, [id]) => {
  await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", id);
  return json({ ok: true });
});
route('GET', '/api/shopping', async (_req, env) => json(await shoppingState(env)));
route('POST', '/api/shopping/lists', async (req, env) => json(await saveShoppingList(env, await body(req))));
route('DELETE', '/api/shopping/lists/:id', async (_req, env, [id]) => json(await deleteShoppingList(env, id)));
route('POST', '/api/shopping/items', async (req, env) => {
  const b = await body<{ list?: string; items: { name: string; quantity?: string; notes?: string }[] }>(req);
  return json(await addShoppingItems(env, b.list, b.items));
});
route('PATCH', '/api/shopping/items/:id', async (req, env, [id]) => json(await updateShoppingItem(env, id, await body(req))));
route('DELETE', '/api/shopping/items/:id', async (_req, env, [id]) => json(await deleteShoppingItem(env, id)));
route('POST', '/api/shopping/config', async (req, env) => json(await saveShoppingConfig(env, await body(req))));
route("GET", "/api/whatsapp/chats", async (_req, env) => json(await knownChats(env)));
route("POST", "/api/people/:id/whatsapp", async (req, env, [id]) => {
  const b = await body<{ chat?: string }>(req);
  if (!b.chat) throw new HttpError(400, "chat required");
  return json(await linkWhatsapp(env, id, b.chat));
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

// ---- Replies: consolidated catch-up ------------------------------------------------
route('POST','/api/replies/batch',async(req,env)=>{try{return json(await batchReplyInstructions(env,await body(req)));}catch(e){throw new HttpError(400,(e as Error).message);}});
route('PUT','/api/replies/:id/draft',async(req,env,[id])=>{const b=await body<{text:string}>(req);return json(await saveReplyDraft(env,id,b.text??''));});
route('POST','/api/replies/:id/dismiss',async(_req,env,[id])=>json(await dismissReply(env,id)));
route('POST','/api/replies/:id/replied',async(_req,env,[id])=>json(await markWhatsAppReplied(env,id)));
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

// ---- Search everything ----------------------------------------------------------
route("GET", "/api/search", async (req, env) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return json({ q, items: [], memories: [], people: [], conversations: [], projects: [], events: [] });
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const [items, memLike, memFts, people, conversations, projects, events] = await Promise.all([
    all<Item>(env, `SELECT * FROM items WHERE title LIKE ? OR notes LIKE ? OR person LIKE ?
      ORDER BY status = 'open' DESC, updated_at DESC LIMIT 25`, like, like, like),
    all<Memory>(env, "SELECT * FROM memories WHERE content LIKE ? ORDER BY updated_at DESC LIMIT 15", like),
    recallMemories(env, q, 15),
    findPeople(env, q, 10),
    all(env, `SELECT m.conversation_id, c.title, m.role, m.content, m.created_at FROM messages m
      LEFT JOIN conversations c ON c.id = m.conversation_id WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT 15`, like),
    all<Project>(env, "SELECT * FROM projects WHERE name LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT 8", like, like),
    all<CalendarEvent>(env, `SELECT id, summary, start_at, end_at, all_day, location, html_link FROM calendar_events
      WHERE summary LIKE ? OR location LIKE ? GROUP BY summary, start_at ORDER BY start_at LIMIT 10`, like, like),
  ]);
  const seen = new Set<string>();
  const memories = [...memLike, ...memFts].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, 15);
  return json({ q, items, memories, people, conversations, projects, events });
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
route("POST", "/api/proactive/run", async (_req, env) => json(await runProactive(env)));
route("POST", "/api/actions/:id/:decision", async (_req, env, [id, decision]) => json(await decidePendingAction(env, id, decision)));
route("GET", "/api/approvals", async (_req, env) => json(await (await import("./approvals")).listApprovals(env)));
route("POST", "/api/approvals/:source/:id/:decision", async (_req, env, [source, id, decision]) => json(await (await import("./approvals")).decideApproval(env, source, id, decision)));

// ---- Settings, usage, notifications foundation ------------------------------
route("GET", "/api/settings", async (_req, env) => json(await getSettings(env)));
route("POST", "/api/client-error", async (req, env) => {
  const e = await body<Record<string, unknown>>(req);
  const row = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'client_errors'");
  const list = (row ? JSON.parse(row.value) : []) as unknown[];
  list.unshift({ at: now(), ...e });
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('client_errors', ?)", JSON.stringify(list.slice(0, 20)));
  return json({ ok: true });
});
route("PUT", "/api/settings", async (req, env) => json(await saveSettings(env, await body(req))));
route("GET", "/api/usage", async (req, env) =>
  json(await all(env, `SELECT model, purpose, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cached_tokens) AS cached_tokens
     FROM usage_log WHERE created_at >= ? GROUP BY model, purpose ORDER BY input_tokens DESC`,
    new URL(req.url).searchParams.get("since") || "0000")));
route("POST", "/api/push/subscribe", async (req, env) => {
  const sub = await body<{ endpoint?: string }>(req);
  if (!sub.endpoint) throw new HttpError(400, "endpoint required");
  await run(env, "INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?)",
    sub.endpoint, JSON.stringify(sub), now());
  return json({ ok: true });
});
route("GET", "/api/push/key", async (_req, env) => json({ key: pushConfigured(env) ? env.VAPID_PUBLIC_KEY : null }));
route("POST", "/api/push/test", async (_req, env) =>
  json(await sendPush(env, { force: true, title: "Notifications are on", body: "This is how your reminders will arrive.", url: "/?tab=today", tag: "test" })));
// ---- Google (Calendar + Gmail) ---------------------------------------------
route("GET", "/api/google/status", async (_req, env) => json(await googleStatus(env)));
// ---- Contacts and one-tap WhatsApps (the user sends each one from WhatsApp; the app never sends them) ----
route("GET", "/api/hashgacha/autopilot", async (_req, env) => json(await autopilotPreview(env)));
route("PUT", "/api/hashgacha/autopilot", async (req, env) => json(await saveAutopilot(env, await body(req))));
route("GET", "/api/contacts/status", async (_req, env) => json(await contactsStatus(env)));
route("POST", "/api/contacts/sync", async (_req, env) => {
  try { return json(await syncContacts(env)); } catch (e) { throw new HttpError(400, (e as Error).message); }
});
route("GET", "/api/whatsapps", async (_req, env) => json(await openWhatsApps(env)));
route("POST", "/api/whatsapps/:id/opened", async (_req, env, [id]) => { await run(env, "UPDATE wa_drafts SET opened_at = COALESCE(opened_at, ?) WHERE id = ?", now(), id); return json({ ok: true }); });
route("PATCH", "/api/whatsapps/:id", async (req, env, [id]) => {
  const { text } = await body<{ text?: string }>(req);
  if (!String(text ?? "").trim()) throw new HttpError(400, "The message can't be empty.");
  await run(env, "UPDATE wa_drafts SET text = ? WHERE id = ? AND done_at IS NULL", String(text).slice(0, 4000), id);
  return json({ ok: true });
});
route("POST", "/api/whatsapps/:id/done", async (_req, env, [id]) => { await run(env, "UPDATE wa_drafts SET done_at = ? WHERE id = ?", now(), id); return json({ ok: true }); });
route("POST", "/api/whatsapps/batch/:id/done", async (_req, env, [id]) => { await run(env, "UPDATE wa_drafts SET done_at = ? WHERE batch_id = ? AND done_at IS NULL", now(), id); return json({ ok: true }); });
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
    const relay=await chatgptRelayRoute(req,env);if(relay)return relay;
    if(url.origin===HEALTH_ORIGIN&&url.pathname==='/')return Response.redirect(new URL('/daynote/'+url.search,url.origin).toString(),302);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (url.pathname === "/api/health") {
      return json({ ok: true, configured: !!env.COS_ACCESS_TOKEN, model: !!env.OPENAI_API_KEY, transcription: !!env.OPENAI_API_KEY, push: pushConfigured(env) });
    }
    // Google redirects the browser here without our bearer token; the single-use state is the check.
    if(url.pathname.startsWith('/api/daynote/android-device/'))return androidDeviceRoute(env,req);
    if(url.pathname === '/api/daynote/sign-in')return redeemDaynoteLogin(env,req);
    if(url.pathname === "/api/daynote/whoop/callback" && req.method === "GET") return finishWhoopAuth(env,req);
    if (url.pathname === "/api/daynote/google/callback" && req.method === "GET") return finishHealthAuth(env,req);
    if (url.pathname === "/api/google/callback" && req.method === "GET") return finishGoogleAuth(env, req);
    // Outside agents (Codex, Claude Code): ask the computer helper for a job and check on it. Every job waits for
    // the user's Allow on their phone. Their own key, never the app passcode.
    // A Claude plan run sends its answer here, to the one-time link it was given for that run.
    const reply = url.pathname.match(/^\/api\/runs\/([\w-]+)\/result$/);
    if (reply && req.method === "POST") return json(await replyWithToken(env, reply[1], url.searchParams.get("k") ?? "", (await req.json().catch(() => ({}))) as Parameters<typeof replyWithToken>[3]));
    if (url.pathname.startsWith("/api/agent/")) {
      const key = req.headers.get("x-agent-key") ?? "";
      if (!env.AGENT_KEY || !safeEqual(key, env.AGENT_KEY)) return json({ error: "unauthorised" }, 401);
      if (url.pathname === "/api/agent/helper-jobs" && req.method === "POST") {
        const b = (await req.json().catch(() => ({}))) as { instruction?: string; start_url?: string; from?: string;target_account?:string };
        try { return json(await createJob(env, { instruction: String(b.instruction ?? ""), start_url: b.start_url,target_account:b.target_account, source: String(b.from || "An outside agent").replace(/^you$/i, "An outside agent") })); }
        catch (e) { return json({ error: (e as Error).message }, 400); }
      }
      try{
      const healthAIResponse=await healthAIRunnerRoute(req,env);if(healthAIResponse)return json(healthAIResponse);
      if(url.pathname==='/api/agent/health/sync'&&req.method==='POST')return json(await healthSync(env,true,true,url.searchParams.get('history_days')==='28'?28:7));
      if(url.pathname==='/api/agent/alumni-visits/status'&&req.method==='GET')return json(await alumniStatus(env,url.searchParams.get('probe')==='1'));
      if(url.pathname==='/api/agent/alumni-visits/write-check/prepare'&&req.method==='POST')return json(await prepareAlumniWriteCheck(env));
      if(url.pathname==='/api/agent/alumni-visits/write-check/confirm'&&req.method==='POST'){const p=await req.json() as {approval_id?:string};return json(await confirmAlumniWriteCheck(env,String(p.approval_id??'')));}
      const alumniDecision=url.pathname.match(/^\/api\/agent\/alumni-visits\/([a-f0-9]{64})\/decision$/);
      if(alumniDecision&&req.method==='POST')return json(await decideAlumni(env,alumniDecision[1],await req.json()));
      if(url.pathname==='/api/agent/alumni-visits/backfill'&&req.method==='POST')return json(await backfillAlumniInbox(env));
      if(url.pathname==='/api/agent/alumni-visits/process'&&req.method==='POST'){await processAlumni(env);return json(await alumniStatus(env));}
      const agentChatResponse=await agentChatsRoute(req,env);if(agentChatResponse)return agentChatResponse;
      if(url.pathname.startsWith('/api/agent/cos/')){
        const target='/api/'+url.pathname.slice('/api/agent/cos/'.length);
        const allowed=(req.method==='GET'&&/^\/api\/(dashboard|items|projects|memories|replies|areas|assistant\/brief)$/.test(target))||(['POST','PATCH'].includes(req.method)&&/^\/api\/(items|projects)(?:\/[^/]+)?$/.test(target)&&!target.endsWith('/organize'));
        if(!allowed)return json({error:'This operation is not available to the agent records API. Use the normal approval workflow.'},403);
        const internal=new URL(req.url);internal.pathname=target;
        for(const [method,re,handler] of routes){const match=target.match(re);if(match&&method===req.method){const result=await handler(new Request(internal,req),env,match.slice(1).map(decodeURIComponent),ctx);const headers=new Headers(result.headers);headers.set('cache-control','private, no-store');return new Response(result.body,{status:result.status,headers});}}
        return json({error:'Record endpoint not found.'},404);
      }
      }catch(e){return json({error:e instanceof HttpError?e.message:'Agent request failed.'},e instanceof HttpError?e.status:500);}
      if(url.pathname==='/api/agent/jobs' && req.method==='GET')return json(await listJobChats(env));
      const jobContextMatch=url.pathname.match(/^\/api\/agent\/jobs\/([\w-]+)\/context$/);
      if(jobContextMatch && req.method==='GET')return json(await jobContext(env,jobContextMatch[1]));
      if(jobContextMatch && req.method==='POST'){await refreshBrief(env,jobContextMatch[1]);return json(await jobContext(env,jobContextMatch[1]));}
      // Jobs: the Codex runner on the home computer takes Codex runs (and reports the plan's usage);
      // the runner and the Claude Code task send each run's answer back.
      if (url.pathname === "/api/agent/codex/next" && req.method === "POST") return json(await nextCodexRun(env, (await req.json().catch(() => ({}))) as Parameters<typeof nextCodexRun>[1]));
      const rm = url.pathname.match(/^\/api\/agent\/runs\/([\w-]+)\/result$/);
      if (rm && req.method === "POST") return json(await runResult(env, rm[1], (await req.json().catch(() => ({}))) as Parameters<typeof runResult>[2]));
      // The coffee production outlook (read-only), as Chief of Staff sees it.
      if (url.pathname === "/api/agent/coffee/outlook" && req.method === "POST") { const { hubCall } = await import("./hub"); return json(await hubCall(env, "outlook")); }
      const am = url.pathname.match(/^\/api\/agent\/helper-jobs\/([^/]+)$/);
      if (am && req.method === "GET") { const j = (await listJobs(env)).find((x) => x.id === am[1]); return j ? json({ id: j.id, status: j.status, question: j.question, result: j.result }) : json({ error: "not found" }, 404); }
      return json({ error: "not found" }, 404);
    }
    // Desktop WhatsApp bridge: its own key, its own three routes.
    if (url.pathname.startsWith("/api/bridge/")) {
      if (!bridgeAuthorised(req, env)) return json({ error: "unauthorised" }, 401);
      if (url.pathname === '/api/bridge/shopping' && req.method === 'GET') return json(await shoppingConfig(env));
      if (url.pathname === '/api/bridge/shopping' && req.method === 'POST') return json(await captureShopping(env, await req.json()));
      if (url.pathname === "/api/bridge/incoming" && req.method === "POST") return json(await handleIncoming(env, await req.json()));
      if (url.pathname === "/api/bridge/diag" && req.method === "POST") {
        const raw = (await req.json().catch(() => ({}))) as { account?: string };
        const key = raw.account === "business" ? "addon_diag_business" : "addon_diag";
        await run(env, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(raw).slice(0, 2000));
        return json({ ok: true });
      }
      if (url.pathname === "/api/bridge/trackers" && req.method === "GET") {
        return json(await bridgeWatches(env, url.searchParams.get("account") === "business" ? "business" : "personal"));
      }
      if (url.pathname === "/api/bridge/track" && req.method === "POST") return json(await capture(env, await req.json()));
      if (url.pathname === "/api/bridge/chats" && req.method === "POST") {
        const b = (await req.json().catch(() => ({}))) as { account?: string; names?: string[] };
        return json(await saveChatNames(env, b.account === "business" ? "business" : "personal", Array.isArray(b.names) ? b.names : []));
      }
      const bf = url.pathname.match(/^\/api\/bridge\/trackers\/([\w-]+)\/backfilled$/);
      if (bf && req.method === "POST") {
        const b = (await req.json().catch(() => ({}))) as { account?: string };
        await markBackfilled(env, bf[1], b.account === "business" ? "business" : "personal");
        return json({ ok: true });
      }
      // Computer helper (only extensions with the helper switched on ask for jobs).
      if (url.pathname === "/api/bridge/helper/next" && req.method === "POST") { const b = (await req.json().catch(() => ({}))) as { device?: string;account?:string }; return json(await nextJob(env, String(b.device ?? "computer").slice(0, 60),b.account)); }
      const hm = url.pathname.match(/^\/api\/bridge\/helper\/([^/]+)\/(step|finish|status)$/);
      if (hm && hm[2] === "status") return json(await jobStatus(env, hm[1]));
      if (hm && hm[2] === "step" && req.method === "POST") return json(await nextAction(env, hm[1], await req.json()));
      if (hm && hm[2] === "finish" && req.method === "POST") return json(await finishJob(env, hm[1], await req.json()));
      if (url.pathname === "/api/bridge/selfnote" && req.method === "POST") return json(await saveSelfNote(env, await req.json()));
      // Older add-ons still post conversations here; meeting detection is gone.
      if (url.pathname === "/api/bridge/convo" && req.method === "POST") return json({ ok: true, disabled: true, agreed: false });
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

    if(url.pathname.startsWith('/api/daynote/')){try{return await daynoteRoute(req,env);}catch(e){return json({error:e instanceof HttpError?e.message:'Daynote could not finish this request. Your local answers are kept.'},e instanceof HttpError?e.status:500);}}
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

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Every 5 minutes: jobs (start what's due, collect results). Everything else keeps its 15-minute rhythm
    // (one schedule: the account allows no more).
    ctx.waitUntil(tickJobs(env).catch((e) => console.error("jobs", e)));
    // New approvals buzz the phone once; the cards live on Today.
    ctx.waitUntil(import("./approvals").then((a) => a.announceApprovals(env)).catch((e) => console.error("approvals", e)));
    // Reminders and due times the user set: every 5 minutes, so they arrive on time.
    ctx.waitUntil(runProactive(env, { remindersOnly: true }).catch((e) => console.error("reminders", e)));
    if (new Date(event.scheduledTime).getUTCMinutes() % 15 >= 5) return;
    ctx.waitUntil(healthSync(env).catch(()=>{}));
    ctx.waitUntil(import("./broken").then((b) => b.checkBroken(env)).catch((e) => console.error("broken check", e)));
    ctx.waitUntil(syncWhoop(env).catch(()=>{}));
    ctx.waitUntil(healthReminders(env).catch(()=>{}));
    // Pull Google first so new emails and meetings are in place before reminders.
    ctx.waitUntil(syncHashgacha(env).catch(e=>console.error('hashgacha',e)).then(()=>runHashgachaAutopilot(env)).catch(e=>console.error('hashgacha autopilot',e)).then(()=>syncGoogle(env)).catch((e) => console.error("google sync", e)).then(() => runProactive(env))
      .then(() => organizeProjects(env)).catch(e=>console.error("project organization",e))
      .then(() => archiveFinishedProjects(env)).catch((e) => console.error("projects", e))
      .then(() => syncContactsDaily(env)).catch((e) => console.error("contacts", e))
      .then(() => processPendingShopping(env)).catch((e) => console.error('shopping', e))
      .then(() => scanNewWatches(env)).catch((e) => console.error("watches", e))
      .then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

/**
 * Reminders that list to-dos stay current: finished items drop off, and a block reminder disappears
 * once everything in it is done.
 */
async function liveNudges(env: Env, nudges: (Nudge & { item_ids?: string | null })[]) {
  const attention=await attentionState(env);
  const out: (Nudge & { items?: { id: string; title: string; person: string | null; due_at?: string | null }[] })[] = [];
  for (const n of nudges) {
    if (n.item_ids) {
      let ids: string[] = [];
      try { ids = JSON.parse(n.item_ids); } catch { /* none */ }
      const open = ids.length ? await all<{ id: string; title: string; person: string | null; due_at: string | null; project_id: string | null; project: string | null }>(env,
        `SELECT i.id, i.title, i.person, i.due_at, i.project_id, p.name AS project FROM items i LEFT JOIN projects p ON p.id = i.project_id
          WHERE i.status = 'open' AND i.id IN (${ids.map(() => "?").join(",")})`, ...ids) : [];
      const ordered = ids.map((id) => open.find((o) => o.id === id))
        .filter((o) => o && actionableNoticeItem(attention.items.get(o.id)!,n,attention)) as typeof open;
      const note = n.body.split("\n").filter((l) => l.startsWith("📝"));
      if (!ordered.length && !note.length) { await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", n.id); continue; }
      out.push({
        ...n, items: ordered,
        title: n.title.replace(/\d+ things?( for now)?/, `${ordered.length} thing${ordered.length > 1 ? "s" : ""}$1`),
        body: [...note, ...ordered.map((i) => `• ${i.title}${i.person ? ` (${i.person})` : ""}`)].join("\n"),
      });
      continue;
    }
    out.push(n);
  }
  return out;
}

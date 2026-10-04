import type { CalendarEvent, Conversation, Dashboard, Item, Memory, Message, Nudge, PendingAction, Project } from "../shared/types";
import type { Env } from "./env";
import { ProviderUnavailable } from "./ai";
import { chat, executeApproved } from "./assistant";
import { processBrainDump } from "./braindump";
import {
  HttpError, all, createItem, createProject, endOfLocalDay, first, getSettings, now, run, saveSettings, updateItem,
} from "./db";
import { runProactive } from "./proactive";
import { actionsFor, applyAction, verifyNudge } from "./actions";
import { pushConfigured, sendPush } from "./push";
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

type Handler = (req: Request, env: Env, params: string[]) => Promise<Response>;
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
    all<Nudge>(env, `SELECT * FROM nudges WHERE dismissed=0 ORDER BY created_at DESC LIMIT 20`),
    all<PendingAction>(env, `SELECT * FROM pending_actions WHERE status='pending' ORDER BY created_at DESC`),
    all<Project>(env, `SELECT p.*, (SELECT COUNT(*) FROM items i WHERE i.project_id=p.id AND i.status='open') AS open_count
                       FROM projects p WHERE p.status='active' ORDER BY p.updated_at DESC LIMIT 6`),
    all<{ kind: string; n: number }>(env, `SELECT kind, COUNT(*) AS n FROM items WHERE status='open' GROUP BY kind`),
    all<CalendarEvent>(env, `SELECT id, summary, start_at, end_at, all_day, location, html_link FROM calendar_events
       WHERE (all_day = 0 AND start_at >= ? AND start_at < ?) OR (all_day = 1 AND start_at <= ? AND end_at > ?)
       GROUP BY summary, start_at ORDER BY all_day DESC, start_at`, startOfDay, endOfDay, localDate, localDate),
  ]);
  const data: Dashboard = {
    today, overdue, waiting, pending, projects, events,
    nudges: nudges.map((n) => ({ ...n, actions: actionsFor(n) })),
    counts: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
  };
  return json(data);
});

// ---- Chat (text, live voice and dictation share one conversation) -----------
route("GET", "/api/conversations", async (_req, env) =>
  json(await all<Conversation>(env, "SELECT * FROM conversations ORDER BY last_message_at DESC LIMIT 100")));
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
  json(await all<Memory>(env, "SELECT * FROM memories ORDER BY category, updated_at DESC")));
route("DELETE", "/api/memories/:id", async (_req, env, [id]) => {
  await run(env, "DELETE FROM memories WHERE id = ?", id);
  return json({ ok: true });
});

// ---- Proactive: nudges and approvals ---------------------------------------
route("POST", "/api/nudges/:id/dismiss", async (_req, env, [id]) => {
  await run(env, "UPDATE nudges SET dismissed = 1 WHERE id = ?", id);
  return json({ ok: true });
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
  json(await all(env, `SELECT model, purpose, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
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
route("POST", "/api/google/sync", async (_req, env) => json(await syncGoogle(env)));

route("GET", "/api/export", async (_req, env) => {
  const [items, projects, memories, messages] = await Promise.all([
    all(env, "SELECT * FROM items"), all(env, "SELECT * FROM projects"),
    all(env, "SELECT * FROM memories"), all(env, "SELECT * FROM messages ORDER BY created_at"),
  ]);
  return json({ exported_at: now(), items, projects, memories, messages });
});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (url.pathname === "/api/health") {
      return json({ ok: true, configured: !!env.COS_ACCESS_TOKEN, model: !!env.OPENAI_API_KEY, transcription: !!env.OPENAI_API_KEY, push: pushConfigured(env) });
    }
    // Google redirects the browser here without our bearer token; the single-use state is the check.
    if (url.pathname === "/api/google/callback" && req.method === "GET") return finishGoogleAuth(env, req);
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
          return await handler(req, env, m.slice(1).map(decodeURIComponent));
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
    ctx.waitUntil(syncGoogle(env).catch((e) => console.error("google sync", e)).then(() => runProactive(env)).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

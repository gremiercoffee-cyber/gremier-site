/**
 * Google Calendar + Gmail: OAuth, the 15-minute sync, completion detection and drafts.
 *
 * Read-only except for one thing: creating Gmail drafts when the user asks. Nothing here sends mail.
 * Subrequest budget per cron run stays well under the Workers free-plan limit of 50:
 * ~1 token refresh + 1 calendar + 2 thread lists + up to MAX_THREADS thread fetches and model calls.
 */
import type { CalendarEvent, GoogleStatus, Item } from "../shared/types";
import type { Env } from "./env";
import { getProvider } from "./ai";
import { all, createItem, first, getSettings, now, run, updateItem } from "./db";
import { notify } from "./push";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose", // drafts only; this code never calls send
  "https://www.googleapis.com/auth/drive",          // find, read, create and (after approval) share files
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
];
/** Calendar + Gmail are required; Docs/Sheets/Drive are optional per account (added later). */
const CORE_SCOPES = SCOPES.slice(2, 5);
export const WORKSPACE_SCOPES = SCOPES.slice(5);
/** Thread fetches + triage calls per run, shared across accounts to stay under 50 subrequests. */
const THREAD_BUDGET = 12;
const TRIAGE_PURPOSES = ["email_triage", "whatsapp_triage"];

/** Background AI calls made today (UTC) and the daily ceiling. Chat with the user never counts. */
export async function triageBudget(env: Env) {
  const cap = Number(env.AI_DAILY_CAP) || 40;
  const row = await first<{ n: number }>(env,
    `SELECT COUNT(*) AS n FROM usage_log WHERE purpose IN (${TRIAGE_PURPOSES.map(() => "?").join(",")}) AND created_at >= ?`,
    ...TRIAGE_PURPOSES, new Date().toISOString().slice(0, 10));
  return { used: row?.n ?? 0, cap };
}

const BULK_SENDER = /(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletter|bounce|alerts?|newsletters?|marketing)@/i;
const ASKS = /\?|\b(can you|could you|please|let me know|send me|waiting for|when will|need you to)\b/i;

/**
 * Free pre-filter: only mail a real person wrote to the user (or the user's own questions) goes to the model.
 * Returns why a thread was skipped, or null when it deserves an AI look.
 */
function skipReason(m: GMessage, me: string | null, text: string): string | null {
  if (fromMe(m)) return ASKS.test(text) ? null : "user's own message without a question";
  if (BULK_SENDER.test(header(m, "From"))) return "automated sender";
  if (header(m, "List-Unsubscribe") || header(m, "List-Id")) return "mailing list";
  if (/bulk|list|junk/i.test(header(m, "Precedence")) || /auto-/i.test(header(m, "Auto-Submitted"))) return "automated";
  if (me && !header(m, "To").toLowerCase().includes(me.toLowerCase())) return "user only cc'd";
  return null;
}
const MEETING_LEAD_MIN = 45;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GoogleAuthError extends Error {}

export const googleConfigured = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

interface Account {
  email: string; refresh_token: string; access_token: string | null; expires_at: number | null;
  last_sync_at: string | null; last_error: string | null;
}

// ---- Token encryption (AES-GCM, key derived from the client secret) ---------
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function tokenKey(env: Env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`cos-google-token:${env.GOOGLE_CLIENT_SECRET}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env: Env, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(env), enc.encode(plain)));
  return `${b64(iv)}.${b64(ct)}`;
}
async function unseal(env: Env, sealed: string) {
  const [iv, ct] = sealed.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await tokenKey(env), unb64(ct)));
}

// ---- OAuth ---------------------------------------------------------------------
const redirectUri = (req: Request) => new URL("/api/google/callback", req.url).toString();

export async function googleStatus(env: Env): Promise<GoogleStatus> {
  const accounts = await all<Account>(env, "SELECT * FROM google_accounts ORDER BY connected_at");
  const b = await triageBudget(env);
  return {
    configured: googleConfigured(env),
    connected: accounts.length > 0,
    accounts: accounts.map((a) => ({
      email: a.email, last_sync_at: a.last_sync_at, last_error: a.last_error,
      workspace: WORKSPACE_SCOPES.every((s) => ((a as Account & { scopes?: string }).scopes ?? "").includes(s)),
    })),
    ai_used_today: b.used, ai_daily_cap: b.cap,
  };
}

export async function startGoogleAuth(env: Env, req: Request): Promise<string> {
  if (!googleConfigured(env)) throw new GoogleAuthError("Google isn't set up on the server yet.");
  const state = crypto.randomUUID();
  await run(env, "DELETE FROM oauth_states WHERE created_at < ?", new Date(Date.now() - 15 * 60_000).toISOString());
  await run(env, "INSERT INTO oauth_states (state, created_at) VALUES (?, ?)", state, now());
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(req), response_type: "code",
    // select_account so a second or third account can be picked instead of silently reusing the first.
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent select_account", include_granted_scopes: "true", state,
  }).toString();
  return u.toString();
}

/** Public route (Google redirects the browser here). Trust comes from the single-use state. */
export async function finishGoogleAuth(env: Env, req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const back = (result: string) => Response.redirect(new URL(`/?tab=settings&google=${result}`, req.url).toString(), 302);
  const state = q.get("state") ?? "";
  const row = await first<{ created_at: string }>(env, "SELECT created_at FROM oauth_states WHERE state = ?", state);
  await run(env, "DELETE FROM oauth_states WHERE state = ?", state);
  if (!row || Date.now() - new Date(row.created_at).getTime() > 15 * 60_000) return back("expired");
  if (q.get("error") || !q.get("code")) return back(q.get("error") === "access_denied" ? "cancelled" : "blocked");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: q.get("code")!, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(req), grant_type: "authorization_code",
    }),
  });
  if (!res.ok) return back("failed");
  const tok = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; id_token?: string; scope: string };
  if (!tok.refresh_token) return back("failed");
  const granted = tok.scope.split(" ");
  if (!CORE_SCOPES.every((s) => granted.includes(s))) return back("missing_access");
  let email = "";
  try { email = JSON.parse(atob(tok.id_token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? ""; } catch { /* below */ }
  if (!email) return back("failed");

  await run(env,
    `INSERT OR REPLACE INTO google_accounts (email, refresh_token, access_token, expires_at, connected_at, scopes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    email, await seal(env, tok.refresh_token), await seal(env, tok.access_token), Date.now() + tok.expires_in * 1000, now(), tok.scope);
  return back("connected");
}

export async function disconnectGoogle(env: Env, email: string) {
  const a = await first<Account>(env, "SELECT * FROM google_accounts WHERE email = ?", email);
  if (a) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(await unseal(env, a.refresh_token))}`, { method: "POST" });
    } catch { /* best effort */ }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM google_accounts WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM calendar_events WHERE account = ?").bind(email),
    env.DB.prepare("DELETE FROM gmail_threads WHERE account = ?").bind(email),
  ]);
}

export const accountEmails = async (env: Env) =>
  (await all<{ email: string }>(env, "SELECT email FROM google_accounts ORDER BY connected_at")).map((r) => r.email);

export async function accessToken(env: Env, email: string): Promise<string> {
  const a = await first<Account>(env, "SELECT * FROM google_accounts WHERE email = ?", email);
  if (!a || !googleConfigured(env)) throw new GoogleAuthError(`${email} isn't connected.`);
  if (a.access_token && (a.expires_at ?? 0) > Date.now() + 60_000) return unseal(env, a.access_token);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: await unseal(env, a.refresh_token), grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const msg = res.status === 400 ? "Access expired. Tap Reconnect." : `Google sign-in failed (${res.status}).`;
    await run(env, "UPDATE google_accounts SET last_error = ? WHERE email = ?", msg, email);
    throw new GoogleAuthError(msg);
  }
  const tok = (await res.json()) as { access_token: string; expires_in: number };
  await run(env, "UPDATE google_accounts SET access_token = ?, expires_at = ? WHERE email = ?",
    await seal(env, tok.access_token), Date.now() + tok.expires_in * 1000, email);
  return tok.access_token;
}

/** Which connected mailbox holds a thread: the synced table knows; otherwise try each account. */
async function accountForThread(env: Env, threadId: string, hint?: string): Promise<{ email: string; token: string }> {
  const emails = await accountEmails(env);
  if (!emails.length) throw new Error("Google isn't connected.");
  const known = hint && emails.includes(hint) ? hint
    : (await first<{ account: string }>(env, "SELECT account FROM gmail_threads WHERE thread_id = ?", threadId))?.account;
  for (const email of known ? [known] : emails) {
    const token = await accessToken(env, email);
    const r = await fetch(`${GMAIL}/threads/${threadId}?format=minimal`, { headers: { authorization: `Bearer ${token}` } });
    if (r.ok) return { email, token };
  }
  throw new Error("That email thread wasn't found in any connected account.");
}

async function gapi<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

// ---- Calendar ----------------------------------------------------------------
interface GEvent {
  id: string; status?: string; summary?: string; location?: string; htmlLink?: string;
  start: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

async function fetchEvents(token: string, timeMin: string, timeMax: string, q?: string): Promise<GEvent[]> {
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "100" });
  if (q) params.set("q", q);
  const r = await gapi<{ items?: GEvent[] }>(token, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`);
  return (r.items ?? []).filter((e) => e.status !== "cancelled" && !e.attendees?.some((a) => a.self && a.responseStatus === "declined"));
}

const toRow = (e: GEvent) => {
  const allDay = !e.start.dateTime;
  return {
    id: e.id, summary: e.summary ?? "(no title)", all_day: allDay ? 1 : 0, location: e.location ?? null, html_link: e.htmlLink ?? null,
    start_at: allDay ? e.start.date! : new Date(e.start.dateTime!).toISOString(),
    end_at: allDay ? e.end?.date ?? null : e.end?.dateTime ? new Date(e.end.dateTime).toISOString() : null,
  };
};

async function syncCalendar(env: Env, token: string, alerts: boolean, account: string) {
  const from = new Date(Date.now() - 86400_000).toISOString();
  const events = (await fetchEvents(token, from, new Date(Date.now() + 14 * 86400_000).toISOString())).map(toRow);
  const t = now();
  const stmts = events.map((e) => env.DB.prepare(
    `INSERT INTO calendar_events (id, account, summary, start_at, end_at, all_day, location, html_link, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, end_at=excluded.end_at, all_day=excluded.all_day,
       location=excluded.location, html_link=excluded.html_link, updated_at=excluded.updated_at,
       reminded_at = CASE WHEN calendar_events.start_at = excluded.start_at THEN calendar_events.reminded_at ELSE NULL END,
       start_at=excluded.start_at`,
  ).bind(`${account}:${e.id}`, account, e.summary, e.start_at, e.end_at, e.all_day, e.location, e.html_link, t));
  // Anything not seen this run was deleted, declined or moved out of the window.
  stmts.push(env.DB.prepare(`DELETE FROM calendar_events WHERE account = ? AND updated_at < ?`).bind(account, t));
  await env.DB.batch(stmts);

  if (!alerts) return events.length;
  const soon = await all<CalendarEvent & { reminded_at: string | null }>(env,
    `SELECT * FROM calendar_events WHERE hidden = 0 AND all_day = 0 AND reminded_at IS NULL AND start_at > ? AND start_at <= ?`,
    t, new Date(Date.now() + MEETING_LEAD_MIN * 60_000).toISOString());
  const { timezone } = await getSettings(env);
  for (const e of soon) {
    // The same meeting can sit in two connected calendars: alert once, mark every copy.
    const twins = await all<{ id: string }>(env, "SELECT id FROM calendar_events WHERE summary = ? AND start_at = ?", e.summary, e.start_at);
    if ((await first(env, "SELECT 1 FROM calendar_events WHERE summary = ? AND start_at = ? AND reminded_at IS NOT NULL", e.summary, e.start_at))) continue;
    const time = new Date(e.start_at).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
    const mins = Math.max(1, Math.round((new Date(e.start_at).getTime() - Date.now()) / 60_000));
    await notify(env, "event", `${e.summary} at ${time}`, `In ${mins} min${e.location ? ` · ${e.location}` : ""}`, null);
    for (const tw of twins) await run(env, "UPDATE calendar_events SET reminded_at = ? WHERE id = ?", t, tw.id);
  }
  return events.length;
}

// ---- Gmail -------------------------------------------------------------------
interface GPart { mimeType: string; body?: { data?: string }; parts?: GPart[]; headers?: { name: string; value: string }[] }
interface GMessage { id: string; threadId: string; labelIds?: string[]; internalDate: string; snippet: string; payload: GPart }
interface GThread { id: string; historyId: string; messages: GMessage[] }

const header = (m: GMessage, name: string) =>
  m.payload.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const fromMe = (m: GMessage) => !!m.labelIds?.includes("SENT");
const displayName = (addr: string) => addr.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || addr;

function decode(data: string) {
  const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
/** Plain text of a message without quoted history. */
function bodyText(m: GMessage): string {
  const find = (p: GPart): string | null => {
    if (p.mimeType === "text/plain" && p.body?.data) return decode(p.body.data);
    for (const c of p.parts ?? []) { const r = find(c); if (r) return r; }
    if (p.mimeType === "text/html" && p.body?.data) return decode(p.body.data).replace(/<[^>]+>/g, " ");
    return null;
  };
  const text = find(m.payload) ?? m.snippet;
  const lines: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (/^On .+wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l)) break;
    if (!l.startsWith(">")) lines.push(l);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 1500);
}

const TRIAGE_SYSTEM = `You triage email for a busy business owner. You see one email thread and the user's open items.
Reply with JSON only, no prose:
{"action":"none"|"task"|"commitment"|"waiting","title":string,"person":string|null,"due_at":string|null,"priority":1|2|3,"category":"coffee"|"yeshiva"|"personal"|null,"completes":string[]}
- task: the latest message is from someone else and the user personally needs to do something (reply, send, pay, decide, book).
- commitment: the user promised something in this thread that is not yet done.
- waiting: the latest message is FROM THE USER and asks someone else for something they have not delivered yet.
- category: coffee = Gremier Coffee business (orders, deliveries, beans, customers, suppliers); yeshiva = the yeshiva (rabbis, students, classes); personal = family/home/money; null if unsure.
- none: newsletters, receipts, notifications, automated mail, FYI-only, or nothing left to do.
- title: short imperative, e.g. "Reply to Dana about the roaster invoice". person: the other person's name.
- due_at: ISO 8601 only if a date is stated or clearly implied, else null. priority 1 only for urgent or money/customer-critical.
- completes: ids of the user's open items (listed) that this thread shows are clearly finished, e.g. the user sent what they promised. Only when certain; otherwise [].`;

interface Triage { action: string; title?: string; person?: string | null; due_at?: string | null; priority?: number; completes?: string[]; category?: string | null }

async function syncGmail(env: Env, token: string, alerts: boolean, me: string, maxThreads: number) {
  const queries = [
    "in:inbox newer_than:3d -category:promotions -category:social -category:updates -category:forums",
    "in:sent newer_than:3d",
  ];
  const listed = new Map<string, string>();
  for (const q of queries) {
    const r = await gapi<{ threads?: { id: string; historyId: string }[] }>(token, `${GMAIL}/threads?${new URLSearchParams({ q, maxResults: "20" })}`);
    for (const th of r.threads ?? []) listed.set(th.id, th.historyId);
  }
  if (!listed.size) return { threads: 0, created: 0, completed: 0 };

  const known = new Map((await all<{ thread_id: string; history_id: string }>(env,
    `SELECT thread_id, history_id FROM gmail_threads WHERE thread_id IN (${[...listed.keys()].map(() => "?").join(",")})`,
    ...listed.keys())).map((r) => [r.thread_id, r.history_id]));
  const changed = [...listed].filter(([id, h]) => known.get(id) !== h).slice(0, maxThreads);

  let created = 0, completed = 0;
  for (const [threadId] of changed) {
    const th = await gapi<GThread>(token, `${GMAIL}/threads/${threadId}?format=full`);
    const last = th.messages.at(-1)!;
    const other = [...th.messages].reverse().find((m) => !fromMe(m)) ?? last;
    const counterpart = displayName(fromMe(last) ? header(last, "To") : header(last, "From"));
    const subject = header(th.messages[0], "Subject") || "(no subject)";
    const lastAt = new Date(Number(last.internalDate)).toISOString();
    const prev = await first<{ analyzed_msg_id: string | null }>(env, "SELECT analyzed_msg_id FROM gmail_threads WHERE thread_id = ?", threadId);
    await run(env,
      `INSERT INTO gmail_threads (thread_id, account, history_id, last_msg_id, subject, counterpart, last_from_me, last_msg_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET history_id=excluded.history_id, last_msg_id=excluded.last_msg_id, subject=excluded.subject,
         counterpart=excluded.counterpart, last_from_me=excluded.last_from_me, last_msg_at=excluded.last_msg_at, updated_at=excluded.updated_at`,
      threadId, me, th.historyId, last.id, subject, counterpart, fromMe(last) ? 1 : 0, lastAt, now());
    if (prev?.analyzed_msg_id === last.id) continue;

    // 1. Deterministic completion: items born from this thread.
    const linked = await all<Item>(env, "SELECT * FROM items WHERE status = 'open' AND ext_source = 'gmail' AND ext_ref = ?", threadId);
    for (const item of linked) {
      if (lastAt <= item.created_at) continue;
      const replied = fromMe(last) && item.kind !== "waiting";
      const answered = !fromMe(last) && item.kind === "waiting";
      if (!replied && !answered) continue;
      await updateItem(env, item.id, { status: "done" });
      completed++;
      if (alerts) await notify(env, "auto_done", `Done: ${item.title}`,
        replied ? `You replied to ${counterpart}. Tap Undo if it isn't finished.` : `${counterpart} got back to you.`, item.id);
    }

    // 2. Model triage of the latest exchange: skipped when an open item already tracks the thread,
    //    when the free pre-filter says it's not personal mail, or when today's AI budget is spent.
    const stillTracked = await first(env, "SELECT 1 FROM items WHERE status = 'open' AND ext_source = 'gmail' AND ext_ref = ?", threadId);
    if (stillTracked || skipReason(last, me, bodyText(last))) {
      await run(env, "UPDATE gmail_threads SET analyzed_msg_id = ? WHERE thread_id = ?", last.id, threadId);
      continue;
    }
    const budget = await triageBudget(env);
    if (budget.used >= budget.cap) break; // left unanalyzed; picked up tomorrow while it's still recent
    const openItems = await all<Item>(env, "SELECT id, kind, title, person FROM items WHERE status = 'open' AND kind != 'idea' ORDER BY updated_at DESC LIMIT 40");
    const transcript = th.messages.slice(-3).map((m) =>
      `--- ${fromMe(m) ? "FROM THE USER" : `From ${header(m, "From")}`} to ${header(m, "To")} on ${new Date(Number(m.internalDate)).toISOString()}\n${bodyText(m)}`).join("\n\n");
    let triage: Triage = { action: "none" };
    try {
      const out = await getProvider(env).complete({
        tier: "fast", purpose: "email_triage", system: TRIAGE_SYSTEM, maxTokens: 400,
        prompt: `Now: ${now()}\nSubject: ${subject}\n\n${transcript}\n\nUser's open items:\n${openItems.map((i) => `- ${i.id}: [${i.kind}] ${i.title}${i.person ? ` (${i.person})` : ""}`).join("\n") || "(none)"}`,
      });
      triage = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    } catch (e) {
      console.error("triage failed", threadId, e);
      continue; // leave analyzed_msg_id unset so the next run retries
    }

    for (const id of triage.completes ?? []) {
      const item = openItems.find((i) => i.id === id);
      if (!item) continue;
      await updateItem(env, id, { status: "done" });
      completed++;
      if (alerts) await notify(env, "auto_done", `Looks done: ${item.title}`, `Based on your email "${subject}". Tap Undo if not.`, id);
    }
    // The other side is the user themselves (another connected account, or their own name): not a real "waiting on".
    const own = await accountEmails(env);
    const userName = ((await getSettings(env)).name || "").trim().toLowerCase();
    const otherAddr = (fromMe(last) ? header(last, "To") : header(last, "From")).toLowerCase();
    const who = (triage.person ?? counterpart ?? "").trim().toLowerCase();
    const isSelf = own.some((e) => otherAddr.includes(e.toLowerCase())) || (!!userName && (who === userName || who.split(/\s+/)[0] === userName));
    if (isSelf && triage.action === "waiting") triage.action = "none";
    if (isSelf && triage.person) triage.person = null;
    if (["task", "commitment", "waiting"].includes(triage.action) && triage.title) {
      const item = await createItem(env, {
        kind: triage.action, title: triage.title, person: triage.person ?? (counterpart || null), due_at: triage.due_at ?? null,
        priority: triage.priority, source: "gmail", category: triage.category,
        notes: `Email (${me}): "${subject}"\nhttps://mail.google.com/mail/?authuser=${encodeURIComponent(me)}#all/${threadId}`,
      });
      await run(env, "UPDATE items SET ext_source = 'gmail', ext_ref = ?, ext_account = ? WHERE id = ?", threadId, me, item.id);
      created++;
    }
    await run(env, "UPDATE gmail_threads SET analyzed_msg_id = ? WHERE thread_id = ?", last.id, threadId);
  }
  return { threads: changed.length, created, completed };
}

/** Runs from the cron trigger and from "Sync now", for every connected account. Never throws. */
export async function syncGoogle(env: Env) {
  const emails = await accountEmails(env);
  if (!emails.length) return { skipped: true };
  const alerts = (await getSettings(env)).proactive;
  const perAccount = Math.max(3, Math.floor(THREAD_BUDGET / emails.length));
  const total = { events: 0, threads: 0, created: 0, completed: 0 };
  const errors: string[] = [];
  for (const email of emails) {
    const errs: string[] = [];
    let token: string;
    try { token = await accessToken(env, email); } catch (e) { errors.push(`${email}: ${(e as Error).message}`); continue; }
    try { total.events += await syncCalendar(env, token, alerts, email); } catch (e) { errs.push(`Calendar: ${(e as Error).message}`); }
    try {
      const r = await syncGmail(env, token, alerts, email, perAccount);
      total.threads += r.threads; total.created += r.created; total.completed += r.completed;
    } catch (e) { errs.push(`Gmail: ${(e as Error).message}`); }
    await run(env, "UPDATE google_accounts SET last_sync_at = ?, last_error = ? WHERE email = ?",
      now(), errs.length ? errs.join(" · ").slice(0, 300) : null, email);
    errors.push(...errs.map((x) => `${email}: ${x}`));
  }
  return { ...total, errors };
}

// ---- Assistant helpers -------------------------------------------------------
export async function calendarLookup(env: Env, from: string, to: string, q?: string) {
  const emails = await accountEmails(env);
  if (!emails.length) throw new Error("Google isn't connected.");
  const out = [];
  for (const email of emails) {
    const rows = (await fetchEvents(await accessToken(env, email), new Date(from).toISOString(), new Date(to).toISOString(), q)).map(toRow);
    out.push(...rows.map((r) => ({ ...r, calendar: email })));
  }
  return out.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export async function searchEmail(env: Env, q: string, account?: string) {
  const emails = (await accountEmails(env)).filter((e) => !account || e === account);
  if (!emails.length) throw new Error("Google isn't connected.");
  const out = [];
  for (const email of emails) {
    const r = await gapi<{ threads?: { id: string; snippet: string }[] }>(await accessToken(env, email), `${GMAIL}/threads?${new URLSearchParams({ q, maxResults: "6" })}`);
    out.push(...(r.threads ?? []).map((t) => ({ account: email, thread_id: t.id, snippet: t.snippet })));
  }
  return out;
}

export async function readThread(env: Env, threadId: string, account?: string) {
  const { email, token } = await accountForThread(env, threadId, account);
  const th = await gapi<GThread>(token, `${GMAIL}/threads/${threadId}?format=full`);
  return {
    account: email,
    thread_id: th.id,
    subject: header(th.messages[0], "Subject"),
    messages: th.messages.slice(-6).map((m) => ({
      from: header(m, "From"), to: header(m, "To"), date: new Date(Number(m.internalDate)).toISOString(),
      from_user: fromMe(m), text: bodyText(m),
    })),
  };
}

const mimeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...enc.encode(s)))}?=`);

/** Saves a draft in Gmail. Replies stay in the thread. Never sends. */
export async function createDraft(env: Env, opts: { threadId?: string; to?: string; subject?: string; body: string; account?: string }) {
  let auth: { email: string; token: string };
  if (opts.threadId) auth = await accountForThread(env, opts.threadId, opts.account);
  else {
    const emails = await accountEmails(env);
    const email = opts.account && emails.includes(opts.account) ? opts.account : emails[0];
    if (!email) throw new Error("Google isn't connected.");
    auth = { email, token: await accessToken(env, email) };
  }
  let to = opts.to ?? "", subject = opts.subject ?? "", inReplyTo = "", references = "";
  if (opts.threadId) {
    const th = await gapi<GThread>(auth.token, `${GMAIL}/threads/${opts.threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
    const target = [...th.messages].reverse().find((m) => !fromMe(m)) ?? th.messages.at(-1)!;
    to ||= fromMe(target) ? header(target, "To") : header(target, "Reply-To") || header(target, "From");
    const s = header(th.messages[0], "Subject");
    subject ||= /^re:/i.test(s) ? s : `Re: ${s}`;
    inReplyTo = header(target, "Message-ID");
    references = `${header(target, "References")} ${inReplyTo}`.trim();
  }
  if (!to) throw new Error("Who should the email go to?");
  const lines = [`To: ${to}`, `Subject: ${mimeWord(subject)}`];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${references}`);
  lines.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    btoa(String.fromCharCode(...enc.encode(opts.body))));
  const raw = btoa(String.fromCharCode(...enc.encode(lines.join("\r\n")))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const d = await gapi<{ id: string; message: { threadId: string } }>(auth.token, `${GMAIL}/drafts`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) } }),
  });
  return { draft_id: d.id, from_account: auth.email, to, subject, open_in_gmail: `https://mail.google.com/mail/?authuser=${encodeURIComponent(auth.email)}#drafts` };
}

/** Today's and tomorrow's events for the assistant's context (from the synced table, no API call). */
export async function upcomingEventsText(env: Env, tz: string): Promise<string | null> {
  if (!(await first(env, "SELECT 1 FROM google_accounts"))) return null;
  const evs = await all<CalendarEvent>(env,
    "SELECT * FROM calendar_events WHERE (all_day = 0 AND start_at >= ? AND start_at < ?) OR (all_day = 1 AND start_at <= ? AND end_at > ?) GROUP BY summary, start_at ORDER BY start_at",
    new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 48 * 3600_000).toISOString(),
    new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10));
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" });
  return evs.map((e) => `- ${e.all_day ? `${e.start_at} (all day)` : fmt.format(new Date(e.start_at))}: ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n") || "- (nothing)";
}


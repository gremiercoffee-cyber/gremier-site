/**
 * Invoice watcher for gremiercoffee@gmail.com.
 *
 * Every cron tick (5 min) it scores new mail (Hebrew/English invoice and receipt words, attachment names,
 * invoice-service links, amounts; see shared/invoice-rules.ts). An invoice gets the Gmail label "Invoice ?",
 * a phone push, and an email with two buttons:
 *   ✓ Forward to invoices → forwards it, with its attachments, to gremiercoffee+expenses@gmail.com
 *   ✗ Not an invoice      → labels it "Not invoice"
 * Nothing is forwarded until the owner taps. Watching starts from when it was installed (migration 0091).
 *
 * Not missing anything: all mail is checked (Spam and filtered mail too); each run looks back 2 hours past
 * the last complete run, and every hour it re-checks 3 days; mail that fails is retried; borderline mail goes
 * to an evening summary; if the watcher stops, broken.ts raises an alert.
 */
import type { Env } from "./env";
import { all, first, run } from "./db";
import { accessToken, hasInvoiceScope } from "./google";
import { notify } from "./push";
import { FLAG_AT, INVOICE_ACCOUNT, INVOICE_TO, MAYBE_AT, addressOf, invoiceAmount, invoiceScore, nameOf } from "../shared/invoice-rules";

export const INVOICE_BASE = "https://health.gremiercoffee.co.il";
const LABEL_NAMES = { ask: "Invoice ?", yes: "Invoice ✓", no: "Not invoice" } as const;
type Labels = { ask: string; yes: string; no: string };
const HOUR = 36e5, DAY = 864e5, OVERLAP = 2 * HOUR, SWEEP_DAYS = 3, PER_RUN = 8, NOTIFY_PER_RUN = 4;

export interface Part { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: Part[] }
export interface GMsg { id: string; threadId: string; internalDate: string; labelIds?: string[]; payload: Part }
export interface InvoiceGmail {
  canLabel: boolean;
  list(q: string, pageToken?: string): Promise<{ messages?: { id: string }[]; nextPageToken?: string }>;
  get(id: string): Promise<GMsg | null>;
  attachment(messageId: string, attachmentId: string): Promise<string>; // base64url
  modify(id: string, add: string[], remove: string[]): Promise<void>;
  labels(): Promise<{ id: string; name: string }[]>;
  createLabel(name: string): Promise<{ id: string }>;
  send(mime: string): Promise<{ id: string }>;
}
interface Config { watch_from: number; last_ok: number | null; last_sweep: number | null; last_summary: string | null; labels: string | null; secret: string }
interface Row { message_id: string; thread_id: string; sender: string; sender_name: string | null; subject: string | null; amount: string | null; status: string; in_spam: number; has_doc: number; received_at: number; note_message_id: string | null; notified_at: number | null; decided_at: number | null; reasons: string | null }

// ---- Gmail -----------------------------------------------------------------------
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export async function invoiceGmail(env: Env): Promise<InvoiceGmail> {
  const token = await accessToken(env, INVOICE_ACCOUNT);
  const api = async <T>(path: string, init: RequestInit = {}, base = API): Promise<T> => {
    const res = await fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(25000) });
    if (res.status === 404) return null as T;
    if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as T;
  };
  return {
    canLabel: await hasInvoiceScope(env, INVOICE_ACCOUNT),
    list: (q, pageToken) => api(`/messages?${new URLSearchParams({ q, maxResults: "50", ...(pageToken ? { pageToken } : {}) })}`),
    get: (id) => api(`/messages/${encodeURIComponent(id)}?format=full`),
    attachment: async (m, a) => (await api<{ data: string }>(`/messages/${encodeURIComponent(m)}/attachments/${encodeURIComponent(a)}`)).data,
    modify: async (id, add, remove) => { await api(`/messages/${encodeURIComponent(id)}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }) }); },
    labels: async () => (await api<{ labels?: { id: string; name: string }[] }>("/labels")).labels ?? [],
    createLabel: (name) => api("/labels", { method: "POST", body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }) }),
    // The upload endpoint takes the whole MIME message (up to 35 MB, so big PDFs fit).
    send: (mime) => api("/messages/send?uploadType=media", { method: "POST", headers: { "content-type": "message/rfc822" }, body: mime }, "https://gmail.googleapis.com/upload/gmail/v1/users/me"),
  };
}

// ---- Reading a message -------------------------------------------------------------
const header = (p: Part, name: string) => p.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const utf8 = (s: string) => new TextDecoder().decode(fromB64url(s));
const walk = (p: Part, out: Part[] = []) => { out.push(p); (p.parts ?? []).forEach((x) => walk(x, out)); return out; };
const bodyOf = (p: Part, mime: string) => walk(p).filter((x) => x.mimeType === mime && x.body?.data && !x.filename).map((x) => utf8(x.body!.data!)).join("\n");
const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<\/(?:tr|p|div|li|h\d)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const attachmentsOf = (p: Part) => walk(p).filter((x) => x.filename && (x.body?.attachmentId || x.body?.data))
  .map((x) => ({ name: x.filename!, type: x.mimeType ?? "application/octet-stream", id: x.body?.attachmentId ?? null, data: x.body?.data ?? null }));
const isDoc = (a: { name: string; type: string }) => /pdf|image\//i.test(a.type) || /\.(pdf|jpe?g|png|webp|heic)$/i.test(a.name);

export function readMessage(m: GMsg) {
  const html = bodyOf(m.payload, "text/html"), plain = bodyOf(m.payload, "text/plain");
  return {
    subject: header(m.payload, "Subject"), from: header(m.payload, "From"), date: header(m.payload, "Date"),
    to: [header(m.payload, "To"), header(m.payload, "Cc"), header(m.payload, "Delivered-To")].join(", "),
    text: plain || stripHtml(html), html, attachments: attachmentsOf(m.payload),
    newsletter: !!(header(m.payload, "List-Unsubscribe") || header(m.payload, "List-Id")),
    spam: (m.labelIds ?? []).includes("SPAM"), received: Number(m.internalDate),
  };
}

// ---- The check ---------------------------------------------------------------------
async function config(env: Env) { return first<Config>(env, "SELECT * FROM invoice_config WHERE id = 1"); }

async function ensureLabels(env: Env, g: InvoiceGmail, cfg: Config): Promise<Labels | null> {
  if (!g.canLabel) return null;
  try { const saved = cfg.labels ? (JSON.parse(cfg.labels) as Labels) : null; if (saved?.ask && saved.yes && saved.no) return saved; } catch { /* rebuild */ }
  const have = await g.labels(), ids = {} as Labels;
  for (const k of Object.keys(LABEL_NAMES) as (keyof Labels)[])
    ids[k] = have.find((l) => l.name === LABEL_NAMES[k])?.id ?? (await g.createLabel(LABEL_NAMES[k])).id;
  await run(env, "UPDATE invoice_config SET labels = ? WHERE id = 1", JSON.stringify(ids));
  return ids;
}

export async function invoiceTick(env: Env, gmail?: InvoiceGmail, at = Date.now()) {
  const cfg = await config(env);
  if (!cfg) return { skipped: "not installed" };
  if (!gmail && !(await first(env, "SELECT 1 FROM google_accounts WHERE email = ?", INVOICE_ACCOUNT))) return { skipped: "Gmail not connected" };
  const g = gmail ?? (await invoiceGmail(env));
  const labels = await ensureLabels(env, g, cfg).catch(() => null);
  const deep = !cfg.last_sweep || at - cfg.last_sweep >= HOUR;
  const since = Math.max(cfg.watch_from, deep ? at - SWEEP_DAYS * DAY : (cfg.last_ok ?? cfg.watch_from) - OVERLAP);
  const q = `in:anywhere -in:sent -in:trash -in:drafts -in:chats -from:me after:${Math.floor(since / 1000)}`;
  let budget = PER_RUN, complete = true, checked = 0, flagged = 0, pageToken: string | undefined;
  pages: do {
    const page = await g.list(q, pageToken);
    const ids = (page.messages ?? []).map((m) => m.id);
    const known = new Set(ids.length ? (await all<{ message_id: string }>(env, `SELECT message_id FROM invoice_mail WHERE message_id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((r) => r.message_id) : []);
    for (const id of ids) {
      if (known.has(id)) continue;
      if (budget-- <= 0) { complete = false; break pages; } // the rest waits for the next run
      try { checked++; if (await consider(env, g, id, labels, cfg, at)) flagged++; }
      catch (e) { complete = false; console.error("invoice check", id, (e as Error).message); }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  if (complete) await run(env, `UPDATE invoice_config SET last_ok = ?${deep ? ", last_sweep = ?" : ""} WHERE id = 1`, ...(deep ? [at, at] : [at]));
  const notified = await notifyPending(env, g, at);
  await eveningSummary(env, g, cfg, at);
  await run(env, "DELETE FROM invoice_mail WHERE status = 'skip' AND created_at < ?", at - 14 * DAY);
  return { checked, flagged, notified, complete, deep };
}

/** Scores one message and records it. Returns true when it was flagged "Invoice ?". */
async function consider(env: Env, g: InvoiceGmail, id: string, labels: Labels | null, cfg: Config, at: number) {
  const m = await g.get(id);
  if (!m) return false;
  const f = readMessage(m), sender = addressOf(f.from);
  const s = await first<{ ok: number; no: number }>(env, "SELECT ok, no FROM invoice_senders WHERE sender = ?", sender);
  const r = f.received < cfg.watch_from ? { score: -99, reasons: ["before the watcher started"] }
    : invoiceScore({ ...f, approvedBefore: s?.ok ?? 0, rejectedBefore: s?.no ?? 0 });
  const status = r.score >= FLAG_AT ? "ask" : r.score >= MAYBE_AT ? "maybe" : "skip";
  if (status === "ask" && labels) // label first: if it fails, the message is retried next run
    await g.modify(id, [labels.ask, ...(f.spam ? ["INBOX"] : [])], f.spam ? ["SPAM"] : []);
  await run(env, `INSERT INTO invoice_mail (message_id, thread_id, sender, sender_name, subject, amount, score, reasons, status, in_spam, has_doc, received_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(message_id) DO NOTHING`,
    id, m.threadId, sender, nameOf(f.from).slice(0, 120), f.subject.slice(0, 300), invoiceAmount(f.subject + "\n" + f.text) || null,
    r.score, r.reasons.join(", "), status, f.spam ? 1 : 0, f.attachments.some(isDoc) ? 1 : 0, f.received || at, at);
  return status === "ask";
}

// ---- Telling the owner ----------------------------------------------------------------
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const b64Lines = (bytes: Uint8Array) => b64(bytes).replace(/.{76}/g, "$&\r\n");
const word = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(new TextEncoder().encode(s))}?=`;
const gmailLink = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;

async function sign(secret: string, action: string, id: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${action}:${id}`)));
  return b64(sig).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function buttons(secret: string, id: string) {
  const link = async (a: string) => `${INVOICE_BASE}/api/invoice/decide?a=${a}&id=${encodeURIComponent(id)}&t=${await sign(secret, a, id)}`;
  return `<a href="${await link("yes")}" style="display:inline-block;background:#1f7a3a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;margin:4px 8px 4px 0">✓ Forward to invoices</a>`
    + `<a href="${await link("no")}" style="display:inline-block;background:#eee;color:#333;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;margin:4px 0">✗ Not an invoice</a>`;
}
async function card(secret: string, r: Row) {
  return `<div style="border:1px solid #ddd;border-radius:12px;padding:12px 14px;margin:10px 0;font-family:Arial,sans-serif">`
    + `<div style="font-size:15px"><b>${esc(r.sender_name || r.sender)}</b>${r.amount ? ` · <b>${esc(r.amount)}</b>` : ""}</div>`
    + `<div dir="auto" style="color:#333;margin:4px 0">${esc(r.subject || "(no subject)")}</div>`
    + `<div style="color:#777;font-size:12px">${r.has_doc ? "📎 PDF/photo attached · " : ""}${r.in_spam ? '<b style="color:#a33">was in Spam</b> · ' : ""}<a href="${gmailLink(r.message_id)}">open the email</a></div>`
    + `<div style="margin-top:8px">${await buttons(secret, r.message_id)}</div></div>`;
}
function mimeHtml(to: string, subject: string, html: string) {
  return [`From: Invoice check <${INVOICE_ACCOUNT}>`, `To: ${to}`, `Subject: ${word(subject)}`, "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", b64Lines(new TextEncoder().encode(html))].join("\r\n");
}

/** Sends the "Invoice?" email and a phone push for flagged mail not told yet (retried until it works). */
async function notifyPending(env: Env, g: InvoiceGmail, at: number) {
  const cfg = (await config(env))!;
  const rows = await all<Row>(env, "SELECT * FROM invoice_mail WHERE status = 'ask' AND notified_at IS NULL ORDER BY received_at LIMIT ?", NOTIFY_PER_RUN);
  for (const r of rows) {
    const title = `🧾 Invoice? ${r.sender_name || r.sender}${r.amount ? " · " + r.amount : ""}`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:560px">${r.in_spam ? '<p style="color:#a33"><b>This one was in Spam.</b> Check it is real before forwarding.</p>' : ""}`
      + `${await card(cfg.secret, r)}<p style="color:#999;font-size:11px">Chief of Staff found this. Nothing is forwarded until you tap.</p></div>`;
    const sent = await g.send(mimeHtml(INVOICE_ACCOUNT, `${title} · ${(r.subject || "").slice(0, 60)}`, html));
    await run(env, "UPDATE invoice_mail SET notified_at = ?, note_message_id = ? WHERE message_id = ?", at, sent?.id ?? null, r.message_id);
    await notify(env, "invoice", title, r.subject || "", null, gmailLink(sent?.id || r.message_id)).catch(() => "");
  }
  return rows.length;
}

/** At 20:00 local: what is still waiting and the borderline "maybe" emails, each with the same buttons. */
async function eveningSummary(env: Env, g: InvoiceGmail, cfg: Config, at: number) {
  const tz = env.TIMEZONE || "Asia/Jerusalem";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (Number(parts.hour) < 20 || cfg.last_summary === today) return;
  await run(env, "UPDATE invoice_config SET last_summary = ? WHERE id = 1", today);
  const waiting = await all<Row>(env, "SELECT * FROM invoice_mail WHERE status = 'ask' AND decided_at IS NULL ORDER BY received_at DESC LIMIT 30");
  const maybe = await all<Row>(env, "SELECT * FROM invoice_mail WHERE status = 'maybe' AND decided_at IS NULL AND created_at >= ? ORDER BY received_at DESC LIMIT 20", at - DAY);
  if (!waiting.length && !maybe.length) return;
  const cards = async (rows: Row[]) => (await Promise.all(rows.map((r) => card(cfg.secret, r)))).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">`
    + (waiting.length ? `<h3>Waiting for you</h3>${await cards(waiting)}` : "")
    + (maybe.length ? `<h3>Maybe (not flagged, worth a glance)</h3>${await cards(maybe)}` : "") + `</div>`;
  await g.send(mimeHtml(INVOICE_ACCOUNT, `🧾 Invoices: ${waiting.length} waiting${maybe.length ? `, ${maybe.length} maybe` : ""}`, html));
}

// ---- The buttons ---------------------------------------------------------------------
function page(text: string, color: string, note = "") {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice check</title>`
    + `<div style="font-family:Arial,sans-serif;text-align:center;padding:48px 16px"><div style="font-size:22px;font-weight:700;color:${color}">${esc(text)}</div>`
    + `${note ? `<p style="color:#555;max-width:420px;margin:12px auto">${esc(note)}</p>` : ""}<p style="color:#888">You can close this tab.</p></div>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

/** Public route: trust comes from the per-message signature in the link (only in the owner's mailbox). */
export async function invoiceDecide(env: Env, req: Request, gmail?: InvoiceGmail, at = Date.now()) {
  const q = new URL(req.url).searchParams, a = q.get("a") ?? "", id = q.get("id") ?? "", t = q.get("t") ?? "";
  const cfg = await config(env);
  if (!cfg || !/^(yes|no)$/.test(a) || !id || t !== (await sign(cfg.secret, a, id))) return page("This link isn't valid.", "#a33");
  const r = await first<Row>(env, "SELECT * FROM invoice_mail WHERE message_id = ?", id);
  if (!r) return page("I don't know this email.", "#a33");
  if (r.decided_at) return page(r.status === "forwarded" ? "Already forwarded to invoices ✓" : "Already marked: not an invoice", "#555");
  const g = gmail ?? (await invoiceGmail(env));
  let note = "";
  if (a === "yes") {
    const m = await g.get(id);
    if (!m) return page("That email is gone (deleted?).", "#a33");
    const hasDoc = await forward(g, m);
    if (!hasDoc) note = "This one has no PDF or photo, so the expense inbox won't file it by itself. It's in the invoices email if you need it.";
  }
  // Claim it before touching labels, so a double tap never forwards twice.
  const claimed = await run(env, "UPDATE invoice_mail SET status = ?, decided_at = ? WHERE message_id = ? AND decided_at IS NULL", a === "yes" ? "forwarded" : "rejected", at, id);
  if (!changed(claimed)) return page("Already done.", "#555");
  await run(env, `INSERT INTO invoice_senders (sender, ok, no) VALUES (?, ?, ?) ON CONFLICT(sender) DO UPDATE SET ok = ok + excluded.ok, no = no + excluded.no`,
    r.sender, a === "yes" ? 1 : 0, a === "yes" ? 0 : 1);
  const labels = await ensureLabels(env, g, cfg).catch(() => null);
  if (labels) await g.modify(id, [a === "yes" ? labels.yes : labels.no], [labels.ask]).catch(() => {});
  if (r.note_message_id) await g.modify(r.note_message_id, [], ["INBOX", "UNREAD"]).catch(() => {}); // tidy the "Invoice?" email away
  return page(a === "yes" ? "Forwarded to invoices ✓" : "OK, not an invoice", a === "yes" ? "#1f7a3a" : "#555", note);
}
const changed = (r: unknown) => Number((r as { meta?: { changes?: number } })?.meta?.changes ?? 1) > 0;

/** Forwards the email with all its attachments. Returns whether it carried a PDF or photo. */
async function forward(g: InvoiceGmail, m: GMsg) {
  const f = readMessage(m), boundary = "inv" + crypto.randomUUID().replace(/-/g, "");
  const head = `<div style="font-family:Arial,sans-serif;color:#555">---------- Forwarded message ---------<br>From: ${esc(f.from)}<br>Date: ${esc(f.date)}<br>Subject: ${esc(f.subject)}<br>To: ${esc(header(m.payload, "To"))}<br><br></div>`;
  const body = head + (f.html || `<pre style="white-space:pre-wrap;font-family:inherit">${esc(f.text)}</pre>`);
  const parts = [`--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64Lines(new TextEncoder().encode(body))}`];
  for (const a of f.attachments) {
    const data = a.data ?? (a.id ? await g.attachment(m.id, a.id) : null);
    if (!data) continue;
    parts.push(`--${boundary}\r\nContent-Type: ${a.type}; name="${word(a.name)}"\r\nContent-Disposition: attachment; filename="${word(a.name)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64Lines(fromB64url(data))}`);
  }
  const mime = [`From: ${INVOICE_ACCOUNT}`, `To: ${INVOICE_TO}`, `Subject: ${word("Fwd: " + f.subject)}`, "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts, `--${boundary}--`, ""].join("\r\n");
  await g.send(mime);
  return f.attachments.some(isDoc);
}

/** For broken.ts: is the watcher running? */
export async function invoiceHealth(env: Env, at = Date.now()) {
  const cfg = await config(env);
  if (!cfg) return null;
  const connected = await first(env, "SELECT 1 FROM google_accounts WHERE email = ?", INVOICE_ACCOUNT);
  return { connected: !!connected, canLabel: connected ? await hasInvoiceScope(env, INVOICE_ACCOUNT) : false, stale: !!connected && at - (cfg.last_ok ?? cfg.watch_from) > 45 * 60_000 };
}

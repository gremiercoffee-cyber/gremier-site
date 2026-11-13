/**
 * Expense intake for gremiercoffee+expenses@gmail.com (suppliers send there directly; the owner forwards there).
 *
 * Every cron tick it files each new email's document into the Gremier expense inbox (Supabase "expense-inbox"):
 *   1. PDF / photo attachments, as they are;
 *   2. otherwise the invoice link(s) in the email (Rivhit, iCount, a supplier's own "view invoice" link ...):
 *      a PDF or photo is filed as it is, a web page is printed to PDF;
 *   3. otherwise the email itself, printed to PDF (receipts that are only the email body).
 * Only document links are opened, never marketing/consent/unsubscribe links (shared/expense-links.ts).
 * The expense inbox then reads it and decides: a Hebrew document without "חשבונית מס" (an order confirmation)
 * is held back; foreign amounts are converted to shekels.
 *
 * Nothing is dropped silently: every email is recorded with what happened; one that cannot be filed is retried,
 * and after the last try the owner gets a phone alert with a link to the email. broken.ts alerts if this stops.
 * The same file arriving twice (e.g. the old Gmail script also sends attachments) is stored once (by its hash).
 */
import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "./env";
import { all, first, run } from "./db";
import { notify } from "./push";
import { invoiceGmail, readMessage, type GMsg, type InvoiceGmail } from "./invoices";
import { INVOICE_TO } from "../shared/invoice-rules";
import { documentLinks, fileKind } from "../shared/expense-links";

export const EXPENSE_ENDPOINT = "https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/expense-inbox";
const HOUR = 36e5, DAY = 864e5, OVERLAP = 2 * HOUR, SWEEP_DAYS = 3, PER_RUN = 4, MAX_TRIES = 4, MAX_BYTES = 20 * 1024 * 1024;

export interface ExpenseDoc { name: string; type: string; bytes: Uint8Array }
export interface IntakeIO {
  /** Opens a document link: the file, or the page printed to PDF. Null if it is neither. */
  fetchLink(url: string): Promise<ExpenseDoc | null>;
  /** Prints an email (HTML) to PDF. */
  printHtml(html: string, name: string): Promise<ExpenseDoc>;
  /** Files one document in the expense inbox; true when stored (or already there). */
  upload(doc: ExpenseDoc, reference: string): Promise<boolean>;
}
interface Config { watch_from: number; last_ok: number | null; last_sweep: number | null }
interface Row { message_id: string; tries: number; status: string }

const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const gmailLink = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;

// ---- The real outside world (browser rendering, web, Supabase) -----------------------------
async function withPage<T>(env: Env, fn: (page: any) => Promise<T>): Promise<T> {
  if (!env.BROWSER) throw new Error("no browser binding");
  const browser = await puppeteer.launch(env.BROWSER as any);
  try { const page = await browser.newPage(); return await fn(page); } finally { await browser.close().catch(() => {}); }
}
const pdfOptions = { format: "A4", printBackground: true, margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" } };

export function liveIO(env: Env): IntakeIO {
  return {
    async fetchLink(url) {
      const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Gremier expense intake)" }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`link ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new Error("linked file over 20 MB");
      const kind = fileKind(bytes), last = decodeURIComponent(new URL(res.url || url).pathname.split("/").pop() || "invoice");
      if (kind) return { name: safeName(last.replace(/\.(pdf|jpe?g|png|webp)$/i, "")) + (kind === "application/pdf" ? ".pdf" : "." + kind.split("/")[1].replace("jpeg", "jpg")), type: kind, bytes };
      if (!/text\/html/i.test(res.headers.get("content-type") || "")) return null;
      // A "view invoice" web page: print it as the browser shows it.
      const pdf = await withPage(env, async (page) => { await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 }); return page.pdf(pdfOptions); });
      return { name: safeName(new URL(url).hostname) + ".pdf", type: "application/pdf", bytes: new Uint8Array(pdf) };
    },
    async printHtml(html, name) {
      const pdf = await withPage(env, async (page) => { await page.setContent(html, { waitUntil: "networkidle0", timeout: 45000 }); return page.pdf(pdfOptions); });
      return { name, type: "application/pdf", bytes: new Uint8Array(pdf) };
    },
    async upload(doc, reference) {
      if (!env.EXPENSE_INGRESS_KEY) throw new Error("expense inbox key missing");
      const form = new FormData();
      form.append("file", new Blob([doc.bytes], { type: doc.type }), doc.name);
      form.append("recipient", INVOICE_TO);
      form.append("reference", reference);
      const res = await fetch(EXPENSE_ENDPOINT, { method: "POST", headers: { "x-expense-ingress": env.EXPENSE_INGRESS_KEY }, body: form, signal: AbortSignal.timeout(60000) });
      const body = await res.json().catch(() => ({})) as { saved?: boolean; error?: string };
      if (!res.ok || !body.saved) throw new Error("expense inbox: " + (body.error || res.status));
      return true;
    },
  };
}

// ---- One email -----------------------------------------------------------------------------
/** The documents in an email, in the order they should be tried. */
export async function documentsOf(g: InvoiceGmail, m: GMsg, io: IntakeIO): Promise<{ docs: ExpenseDoc[]; how: string }> {
  const f = readMessage(m), docs: ExpenseDoc[] = [];
  // 1. Attachments: PDFs, and photos that are not small logos (phone mail apps often attach photos inline).
  for (const a of f.attachments) {
    const isPdf = /pdf/i.test(a.type) || /\.pdf$/i.test(a.name), isImg = /^image\/(jpe?g|png|webp)$/i.test(a.type);
    if (!isPdf && !isImg) continue;
    const data = a.data ?? (a.id ? await g.attachment(m.id, a.id) : null);
    if (!data) continue;
    const bytes = b64ToBytes(data), kind = fileKind(bytes);
    if (!kind || (kind !== "application/pdf" && bytes.length < 15000) || bytes.length > MAX_BYTES) continue;
    docs.push({ name: safeName(a.name || "receipt") , type: kind, bytes });
  }
  if (docs.length) return { docs, how: "attachment" };
  // 2. Invoice links.
  const errors: string[] = [];
  for (const url of documentLinks(f.html, f.text)) {
    try { const d = await io.fetchLink(url); if (d) docs.push(d); } catch (e) { errors.push((e as Error).message); }
    if (docs.length) break; // the first link that gives a document is the invoice
  }
  if (docs.length) return { docs, how: "link" };
  if (errors.length) throw new Error("invoice link could not be opened: " + errors.join("; ").slice(0, 200));
  // 3. The email itself.
  const head = `<div dir="auto" style="font:13px Arial,sans-serif;color:#555;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:12px">`
    + `<b>From:</b> ${esc(f.from)}<br><b>Date:</b> ${esc(f.date)}<br><b>Subject:</b> ${esc(f.subject)}</div>`;
  const body = f.html || `<pre dir="auto" style="white-space:pre-wrap;font:14px Arial,sans-serif">${esc(f.text)}</pre>`;
  if (!f.text.trim() && !f.html.trim()) return { docs: [], how: "empty" };
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">${head}${body}</body>`;
  docs.push(await io.printHtml(html, safeName(f.subject || "email") + ".pdf"));
  return { docs, how: "email" };
}

// ---- The tick -----------------------------------------------------------------------------
async function config(env: Env) { return first<Config>(env, "SELECT * FROM expense_intake_config WHERE id = 1"); }

export async function expenseIntakeTick(env: Env, gmail?: InvoiceGmail, io?: IntakeIO, at = Date.now()) {
  const cfg = await config(env);
  if (!cfg) return { skipped: "not installed" };
  if (!env.EXPENSE_INGRESS_KEY && !io) return { skipped: "no expense inbox key" };
  if (!gmail && !(await first(env, "SELECT 1 FROM google_accounts WHERE email = ?", "gremiercoffee@gmail.com"))) return { skipped: "Gmail not connected" };
  const g = gmail ?? (await invoiceGmail(env)), x = io ?? liveIO(env);
  const deep = !cfg.last_sweep || at - cfg.last_sweep >= HOUR;
  const since = Math.max(cfg.watch_from, deep ? at - SWEEP_DAYS * DAY : (cfg.last_ok ?? cfg.watch_from) - OVERLAP);
  const q = `to:${INVOICE_TO} -in:trash -in:drafts after:${Math.floor(since / 1000)}`;
  let budget = PER_RUN, complete = true, filed = 0, failed = 0, pageToken: string | undefined;
  pages: do {
    const page = await g.list(q, pageToken);
    const ids = (page.messages ?? []).map((m) => m.id);
    const known = new Map((ids.length ? await all<Row>(env, `SELECT message_id, tries, status FROM expense_intake WHERE message_id IN (${ids.map(() => "?").join(",")})`, ...ids) : []).map((r) => [r.message_id, r]));
    for (const id of ids) {
      const k = known.get(id);
      if (k && k.status !== "retry") continue;
      if (budget-- <= 0) { complete = false; break pages; }
      const r = await handle(env, g, x, id, k?.tries ?? 0, at);
      if (r === "filed") filed++; else if (r !== "skip") { failed++; if (r === "retry") complete = false; }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  if (complete) await run(env, `UPDATE expense_intake_config SET last_ok = ?${deep ? ", last_sweep = ?" : ""} WHERE id = 1`, ...(deep ? [at, at] : [at]));
  return { filed, failed, complete, deep };
}

async function handle(env: Env, g: InvoiceGmail, io: IntakeIO, id: string, tries: number, at: number): Promise<"filed" | "skip" | "retry" | "gave_up"> {
  let m: GMsg | null = null, subject = "", sender = "";
  try {
    m = await g.get(id);
    if (!m) return "skip";
    const f = readMessage(m); subject = f.subject; sender = f.from;
    if (f.received < (await config(env))!.watch_from) { await record(env, id, "skip", 0, "before intake started", f, at, tries); return "skip"; }
    const { docs, how } = await documentsOf(g, m, io);
    if (!docs.length) throw new Error("nothing to file (empty email)");
    for (const [n, d] of docs.entries()) await io.upload(d, `cos:${id}:${n}`);
    await record(env, id, "filed", docs.length, how, f, at, tries + 1);
    return "filed";
  } catch (e) {
    const why = (e as Error).message.slice(0, 300), last = tries + 1 >= MAX_TRIES;
    await record(env, id, last ? "gave_up" : "retry", 0, why, m ? readMessage(m) : { subject, from: sender, received: at }, at, tries + 1);
    if (last) await notify(env, "invoice", "Expense email not filed", `${subject || "(no subject)"}: ${why}. Open it and file it by hand.`, null, gmailLink(id)).catch(() => "");
    return last ? "gave_up" : "retry";
  }
}

async function record(env: Env, id: string, status: string, docs: number, detail: string, f: { subject: string; from: string; received: number }, at: number, tries: number) {
  await run(env, `INSERT INTO expense_intake (message_id, sender, subject, status, docs, detail, tries, received_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET status = excluded.status, docs = excluded.docs, detail = excluded.detail, tries = excluded.tries, updated_at = excluded.updated_at`,
    id, String(f.from || "").slice(0, 200), String(f.subject || "").slice(0, 300), status, docs, detail.slice(0, 300), tries, f.received || at, at);
}

/** For broken.ts: is the intake running? */
export async function expenseIntakeHealth(env: Env, at = Date.now()) {
  const cfg = await config(env);
  if (!cfg || !env.EXPENSE_INGRESS_KEY) return null;
  return { stale: at - (cfg.last_ok ?? cfg.watch_from) > 45 * 60_000 };
}

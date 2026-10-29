/**
 * Emails from a research chat (or a chat started just for emailing): "email those suppliers asking for prices".
 *
 * - Codex (on the user's ChatGPT plan, with its Gmail app) writes the emails, looking up missing addresses on the
 *   web or in Gmail. Each one is shown in the chat as #1, #2… with Send / Skip.
 * - Nothing is sent until the user taps Send (or says "send #2" / "send them all"); then Codex sends exactly that
 *   text from their Gmail and reports back the Gmail thread.
 * - Chief of Staff then watches each thread: a reply is posted in the chat (with a notification); no reply in
 *   3 days → "Write a follow-up?". "Who replied?" lists them all. Small rewrites and replies are written here.
 */
import type { Env } from "./env";
import { all, first, getSettings, now, run } from "./db";
import { getProvider } from "./ai";
import { readThread } from "./google";
import { post, queueRun, type Job } from "./jobs";

export interface JobEmail {
  id: string; job_id: string; number: number; to_email: string; to_name: string | null; subject: string; body: string; status: string;
  thread_id: string | null; from_account: string | null; error: string | null; reply_text: string | null; created_at: string;
  sent_at: string | null; replied_at: string | null; checked_at: string | null; nudged_at: string | null;
}
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;
const FOLLOW_UP_DAYS = 3;
/** Replies are looked for this long after sending. */
const WATCH_DAYS = 21;
const CHECK_EVERY_MIN = 15;

const who = (e: Pick<JobEmail, "to_name" | "to_email">) => e.to_name ? `${e.to_name} (${e.to_email})` : e.to_email;
const STATUS: Record<string, string> = { draft: "draft, not sent", sending: "being sent by Codex", sent: "sent, no reply yet", replied: "replied", failed: "didn't send", skipped: "skipped" };

export async function jobEmails(env: Env, jobId: string) {
  return all<JobEmail>(env, "SELECT * FROM job_emails WHERE job_id = ? ORDER BY number", jobId);
}

/** The emails, for the job's assistant to see (so "send #2" and "who replied?" work). */
export async function emailsBrief(env: Env, jobId: string) {
  return (await jobEmails(env, jobId)).map((e) => ({ number: e.number, to: who(e), subject: e.subject, status: e.status, reply: e.reply_text?.slice(0, 300) ?? undefined }));
}

async function sender(env: Env) {
  const s = await getSettings(env) as { name?: string };
  return `${s.name || "the user"}, who runs Gremier Coffee (a cold-brew coffee business in Israel)`;
}
const WRITING = `Write like the user: short, clear, friendly and professional, no fluff. Sign with their first name (and the business only when it's a business email). Language: the one the user asks for; otherwise the recipient's (Hebrew for an Israeli business), else English. Plain text, no markdown.`;

function parse<T>(out: string): T | null {
  try { return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as T; } catch { return null; }
}

/** Shows one email in the chat with its Send / Skip buttons. */
async function show(env: Env, j: Job, e: Pick<JobEmail, "id" | "number" | "to_name" | "to_email" | "subject" | "body">, intro = "", note = "") {
  await post(env, j, `${intro}✉️ **#${e.number} to ${who(e)}**${note}\nSubject: ${e.subject}\n\n${e.body}`,
    [[{ text: `✉️ Send #${e.number}`, data: `esend:${e.id}` }, { text: "Skip", data: `eskip:${e.id}` }]]);
}

async function insert(env: Env, j: Job, d: { to_email: string; to_name?: string | null; subject: string; body: string; thread_id?: string | null; from_account?: string | null }) {
  const n = ((await first<{ n: number }>(env, "SELECT MAX(number) AS n FROM job_emails WHERE job_id = ?", j.id))?.n ?? 0) + 1;
  const e = { id: crypto.randomUUID(), number: n, to_email: d.to_email.trim(), to_name: d.to_name?.trim() || null, subject: d.subject.trim().slice(0, 200), body: d.body.trim().slice(0, 8000) };
  await run(env, "INSERT INTO job_emails (id, job_id, number, to_email, to_name, subject, body, status, thread_id, from_account, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
    e.id, j.id, e.number, e.to_email, e.to_name, e.subject, e.body, d.thread_id ?? null, d.from_account ?? null, now());
  return e;
}

// ---- Codex writes and sends ---------------------------------------------------------------------
/** "Email the suppliers asking for prices": Codex writes them (a run on the Codex plan); they come back as drafts. */
export async function requestDrafts(env: Env, j: Job, ask: string) {
  await queueRun(env, j, { mode: "email_draft", ask });
  return "Codex is writing the emails now. They'll show up here to check, each with a Send button. Nothing is sent before you tap Send.";
}

/** What Codex gets for an email run. */
export async function emailPrompt(env: Env, j: Job, r: { mode?: string | null; ask?: string | null }) {
  if (r.mode === "email_send") {
    const ids = JSON.parse(r.ask ?? "[]") as string[];
    const es = (await jobEmails(env, j.id)).filter((e) => ids.includes(e.id));
    return [
      `The user reviewed these emails in their Chief of Staff app and tapped Send: they asked you to send each one now from their Gmail, exactly as written (same recipient, subject and body; don't change a word). Use the Gmail app's send tool.${es.some((e) => e.thread_id) ? " An email with a thread_id is a reply: send it in that Gmail thread." : ""}`,
      JSON.stringify(es.map((e) => ({ number: e.number, to: e.to_email, subject: e.subject, body: e.body, thread_id: e.thread_id ?? undefined }))),
      `Then reply ONLY with JSON: {"from":"the Gmail address it was sent from","sent":[{"number":1,"message_id":"…","thread_id":"…"}],"failed":[{"number":2,"error":"why"}]} using the ids the tool returned.`,
    ].join("\n\n");
  }
  const runs = await all<{ result: string }>(env, "SELECT result FROM job_runs WHERE job_id = ? AND status = 'done' AND (mode IS NULL OR mode = 'research') AND result IS NOT NULL ORDER BY finished_at DESC LIMIT 2", j.id);
  const chat = await all<{ role: string; text: string }>(env, "SELECT role, text FROM job_messages WHERE job_id = ? ORDER BY created_at DESC LIMIT 20", j.id);
  return [
    `You write emails for ${await sender(env)}. They asked, in their Chief of Staff app: "${r.ask}"`,
    `Write the emails, but DON'T send them and don't create Gmail drafts: they will review each one first. ${WRITING}`,
    `One email per recipient they mean. Use the research and chat below. If an address is missing, look it up (the business's own website, a trusted directory, or their Gmail). Never guess an address: if you can't find it, list the name under "missing".`,
    runs.length ? `THE RESEARCH:\n${runs.map((x) => x.result.slice(0, 6000)).join("\n\n---\n\n")}` : "",
    chat.length ? `THE CHAT (latest last):\n${chat.reverse().map((m) => `${m.role}: ${m.text.slice(0, 600)}`).join("\n")}` : "",
    `Reply ONLY with JSON: {"emails":[{"to_email","to_name","subject","body","address_source":"where you found the address"}],"missing":["names with no address found"]}`,
  ].filter(Boolean).join("\n\n");
}

/** Codex's answer to an email run. */
export async function finishEmailRun(env: Env, j: Job, r: { mode?: string | null; ask?: string | null }, text: string) {
  if (r.mode === "email_send") {
    const v = parse<{ from?: string; sent?: { number?: number; thread_id?: string; message_id?: string }[]; failed?: { number?: number; error?: string }[] }>(text);
    const ids = JSON.parse(r.ask ?? "[]") as string[];
    const es = (await jobEmails(env, j.id)).filter((e) => ids.includes(e.id));
    const lines: string[] = [];
    for (const e of es) {
      const s = v?.sent?.find((x) => Number(x.number) === e.number);
      if (s) {
        await run(env, "UPDATE job_emails SET status = 'sent', sent_at = ?, checked_at = ?, thread_id = COALESCE(?, thread_id), from_account = COALESCE(?, from_account), error = NULL WHERE id = ?",
          now(), now(), s.thread_id || null, v?.from || null, e.id);
        lines.push(`✅ #${e.number} sent to ${who(e)}`);
      } else {
        const why = v?.failed?.find((x) => Number(x.number) === e.number)?.error || (v ? "Codex didn't send it" : `Codex's answer wasn't clear: ${text.slice(0, 150)}`);
        // Back to a draft: one tap sends it again. (Check Gmail's Sent first if it says it wasn't clear.)
        await run(env, "UPDATE job_emails SET status = 'draft', error = ? WHERE id = ?", why.slice(0, 300), e.id);
        await post(env, j, `⚠️ #${e.number} to ${who(e)} didn't send: ${why.slice(0, 200)}`, [[{ text: `Try #${e.number} again`, data: `esend:${e.id}` }]]);
      }
    }
    if (lines.length) await post(env, j, `${lines.join("\n")}\n\nSent by Codex from ${v?.from || "your Gmail"}. I'll tell you when they reply.`, undefined, { push: true });
    return;
  }
  const v = parse<{ emails?: { to_email?: string; to_name?: string; subject?: string; body?: string; address_source?: string }[]; missing?: string[] }>(text);
  if (!v) { await post(env, j, `⚠️ Codex's emails didn't come back in a usable form. Say it again and I'll retry.`); return; }
  const missing = [...(v.missing ?? [])];
  const made = [];
  for (const d of (v.emails ?? []).slice(0, 25)) {
    const to = String(d.to_email ?? "").trim();
    if (!d.subject || !d.body) continue;
    if (!EMAIL_RE.test(to)) { missing.push(d.to_name || to || "someone"); continue; }
    const e = await insert(env, j, { to_email: to, to_name: d.to_name, subject: d.subject, body: d.body });
    made.push(e);
    await show(env, j, e, "", d.address_source ? `\n_Address from: ${d.address_source.slice(0, 120)}_` : "");
  }
  if (made.length > 1) await post(env, j, `${made.length} emails ready. Check them, then send:`, [[{ text: `✉️ Send all ${made.length}`, data: `esendall:${j.id}` }]]);
  const lines = [made.length ? `To change one, just say so (“make #2 shorter”, “ask #1 about delivery too”).` : "Codex didn't write any emails."];
  if (missing.length) lines.push(`No email address found for: ${[...new Set(missing)].join(", ")}.`);
  await post(env, j, lines.join("\n"), undefined, { push: true });
}

/** A failed email run: anything being sent goes back to a draft, so it can be sent again. */
export async function emailRunFailed(env: Env, r: { mode?: string | null; ask?: string | null }) {
  if (r.mode !== "email_send") return;
  for (const id of JSON.parse(r.ask ?? "[]") as string[]) await run(env, "UPDATE job_emails SET status = 'draft' WHERE id = ? AND status = 'sending'", id);
}

/** Send drafts (by id): Codex sends them in one run. A second tap does nothing. */
export async function sendEmails(env: Env, jobId: string, ids: string[]) {
  const j = await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", jobId);
  if (!j) return "That chat isn't there any more.";
  const claimed: string[] = [];
  for (const id of ids) {
    const r = await run(env, "UPDATE job_emails SET status = 'sending' WHERE id = ? AND job_id = ? AND status = 'draft'", id, jobId);
    if (r.meta.changes) { claimed.push(id); await run(env, "UPDATE job_messages SET buttons = NULL WHERE job_id = ? AND buttons LIKE ?", jobId, `%esend:${id}%`); }
  }
  if (!claimed.length) return "There's nothing waiting to be sent.";
  await queueRun(env, j, { mode: "email_send", ask: JSON.stringify(claimed) });
  return `📤 Codex is sending ${claimed.length === 1 ? "it" : `${claimed.length} emails`} now. I'll confirm here.`;
}

export async function sendNumbers(env: Env, jobId: string, numbers: number[]) {
  const ids = (await jobEmails(env, jobId)).filter((e) => e.status === "draft" && (!numbers.length || numbers.includes(e.number))).map((e) => e.id);
  return sendEmails(env, jobId, ids);
}

export async function skipNumbers(env: Env, jobId: string, numbers: number[]) {
  for (const e of (await jobEmails(env, jobId)).filter((x) => x.status === "draft" && (!numbers.length || numbers.includes(x.number)))) {
    await run(env, "UPDATE job_emails SET status = 'skipped' WHERE id = ?", e.id);
    await run(env, "UPDATE job_messages SET buttons = NULL WHERE job_id = ? AND buttons LIKE ?", jobId, `%esend:${e.id}%`);
  }
  return "Okay, those won't be sent.";
}

// ---- Small rewrites and replies, written here ----------------------------------------------------
/** "Make #2 shorter" / "ask them all about delivery too": rewrite drafts that aren't sent yet. */
export async function editEmails(env: Env, j: Job, numbers: number[], ask: string) {
  const drafts = (await jobEmails(env, j.id)).filter((e) => e.status === "draft" && (!numbers.length || numbers.includes(e.number)));
  if (!drafts.length) return "There's no unsent email to change.";
  const out = await getProvider(env).complete({
    tier: "main", purpose: "job_email", json: true, maxTokens: 4000,
    system: `You revise email drafts for ${await sender(env)} as they ask. ${WRITING}\nReply ONLY JSON: {"emails":[{"number","to_email","subject","body"}]} with every draft given, changed as asked (to_email only changes if they give a new address).`,
    prompt: JSON.stringify({ drafts: drafts.map((e) => ({ number: e.number, to_email: e.to_email, to_name: e.to_name, subject: e.subject, body: e.body })), change: ask }),
  });
  const v = parse<{ emails?: { number?: number; to_email?: string; subject?: string; body?: string }[] }>(out);
  if (!v?.emails?.length) return "Sorry, I couldn't change it. Try saying it another way.";
  for (const d of v.emails) {
    const e = drafts.find((x) => x.number === Number(d.number));
    if (!e || !d.body) continue;
    const to = d.to_email && EMAIL_RE.test(d.to_email) && ask.toLowerCase().includes(d.to_email.toLowerCase()) ? d.to_email : e.to_email;
    const next = { ...e, to_email: to, subject: (d.subject || e.subject).slice(0, 200), body: d.body.slice(0, 8000) };
    await run(env, "UPDATE job_emails SET to_email = ?, subject = ?, body = ? WHERE id = ? AND status = 'draft'", next.to_email, next.subject, next.body, e.id);
    // The old card's buttons go; the new version is shown with its own.
    await run(env, "UPDATE job_messages SET buttons = NULL WHERE job_id = ? AND buttons LIKE ?", j.id, `%esend:${e.id}%`);
    await show(env, j, next, "Updated: ");
  }
  return "Updated. Have a look and tap Send when it's right.";
}

/** "Reply to #2: we'll take 500" / a follow-up: a new draft in that email's thread (Codex sends it there). */
export async function replyDraft(env: Env, j: Job, number: number, ask: string) {
  const e = (await jobEmails(env, j.id)).find((x) => x.number === number);
  if (!e?.thread_id) return `#${number} hasn't been sent yet, so there's nothing to reply to.`;
  const th = await readThread(env, e.thread_id, e.from_account ?? undefined).catch(() => null);
  const out = await getProvider(env).complete({
    tier: "main", purpose: "job_email", json: true, maxTokens: 2500,
    system: `You write the next email in an existing email thread for ${await sender(env)}. ${WRITING}\nReply ONLY JSON: {"body":"the email"}`,
    prompt: JSON.stringify({ to: who(e), thread: th?.messages.map((m) => ({ from: m.from_user ? "the user" : m.from, text: m.text.slice(0, 2000) })) ?? [{ from: "the user", text: e.body }], what_to_say: ask }),
  });
  const v = parse<{ body?: string }>(out);
  if (!v?.body) return "Sorry, I couldn't write it. Try again.";
  const d = await insert(env, j, { to_email: e.to_email, to_name: e.to_name, subject: /^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`, body: v.body, thread_id: e.thread_id, from_account: e.from_account });
  await show(env, j, d);
  return `Here's the reply to ${e.to_name || e.to_email}: tap Send when it's right.`;
}

/** "Who replied?": every email and where it stands. */
export async function emailStatus(env: Env, jobId: string) {
  const es = await jobEmails(env, jobId);
  if (!es.length) return "No emails from this chat yet.";
  return `📬 **Emails**\n${es.map((e) => `#${e.number} ${who(e)}: ${STATUS[e.status] ?? e.status}${e.status === "replied" && e.reply_text ? ` · “${e.reply_text.replace(/\s+/g, " ").slice(0, 120)}”` : ""}`).join("\n")}`;
}

/** Cron: look for replies to sent emails (each thread every 15 minutes, for 3 weeks); suggest a follow-up after 3 quiet days. */
export async function checkEmailReplies(env: Env) {
  const due = new Date(Date.now() - CHECK_EVERY_MIN * 60_000).toISOString();
  const since = new Date(Date.now() - WATCH_DAYS * 86_400_000).toISOString();
  for (const e of await all<JobEmail>(env, "SELECT * FROM job_emails WHERE status = 'sent' AND thread_id IS NOT NULL AND sent_at > ? AND (checked_at IS NULL OR checked_at < ?) ORDER BY checked_at LIMIT 15", since, due)) {
    await run(env, "UPDATE job_emails SET checked_at = ? WHERE id = ?", now(), e.id);
    const th = await readThread(env, e.thread_id!, e.from_account ?? undefined).catch(() => null);
    const j = await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", e.job_id);
    if (!th || !j) continue;
    const reply = th.messages.filter((m) => !m.from_user && m.date > e.sent_at!).at(-1);
    if (reply) {
      // Only the new part of their message (not the quoted email below it).
      const text = reply.text.split(/\n(?:On .{5,120}wrote:|-{2,} ?Original Message|בתאריך .{5,120}כתב)/i)[0].trim().slice(0, 1500);
      await run(env, "UPDATE job_emails SET status = 'replied', replied_at = ?, reply_text = ? WHERE id = ?", reply.date, text, e.id);
      await post(env, j, `📩 **${e.to_name || reply.from} replied** (#${e.number}):\n\n${text}\n\nTo answer, say e.g. “reply to #${e.number}: we'll take 500 units”.`, undefined, { push: true });
    } else if (!e.nudged_at && Date.now() - Date.parse(e.sent_at!) > FOLLOW_UP_DAYS * 86_400_000) {
      await run(env, "UPDATE job_emails SET nudged_at = ? WHERE id = ?", now(), e.id);
      await post(env, j, `No reply from ${who(e)} (#${e.number}) in ${FOLLOW_UP_DAYS} days.`, [[{ text: "✍️ Write a follow-up", data: `efollow:${e.id}` }]], { push: true });
    }
  }
}

/** The email buttons: Send, Skip, Send all, Write a follow-up. */
export async function pressEmailButton(env: Env, what: string, id: string) {
  const e = what === "esendall" ? null : await first<JobEmail>(env, "SELECT * FROM job_emails WHERE id = ?", id);
  const j = await first<Job>(env, "SELECT * FROM jobs WHERE id = ?", what === "esendall" ? id : e?.job_id ?? "");
  if (!j) return;
  if (what === "esend" && e) await post(env, j, await sendEmails(env, j.id, [e.id]));
  if (what === "esendall") await post(env, j, await sendNumbers(env, j.id, []));
  if (what === "eskip" && e) await skipNumbers(env, j.id, [e.number]);
  if (what === "efollow" && e) await post(env, j, await replyDraft(env, j, e.number, "A short, polite follow-up: did they see my last email? Ask again for what I asked before."));
}

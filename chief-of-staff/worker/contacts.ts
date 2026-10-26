/**
 * Contacts and one-tap WhatsApps.
 *
 * Contacts: a read-only copy of the user's Google Contacts (where Android phones keep their contacts),
 * refreshed daily, used only to look up people's numbers.
 *
 * One-tap WhatsApps: "send a WhatsApp to X, Y and Z" prepares one message per person with a WhatsApp link.
 * They appear on the Replies page; the user taps each link and presses Send in WhatsApp. The app never
 * sends these itself.
 */
import type { Env } from "./env";
import { CONTACTS_SCOPE, accessToken } from "./google";
import { all, first, now, run, uid } from "./db";

/** Any phone format → digits with country code (Israel assumed for local numbers): "054-123 4567" → 972541234567. */
export function normalizePhone(raw: string): string | null {
  let d = String(raw ?? "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "972" + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = "972" + d;
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Copy Google Contacts (names, phones, emails) from every account that allowed it. */
export async function syncContacts(env: Env) {
  const accounts = await all<{ email: string; scopes: string | null }>(env, "SELECT email, scopes FROM google_accounts");
  const started = now();
  let saved = 0;
  const missing: string[] = [];
  for (const a of accounts) {
    if (!(a.scopes ?? "").includes(CONTACTS_SCOPE)) { missing.push(a.email); continue; }
    const token = await accessToken(env, a.email);
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const u = new URL("https://people.googleapis.com/v1/people/me/connections");
      u.searchParams.set("personFields", "names,phoneNumbers,emailAddresses");
      u.searchParams.set("pageSize", "1000");
      if (pageToken) u.searchParams.set("pageToken", pageToken);
      const res = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Google Contacts ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { connections?: { resourceName: string; names?: { displayName?: string }[]; phoneNumbers?: { value?: string; canonicalForm?: string }[]; emailAddresses?: { value?: string }[] }[]; nextPageToken?: string };
      const rows = (body.connections ?? []).map((c) => ({
        resource: c.resourceName,
        name: c.names?.[0]?.displayName?.trim() || "",
        phones: [...new Set((c.phoneNumbers ?? []).map((p) => normalizePhone(p.canonicalForm || p.value || "")).filter(Boolean))],
        emails: [...new Set((c.emailAddresses ?? []).map((e) => (e.value || "").trim().toLowerCase()).filter(Boolean))],
      })).filter((c) => c.name && (c.phones.length || c.emails.length));
      if (rows.length) await env.DB.batch(rows.map((c) => env.DB.prepare(
        `INSERT INTO contacts (id, account, resource, name, phones, emails, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account, resource) DO UPDATE SET name = excluded.name, phones = excluded.phones, emails = excluded.emails, seen_at = excluded.seen_at`,
      ).bind(uid(), a.email, c.resource, c.name, JSON.stringify(c.phones), JSON.stringify(c.emails), started)));
      saved += rows.length;
      pageToken = body.nextPageToken ?? "";
      if (!pageToken) break;
    }
    // Contacts deleted in Google disappear here too.
    await run(env, "DELETE FROM contacts WHERE account = ? AND seen_at < ?", a.email, started);
  }
  await run(env, "INSERT OR REPLACE INTO settings (key, value) VALUES ('contacts_synced_at', ?)", started);
  return { saved, missing_permission: missing };
}

/** Once a day from the cron, quietly. */
export async function syncContactsDaily(env: Env) {
  const last = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'contacts_synced_at'");
  if (last && Date.now() - Date.parse(last.value) < 20 * 3600_000) return;
  await syncContacts(env);
}

export async function contactsStatus(env: Env) {
  const n = await first<{ n: number }>(env, "SELECT COUNT(*) AS n FROM contacts");
  const last = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'contacts_synced_at'");
  return { count: n?.n ?? 0, synced_at: last?.value ?? null };
}

export interface ContactMatch { name: string; phone: string | null; source: "contacts" | "people" }

/** People whose name contains every word of the query (any order, any case), from Contacts and the address book. */
export async function findContacts(env: Env, query: string): Promise<ContactMatch[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const like = `%${words[0]}%`;
  const [cs, ps] = await Promise.all([
    all<{ name: string; phones: string }>(env, "SELECT name, phones FROM contacts WHERE lower(name) LIKE ? LIMIT 200", like),
    all<{ name: string; phone: string | null; aliases: string; whatsapp_name: string | null }>(env,
      "SELECT name, phone, aliases, whatsapp_name FROM people WHERE lower(name) LIKE ? OR lower(aliases) LIKE ? OR lower(whatsapp_name) LIKE ? LIMIT 50", like, like, like),
  ]);
  const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  const out: ContactMatch[] = [];
  for (const p of ps) if (has(`${p.name} ${p.aliases} ${p.whatsapp_name ?? ""}`)) out.push({ name: p.name, phone: p.phone ? normalizePhone(p.phone) : null, source: "people" });
  for (const c of cs) {
    if (!has(c.name)) continue;
    const phones = JSON.parse(c.phones) as string[];
    if (phones.length) for (const ph of phones) out.push({ name: c.name, phone: ph, source: "contacts" });
    else out.push({ name: c.name, phone: null, source: "contacts" });
  }
  // The same number twice (address book + Contacts) is one person.
  const seen = new Set<string>();
  return out.filter((m) => { const k = m.phone ?? `name:${m.name.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6);
}

const personalize = (text: string, name: string) =>
  text.replace(/\{name\}/gi, name).replace(/\{first_name\}/gi, /^(rabbi|rav|dr|reb)\.?\s/i.test(name) ? name : name.split(/\s+/)[0]);

/**
 * Assistant tool: one WhatsApp per person, ready to send with one tap each. A recipient can be a name or a
 * number. Clear matches are prepared; names with several possible people (or none) come back to ask about.
 */
export async function prepareWhatsApps(env: Env, input: { recipients: string[]; message: string; title?: string }) {
  const message = String(input.message ?? "").trim();
  if (!message) throw new Error("What should the message say?");
  const batch = uid(), title = String(input.title ?? "").slice(0, 80), t = now();
  const ready: { name: string; phone: string }[] = [], ask: { recipient: string; options: ContactMatch[] }[] = [], notFound: string[] = [];
  for (const r of (input.recipients ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 40)) {
    const asNumber = /^[+\d][\d\s\-()]{6,}$/.test(r) ? normalizePhone(r) : null;
    if (asNumber) { ready.push({ name: r, phone: asNumber }); continue; }
    const matches = (await findContacts(env, r)).filter((m) => m.phone);
    const exact = matches.filter((m) => m.name.toLowerCase() === r.toLowerCase());
    const pick = exact.length === 1 ? exact : matches;
    if (pick.length === 1) ready.push({ name: pick[0].name, phone: pick[0].phone! });
    else if (pick.length > 1) ask.push({ recipient: r, options: pick });
    else notFound.push(r);
  }
  for (const p of ready) await run(env,
    "INSERT INTO wa_drafts (id, batch_id, batch_title, name, phone, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    uid(), batch, title, p.name, p.phone, personalize(message, p.name), t);
  return {
    prepared: ready.map((p) => `${p.name} (+${p.phone})`),
    // Anything unresolved makes the assistant read this and ask, instead of a ready-made "done".
    ...(ask.length || notFound.length ? { clarification: "Some recipients need the user to choose or give a number." } : {}),
    ...(ask.length ? { which_one: ask.map((a) => ({ asked_for: a.recipient, options: a.options.map((o) => `${o.name} (+${o.phone})`) })) } : {}),
    ...(notFound.length ? { not_found: notFound, hint: "Not in Contacts or the address book: ask the user for the number (it can be given directly)." } : {}),
    where: "Replies page → WhatsApps to send. The user taps each one and presses Send in WhatsApp.",
  };
}

export const openWhatsApps = (env: Env) =>
  all(env, "SELECT * FROM wa_drafts WHERE done_at IS NULL ORDER BY created_at, name LIMIT 200");

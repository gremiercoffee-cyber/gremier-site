/**
 * Google Docs, Sheets and Drive for the assistant. Creating and reading is direct; sharing a file
 * with someone else goes through the approval queue (pending_actions) like any outside effect.
 */
import type { Env } from "./env";
import { accessToken, accountEmails, WORKSPACE_SCOPES } from "./google";
import { first } from "./db";

const DRIVE = "https://www.googleapis.com/drive/v3";

async function pickAccount(env: Env, account?: string): Promise<{ email: string; token: string }> {
  const emails = await accountEmails(env);
  if (!emails.length) throw new Error("No Google account is connected.");
  const email = account && emails.includes(account) ? account : emails[0];
  const row = await first<{ scopes: string }>(env, "SELECT scopes FROM google_accounts WHERE email = ?", email);
  if (!WORKSPACE_SCOPES.every((s) => (row?.scopes ?? "").includes(s))) {
    throw new Error(`${email} hasn't granted Docs/Sheets/Drive access yet. Ask the user to tap Reconnect on that account in Settings.`);
  }
  return { email, token: await accessToken(env, email) };
}

async function g<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Google ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Plain text with light markdown (#, ##, ###, "- " bullets, **bold** stripped) into a Google Doc. */
export async function createDoc(env: Env, title: string, content: string, account?: string) {
  const { email, token } = await pickAccount(env, account);
  const doc = await g<{ documentId: string }>(token, "https://docs.googleapis.com/v1/documents", { method: "POST", body: JSON.stringify({ title }) });

  let text = "";
  const styles: { start: number; end: number; style: string }[] = [];
  const bullets: { start: number; end: number }[] = [];
  for (const raw of content.replace(/\r/g, "").split("\n")) {
    let line = raw.replace(/\*\*(.+?)\*\*/g, "$1");
    let style: string | null = null, bullet = false;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { style = `HEADING_${h[1].length}`; line = h[2]; }
    else if (/^\s*[-*•]\s+/.test(line)) { bullet = true; line = line.replace(/^\s*[-*•]\s+/, ""); }
    const start = 1 + text.length;
    text += line + "\n";
    const end = 1 + text.length;
    if (style) styles.push({ start, end, style });
    if (bullet) bullets.push({ start, end });
  }
  const requests: unknown[] = [{ insertText: { location: { index: 1 }, text } }];
  for (const s of styles) requests.push({ updateParagraphStyle: { range: { startIndex: s.start, endIndex: s.end }, paragraphStyle: { namedStyleType: s.style }, fields: "namedStyleType" } });
  for (const b of bullets) requests.push({ createParagraphBullets: { range: { startIndex: b.start, endIndex: b.end }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } });
  await g(token, `https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests }) });
  return { file_id: doc.documentId, title, account: email, link: `https://docs.google.com/document/d/${doc.documentId}/edit` };
}

export async function createSheet(env: Env, title: string, rows: unknown[][], account?: string) {
  const { email, token } = await pickAccount(env, account);
  const sh = await g<{ spreadsheetId: string }>(token, "https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST", body: JSON.stringify({ properties: { title } }),
  });
  if (rows?.length) {
    await g(token, `https://sheets.googleapis.com/v4/spreadsheets/${sh.spreadsheetId}/values/A1?valueInputOption=USER_ENTERED`, {
      method: "PUT", body: JSON.stringify({ values: rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : c))) }),
    });
  }
  return { file_id: sh.spreadsheetId, title, account: email, link: `https://docs.google.com/spreadsheets/d/${sh.spreadsheetId}/edit` };
}

export async function appendRows(env: Env, fileId: string, rows: unknown[][], sheet?: string, account?: string) {
  const { token } = await pickAccount(env, account);
  const range = encodeURIComponent(sheet ? `${sheet}!A1` : "A1");
  const r = await g<{ updates?: { updatedRows?: number } }>(token,
    `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) });
  return { appended: r.updates?.updatedRows ?? rows.length };
}

export async function searchDrive(env: Env, query: string, account?: string) {
  const accounts = account ? [account] : await accountEmails(env);
  const out: unknown[] = [];
  for (const acct of accounts) {
    let auth;
    try { auth = await pickAccount(env, acct); } catch { continue; }
    const safe = query.replace(/['\\]/g, " ");
    const q = `trashed = false and (name contains '${safe}' or fullText contains '${safe}')`;
    const r = await g<{ files?: { id: string; name: string; mimeType: string; modifiedTime: string; webViewLink: string }[] }>(auth.token,
      `${DRIVE}/files?${new URLSearchParams({ q, pageSize: "8", orderBy: "modifiedTime desc", fields: "files(id,name,mimeType,modifiedTime,webViewLink)" })}`);
    out.push(...(r.files ?? []).map((f) => ({ ...f, account: auth.email })));
  }
  if (!out.length && !(await accountEmails(env)).length) throw new Error("No Google account is connected.");
  return out;
}

/** Text of a Doc, values of a Sheet, or the text export of other Google files. */
export async function readFile(env: Env, fileId: string, account?: string) {
  const accounts = account ? [account] : await accountEmails(env);
  let lastErr: unknown;
  for (const acct of accounts) {
    try {
      const { token } = await pickAccount(env, acct);
      const meta = await g<{ name: string; mimeType: string }>(token, `${DRIVE}/files/${fileId}?fields=name,mimeType`);
      if (meta.mimeType === "application/vnd.google-apps.spreadsheet") {
        const v = await g<{ values?: unknown[][] }>(token, `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/A1:Z300`);
        return { name: meta.name, type: "sheet", rows: v.values ?? [], account: acct };
      }
      const exportable = meta.mimeType.startsWith("application/vnd.google-apps.");
      const url = exportable ? `${DRIVE}/files/${fileId}/export?mimeType=text/plain` : `${DRIVE}/files/${fileId}?alt=media`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Google ${res.status}`);
      return { name: meta.name, type: meta.mimeType, text: (await res.text()).slice(0, 12000), account: acct };
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("File not found in any connected account.");
}

/** Only ever called after the user approved the share in the app. */
export async function shareFile(env: Env, fileId: string, email: string, role: "reader" | "commenter" | "writer", account?: string) {
  const accounts = account ? [account] : await accountEmails(env);
  for (const acct of accounts) {
    try {
      const { token } = await pickAccount(env, acct);
      await g(token, `${DRIVE}/files/${fileId}/permissions?sendNotificationEmail=true`, {
        method: "POST", body: JSON.stringify({ type: "user", role, emailAddress: email }),
      });
      return `shared with ${email} as ${role}`;
    } catch { /* try next account */ }
  }
  throw new Error("Couldn't share that file from any connected account.");
}

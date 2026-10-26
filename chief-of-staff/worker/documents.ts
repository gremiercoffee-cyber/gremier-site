/**
 * My details + files from email + signing.
 *
 * - My details (vault_items): things saved once (addresses, business numbers, signatures) that the assistant uses
 *   when asked. Signatures are cropped, transparent PNGs made in the app from a photo or screenshot.
 * - Files from email: "find the file from the bank" searches Gmail for attachments and lists what it found, so the
 *   user can see it before anything is done with it. Only a pointer is kept; the file is fetched fresh from Gmail.
 * - Filling: a form's own boxes, or (flat and scanned PDFs) answers written onto the page; see pdf-overlay.ts.
 * - Signing: put one or more saved signatures at the bottom of every page of a PDF and hand back a new file to
 *   download. The original is never changed, and nothing is sent anywhere.
 */
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, type PDFField } from "pdf-lib";
import type { Env } from "./env";
import { accessToken, accountEmails } from "./google";
import { all, first, now, run, uid } from "./db";
import { getProvider } from "./ai";
import { describeLayout, overlay, readLayout, type Placement } from "./pdf-overlay";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---- My details ------------------------------------------------------------------------------------
export interface VaultItem { id: string; kind: "text" | "signature"; label: string; text: string; image: string | null; created_at: string; updated_at: string }

export const listVault = (env: Env) => all<VaultItem>(env, "SELECT * FROM vault_items ORDER BY kind DESC, label");

export async function saveVault(env: Env, v: { id?: string; kind?: string; label?: string; text?: string; image?: string | null }) {
  const label = String(v.label ?? "").trim().slice(0, 80);
  if (!label) throw new Error("Give it a name, e.g. 'Business address' or 'My signature'.");
  const kind = v.kind === "signature" ? "signature" : "text";
  if (kind === "signature" && v.image !== undefined && v.image !== null && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v.image)) throw new Error("The signature must be a PNG image.");
  if (v.image && v.image.length > 1_500_000) throw new Error("That image is too large; try a smaller crop.");
  const t = now();
  const old = v.id ? await first<VaultItem>(env, "SELECT * FROM vault_items WHERE id = ?", v.id) : await first<VaultItem>(env, "SELECT * FROM vault_items WHERE lower(label) = lower(?)", label);
  if (old) {
    await run(env, "UPDATE vault_items SET label = ?, text = ?, image = COALESCE(?, image), updated_at = ? WHERE id = ?", label, String(v.text ?? old.text).slice(0, 4000), v.image ?? null, t, old.id);
    return { id: old.id, updated: true };
  }
  const id = uid();
  await run(env, "INSERT INTO vault_items (id, kind, label, text, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, kind, label, String(v.text ?? "").slice(0, 4000), v.image ?? null, t, t);
  return { id, created: true };
}

export const deleteVault = (env: Env, id: string) => run(env, "DELETE FROM vault_items WHERE id = ?", id);

/** For the assistant's context: text details in full, signatures by name only. */
/** The user's name (from Settings) and email addresses, for a form's name / contact / signer fields. */
async function whoAmI(env: Env) {
  const name = await first<{ value: string }>(env, "SELECT value FROM settings WHERE key = 'name'").catch(() => null);
  let n = name?.value ?? "";
  try { n = JSON.parse(n); } catch { /* stored plain */ }
  const emails = await accountEmails(env).catch(() => [] as string[]);
  return [n && `name ${n}`, emails.length && `email ${emails.join(", ")}`].filter(Boolean).join("; ");
}

export async function vaultSummary(env: Env) {
  const items = await listVault(env);
  if (!items.length) return "";
  return items.map((i) => i.kind === "signature" ? `- ${i.label} (signature image, id ${i.id})` : `- ${i.label}: ${i.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
}

// ---- Files from email --------------------------------------------------------------------------------
interface Part { partId?: string; mimeType: string; filename?: string; body?: { attachmentId?: string; size?: number }; parts?: Part[]; headers?: { name: string; value: string }[] }
const flat = (p: Part): Part[] => [p, ...(p.parts ?? []).flatMap(flat)];
const hdr = (p: Part, n: string) => p.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
async function gmail<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${GMAIL}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json() as Promise<T>;
}

export interface FoundFile {
  id: string; filename: string; mime: string | null; size: number | null; sender: string | null; subject: string | null; sent_at: string | null; account: string;
  source?: string; purpose?: string | null; batch?: string | null; chosen?: number; parent_id?: string | null; note?: string | null; created_at?: string;
  needed?: { label: string; ask: string }[];
}
export type Purpose = "sign" | "fill" | "view";
const purposeOf = (p: unknown): Purpose => (p === "sign" || p === "fill" ? p : "view");

// ---- Keeping file contents (uploads, downloaded email attachments, signed/filled copies) ------------------
const CHUNK = 900_000; // raw bytes per stored piece (a database entry holds up to ~2 MB)
const MAX_FILE = 15 * 1024 * 1024;
const toB64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => { const bin = atob(s); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

async function storeBytes(env: Env, fileId: string, bytes: Uint8Array) {
  if (bytes.length > MAX_FILE) throw new Error("That file is too big (over 15 MB).");
  await run(env, "DELETE FROM file_chunks WHERE file_id = ?", fileId);
  for (let i = 0, idx = 0; i < bytes.length || idx === 0; i += CHUNK, idx++)
    await run(env, "INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)", fileId, idx, toB64(bytes.subarray(i, i + CHUNK)));
  await run(env, "UPDATE found_files SET stored = 1, size = ? WHERE id = ?", bytes.length, fileId);
}
async function loadBytes(env: Env, fileId: string) {
  const parts = await all<{ data: string }>(env, "SELECT data FROM file_chunks WHERE file_id = ? ORDER BY idx", fileId);
  const chunks = parts.map((p) => fromB64(p.data));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ---- Files from email --------------------------------------------------------------------------------
/** Search all connected Gmail accounts for attachments (Gmail search words). One match is taken as "the one". */
export async function findEmailFiles(env: Env, query: string, purpose?: string, max = 8) {
  const q = `${String(query ?? "").trim()} has:attachment`.trim();
  const found: FoundFile[] = [];
  const batch = uid(), why = purposeOf(purpose);
  for (const account of await accountEmails(env)) {
    const token = await accessToken(env, account);
    const list = await gmail<{ messages?: { id: string }[] }>(token, `/messages?${new URLSearchParams({ q, maxResults: String(max) })}`);
    for (const m of list.messages ?? []) {
      const msg = await gmail<{ id: string; internalDate: string; payload: Part }>(token, `/messages/${m.id}?format=full`);
      for (const p of flat(msg.payload)) {
        if (!p.filename || !p.body?.attachmentId || !p.partId) continue;
        if (/^(image\/(gif)|application\/(ics|pkcs))/i.test(p.mimeType) || (p.body.size ?? 0) < 2000) continue; // signatures/logos in emails
        const f: FoundFile = { id: uid(), account, filename: p.filename, mime: p.mimeType, size: p.body.size ?? null,
          sender: hdr(msg.payload, "from") || null, subject: hdr(msg.payload, "subject") || null, sent_at: new Date(Number(msg.internalDate)).toISOString() };
        await run(env, "INSERT INTO found_files (id, account, message_id, part_id, filename, mime, size, sender, subject, sent_at, created_at, source, purpose, batch) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'email', ?, ?)",
          f.id, account, msg.id, p.partId, f.filename, f.mime, f.size, f.sender, f.subject, f.sent_at, now(), why, batch);
        found.push(f);
      }
    }
  }
  const list = found.sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? "")).slice(0, 12);
  if (list.length === 1) await chooseFile(env, list[0].id);
  return list;
}

/** "This one": the file to work on. Its contents are downloaded and kept, and the others from that search step aside. */
export async function chooseFile(env: Env, id: string) {
  const f = await first<FoundFile & { batch: string | null }>(env, "SELECT * FROM found_files WHERE id = ?", id);
  if (!f) throw new Error("That file isn't available any more. Ask me to find it again.");
  if (f.batch) await run(env, "UPDATE found_files SET chosen = -1 WHERE batch = ? AND id != ?", f.batch, id);
  await run(env, "UPDATE found_files SET chosen = 1 WHERE id = ?", id);
  await fileBytes(env, id); // downloads it from the email now, and keeps it
  return { file_id: id, filename: f.filename, purpose: f.purpose ?? "view" };
}

/** A file the user uploaded or pasted into the chat. */
export async function uploadFile(env: Env, p: { filename: string; mime: string; bytes: Uint8Array; purpose?: string }) {
  const id = uid();
  const name = (p.filename || "file").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  await run(env, "INSERT INTO found_files (id, account, message_id, part_id, filename, mime, size, created_at, source, purpose, chosen) VALUES (?, 'upload', '', '', ?, ?, ?, ?, 'upload', ?, 1)",
    id, name, p.mime || "application/octet-stream", p.bytes.length, now(), p.purpose ? purposeOf(p.purpose) : null);
  await storeBytes(env, id, p.bytes);
  return { id, filename: name, mime: p.mime, size: p.bytes.length };
}

export const recentFiles = (env: Env, since: string) =>
  all<FoundFile>(env, "SELECT id, account, filename, mime, size, sender, subject, sent_at, source, purpose, batch, chosen, parent_id, note, needed, created_at FROM found_files WHERE created_at >= ? ORDER BY created_at, sent_at DESC LIMIT 40", since)
    .then((rows) => rows.map((r) => ({ ...r, needed: (() => { try { return r.needed ? JSON.parse(r.needed as unknown as string) : []; } catch { return []; } })() })));

export const fileInfo = (env: Env, id: string) => first<FoundFile>(env, "SELECT * FROM found_files WHERE id = ?", id);

/** The file's bytes: kept ones from here; email attachments fetched from Gmail the first time, then kept. */
export async function fileBytes(env: Env, id: string) {
  const f = await first<{ account: string; message_id: string; part_id: string; filename: string; mime: string | null; stored: number }>(env, "SELECT * FROM found_files WHERE id = ?", id);
  if (!f) throw new Error("That file isn't available any more. Ask me to find it again.");
  const mime = f.mime || "application/octet-stream";
  if (f.stored) return { bytes: await loadBytes(env, id), filename: f.filename, mime };
  if (f.account === "made" || f.account === "upload") throw new Error("This copy didn't finish saving. Ask me to do it again.");
  const token = await accessToken(env, f.account);
  const msg = await gmail<{ payload: Part }>(token, `/messages/${f.message_id}?format=full`);
  const part = flat(msg.payload).find((p) => p.partId === f.part_id);
  if (!part?.body?.attachmentId) throw new Error("The attachment is no longer in that email.");
  // Attachment ids change between fetches; the part id doesn't.
  const a = await gmail<{ data: string }>(token, `/messages/${f.message_id}/attachments/${part.body.attachmentId}`);
  const bytes = fromB64(a.data.replace(/-/g, "+").replace(/_/g, "/"));
  if (bytes.length <= MAX_FILE) await storeBytes(env, id, bytes).catch(() => {});
  return { bytes, filename: f.filename, mime };
}

/** A new file made from another (a signed or filled copy), kept and shown for review. */
/** The questions a fill still has, kept on the file whose card shows the form for them ([] = none). */
async function setNeeded(env: Env, id: string, needed: { label: string; ask: string }[]) {
  await run(env, "UPDATE found_files SET needed = ? WHERE id = ?", needed.length ? JSON.stringify(needed) : null, id);
}

async function saveMade(env: Env, parentId: string, bytes: Uint8Array, filename: string, note: string, fillValues?: unknown, needed?: { label: string; ask: string }[]) {
  const id = uid();
  // Contents first, then the entry: a copy cut off mid-save never shows up as a broken card.
  await storeBytes(env, id, bytes);
  await run(env, "INSERT INTO found_files (id, account, message_id, part_id, filename, mime, size, created_at, source, parent_id, note, chosen, fill_values, stored) VALUES (?, 'made', '', '', ?, 'application/pdf', ?, ?, 'made', ?, ?, 1, ?, 1)",
    id, filename, bytes.length, now(), parentId, note, fillValues ? JSON.stringify(fillValues) : null);
  if (needed?.length) await setNeeded(env, id, needed);
  return id;
}

/** For the assistant: the file as something it can read (images and short PDFs), or null if too big. */
export async function fileForModel(env: Env, id: string): Promise<{ kind: "image" | "pdf"; name: string; dataUrl: string } | null> {
  const f = await fileBytes(env, id).catch(() => null);
  if (!f || f.bytes.length > 4 * 1024 * 1024) return null;
  if (/^image\/(png|jpe?g|webp|gif)$/i.test(f.mime)) return { kind: "image", name: f.filename, dataUrl: `data:${f.mime};base64,${toB64(f.bytes)}` };
  if (/pdf/i.test(f.mime) || /\.pdf$/i.test(f.filename)) return { kind: "pdf", name: f.filename, dataUrl: `data:application/pdf;base64,${toB64(f.bytes)}` };
  return null;
}

// ---- Signing ---------------------------------------------------------------------------------------------
export type Position = "bottom-right" | "bottom-left" | "bottom-center";
const pngBytes = (dataUrl: string) => fromB64(dataUrl.split(",")[1] ?? "");

/** Put the signatures side by side at the bottom of every page. */
export async function stampSignatures(pdf: Uint8Array, signatures: Uint8Array[], position: Position = "bottom-right") {
  const doc = await openPdf(pdf);
  const images = await Promise.all(signatures.map((s) => doc.embedPng(s)));
  const margin = 24, gap = 14;
  for (const page of doc.getPages()) {
    const { width } = page.getSize();
    const h = Math.min(42, Math.max(26, width / 16)); // ~ a real signature's height, scaled to the page
    const sized = images.map((img) => { const w = Math.min(160, (img.width / img.height) * h); return { img, w, h: w * (img.height / img.width) }; });
    const total = sized.reduce((s, x) => s + x.w, 0) + gap * (sized.length - 1);
    let x = position === "bottom-left" ? margin : position === "bottom-center" ? (width - total) / 2 : width - margin - total;
    for (const s of sized) { page.drawImage(s.img, { x, y: margin, width: s.w, height: s.h }); x += s.w + gap; }
  }
  return { bytes: await doc.save(), pages: doc.getPageCount() };
}

async function openPdf(pdf: Uint8Array) {
  try { return await PDFDocument.load(pdf); }
  catch (e) { throw new Error(/encrypt/i.test(String((e as Error).message)) ? "This PDF is locked (password-protected), so it can't be changed. Open it in the sender's signing app instead." : "That file couldn't be opened as a PDF."); }
}

async function pickSignatures(env: Env, wanted?: string[]) {
  const sigs = await all<{ id: string; label: string; image: string }>(env, "SELECT id, label, image FROM vault_items WHERE kind = 'signature' AND image IS NOT NULL");
  if (!sigs.length) return { error: "No signature is saved yet. Add one under My details (a photo or screenshot of the signature)." as const };
  const w = (wanted ?? []).map((s) => s.toLowerCase());
  const chosen = w.length ? sigs.filter((s) => w.some((x) => s.id === x || s.label.toLowerCase().includes(x))) : sigs.length === 1 ? sigs : [];
  if (!chosen.length) return { ask: sigs.map((s) => s.label) };
  return { chosen };
}

/** Sign every page now: a new signed copy, shown in the chat for review and download. */
export async function signFile(env: Env, input: { file_id: string; signatures?: string[]; position?: string }) {
  const info = await fileInfo(env, input.file_id);
  if (!info) throw new Error("I don't have that file; find or upload it first.");
  if (!/pdf/i.test(info.mime ?? "") && !/\.pdf$/i.test(info.filename)) throw new Error("Only PDFs can be signed this way.");
  const pick = await pickSignatures(env, input.signatures);
  if ("error" in pick) return { clarification: pick.error };
  if ("ask" in pick) return { clarification: "Which signatures?", options: pick.ask };
  const position = (["bottom-right", "bottom-left", "bottom-center"].includes(String(input.position)) ? input.position : "bottom-right") as Position;
  const f = await fileBytes(env, input.file_id);
  const out = await stampSignatures(f.bytes, pick.chosen!.map((s) => pngBytes(s.image)), position);
  const id = await saveMade(env, input.file_id, out.bytes, f.filename.replace(/\.pdf$/i, "") + " (signed).pdf", `Signed by ${pick.chosen!.map((s) => s.label).join(" and ")} on all ${out.pages} pages`);
  return { file_id: id, made: "signed copy", signatures: pick.chosen!.map((s) => s.label), pages: out.pages, where: "It's in the chat with a preview, Download and Share." };
}

// ---- Filling in a form ---------------------------------------------------------------------------------------
/**
 * Fill in a PDF: a real form's boxes when it has them; otherwise the answers are written onto the page beside
 * the printed labels (flat PDFs), or at positions read off the picture (scanned PDFs). Answers come only from
 * the user's saved details and what they said; anything missing comes back as still_needed, each with the label
 * to save the answer under in My details. Filling a filled copy again starts from the clean original and keeps
 * what was already written, so answers can be added or corrected without writing twice.
 */
type Needed = { label: string; ask: string };
type FillState = { mode: "fields"; values: Record<string, string | boolean> } | { mode: "flat" | "scan"; placements: Placement[] };

const NEEDED_RULE = `"still_needed": one entry per thing the form asks for that you couldn't fill: {"label": the name to save the answer under in the user's details (reuse a saved label if one fits; otherwise a plain one like "Home address", "ID number", "Phone", "Date of birth", "Bank account"), "ask": a short question for the user}. Skip "office use only" sections and things for someone else to fill.`;

function parseJson<T>(out: string): T {
  try { return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as T; } catch { throw new Error("I couldn't work out how to fill this form."); }
}
const neededList = (n: unknown): Needed[] => (Array.isArray(n) ? n : [])
  .map((x) => typeof x === "string" ? { label: x, ask: x } : { label: String((x as Needed)?.label ?? ""), ask: String((x as Needed)?.ask ?? (x as Needed)?.label ?? "") })
  .filter((x) => x.label).slice(0, 12);
const ASK_NEXT = "The user now sees a short form in the chat with a box for each still_needed item and one 'Save & fill in' button: it saves every answer to My details and fills the form once. Tell them in one line to fill it in there (don't list the questions one by one). Don't call fill_document again yourself after each answer: if they answer in the chat instead, save each with save_detail, and fill again only once they've given everything they have or say 'fill it'.";

// Fills run one at a time on a server: several at once (quick messages in a row) can run it out of memory.
let fillQueue: Promise<unknown> = Promise.resolve();
export function fillForm(env: Env, input: { file_id: string; instructions?: string }) {
  const run = fillQueue.then(() => fillFormNow(env, input), () => fillFormNow(env, input));
  fillQueue = run.catch(() => {});
  return run;
}

async function fillFormNow(env: Env, input: { file_id: string; instructions?: string }) {
  const info = await fileInfo(env, input.file_id) as (FoundFile & { fill_values?: string | null }) | null;
  if (!info) throw new Error("I don't have that file; find or upload it first.");
  if (!/pdf/i.test(info.mime ?? "") && !/\.pdf$/i.test(info.filename)) return { clarification: "I can fill in PDF forms. This file isn't a PDF." };
  let baseId = input.file_id, prev: FillState | null = null;
  if (info.source === "made" && info.fill_values && info.parent_id) { try { prev = JSON.parse(info.fill_values); baseId = info.parent_id; } catch { /* fill the copy as it is */ } }
  const f = await fileBytes(env, baseId);
  const doc = await openPdf(f.bytes);
  const fields = doc.getForm().getFields();
  const details = await vaultSummary(env);
  const today = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Jerusalem" });
  // Who's filling it: their name and email belong in a form's name / contact / signer fields.
  const who = await whoAmI(env);
  const common = `File: ${f.filename}\nToday: ${today}\nThe user: ${who || "(name not set)"}\nWhat the user said: ${input.instructions || "(fill in what you can)"}\n\nThe user's saved details:\n${details || "(none saved)"}`;
  const name = f.filename.replace(/\.pdf$/i, "").replace(/ \((filled|signed)\)$/i, "") + " (filled).pdf";
  if (fields.length) return fillFields(env, { fileId: input.file_id, baseId, doc, fields, common, prev: prev?.mode === "fields" ? prev : null, name });

  // A flat PDF: write onto the page. Read where the text is; with (almost) none, it's a scan.
  const layout = await readLayout(f.bytes).catch(() => null);
  const scanned = !layout || layout.pieces.length < 6;
  const before = prev && prev.mode !== "fields" ? `\n\nAlready written on this form (keep these unless the user asks to change or move one; return the FULL list):\n${JSON.stringify(prev.placements)}` : "";
  const rules = `Go through EVERY page and every blank meant for the user (the applicant / business / signer): each one is either filled or listed in still_needed — none silently skipped. Use the user's saved details, what they said, and the user's name and email; work out what follows plainly from them (a short business name from the business name; the contact or manager is the user; the signer's name next to a signature line; a phone or email repeated wherever the form asks again; today's date next to where they sign or for "date"). Never invent ID numbers, account numbers, amounts or facts. Write each value in the form's language when it's a word you'd translate naturally (e.g. city names in Hebrew on a Hebrew form), otherwise as saved. A tick box: value "X". ${NEEDED_RULE}`;
  let placements: Placement[] = [], needed: Needed[] = [];
  if (!scanned) {
    const out = await getProvider(env).complete({
      tier: "main", purpose: "fill_form", maxTokens: 8000, effort: "medium",
      system: `You fill in a flat PDF form (it has no fill-in boxes) by saying where each answer is written. You get every piece of text on the pages: #id, page, (x,y) of its start from the bottom-left in points, w = its width, then the text. Find what each label asks for and anchor the answer to it:
- "after": to the right of the label on the same line (English forms, "Name: ____").
- "left": to the left of the label (Hebrew right-to-left forms: the answer goes left of "שם:").
- "on": on a blank-line piece itself ("__________"), anchoring that piece.
- "below" / "above": when the space for the answer is under / over the label.
A tick box: anchor the option's text, "left" for English (box before the text), "after" for Hebrew (box after it).
Hebrew text may come out with its letters reversed; read it either way. Text marked [runs up the page] / [runs down the page] is a sideways part of the page: anchor to it the same way; the answer is written along that line too.
${rules}
Reply ONLY JSON: {"placements": [{"what": "Full name", "value": "...", "anchor": 12, "where": "after"}], "still_needed": [...]}`,
      prompt: `${common}\n\nPages: ${layout!.pages.map((p, i) => `p${i + 1} ${Math.round(p.w)}x${Math.round(p.h)}`).join(", ")}\n\nText on the pages:\n${describeLayout(layout!)}${before}`,
    });
    const v = parseJson<{ placements?: Placement[]; still_needed?: unknown }>(out);
    placements = (v.placements ?? []).filter((p) => p && p.value != null && Number.isFinite(Number(p.anchor))).map((p) => ({ ...p, anchor: Number(p.anchor) }));
    needed = neededList(v.still_needed);
  } else {
    const file = f.bytes.length <= 4 * 1024 * 1024 ? { kind: "pdf" as const, name: f.filename, dataUrl: `data:application/pdf;base64,${toB64(f.bytes)}` } : null;
    if (!file) return { clarification: "This looks like a scan and it's too big for me to read. Send a smaller copy (or a photo of each page) and I'll fill it." };
    const out = await getProvider(env).complete({
      tier: "main", purpose: "fill_form", maxTokens: 8000, effort: "medium", attachments: [file],
      system: `You fill in a scanned paper form (a picture, so no text to anchor to) by saying where each answer is written. Look carefully at each page, including pages scanned sideways or upside down and tables whose columns each ask something.
For each answer mark its empty space as a line on the page: page (0 = first); x1,y1 = where the space starts and x2,y2 = where it ends, along the line the answer is written on. Both points in thousandths of the page width and height AS YOU SEE IT, measured from the TOP-LEFT corner; the bottom of the letters sits on that line. "Starts" = the left end when the form's printed text is read upright — so on a sideways page the line runs up or down the page, like the printed lines there, and the answer will be written that way too. Keep the line inside the blank (a table cell, after a label, on a dotted line), never over printed text. size = points (usually 9-11; smaller for small cells).
${rules}
Reply ONLY JSON: {"placements": [{"what": "Full name", "value": "...", "page": 0, "x1": 420, "y1": 233, "x2": 610, "y2": 233, "size": 10}], "still_needed": [...]}`,
      prompt: `${common}${before}`,
    });
    const v = parseJson<{ placements?: Placement[]; still_needed?: unknown }>(out);
    const num = (n: unknown) => n == null || n === "" ? undefined : Number(n);
    placements = (v.placements ?? []).map((p) => ({ ...p, anchor: undefined, page: num(p.page), x1: num(p.x1 ?? p.x), y1: num(p.y1 ?? p.y), x2: num(p.x2), y2: num(p.y2), x: undefined, y: undefined }))
      .filter((p) => p.value != null && [p.page, p.x1, p.y1].every((n) => Number.isFinite(n)));
    needed = neededList(v.still_needed);
  }
  if (!placements.length) await setNeeded(env, input.file_id, needed);
  if (!placements.length) return { clarification: needed.length ? "I need a few details before I can fill this form." : "I couldn't find anything on this form to fill from your details. Tell me the answers and I'll write them in.", still_needed: needed, next: ASK_NEXT };
  const out = await overlay(f.bytes, scanned ? null : layout, placements);
  if (!out.written) return { clarification: "I couldn't place the answers on this form. Tell me where they go and I'll try again.", still_needed: needed };
  const note = `Wrote ${out.written} answer${out.written === 1 ? "" : "s"} onto the page${scanned ? " (a scan: positions are estimated, check them)" : ""}${needed.length ? `. Still needed: ${needed.map((n) => n.label).join("; ")} (answer them in the form below)` : ""}`;
  const id = await saveMade(env, baseId, out.bytes, name, note, { mode: scanned ? "scan" : "flat", placements }, needed);
  await setNeeded(env, input.file_id, []); // answered by this newer copy
  return { file_id: id, made: "filled copy (written onto the page)", written: out.written, scanned, still_needed: needed,
    where: "It's in the chat with a preview, Download and Share.",
    ...(needed.length ? { next: ASK_NEXT } : {}),
    ...(scanned ? { check: "Positions on a scan are estimated: ask the user to check, and move any that are off (call again with e.g. 'move the ID number a little right')." } : {}) };
}

async function fillFields(env: Env, p: { fileId: string; baseId: string; doc: PDFDocument; fields: PDFField[]; common: string; prev: { values: Record<string, string | boolean> } | null; name: string }) {
  const form = p.doc.getForm();
  // Field kinds are checked with instanceof: class names don't survive bundling.
  const kind = (fl: PDFField) => fl instanceof PDFTextField ? "Text" : fl instanceof PDFCheckBox ? "CheckBox" : fl instanceof PDFDropdown ? "Dropdown"
    : fl instanceof PDFOptionList ? "OptionList" : fl instanceof PDFRadioGroup ? "RadioGroup" : "Other";
  const desc = p.fields.slice(0, 200).map((fl) => {
    const opts = fl instanceof PDFDropdown || fl instanceof PDFOptionList || fl instanceof PDFRadioGroup ? ` options: ${fl.getOptions().slice(0, 12).join(" / ")}` : "";
    return `- ${fl.getName()} (${kind(fl)})${opts}`;
  }).join("\n");
  const before = p.prev ? `\n\nAlready filled (keep these unless the user asks to change one; return them all):\n${JSON.stringify(p.prev.values)}` : "";
  const out = await getProvider(env).complete({
    tier: "main", purpose: "fill_form", maxTokens: 6000, effort: "medium",
    system: `You fill in a PDF form for the user. Field names can be cryptic: use the name, its position in the list and the options to tell what each asks for. Use ONLY the user's saved details and what they said; never invent personal information, numbers or dates. Leave a field out if you don't know it. ${NEEDED_RULE} Reply ONLY JSON: {"values": {"<exact field name>": "text" | true | false | "<option>"}, "still_needed": [...]}`,
    prompt: `${p.common}\n\nForm fields:\n${desc}${before}`,
  });
  const v = parseJson<{ values?: Record<string, string | boolean>; still_needed?: unknown }>(out);
  const values = { ...(p.prev?.values ?? {}), ...(v.values ?? {}) };
  const needed = neededList(v.still_needed);
  let filled = 0;
  for (const [name, val] of Object.entries(values)) {
    try {
      const fl = form.getField(name);
      if (fl instanceof PDFTextField) fl.setText(String(val));
      else if (fl instanceof PDFCheckBox) { if (val === true || /^(yes|true|x|on|1)$/i.test(String(val))) fl.check(); else fl.uncheck(); }
      else if (fl instanceof PDFDropdown || fl instanceof PDFOptionList || fl instanceof PDFRadioGroup) fl.select(String(val));
      else continue;
      filled++;
    } catch { /* a value that doesn't fit that field: left for the user */ }
  }
  if (!filled) { await setNeeded(env, p.fileId, needed); return { clarification: "I need a few details before I can fill this form.", still_needed: needed, next: ASK_NEXT }; }
  const bytes = await p.doc.save({ updateFieldAppearances: true });
  const note = `Filled ${filled} of ${p.fields.length} fields${needed.length ? `. Still needed: ${needed.map((n) => n.label).join("; ")} (answer them in the form below)` : ""}`;
  const id = await saveMade(env, p.baseId, bytes, p.name, note, { mode: "fields", values }, needed);
  await setNeeded(env, p.fileId, []);
  return { file_id: id, made: "filled copy", filled, of: p.fields.length, still_needed: needed, where: "It's in the chat with a preview, Download and Share. It stays editable.",
    ...(needed.length ? { next: ASK_NEXT } : {}) };
}

// ---- Older signed copies (made before files were kept) ------------------------------------------------------
export const recentSigned = (env: Env, since: string) =>
  all<{ id: string; file_id: string; filename: string; signatures: string; position: string; created_at: string }>(env,
    "SELECT s.id, s.file_id, f.filename, s.signatures, s.position, s.created_at FROM signed_files s JOIN found_files f ON f.id = s.file_id WHERE s.created_at >= ? ORDER BY s.created_at DESC LIMIT 10", since);

export async function signedFileBytes(env: Env, id: string) {
  const s = await first<{ file_id: string; signatures: string; position: Position }>(env, "SELECT * FROM signed_files WHERE id = ?", id);
  if (!s) throw new Error("That signed copy isn't available.");
  const ids = JSON.parse(s.signatures) as string[];
  const imgs = await all<{ id: string; image: string }>(env, `SELECT id, image FROM vault_items WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  const ordered = ids.map((i) => imgs.find((x) => x.id === i)).filter((x): x is { id: string; image: string } => !!x?.image);
  if (!ordered.length) throw new Error("Those signatures were deleted.");
  const f = await fileBytes(env, s.file_id);
  const out = await stampSignatures(f.bytes, ordered.map((x) => pngBytes(x.image)), s.position);
  return { bytes: out.bytes, filename: f.filename.replace(/\.pdf$/i, "") + " (signed).pdf" };
}

/** Kept for older callers: signing now makes the copy straight away. */
export const prepareSignedFile = signFile;

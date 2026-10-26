/**
 * My details + files from email + signing.
 *
 * - My details (vault_items): things saved once (addresses, business numbers, signatures) that the assistant uses
 *   when asked. Signatures are cropped, transparent PNGs made in the app from a photo or screenshot.
 * - Files from email: "find the file from the bank" searches Gmail for attachments and lists what it found, so the
 *   user can see it before anything is done with it. Only a pointer is kept; the file is fetched fresh from Gmail.
 * - Signing: put one or more saved signatures at the bottom of every page of a PDF and hand back a new file to
 *   download. The original is never changed, and nothing is sent anywhere.
 */
import { PDFDocument } from "pdf-lib";
import type { Env } from "./env";
import { accessToken, accountEmails } from "./google";
import { all, first, now, run, uid } from "./db";

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

export interface FoundFile { id: string; filename: string; mime: string | null; size: number | null; sender: string | null; subject: string | null; sent_at: string | null; account: string }

/** Search all connected Gmail accounts for messages with attachments matching the query (Gmail search words). */
export async function findEmailFiles(env: Env, query: string, max = 8) {
  const q = `${String(query ?? "").trim()} has:attachment`.trim();
  const found: FoundFile[] = [];
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
        await run(env, "INSERT INTO found_files (id, account, message_id, part_id, filename, mime, size, sender, subject, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          f.id, account, msg.id, p.partId, f.filename, f.mime, f.size, f.sender, f.subject, f.sent_at, now());
        found.push(f);
      }
    }
  }
  return found.sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? "")).slice(0, 12);
}

export const recentFiles = (env: Env, since: string) =>
  all<FoundFile>(env, "SELECT id, account, filename, mime, size, sender, subject, sent_at FROM found_files WHERE created_at >= ? ORDER BY created_at DESC, sent_at DESC LIMIT 20", since);

/** The file's bytes, fetched fresh from Gmail (attachment ids change between fetches; the part id doesn't). */
export async function fileBytes(env: Env, id: string) {
  const f = await first<{ account: string; message_id: string; part_id: string; filename: string; mime: string | null }>(env, "SELECT * FROM found_files WHERE id = ?", id);
  if (!f) throw new Error("That file isn't available any more. Ask me to find it again.");
  const token = await accessToken(env, f.account);
  const msg = await gmail<{ payload: Part }>(token, `/messages/${f.message_id}?format=full`);
  const part = flat(msg.payload).find((p) => p.partId === f.part_id);
  if (!part?.body?.attachmentId) throw new Error("The attachment is no longer in that email.");
  const a = await gmail<{ data: string }>(token, `/messages/${f.message_id}/attachments/${part.body.attachmentId}`);
  const bin = atob(a.data.replace(/-/g, "+").replace(/_/g, "/"));
  return { bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)), filename: f.filename, mime: f.mime || "application/octet-stream" };
}

// ---- Signing ---------------------------------------------------------------------------------------------
export type Position = "bottom-right" | "bottom-left" | "bottom-center";
const pngBytes = (dataUrl: string) => { const bin = atob(dataUrl.split(",")[1] ?? ""); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

/** Put the signatures side by side at the bottom of every page. */
export async function stampSignatures(pdf: Uint8Array, signatures: Uint8Array[], position: Position = "bottom-right") {
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(pdf); }
  catch (e) { throw new Error(/encrypt/i.test(String((e as Error).message)) ? "This PDF is locked (password-protected), so it can't be changed. Open it in the bank's signing app instead." : "That file couldn't be opened as a PDF."); }
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

/** Assistant tool: prepare a signed copy (which signatures, where). Returns where the user downloads it. */
export async function prepareSignedFile(env: Env, input: { file_id: string; signatures?: string[]; position?: string }) {
  const file = await first<{ filename: string; mime: string | null }>(env, "SELECT filename, mime FROM found_files WHERE id = ?", input.file_id);
  if (!file) throw new Error("I don't have that file; find it first.");
  if (!/pdf/i.test(file.mime ?? "") && !/\.pdf$/i.test(file.filename)) throw new Error("Only PDFs can be signed this way.");
  const sigs = await all<{ id: string; label: string }>(env, "SELECT id, label FROM vault_items WHERE kind = 'signature' AND image IS NOT NULL");
  if (!sigs.length) return { clarification: "No signature is saved yet. The user can add one under My details (a photo or screenshot of the signature)." };
  const wanted = (input.signatures ?? []).map((s) => s.toLowerCase());
  const chosen = wanted.length ? sigs.filter((s) => wanted.some((w) => s.id === w || s.label.toLowerCase().includes(w))) : sigs.length === 1 ? sigs : [];
  if (!chosen.length) return { clarification: "Which signatures?", options: sigs.map((s) => s.label) };
  const position = (["bottom-right", "bottom-left", "bottom-center"].includes(String(input.position)) ? input.position : "bottom-right") as Position;
  const id = uid();
  await run(env, "INSERT INTO signed_files (id, file_id, signatures, position, created_at) VALUES (?, ?, ?, ?, ?)", id, input.file_id, JSON.stringify(chosen.map((s) => s.id)), position, now());
  return { signed_file_id: id, file: file.filename, signatures: chosen.map((s) => s.label), position, where: "A preview and Download button appear in this chat." };
}

export const recentSigned = (env: Env, since: string) =>
  all<{ id: string; file_id: string; filename: string; signatures: string; position: string; created_at: string }>(env,
    "SELECT s.id, s.file_id, f.filename, s.signatures, s.position, s.created_at FROM signed_files s JOIN found_files f ON f.id = s.file_id WHERE s.created_at >= ? ORDER BY s.created_at DESC LIMIT 10", since);

/** Build the signed PDF for download. */
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

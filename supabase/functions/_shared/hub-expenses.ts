// file_expense: a photo or PDF of an expense, sent by a connected app (Grok bot), goes into the
// same expense inbox the email route uses. The inbox stores it, reads supplier / date / total / VAT,
// and the admin app shows it under Finance → Expenses with the category and note the sender gave.
import { HubError } from "./hub-ops.ts";

// The categories the bookkeeping (FinBot) already uses, so a label lines up with the books.
export const EXPENSE_CATEGORIES = [
  "קניות בארץ", "קניות בארץ ללא מעמ", "קניות חו\"ל", "חומרי עזר", "קבלני משנה", "יבוא",
  "הובלות", "משלוחים", "פרסום", "כיבודים עם מעמ", "כיבודים ללא מעמ", "משרדיות",
  "אחזקת משרד / עסק", "אחזקת מחשב ותוכנות", "שכירות רכב", "דלק רכב 2/3", "דמי שכירות תפעולית",
  "חשמל 25%", "ארנונה בית 25%", "הנהלת חשבונות", "עמלות סליקה", "תרומות", "רכוש קבוע",
];

const MAX_BYTES = 15 * 1024 * 1024;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

function decode(raw: unknown): Uint8Array {
  let s = String(raw ?? "").trim();
  const m = /^data:[^;,]+;base64,/i.exec(s);
  if (m) s = s.slice(m[0].length);
  s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!s) throw new HubError("bad_request", "image_base64 is required: the photo or PDF, base64-encoded");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new HubError("bad_request", "image_base64 isn't valid base64");
  if (s.length * 0.75 > MAX_BYTES) throw new HubError("bad_request", "The file is over 15 MB; send a smaller photo");
  let bin: string;
  try { bin = atob(s.padEnd(Math.ceil(s.length / 4) * 4, "=")); } catch { throw new HubError("bad_request", "image_base64 isn't valid base64"); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function kind(b: Uint8Array): string | null {
  const head = new TextDecoder().decode(b.slice(0, 12));
  if (head.startsWith("%PDF-")) return "pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10") return "png";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
  return null;
}

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch { return ""; }
}

export async function fileExpense(app: string, a: Record<string, unknown>) {
  const bytes = decode(a.image_base64);
  const ext = kind(bytes);
  // A model that "describes" an image instead of passing its real bytes produces data that isn't a real file.
  if (!ext) throw new HubError("bad_request", "That data isn't a real JPEG, PNG, WebP or PDF file. Pass the exact bytes of the photo the user sent (base64), not a description or a re-drawn image.");
  if (bytes.length < 2000) throw new HubError("bad_request", "That file is too small to be a photo of a receipt. Pass the original photo's bytes.");
  const category = clip(a.category, 80);
  const note = clip(a.note, 300);
  const name = (clip(a.file_name, 80).replace(/[\\/:*?"<>|]+/g, "-") || `expense-${new Date().toISOString().slice(0, 10)}`).replace(/\.(jpe?g|png|webp|pdf)$/i, "") + "." + ext;

  const form = new FormData();
  form.append("file", new File([bytes], name, { type: ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}` }));
  form.append("via", "hub");
  form.append("app", clip(app, 80));
  if (category) form.append("category", category);
  if (note) form.append("note", note);
  form.append("wait", "1");   // read it now, so the reply can say what was filed

  const key = serviceKey();
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/expense-inbox`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key }, body: form, signal: AbortSignal.timeout(110000),
  });
  const out = await r.json().catch(() => ({})) as Record<string, any>;
  if (!r.ok || !out.saved) throw new HubError("bad_request", `The expense inbox didn't accept it (${out.error || r.status})`);
  const d = out.document || {};
  return {
    filed: true,
    duplicate: !!out.duplicate,
    id: out.id || null,
    category: category || null,
    note: note || null,
    read: out.duplicate ? "This exact file is already in the inbox" : d.read_status || "reading",
    supplier: d.supplier ?? null,
    date: d.doc_date ?? null,
    total: d.total_minor != null ? d.total_minor / 100 : null,
    vat: d.vat_minor != null ? d.vat_minor / 100 : null,
    currency: d.currency ?? null,
    document: d.doc_kind ?? null,
    where: "Admin app → Finance → Expenses",
  };
}

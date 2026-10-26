/**
 * Writing onto flat PDFs (forms with no fill-in boxes): find the printed labels ("Name:", "כתובת", a blank line)
 * and write each answer beside them as real text, in English or Hebrew, along the same line as the label —
 * so a sideways page or a rotated block gets sideways answers, the way a person would write them.
 *
 * - readLayout: every piece of text on every page with its position and direction (pdf.js, via unpdf).
 * - placeText: turns "write X after/left of/below/on piece #12" into a point and direction, sized to fit.
 * - drawValue: draws mixed Hebrew/English text (Hebrew in Noto Sans Hebrew, the rest in Helvetica).
 * Scanned pages have no text to anchor to; there the model looks at the page and marks each answer's space as
 * a line (start and end), which gives its direction too.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { HEBREW_FONT_B64 } from "./fonts/hebrew";

/** A piece of text. x,y = where its line starts (PDF points from the bottom-left); angle = the line's direction
 *  in degrees (0 = normal, 90 = running up the page); w = its length along the line, h = its size. */
export interface Piece { id: number; page: number; x: number; y: number; angle: number; w: number; h: number; text: string }
export interface Layout { pages: { w: number; h: number }[]; pieces: Piece[] }

// Points seen along a line at `angle`: (along, across). And back.
const toLine = (x: number, y: number, a: number) => { const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { u: x * c + y * s, v: -x * s + y * c }; };
const fromLine = (u: number, v: number, a: number) => { const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: u * c - v * s, y: u * s + v * c }; };
const sameDir = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180) < 5;

/** Each text piece's position and direction, in the space pdf-lib draws in. */
export async function readLayout(bytes: Uint8Array, maxPages = 12): Promise<Layout> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: Layout["pages"] = [], pieces: Piece[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    const page = await pdf.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    pages.push({ w: x1 - x0, h: y1 - y0 });
    const tc = await page.getTextContent();
    const raw: Omit<Piece, "id">[] = [];
    for (const it of tc.items as { str?: string; transform: number[]; width: number; height: number }[]) {
      const text = (it.str ?? "").replace(/\s+/g, " ");
      if (!text.trim()) continue;
      const t = it.transform;
      const size = Math.hypot(t[2], t[3]) || it.height || 10;
      const angle = Math.round((Math.atan2(t[1], t[0]) * 180) / Math.PI);
      raw.push({ page: n - 1, x: t[4], y: t[5], angle: (angle + 360) % 360, w: it.width, h: size, text });
    }
    for (const p of joinFragments(raw)) pieces.push({ id: pieces.length + 1, ...p });
  }
  // Let go of pdf.js's copy of the file straight away (memory is tight with several files).
  const p = pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> };
  try { await (p.destroy ?? p.cleanup)?.call(pdf); } catch { /* already released */ }
  return { pages, pieces };
}

/** Text often comes in fragments (a word, a colon; Hebrew especially). Fragments that touch on the same line
 *  (and run the same way) become one piece, so a label is one thing to anchor to. Hebrew reads right to left. */
function joinFragments(raw: Omit<Piece, "id">[]) {
  const out: Omit<Piece, "id">[] = [];
  const dirs: number[] = [];
  for (const r of raw) if (!dirs.some((d) => sameDir(d, r.angle))) dirs.push(r.angle);
  for (const dir of dirs) {
    const group = raw.filter((r) => sameDir(r.angle, dir)).map((r) => ({ ...r, ...toLine(r.x, r.y, dir) }))
      .sort((a, b) => b.v - a.v || a.u - b.u);
    const lines: (typeof group[number] & { parts: typeof group })[] = [];
    for (const r of group) {
      const last = lines[lines.length - 1];
      const gap = last ? r.u - (last.u + last.w) : Infinity;
      if (last && Math.abs(r.v - last.v) < Math.min(r.h, last.h) * 0.4 && gap > -r.h * 0.3 && gap < Math.max(r.h, last.h) * 0.45) {
        last.parts.push(r);
        last.w = Math.max(last.w, r.u + r.w - last.u); last.h = Math.max(last.h, r.h);
      } else lines.push({ ...r, parts: [r] });
    }
    for (const { parts, u, v, ...p } of lines) {
      const rtl = parts.some((x) => HEB.test(x.text));
      const ordered = rtl ? [...parts].reverse() : parts;
      // Hebrew is sometimes stored letter by letter as drawn (reversed). Judge the whole line, then put it back.
      const all = parts.map((x) => x.text).join(" ");
      const flip = rtl && count(all, REVERSED_END) > count(all, NORMAL_END);
      const text = ordered.map((x, i) => {
        const t = flip && HEB.test(x.text) ? [...x.text].reverse().join("") : x.text;
        const prev = ordered[i - 1];
        const spaced = prev && (rtl ? prev.u - (x.u + x.w) : x.u - (prev.u + prev.w)) > x.h * 0.15;
        return (spaced ? " " : "") + t;
      }).join("").replace(/\s+/g, " ").trim();
      const at = fromLine(u, v, dir);
      out.push({ page: p.page, x: at.x, y: at.y, angle: dir, w: p.w, h: p.h, text });
    }
  }
  return out;
}
// Letters that only end a Hebrew word (ך ם ן ף ץ): found at a word's start, the text was stored reversed.
const REVERSED_END = /(^|[\s:.,])[ךםןףץ][א-ת]/g, NORMAL_END = /[א-ת][ךםןףץ](?=$|[\s:.,])/g;
const count = (t: string, re: RegExp) => t.match(re)?.length ?? 0;

/** The layout as short lines for the model: "#12 p1 (50,700 w177) Full name: ______", "… sideways" for text
 *  that runs up or down the page. Reading order on each page. */
export function describeLayout(l: Layout, max = 700) {
  const key = (p: Piece) => { const q = toLine(p.x, p.y, p.angle); return { v: q.v, u: q.u }; };
  const sorted = [...l.pieces].sort((a, b) => a.page - b.page || a.angle - b.angle || key(b).v - key(a).v || key(a).u - key(b).u);
  const turn = (a: number) => a === 0 ? "" : sameDir(a, 90) ? " [runs up the page]" : sameDir(a, 270) ? " [runs down the page]" : sameDir(a, 180) ? " [upside down]" : ` [at ${a}°]`;
  return sorted.slice(0, max).map((p) => `#${p.id} p${p.page + 1} (${Math.round(p.x)},${Math.round(p.y)} w${Math.round(p.w)})${turn(p.angle)} ${p.text.slice(0, 90)}`).join("\n");
}

export type Where = "after" | "left" | "below" | "above" | "on";
/** Anchored (text pages): anchor + where. Scanned pages: page + the answer's space as a line from (x1,y1) to
 *  (x2,y2), in thousandths of the page as seen, from the top-left. (Older copies used a single x,y.) */
export interface Placement { value?: string; signature?: string; anchor?: number; where?: Where; page?: number; x1?: number; y1?: number; x2?: number; y2?: number; x?: number; y?: number; size?: number; what?: string }

const HEB = /[֐-׿יִ-ﭏ]/;
const BLANK = /[_.…‐-]{4,}/;

export interface Spot { page: number; x: number; y: number; size: number; angle: number }

/** Where to write a value relative to its anchor piece, and how big, so it fits before the next text. Worked
 *  out along the label's own line, so it's the same for sideways text. */
export function placeText(l: Layout, p: Placement, width: (size: number) => number): Spot | null {
  const a = l.pieces.find((x) => x.id === p.anchor);
  if (!a) return null;
  const dir = a.angle;
  const A = toLine(a.x, a.y, dir);
  const pg = l.pages[a.page];
  const corners = [[0, 0], [pg.w, 0], [0, pg.h], [pg.w, pg.h]].map(([x, y]) => toLine(x, y, dir).u);
  const pageStart = Math.min(...corners) + 24, pageEnd = Math.max(...corners) - 24;
  const where: Where = p.where ?? (HEB.test(a.text) ? "left" : "after");
  const sameLine = l.pieces.filter((x) => x.page === a.page && x.id !== a.id && sameDir(x.angle, dir))
    .map((x) => ({ ...x, ...toLine(x.x, x.y, dir) })).filter((x) => Math.abs(x.v - A.v) < a.h * 0.6);
  let size = Math.max(6, Math.min(p.size ?? a.h, 11));
  let u: number, v = A.v, room: number, rightAlign = false;
  const blank = a.text.match(BLANK);
  if (where === "on" || (where === "after" && blank && blank.index! > 0 && a.text.slice(blank.index! + blank[0].length).trim() === "")) {
    // Write on the blank line itself: from where the underscores start.
    const start = blank ? A.u + a.w * (blank.index! / a.text.length) : A.u;
    u = start + 2; v = A.v + 1.5; room = A.u + a.w - u;
  } else if (where === "after") {
    u = A.u + a.w + 4;
    const next = sameLine.filter((o) => o.u >= A.u + a.w - 1).sort((m, n) => m.u - n.u)[0];
    room = (next && !BLANK.test(next.text) ? next.u : pageEnd) - u;
  } else if (where === "left") {
    // Right-to-left forms: the answer goes before the label, ending just before it.
    const prev = sameLine.filter((o) => o.u + o.w <= A.u + 1).sort((m, n) => n.u + n.w - (m.u + m.w))[0];
    const left = prev && !BLANK.test(prev.text) ? prev.u + prev.w + 4 : pageStart;
    u = A.u - 4; room = u - left; rightAlign = true;
  } else {
    // below / above: under or over the label, lined up with its start (its end for Hebrew).
    v = where === "below" ? A.v - a.h * 1.5 : A.v + a.h * 1.5;
    if (HEB.test(a.text)) { u = A.u + a.w; rightAlign = true; room = A.u + a.w - pageStart; }
    else { u = A.u; room = pageEnd - A.u; }
  }
  room = Math.max(room, 30);
  while (size > 5 && width(size) > room) size -= 0.5;
  const at = fromLine(rightAlign ? u - width(size) : u, v, dir);
  return { page: a.page, x: at.x, y: at.y, size, angle: dir };
}

/** A scanned page: the answer's space marked as a line in thousandths of the page as it's shown (which can be
 *  turned from how it's stored). Gives where the text starts, its direction and a size that fits the space. */
export function placeOnScan(page: PDFPage, pageNo: number, p: Placement, width: (size: number) => number, rtl: boolean): Spot | null {
  const x1 = p.x1 ?? p.x, y1 = p.y1 ?? p.y;
  if (x1 == null || y1 == null) return null;
  const { width: W, height: H } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const [dw, dh] = rot === 90 || rot === 270 ? [H, W] : [W, H];
  // A point as shown (from the top-left) → where it is on the stored page.
  const toPage = (fx: number, fy: number) => {
    const X = (fx / 1000) * dw, Y = (fy / 1000) * dh;
    return rot === 90 ? { x: Y, y: X } : rot === 180 ? { x: W - X, y: Y } : rot === 270 ? { x: W - Y, y: H - X } : { x: X, y: H - Y };
  };
  const a = toPage(x1, y1);
  // No end given (older copies): straight across as the page is shown.
  const b = p.x2 != null && p.y2 != null ? toPage(p.x2, p.y2) : (() => { const e = toPage(x1 + 300, y1); return e; })();
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return null;
  const angle = (Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) + 360) % 360;
  let size = Math.max(6, Math.min(p.size ?? 10, 14));
  const fit = p.x2 != null ? len : Infinity;
  while (size > 5 && width(size) > fit) size -= 0.5;
  // Hebrew ends at the far (right) end of the space; English starts at the near end.
  const start = rtl && p.x2 != null ? Math.max(0, len - width(size)) : 0;
  const r = (angle * Math.PI) / 180;
  return { page: pageNo, x: a.x + Math.cos(r) * start, y: a.y + Math.sin(r) * start, size, angle };
}

// ---- Drawing mixed Hebrew / English -------------------------------------------------------------------
export interface Fonts { latin: PDFFont; hebrew: PDFFont }

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const bin = Uint8Array.from(atob(HEBREW_FONT_B64), (c) => c.charCodeAt(0));
  return { latin: await doc.embedFont(StandardFonts.Helvetica), hebrew: await doc.embedFont(bin, { subset: true }) };
}

/**
 * The value as runs drawn one after another, left to right, each with its font. In a Hebrew line the words go
 * right to left while English/number stretches keep their order. The letters inside a Hebrew word are NOT
 * reversed here: the font engine (fontkit) already lays Hebrew out right to left.
 */
export function runs(text: string, f: Fonts) {
  const tokens = text.match(/[֐-׿יִ-ﭏ"'׳״]+|[A-Za-z0-9@#&+\-/]+(?:[.,:][A-Za-z0-9]+)*|\s+|./gu) ?? [];
  const rtl = HEB.test(text);
  const strong = (t: string) => HEB.test(t) ? "H" : /[A-Za-z0-9@#&]/.test(t) ? "L" : "N";
  let ordered: string[] = [...tokens];
  if (rtl) {
    const cls = tokens.map(strong);
    for (let i = 0; i < cls.length; i++) if (cls[i] === "N") {
      const before = cls.slice(0, i).reverse().find((c) => c !== "N"), after = cls.slice(i + 1).find((c) => c !== "N");
      cls[i] = before === "L" && after === "L" ? "L" : "H";
    }
    const groups: { c: string; t: string[] }[] = [];
    tokens.forEach((t, i) => { const g = groups[groups.length - 1]; if (g && g.c === cls[i]) g.t.push(t); else groups.push({ c: cls[i], t: [t] }); });
    ordered = groups.reverse().flatMap((g) => g.c === "H" ? [...g.t].reverse() : [g.t.join("")]);
  }
  const out: { text: string; font: PDFFont }[] = [];
  for (const s of ordered) {
    const isHeb = HEB.test(s) || s === "₪";
    const font = isHeb ? f.hebrew : f.latin;
    // Characters neither font can write are dropped rather than breaking the file.
    let ok = s;
    try { font.encodeText(s); } catch { ok = [...s].filter((c) => { try { font.encodeText(c); return true; } catch { return false; } }).join(""); }
    if (ok) out.push({ text: ok, font });
  }
  return out;
}

export const textWidth = (text: string, f: Fonts, size: number) => runs(text, f).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);

/** Draw the value from its start point along its direction (angle in degrees). */
export function drawValue(page: PDFPage, text: string, at: { x: number; y: number; size: number; angle?: number }, f: Fonts) {
  const a = at.angle ?? 0, r = (a * Math.PI) / 180;
  let x = at.x, y = at.y;
  for (const run of runs(text, f)) {
    page.drawText(run.text, { x, y, size: at.size, font: run.font, color: rgb(0.05, 0.1, 0.45), rotate: degrees(a) });
    const w = run.font.widthOfTextAtSize(run.text, at.size);
    x += Math.cos(r) * w; y += Math.sin(r) * w;
  }
}

/** Write every placement onto the PDF (text, or a saved signature image). Returns the new file and how many. */
export async function overlay(bytes: Uint8Array, l: Layout | null, placements: Placement[], signatures: Record<string, Uint8Array> = {}) {
  const doc = await PDFDocument.load(bytes);
  const f = await embedFonts(doc);
  const pages = doc.getPages();
  const images = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  let written = 0;
  for (const p of placements) {
    if (p.signature) { if (await drawSignature(doc, pages, l, p, signatures, images)) written++; continue; }
    const value = String(p.value ?? "").trim();
    // An id or code is never an answer (a signature's id once got written as text).
    if (!value || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) continue;
    const w = (size: number) => textWidth(value, f, size);
    let at: Spot | null = null;
    if (p.anchor != null && l) at = placeText(l, p, w);
    else if (p.page != null && pages[p.page]) at = placeOnScan(pages[p.page], p.page, p, w, HEB.test(value));
    if (!at || !pages[at.page]) continue;
    drawValue(pages[at.page], value, at, f);
    written++;
  }
  return { bytes: await doc.save(), written };
}

/** A saved signature on a signature line: about two lines of text tall, along the line, a little below it. */
async function drawSignature(doc: PDFDocument, pages: PDFPage[], l: Layout | null, p: Placement, sigs: Record<string, Uint8Array>,
  images: Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>) {
  const want = String(p.signature).toLowerCase();
  const key = Object.keys(sigs).find((k) => k === want) ?? Object.keys(sigs).find((k) => k.includes(want) || want.includes(k)) ?? Object.keys(sigs)[0];
  if (!key) return false;
  let img = images.get(key);
  if (!img) { img = await doc.embedPng(sigs[key]); images.set(key, img); }
  const aspect = img.width / img.height;
  let h = Math.max(16, Math.min(40, (p.size ?? 10) * 2.6));
  // Fit the space: the "width" of a signature is its drawn length.
  const width = (size: number) => (h * (size / (p.size ?? 10))) * aspect;
  const at = p.anchor != null && l ? placeText(l, { ...p, size: p.size ?? 10 }, width)
    : p.page != null && pages[p.page] ? placeOnScan(pages[p.page], p.page, p, width, false) : null;
  if (!at || !pages[at.page]) return false;
  h = h * (at.size / (p.size ?? 10));
  const r = (at.angle * Math.PI) / 180, drop = h * 0.2;
  pages[at.page].drawImage(img, { x: at.x + Math.sin(r) * drop, y: at.y - Math.cos(r) * drop, width: h * aspect, height: h, rotate: degrees(at.angle) });
  return true;
}

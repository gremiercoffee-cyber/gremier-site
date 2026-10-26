/**
 * Writing onto flat PDFs (forms with no fill-in boxes): find the printed labels ("Name:", "כתובת", a blank line)
 * and write each answer beside them as real text, in English or Hebrew.
 *
 * - readLayout: every piece of text on every page with its position (pdf.js, via unpdf, which runs in Workers).
 * - placeText: turns "write X after/left of/below/on piece #12" into page coordinates, sized to fit the space.
 * - drawValue: draws mixed Hebrew/English text (Hebrew in Noto Sans Hebrew, the rest in Helvetica), right to left
 *   when it's Hebrew.
 * Scanned pages have no text to anchor to; there the model looks at the page and gives positions itself.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { HEBREW_FONT_B64 } from "./fonts/hebrew";

export interface Piece { id: number; page: number; x: number; y: number; w: number; h: number; text: string }
export interface Layout { pages: { w: number; h: number }[]; pieces: Piece[] }

/** Each text piece's position, in PDF points from the bottom-left (the same space pdf-lib draws in). */
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
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      raw.push({ page: n - 1, x: it.transform[4], y: it.transform[5], w: it.width, h: size, text });
    }
    for (const p of joinFragments(raw)) pieces.push({ id: pieces.length + 1, ...p });
  }
  await pdf.cleanup?.();
  return { pages, pieces };
}

/** Text often comes in fragments (a word, a colon; Hebrew especially). Fragments that touch on the same line
 *  become one piece, so a label is one thing to anchor to. Hebrew reads right to left. */
function joinFragments(raw: Omit<Piece, "id">[]) {
  const sorted = [...raw].sort((a, b) => b.y - a.y || a.x - b.x);
  const out: (Omit<Piece, "id"> & { parts: Omit<Piece, "id">[] })[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const gap = last ? r.x - (last.x + last.w) : Infinity;
    if (last && Math.abs(r.y - last.y) < Math.min(r.h, last.h) * 0.4 && gap > -r.h * 0.3 && gap < Math.max(r.h, last.h) * 0.45) {
      last.parts.push(r);
      last.w = Math.max(last.w, r.x + r.w - last.x); last.h = Math.max(last.h, r.h);
    } else out.push({ ...r, parts: [r] });
  }
  return out.map(({ parts, ...p }) => {
    const rtl = parts.some((x) => HEB.test(x.text));
    const ordered = rtl ? [...parts].reverse() : parts;
    // Hebrew is sometimes stored letter by letter as drawn (reversed). Judge the whole line, then put it back.
    const all = parts.map((x) => x.text).join(" ");
    const flip = rtl && count(all, REVERSED_END) > count(all, NORMAL_END);
    const text = ordered.map((x, i) => {
      const t = flip && HEB.test(x.text) ? [...x.text].reverse().join("") : x.text;
      const prev = ordered[i - 1];
      const spaced = prev && (rtl ? prev.x - (x.x + x.w) : x.x - (prev.x + prev.w)) > x.h * 0.15;
      return (spaced ? " " : "") + t;
    }).join("").replace(/\s+/g, " ").trim();
    return { ...p, text };
  });
}
// Letters that only end a Hebrew word (ך ם ן ף ץ): found at a word's start, the text was stored reversed.
const REVERSED_END = /(^|[\s:.,])[ךםןףץ][א-ת]/g, NORMAL_END = /[א-ת][ךםןףץ](?=$|[\s:.,])/g;
const count = (t: string, re: RegExp) => t.match(re)?.length ?? 0;

/** The layout as short lines for the model: "#12 p1 (50,700 w177) Full name: ______". Top of page first. */
export function describeLayout(l: Layout, max = 700) {
  const sorted = [...l.pieces].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  return sorted.slice(0, max).map((p) => `#${p.id} p${p.page + 1} (${Math.round(p.x)},${Math.round(p.y)} w${Math.round(p.w)}) ${p.text.slice(0, 90)}`).join("\n");
}

export type Where = "after" | "left" | "below" | "above" | "on";
export interface Placement { value: string; anchor?: number; where?: Where; page?: number; x?: number; y?: number; size?: number; what?: string }

const HEB = /[֐-׿יִ-ﭏ]/;
const BLANK = /[_.…‐-]{4,}/;

/** Where to write a value relative to its anchor piece, and how big, so it fits before the next text. */
export function placeText(l: Layout, p: Placement, width: (size: number) => number) {
  const a = l.pieces.find((x) => x.id === p.anchor);
  if (!a) return null;
  const page = l.pages[a.page];
  const where: Where = p.where ?? (HEB.test(a.text) ? "left" : "after");
  const sameLine = l.pieces.filter((x) => x.page === a.page && x.id !== a.id && Math.abs(x.y - a.y) < a.h * 0.6);
  let size = Math.max(6, Math.min(p.size ?? a.h, 11));
  let x: number, y = a.y, room: number, rightAlign = false;
  const blank = a.text.match(BLANK);
  if (where === "on" || (where === "after" && blank && blank.index! > 0 && a.text.slice(blank.index! + blank[0].length).trim() === "")) {
    // Write on the blank line itself: from where the underscores start.
    const start = blank ? a.x + a.w * (blank.index! / a.text.length) : a.x;
    x = start + 2; y = a.y + 1.5; room = a.x + a.w - x;
  } else if (where === "after") {
    x = a.x + a.w + 4;
    const next = sameLine.filter((o) => o.x >= a.x + a.w - 1).sort((m, n) => m.x - n.x)[0];
    room = (next && !BLANK.test(next.text) ? next.x : page.w - 24) - x;
  } else if (where === "left") {
    // Right-to-left forms: the answer goes to the left of the label, ending just before it.
    const prev = sameLine.filter((o) => o.x + o.w <= a.x + 1).sort((m, n) => n.x + n.w - (m.x + m.w))[0];
    const left = prev && !BLANK.test(prev.text) ? prev.x + prev.w + 4 : 24;
    x = a.x - 4; room = x - left; rightAlign = true;
  } else {
    // below / above: under or over the label, lined up with its start (its end for Hebrew).
    y = where === "below" ? a.y - a.h * 1.5 : a.y + a.h * 1.5;
    if (HEB.test(a.text)) { x = a.x + a.w; rightAlign = true; room = a.x + a.w - 24; }
    else { x = a.x; room = page.w - 24 - a.x; }
  }
  room = Math.max(room, 30);
  while (size > 5 && width(size) > room) size -= 0.5;
  return { page: a.page, x: rightAlign ? x - width(size) : x, y, size };
}

// ---- Drawing mixed Hebrew / English -------------------------------------------------------------------
export interface Fonts { latin: PDFFont; hebrew: PDFFont }

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const bin = Uint8Array.from(atob(HEBREW_FONT_B64), (c) => c.charCodeAt(0));
  return { latin: await doc.embedFont(StandardFonts.Helvetica), hebrew: await doc.embedFont(bin, { subset: true }) };
}

/** Pieces in the order they're drawn left to right, each with its font. Hebrew text is reversed (simple bidi). */
export function runs(text: string, f: Fonts) {
  const tokens = text.match(/[֐-׿יִ-ﭏ"'׳״]+|[A-Za-z0-9@#&+\-/]+(?:[.,:][A-Za-z0-9]+)*|\s+|./gu) ?? [];
  const rtl = HEB.test(text);
  const strong = (t: string) => HEB.test(t) ? "H" : /[A-Za-z0-9@#&]/.test(t) ? "L" : "N";
  // Right-to-left line: English/number stretches (with the spaces inside them) keep their order; the
  // stretches themselves, and the Hebrew, go right to left.
  let ordered: string[] = [...tokens];
  if (rtl) {
    const cls = tokens.map(strong);
    for (let i = 0; i < cls.length; i++) if (cls[i] === "N") {
      const before = cls.slice(0, i).reverse().find((c) => c !== "N"), after = cls.slice(i + 1).find((c) => c !== "N");
      cls[i] = before === "L" && after === "L" ? "L" : "H";
    }
    const groups: { c: string; t: string[] }[] = [];
    tokens.forEach((t, i) => { const g = groups[groups.length - 1]; if (g && g.c === cls[i]) g.t.push(t); else groups.push({ c: cls[i], t: [t] }); });
    ordered = groups.reverse().flatMap((g) => g.c === "H" ? [...g.t].reverse().map((t) => [...t].reverse().join("")) : [g.t.join("")]);
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

export function drawValue(page: PDFPage, text: string, at: { x: number; y: number; size: number }, f: Fonts) {
  let x = at.x;
  for (const r of runs(text, f)) {
    page.drawText(r.text, { x, y: at.y, size: at.size, font: r.font, color: rgb(0.05, 0.1, 0.45) });
    x += r.font.widthOfTextAtSize(r.text, at.size);
  }
}

/** Write every placement onto the PDF. Anchored ones use the layout; free ones (scanned pages) use x/y as
 *  thousandths of the page from the top-left. Returns the new file and how many were written. */
export async function overlay(bytes: Uint8Array, l: Layout | null, placements: Placement[]) {
  const doc = await PDFDocument.load(bytes);
  const f = await embedFonts(doc);
  const pages = doc.getPages();
  let written = 0;
  for (const p of placements) {
    const value = String(p.value ?? "").trim();
    if (!value) continue;
    const w = (size: number) => textWidth(value, f, size);
    let at: { page: number; x: number; y: number; size: number } | null = null;
    if (p.anchor != null && l) at = placeText(l, p, w);
    else if (p.page != null && p.x != null && p.y != null && pages[p.page]) {
      const { width, height } = pages[p.page].getSize();
      at = { page: p.page, x: (p.x / 1000) * width, y: height - (p.y / 1000) * height, size: Math.max(6, Math.min(p.size ?? 10, 14)) };
    }
    if (!at || !pages[at.page]) continue;
    drawValue(pages[at.page], value, at, f);
    written++;
  }
  return { bytes: await doc.save(), written };
}

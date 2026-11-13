/** Which links in an email to the expenses address lead to the invoice itself. Pure: no I/O, easy to test.
 * Only document links are opened; marketing, consent, unsubscribe and social links never are
 * (opening one could sign the business up for something). */
export interface Link { url: string; text: string; plain: boolean }

const DOC_WORDS = /חשבוני|קבל[הו]|מסמך|הורד|invoice|receipt|document|download|\bpdf\b/i;
const DOC_URL = /\.pdf\b|export=pdf|[?&/](?:doc|document|invoice|receipt)[_-]?(?:id)?[=/]|getdocument|downloaddocument|downloadpdf|icount-pdfs|\/invoices?\/|\/receipts?\/|\/documents?\//i;
const BLOCK = /unsubscribe|הסר|הסרה|consent|marketing|opt-?out|preferences|newsletter|subscribe|remove|feedback|survey|review|tracking|track-order|maps\.google|google\.[a-z.]+\/maps|facebook\.|instagram\.|twitter\.|x\.com\/|linkedin\.|whatsapp|wa\.me|youtube\.|tiktok\./i;

const decode = (s: string) => s.replace(/&amp;|&#38;/gi, "&").replace(/&quot;/g, '"').replace(/&#x2F;/gi, "/");

/** Every https link in the email: anchors (with their text) and bare URLs in the text. */
export function linksIn(html: string, text: string): Link[] {
  const out: Link[] = [], seen = new Set<string>();
  const add = (raw: string, label: string, plain: boolean) => {
    let url = decode(raw.trim()).replace(/[),.;]+$/, "");
    // Gmail sometimes wraps links: https://www.google.com/url?q=<real>
    try { const u = new URL(url); if (/(^|\.)google\.com$/.test(u.hostname) && u.pathname === "/url" && u.searchParams.get("q")) url = u.searchParams.get("q")!; } catch { return; }
    if (!/^https:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url); out.push({ url, text: label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120), plain });
  };
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(m[1], m[2], false);
  for (const m of text.matchAll(/https:\/\/[^\s<>"']+/g)) add(m[0], "", true);
  return out;
}

/** The links worth opening for the invoice, best first (at most 3).
 * - a link whose words or address say "invoice / receipt / document / PDF";
 * - a bare link someone pasted on its own (the owner sending a link from the phone). */
export function documentLinks(html: string, text: string): string[] {
  const all = linksIn(html, text), bodyWithoutLinks = text.replace(/https:\/\/[^\s<>"']+/g, "").replace(/\s+/g, " ").trim();
  const scored = all.filter((l) => !BLOCK.test(l.url) && !BLOCK.test(l.text)).map((l) => {
    let score = 0;
    if (DOC_WORDS.test(l.text)) score += 3;
    if (DOC_URL.test(l.url)) score += 2;
    if (l.plain && all.length <= 2 && bodyWithoutLinks.length < 60) score += 2; // just a pasted link
    return { url: l.url, score };
  }).filter((l) => l.score >= 2);
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map((l) => l.url);
}

/** What kind of file the bytes are (only these are filed). */
export function fileKind(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | null {
  const head = String.fromCharCode(...bytes.slice(0, 12));
  if (head.startsWith("%PDF-")) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && head.slice(1, 4) === "PNG") return "image/png";
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

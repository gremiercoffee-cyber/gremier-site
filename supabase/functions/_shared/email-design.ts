// The look shared by Gremier's designed emails (same style as the gift card email): logo, a product
// photo, the message in a card, a code on a dark gift-card-style card, and a button.
const SITE = (Deno.env.get("SITE_URL") || "https://gremiercoffee.co.il").replace(/\/$/, "");
const LOGO = Deno.env.get("GIFT_CARD_LOGO_URL") || `${SITE}/logo.png`;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const photo = (url: string, w = 1040) => (url.includes("/upload/") ? url.replace("/upload/", `/upload/f_auto,q_auto,w_${w}/`) : url);

export type CodeCard = { label: string; big: string; codeLabel: string; code?: string; note?: string };   // no code: just the label + note
export type DesignedEmail = {
  he: boolean;
  preheader: string;
  hello: string;            // big heading
  lead: string;             // short line under it
  image?: string | null;    // a product photo
  body?: string[];          // paragraphs in the white card
  card?: CodeCard;          // the gift-card-style code card
  cta?: { label: string; url: string };
  small?: string[];         // small print under the button
  smallLinks?: string[];    // a link for each small line (e.g. unsubscribe)
  bodyBlocks?: string[];    // ready-made rows (e.g. the ordered items) before the message
  sign: string;
};

export function designedEmailHtml(o: DesignedEmail): string {
  const dir = o.he ? "rtl" : "ltr", align = o.he ? "right" : "left";
  const card = o.card ? `<tr><td style="padding:0 0 22px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-radius:20px;background:#15110e;background-image:linear-gradient(135deg,#3a2a1a 0%,#1c1714 50%,#0d0b0a 100%);color:#f4efe8">
        <tr><td style="padding:22px 24px 6px;text-align:${align}">
          <table role="presentation" cellspacing="0" cellpadding="0" dir="ltr" style="${o.he ? "margin-left:auto" : ""}"><tr>
            <td style="padding-right:10px"><img src="${esc(LOGO)}" width="34" height="34" alt="" style="display:block;border-radius:50%;background:#ffffff"></td>
            <td style="font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#f4efe8">Gremier Coffee Co.</td>
          </tr></table></td></tr>
        <tr><td style="padding:30px 24px 0;text-align:${align};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#c8873a">${esc(o.card.label)}</td></tr>
        <tr><td style="padding:2px 24px 16px;text-align:${align};font-family:Georgia,'Times New Roman',serif;font-size:50px;line-height:1.05;font-weight:bold;color:#ffffff">${esc(o.card.big)}</td></tr>
        <tr><td style="padding:0 16px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe8;border-radius:12px"><tr><td style="padding:12px 14px;text-align:center">
            <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#8a7c6e;margin-bottom:4px">${esc(o.card.codeLabel)}</div>
            ${o.card.code ? `<div dir="ltr" style="font-family:'Courier New',Courier,monospace;font-size:22px;letter-spacing:3px;font-weight:bold;color:#1a1a1a">${esc(o.card.code)}</div>` : ""}
            ${o.card.note ? `<div style="font-size:12px;color:#8a7c6e;margin-top:6px">${esc(o.card.note)}</div>` : ""}
          </td></tr></table></td></tr>
      </table></td></tr>` : "";
  const image = o.image ? `<tr><td style="padding:0 0 22px"><img src="${esc(photo(o.image))}" width="520" alt="" style="display:block;width:100%;max-width:520px;height:auto;border-radius:18px;background:#ece6dd"></td></tr>` : "";
  const body = o.body?.length ? `<tr><td style="padding:0 0 22px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:14px;border:1px solid #e7e0d6"><tr><td style="padding:18px 22px;text-align:${align};font-size:15px;line-height:1.65;color:#2a2a2a">
        ${o.body.map((p) => `<p style="margin:0 0 10px">${esc(p).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#8a5a1c">${u.replace(/^https?:\/\//, "")}</a>`).replace(/\n/g, "<br>")}</p>`).join("")}
      </td></tr></table></td></tr>` : "";
  return `<!doctype html>
<html dir="${dir}" lang="${o.he ? "he" : "en"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:#f4f1ec;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
  <div style="display:none;max-height:0;overflow:hidden">${esc(o.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ec;padding:28px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto" dir="${dir}">
      <tr><td style="text-align:center;padding:0 0 18px"><img src="${esc(LOGO)}" width="56" height="56" alt="Gremier Coffee Co." style="display:inline-block;border-radius:50%"></td></tr>
      <tr><td style="text-align:center;padding:0 8px 6px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:bold">${esc(o.hello)}</td></tr>
      ${o.lead ? `<tr><td style="text-align:center;padding:0 12px 22px;font-size:15px;line-height:1.6;color:#4a4a4a">${esc(o.lead)}</td></tr>` : `<tr><td style="padding:0 0 16px"></td></tr>`}
      ${image}${card}${(o.bodyBlocks || []).join("")}${body}
      ${o.cta ? `<tr><td style="text-align:center;padding:0 0 18px"><a href="${esc(o.cta.url)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:999px;font-size:15px;font-weight:bold">${esc(o.cta.label)}</a></td></tr>` : ""}
      ${(o.small || []).map((s, i) => `<tr><td style="text-align:center;padding:0 16px 8px;font-size:13px;line-height:1.6;color:#6b7178">${o.smallLinks?.[i] ? `<a href="${esc(o.smallLinks[i])}" style="color:#9a9188">${esc(s || "Unsubscribe")}</a>` : esc(s)}</td></tr>`).join("")}
      <tr><td style="text-align:center;border-top:1px solid #e2dbd1;padding:18px 16px 0;font-size:12px;color:#9a9188">${esc(o.sign)}<br><a href="${esc(SITE)}" style="color:#9a9188">gremiercoffee.co.il</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// What a customer ordered (or left in the cart), with photos, in a card.
export type EmailItem = { name: string; qty?: number; image?: string | null };
export function itemsHtml(items: EmailItem[], he: boolean, title?: string): string {
  if (!items.length) return "";
  const align = he ? "right" : "left";
  return `<tr><td style="padding:0 0 22px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border-radius:14px;border:1px solid #e7e0d6">
      ${title ? `<tr><td colspan="2" style="padding:14px 18px 4px;text-align:${align};font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8a7c6e">${esc(title)}</td></tr>` : ""}
      ${items.slice(0, 8).map((i) => `<tr><td width="68" style="padding:10px 0 10px 16px;${he ? "padding:10px 16px 10px 0;" : ""}">${i.image ? `<img src="${esc(photo(i.image, 160))}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:10px;background:#f3f0eb">` : `<div style="width:56px;height:56px;border-radius:10px;background:#f3f0eb"></div>`}</td>
        <td style="padding:10px 16px;text-align:${align};font-size:15px;color:#1a1a1a">${esc(i.name)}${i.qty && i.qty > 1 ? ` <span style="color:#8a7c6e">×${i.qty}</span>` : ""}</td></tr>`).join("")}
    </table></td></tr>`;
}

// Any plain email, designed: its first short line as the heading, the rest in a card, its first link as a
// button. Used automatically for customer emails that don't bring their own design.
export function designedFromText(text: string, o: { subject?: string; items?: EmailItem[]; itemsTitle?: string; card?: CodeCard; image?: string | null } = {}): string {
  const he = (text.match(/[֐-׿]/g) || []).length > (text.match(/[A-Za-z]/g) || []).length / 3;
  const url = (text.match(/https?:\/\/[^\s)]+/) || [])[0];
  const isSign = (l: string) => /^(—|--)\s*$|^—\s*Gremier|^Gremier Coff?ee( Co\.)?$|^גרמיר (קפה|קופי)$|^https?:\/\/gremiercoffee\.co\.il\/?$/i.test(l.trim());
  const paras = text.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.split("\n").filter((l) => !isSign(l)).join("\n").trim()).filter(Boolean);
  const first = paras[0] && paras[0].length <= 70 && !paras[0].includes("\n") ? paras.shift()! : (o.subject || "").replace(/^Gremier Coff?ee\s*[—-]\s*/i, "");
  // Unsubscribe / opt-out lines stay small at the bottom; the link goes on its own button.
  const small = paras.filter((p) => /unsubscribe|להסרה/i.test(p));
  const body = paras.filter((p) => !small.includes(p)).map((p) => p.replace(url && !/unsubscribe|להסרה/i.test(p) ? url : "\u0000", "").replace(/[:\s]+$/, "").trim()).filter(Boolean);
  const label = url && !/unsubscribe|optout|opt-out/i.test(url) ? (he ? "לפרטים" : "Open") : null;
  return designedEmailHtml({ he, preheader: body[0] || first, hello: first, lead: "", image: o.image, card: o.card,
    bodyBlocks: [itemsHtml(o.items || [], he, o.itemsTitle)], body,
    cta: label ? { label, url: url! } : undefined, small: small.map((s) => s.replace(/https?:\/\/\S+/g, "").trim()), smallLinks: small.map((s) => (s.match(/https?:\/\/\S+/) || [])[0] || ""),
    sign: he ? "גרמיר קפה" : "Gremier Coffee Co." });
}

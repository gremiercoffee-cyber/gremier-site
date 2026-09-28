import { forbidden, isServiceOrAdmin } from "../_shared/security.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const PDFSHIFT_API_KEY = Deno.env.get("PDFSHIFT_API_KEY")!;

const BIZ_NAME    = "גרמיר קפה";
const BIZ_TAXID   = "343836268";
const BIZ_EMAIL   = "gremiercoffee@gmail.com";
const BIZ_ADDRESS = "ביתר עילית, כף החיים 11";
const BIZ_PHONE   = "0584321781";

async function htmlToPdf(html: string): Promise<Uint8Array> {
  const res = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa("api:" + PDFSHIFT_API_KEY),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: html, landscape: false, use_print: false }),
  });
  if (!res.ok) throw new Error("PDFShift error: " + await res.text());
  return new Uint8Array(await res.arrayBuffer());
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function buildReceiptHTML(order: any, overrideName?: string): string {
  const date = new Date(order.created_at).toLocaleDateString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });

  const deliveryFee = order.delivery_fee ?? order.delivery_info?.delivery_fee ?? null;
  const hasDelivery = deliveryFee && Number(deliveryFee) > 0;

  let itemRows = (order.items || []).map((item: any) => `
    <tr>
      <td>${Number(item.qty) || 1}</td>
      <td>${item.name_he || item.name_en || 'מוצר'}</td>
      <td>₪${Number(item.price).toFixed(2)}</td>
      <td>₪${(Number(item.price) * (Number(item.qty) || 1)).toFixed(2)}</td>
    </tr>`).join('');

  if (hasDelivery) {
    itemRows += `
    <tr>
      <td>1</td>
      <td>משלוח</td>
      <td>₪${Number(deliveryFee).toFixed(2)}</td>
      <td>₪${Number(deliveryFee).toFixed(2)}</td>
    </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Arial,sans-serif; direction:rtl; color:#222; font-size:13px; padding:30px 40px; }
.header { display:flex; justify-content:space-between; margin-bottom:18px; }
.biz-name { font-size:18px; font-weight:700; color:#4a2c0a; }
.title-bar { background:#4a2c0a; color:#fff; text-align:center; font-size:18px; font-weight:700; letter-spacing:4px; padding:10px; margin-bottom:18px; }
.meta { display:flex; justify-content:space-between; margin-bottom:18px; border:1px solid #ddd; padding:10px 14px; }
table { width:100%; border-collapse:collapse; margin-bottom:14px; }
thead tr { background:#c8860a; color:#fff; }
thead th { padding:8px 10px; text-align:right; }
tbody tr:nth-child(even) { background:#fdf6ee; }
tbody td { padding:7px 10px; border-bottom:1px solid #eee; }
.totals { width:260px; border:1px solid #ddd; }
.totals td { padding:6px 12px; }
.grand { background:#4a2c0a; color:#fff; font-weight:700; }
.paid-stamp { display:inline-block; border:3px solid #2a7a2a; color:#2a7a2a; font-size:22px; font-weight:700; padding:6px 18px; border-radius:4px; transform:rotate(-8deg); margin-top:16px; letter-spacing:4px; }
.footer { margin-top:30px; border-top:1px solid #ddd; padding-top:8px; font-size:11px; color:#888; display:flex; justify-content:space-between; }
.exempt { font-size:11px; color:#888; margin-top:6px; }
</style></head>
<body>
<div class="header">
  <div style="text-align:center;padding-top:8px">
    <div class="paid-stamp">שולם ✓</div>
  </div>
  <div style="text-align:right;line-height:1.7">
    <div class="biz-name">${BIZ_NAME}</div>
    <div>עוסק פטור מס': ${BIZ_TAXID}</div>
    <div>${BIZ_EMAIL}</div>
    <div>כתובת: ${BIZ_ADDRESS}</div>
    <div>${BIZ_PHONE}</div>
  </div>
</div>

<div class="title-bar">ק ב ל ה &nbsp; / &nbsp;מס' ${order.order_number}</div>

<div class="meta">
  <div>
    <div>תאריך: ${date}</div>
    <div>אמצעי תשלום: כרטיס אשראי</div>
  </div>
  <div style="text-align:right">
    <div>לכבוד:</div>
    <div><strong>${overrideName || order.customer_name || ''}</strong></div>
    ${order.customer_email ? `<div>${order.customer_email}</div>` : ''}
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>כמות</th>
      <th>תיאור</th>
      <th>מחיר ליחידה</th>
      <th>סה"כ</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<table class="totals">
  ${order.discount > 0 ? `
  <tr><td>סכום לפני הנחה</td><td style="text-align:left">₪${Number(order.subtotal).toFixed(2)}</td></tr>
  <tr><td>הנחה</td><td style="text-align:left">-₪${Number(order.discount).toFixed(2)}</td></tr>
  ` : ''}
  <tr class="grand"><td>סה"כ שולם</td><td style="text-align:left">₪${Number(order.total).toFixed(2)}</td></tr>
</table>
<div class="exempt">* עוסק פטור — פטור ממע"מ</div>

<div class="footer">
  <span>תאריך הפקה: ${date}</span>
  <span>מסמך זה אינו חשבונית מס מוסמכת</span>
</div>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Admin-only (or our own cron/server). verify_jwt alone lets the public site key through.
  if (!(await isServiceOrAdmin(req))) return forbidden(corsHeaders);

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { order_id, override_name } = await req.json();

    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const { data: order, error } = await sb
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .single();

    if (error || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!order.customer_email) {
      return new Response(JSON.stringify({ error: "no_email", detail: "Customer has no email address" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const html = buildReceiptHTML(order, override_name);
    const pdfBytes = await htmlToPdf(html);
    const pdfBase64 = uint8ToBase64(pdfBytes);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Gremier Coffee <orders@gremiercoffee.co.il>",
        to: [order.customer_email],
        subject: `קבלה מגרמיר קפה — הזמנה #${order.order_number}`,
        html: `
          <div dir="rtl" style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:20px">
            <h2 style="color:#4a2c0a">גרמיר קפה</h2>
            <p>שלום ${order.customer_name || ''},</p>
            <p>מצורפת קבלה עבור הזמנה מס' <strong>#${order.order_number}</strong>.</p>
            <p style="font-size:22px;font-weight:700;color:#4a2c0a">סה"כ שולם: ₪${Number(order.total).toFixed(2)}</p>
            <p>תודה שקניתם אצלנו! ☕</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #eee"/>
            <p style="font-size:11px;color:#888">גרמיר קפה · עוסק פטור ${BIZ_TAXID} · ${BIZ_PHONE}</p>
          </div>`,
        attachments: [{
          filename: `קבלה-גרמיר-קפה-${order.order_number}.pdf`,
          content: pdfBase64,
          type: "application/pdf",
          disposition: "attachment",
        }],
      }),
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: "email_failed", detail: resendData }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: true, sent_to: order.customer_email }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
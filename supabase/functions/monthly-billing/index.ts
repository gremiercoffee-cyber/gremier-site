import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PDFSHIFT_API_KEY = Deno.env.get("PDFSHIFT_API_KEY")!;

const BIZ_NAME    = "גרמיר קפה";
const BIZ_TAXID   = "343836268";
const BIZ_EMAIL   = "gremiercoffee@gmail.com";
const BIZ_ADDRESS = "ביתר עילית, כף החיים 11";
const BIZ_PHONE   = "0584321781";
const BIZ_BANK    = "יונתן דוד מוריה גריי | בנק מרכנתיל 17 | סניף 661 | 90297565";

const BUCKET = "billing-invoices";

// same HTML→file approach as before, just pointed at PDFShift's PNG endpoint instead of its PDF
// one — same HTML, same fidelity, no separate rendering pipeline needed
async function htmlToPng(html: string): Promise<Uint8Array> {
  const res = await fetch("https://api.pdfshift.io/v3/convert/png", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa("api:" + PDFSHIFT_API_KEY),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: html,
      fullpage: true,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("PDFShift PNG error: " + err);
  }
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

async function uploadInvoicePng(
  sb: ReturnType<typeof createClient>,
  year: number,
  month: number,
  storeId: string,
  bytes: Uint8Array,
): Promise<{ path: string; url: string }> {
  const path = `${year}-${String(month).padStart(2, "0")}/${storeId}.png`;
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/png",
    upsert: true,
  });
  if (error) throw new Error("Storage upload error: " + error.message);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const year  = body.year  ?? now.getFullYear();
    const month = body.month ?? (now.getMonth() + 1);

    const start = new Date(year, month - 1, 1).toISOString().split("T")[0];
    const end   = new Date(year, month,     1).toISOString().split("T")[0];

    const monthNames = ["January","February","March","April","May","June",
                        "July","August","September","October","November","December"];
    const monthName  = `${monthNames[month - 1]} ${String(year).slice(-2)}`;

    const { data: deliveries, error } = await sb
      .from("store_deliveries")
      .select("*, stores(name, price_large, price_small, price_syrup, phone)")
      .gte("delivery_date", start)
      .lt("delivery_date", end);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const storeMap: Record<string, any> = {};
    for (const d of deliveries ?? []) {
      const sid = d.store_id;
      if (!storeMap[sid]) {
        storeMap[sid] = {
          id:         sid,
          name:       d.stores?.name       ?? d.store_name,
          phone:      d.stores?.phone      ?? "",
          largePrice: d.stores?.price_large ?? 0,
          smallPrice: d.stores?.price_small ?? 0,
          syrupPrice: d.stores?.price_syrup ?? 0,
          qtyLarge: 0, qtySmall: 0, qtySyrup: 0,
        };
      }
      storeMap[sid].qtyLarge += d.qty_large ?? 0;
      storeMap[sid].qtySmall += d.qty_small ?? 0;
      storeMap[sid].qtySyrup += d.qty_syrup ?? 0;
    }

    const activeStores = Object.values(storeMap).filter(
      (s: any) => s.qtyLarge > 0 || s.qtySmall > 0 || s.qtySyrup > 0
    );

    if (!activeStores.length) {
      return new Response(JSON.stringify({ ok: true, skipped: "no_deliveries" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let grandTotal = 0;
    let totalLarge = 0, totalSmall = 0, totalSyrup = 0;
    const results: any[] = [];

    for (const [idx, store] of activeStores.entries()) {
      const storeTotal =
        (store.qtyLarge * store.largePrice) +
        (store.qtySmall * store.smallPrice) +
        (store.qtySyrup * store.syrupPrice);

      grandTotal  += storeTotal;
      totalLarge  += store.qtyLarge;
      totalSmall  += store.qtySmall;
      totalSyrup  += store.qtySyrup;

      const invoiceNum = 44043 + idx;
      const today = new Date().toLocaleDateString("he-IL", {
        day: "2-digit", month: "2-digit", year: "numeric"
      });

      let rows = "";
      if (store.qtyLarge > 0) rows += `<tr><td>${store.qtyLarge}</td><td>בקבוק גדול</td><td>${store.largePrice.toFixed(2)}</td><td>${(store.qtyLarge * store.largePrice).toFixed(2)}</td></tr>`;
      if (store.qtySmall > 0) rows += `<tr><td>${store.qtySmall}</td><td>בקבוק קטן</td><td>${store.smallPrice.toFixed(2)}</td><td>${(store.qtySmall * store.smallPrice).toFixed(2)}</td></tr>`;
      if (store.qtySyrup > 0) rows += `<tr><td>${store.qtySyrup}</td><td>סירופ</td><td>${store.syrupPrice.toFixed(2)}</td><td>${(store.qtySyrup * store.syrupPrice).toFixed(2)}</td></tr>`;

      const invoiceHTML = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;direction:rtl;color:#222;font-size:13px;padding:30px 40px;background:#fff}
.header{display:flex;justify-content:space-between;margin-bottom:18px}
.biz-name{font-size:18px;font-weight:700;color:#4a2c0a}
.title-bar{background:#4a2c0a;color:#fff;text-align:center;font-size:18px;font-weight:700;letter-spacing:4px;padding:10px;margin-bottom:18px}
.meta{display:flex;justify-content:space-between;margin-bottom:18px;border:1px solid #ddd;padding:10px 14px}
table{width:100%;border-collapse:collapse;margin-bottom:14px}
thead tr{background:#c8860a;color:#fff}
thead th{padding:8px 10px;text-align:right}
tbody tr:nth-child(even){background:#fdf6ee}
tbody td{padding:7px 10px;border-bottom:1px solid #eee}
.totals{width:260px;border:1px solid #ddd}
.totals td{padding:6px 12px}
.grand{background:#4a2c0a;color:#fff;font-weight:700}
.notes{margin-top:20px;border-top:1px solid #ddd;padding-top:12px;text-align:center}
.footer{margin-top:30px;border-top:1px solid #ddd;padding-top:8px;font-size:11px;color:#888;display:flex;justify-content:space-between}
</style></head>
<body>
<div class="header"><div></div><div style="text-align:right;line-height:1.7">
  <div class="biz-name">${BIZ_NAME}</div>
  <div>עוסק פטור מס': ${BIZ_TAXID}</div>
  <div>${BIZ_EMAIL}</div>
  <div>כתובת: ${BIZ_ADDRESS}</div>
  <div>${BIZ_PHONE}</div>
</div></div>
<div class="title-bar">ח ש ב ו ן &nbsp; ע ס ק ה &nbsp; / &nbsp;${invoiceNum}</div>
<div class="meta">
  <div><div>מקור</div><div>תאריך מסמך: ${today}</div></div>
  <div style="text-align:right"><div>עבור:</div><div><strong>שם: </strong>${store.name}</div><div>${monthName}</div></div>
</div>
<table>
  <thead><tr><th>כמות</th><th>שם פריט / שירות</th><th>מחיר ליחידה</th><th>סה"כ (₪)</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<table class="totals">
  <tr><td>סה"כ</td><td style="text-align:left">₪${storeTotal.toFixed(2)}</td></tr>
  <tr><td>הנחה</td><td style="text-align:left">₪0.00</td></tr>
  <tr><td>מע"מ 0%</td><td style="text-align:left">₪0.00</td></tr>
  <tr class="grand"><td>סה"כ לתשלום</td><td style="text-align:left">₪${storeTotal.toFixed(2)}</td></tr>
</table>
<div class="notes"><p><strong>פרטים להעברה:</strong></p><p>${BIZ_BANK}</p></div>
<div class="footer"><span>תאריך הפקה: ${today}</span><strong>מסמך ממוחשב חתום דיגיטלית</strong></div>
</body></html>`;

      const pngBytes = await htmlToPng(invoiceHTML);
      const { path, url } = await uploadInvoicePng(sb, year, month, store.id, pngBytes);

      // upsert — only the data columns get written, so regenerating a month never clobbers
      // an existing billed_at/paid_at that was already set on a previous run
      const { error: upsertErr } = await sb.from("store_billing").upsert({
        store_id: store.id,
        year, month,
        total: storeTotal,
        qty_large: store.qtyLarge,
        qty_small: store.qtySmall,
        qty_syrup: store.qtySyrup,
        image_path: path,
        image_url: url,
        updated_at: new Date().toISOString(),
      }, { onConflict: "store_id,year,month" });
      if (upsertErr) throw new Error(`store_billing upsert failed for ${store.name}: ${upsertErr.message}`);

      results.push({ store: store.name, total: storeTotal, image_url: url });
    }

    return new Response(
      JSON.stringify({ ok: true, grandTotal, stores: activeStores.length, month: monthName, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message ?? "unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
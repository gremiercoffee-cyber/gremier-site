/**
 * Gremier Coffee — Google Sheet order webhook + email
 *
 * SETUP (one time, ~5 min):
 * 1. Create a Google Sheet (e.g. "Gremier Orders")
 * 2. Extensions → Apps Script → paste this file → Save
 * 3. Set NOTIFY_EMAIL and WEBHOOK_SECRET below (pick any random secret)
 * 4. Run setupSheet() once from the editor (authorize when prompted)
 * 5. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy the web app URL → Supabase Edge Function secret:
 *    GOOGLE_ORDER_WEBHOOK_URL = that URL
 *    GOOGLE_ORDER_WEBHOOK_SECRET = same as WEBHOOK_SECRET below
 * 7. Deploy payme-webhook: npx supabase functions deploy payme-webhook
 */

var NOTIFY_EMAIL = 'gremiercoffee@gmail.com';
var WEBHOOK_SECRET = 'change-me-to-a-long-random-string';
var SHEET_NAME = 'Orders';

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Paid At',
      'Order #',
      'Order ID',
      'Customer',
      'Phone',
      'Email',
      'Address',
      'Items',
      'Subtotal',
      'Discount',
      'Total',
      'Source',
      'Notes',
      'Admin URL',
    ]);
    sheet.getRange(1, 1, 1, 14).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (WEBHOOK_SECRET && data.secret !== WEBHOOK_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }

    setupSheet();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

    sheet.appendRow([
      data.paid_at || new Date().toISOString(),
      data.order_number || data.order_label || '',
      data.order_id || '',
      data.customer_name || '',
      data.customer_phone || '',
      data.customer_email || '',
      data.delivery_address || '',
      data.items_summary || '',
      data.subtotal || 0,
      data.discount || 0,
      data.total || 0,
      data.source || '',
      data.notes || '',
      data.admin_url || '',
    ]);

    var label = data.order_number ? ('#' + data.order_number) : (data.order_label || data.order_id || 'New');
    var subject = 'Gremier — paid order ' + label + ' — ₪' + (data.total || 0);
    var body = [
      'New payment received!',
      '',
      'Order: ' + label,
      'Customer: ' + (data.customer_name || '—'),
      'Phone: ' + (data.customer_phone || '—'),
      'Email: ' + (data.customer_email || '—'),
      'Address: ' + (data.delivery_address || '—'),
      '',
      'Items:',
      data.items_summary || '—',
      '',
      'Subtotal: ₪' + (data.subtotal || 0),
      (data.discount > 0 ? ('Discount: -₪' + data.discount) : null),
      'Total: ₪' + (data.total || 0),
      data.notes ? ('Notes: ' + data.notes) : null,
      data.source ? ('Source: ' + data.source) : null,
      '',
      'Admin: ' + (data.admin_url || ''),
    ].filter(function (line) { return line !== null; }).join('\n');

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: subject,
      body: body,
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
}

function jsonResponse(obj, code) {
  var out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}

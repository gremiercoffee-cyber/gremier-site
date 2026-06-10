/**

 * Gremier Coffee — Google Sheet order webhook + email

 *

 * SETUP (one time, ~5 min):

 * 1. Open your Google Sheet → Extensions → Apps Script → paste this file → Save

 * 2. Set NOTIFY_EMAIL, WEBHOOK_SECRET, and SPREADSHEET_ID below

 * 3. Run setupSheet() once from the editor (authorize when prompted)

 * 4. Deploy → New deployment → Web app

 *    - Execute as: Me

 *    - Who has access: Anyone

 * 5. Copy the web app URL → Supabase → Project Settings → Edge Functions → Secrets:

 *    GOOGLE_ORDER_WEBHOOK_URL = that URL

 *    GOOGLE_ORDER_WEBHOOK_SECRET = same as WEBHOOK_SECRET below

 * 6. Redeploy confirm-payment-return and payme-webhook edge functions

 */



var NOTIFY_EMAIL = 'gremiercoffee@gmail.com';

var WEBHOOK_SECRET = 'change-me-to-a-long-random-string';

var SHEET_NAME = 'Web Orders';

// Your orders spreadsheet — script can live here or as standalone if this ID is set

var SPREADSHEET_ID = '1dYpQ085ez1BkmDAOTtRpUR-1zzBJa5OQsg-WnAOTLcQ';



function getSpreadsheet() {

  if (SPREADSHEET_ID) {

    return SpreadsheetApp.openById(SPREADSHEET_ID);

  }

  return SpreadsheetApp.getActiveSpreadsheet();

}



function setupSheet() {

  var ss = getSpreadsheet();

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



function doGet() {

  setupSheet();

  return jsonResponse({ ok: true, message: 'Gremier order webhook is running' });

}



function doPost(e) {

  try {

    if (!e || !e.postData || !e.postData.contents) {

      return jsonResponse({ ok: false, error: 'empty body' }, 400);

    }



    var data = JSON.parse(e.postData.contents);

    if (WEBHOOK_SECRET && WEBHOOK_SECRET !== 'change-me-to-a-long-random-string' && data.secret !== WEBHOOK_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }



    setupSheet();

    var sheet = getSpreadsheet().getSheetByName(SHEET_NAME);



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



    var customerReceipt = sendCustomerReceipt(data);

    return jsonResponse({ ok: true, customer_receipt: customerReceipt });

  } catch (err) {

    return jsonResponse({ ok: false, error: String(err) }, 500);

  }

}



/** Order confirmation to the customer (when email is on the order). */
function sendCustomerReceipt(data) {
  var email = String(data.customer_email || '').trim();
  if (!email || email.indexOf('@') < 1) {
    return { sent: false, reason: 'no_email' };
  }

  var label = data.order_number ? ('#' + data.order_number) : (data.order_label || data.order_id || '');
  var greeting = data.customer_name ? ('Hi ' + data.customer_name + ',') : 'Hi,';
  var subject = 'Gremier Coffee — order confirmation ' + label;
  var body = [
    greeting,
    '',
    'Thank you for your order! We received your payment of ₪' + (data.total || 0) + '.',
    '',
    'Order: ' + label,
    data.delivery_address ? ('Delivery: ' + data.delivery_address) : null,
    '',
    'Items:',
    data.items_summary || '—',
    '',
    data.discount > 0 ? ('Discount: -₪' + data.discount) : null,
    'Total paid: ₪' + (data.total || 0),
    '',
    'We will contact you about delivery details if we have not already.',
    'Questions? Reply to this email or message us on WhatsApp.',
    '',
    '— Gremier Coffee Co.',
    'https://gremier-site.vercel.app',
  ].filter(function (line) { return line !== null; }).join('\n');

  MailApp.sendEmail({
    to: email,
    replyTo: NOTIFY_EMAIL,
    subject: subject,
    body: body,
  });

  return { sent: true, to: email };
}

function jsonResponse(obj, code) {

  var out = ContentService.createTextOutput(JSON.stringify(obj));

  out.setMimeType(ContentService.MimeType.JSON);

  return out;

}



/** Run once from Apps Script editor to verify sheet + email without a real order. */

function testWebhook() {

  var payload = {

    secret: WEBHOOK_SECRET,

    paid_at: new Date().toISOString(),

    order_number: 9999,

    order_id: 'test-order-id',

    order_label: 'TEST',

    customer_name: 'Test Customer',

    customer_phone: '050-0000000',

    customer_email: 'test@example.com',

    delivery_address: 'Test Address',

    items_summary: '1× Test Coffee — ₪50',

    subtotal: 50,

    discount: 0,

    total: 50,

    source: 'test',

    notes: 'Manual test from Apps Script',

    admin_url: 'https://gremier-site.vercel.app/admin.html',

  };

  var e = { postData: { contents: JSON.stringify(payload) } };

  var result = doPost(e);

  Logger.log(result.getContent());

}


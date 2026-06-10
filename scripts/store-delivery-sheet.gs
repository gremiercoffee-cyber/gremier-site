/**
 * Google Apps Script — store delivery logging (Ops app → spreadsheet)
 *
 * Deploy as Web App (Execute as: Me, Who has access: Anyone).
 * Update SPREADSHEET_ID and redeploy if the script URL changes.
 * Ops calls: GET ?storeName=&phone=&large=&mini=&syrup=&date=
 *
 * IMPORTANT: Every store in ops-app STORES must appear in STORE_ALIASES below.
 * If a store logs to the sheet from Ops but the row is missing, add its name here.
 */

var SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID';
var LOG_SHEET_NAME = 'Store Deliveries';

/** Canonical name → aliases accepted from the Ops app (case-insensitive match) */
var STORE_ALIASES = {
  'Good Store': ['Good Store', 'Good store'],
  'Arzei Market': ['Arzei Market', 'Arzei'],
  "Yossi's": ["Yossi's", 'Yossis', 'Yossi'],
  'French Hill': ['French Hill'],
  'Rova Market': ['Rova Market', 'Rova'],
  'Nemirovs': ['Nemirovs', 'Nemirov'],
  'Mini Machaneyu': ['Mini Machaneyu', 'Machaneyu'],
  'Shevach Fruit Store': ['Shevach Fruit Store', 'Shevach'],
  'Birkat Sanhedria': ['Birkat Sanhedria', 'Birkat', 'Sanhedria'],
};

function normalizeStoreName(raw) {
  var name = String(raw || '').trim();
  if (!name) return null;
  var lower = name.toLowerCase();
  for (var canonical in STORE_ALIASES) {
    var aliases = STORE_ALIASES[canonical];
    for (var i = 0; i < aliases.length; i++) {
      if (aliases[i].toLowerCase() === lower) return canonical;
    }
  }
  return name;
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var storeName = normalizeStoreName(p.storeName);
    if (!storeName || !STORE_ALIASES[storeName]) {
      return ContentService.createTextOutput(JSON.stringify({
        ok: false,
        error: 'Unknown store: ' + (p.storeName || ''),
        known: Object.keys(STORE_ALIASES),
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var large = Number(p.large) || 0;
    var mini = Number(p.mini) || 0;
    var syrup = Number(p.syrup) || 0;
    var phone = String(p.phone || '');
    var dateStr = String(p.date || '').slice(0, 10) || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow(['Date', 'Store', 'Phone', 'Large', 'Mini', 'Syrup', 'Logged at']);
    }

    sheet.appendRow([dateStr, storeName, phone, large, mini, syrup, new Date()]);

    return ContentService.createTextOutput(JSON.stringify({ ok: true, store: storeName }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

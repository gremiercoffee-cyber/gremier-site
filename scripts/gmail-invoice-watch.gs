/** Invoice watcher: finds invoices and receipts (Hebrew or English) in the owner's Gmail,
 * puts them under "Invoice ?" and emails the owner a one-tap choice:
 *   ✓ Forward to invoices  → forwards to the expenses address (the expense importer files it)
 *   ✗ Not an invoice       → labels it "Not invoice"
 * Runs on Google's servers (no computer needs to be on). Separate from the read-only
 * expense importer (gmail-expense-intake.gs), which keeps its read-only access.
 *
 * Not missing anything:
 *  - every new email is scored (subject, sender, body, attachment names, receipt links), and
 *    borderline ones are flagged too: a wrong "?" costs one tap, a missed invoice costs money;
 *  - every minute it checks mail since the last good run (2 hours of overlap), and every hour it
 *    re-sweeps the last 3 days, including Spam and mail filtered out of the inbox;
 *  - a message that fails to process is retried on the next run;
 *  - an evening summary lists what is still waiting and the "maybe" emails that scored just
 *    below the line (each with the same buttons). If the summary stops arriving, it has stopped.
 *
 * Setup (once): paste this file + gmail-invoice-appsscript.json into a new Apps Script project,
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Only myself),
 * then run installInvoiceWatch and approve Google's permission screen.
 */
var INVOICE_TO = 'gremiercoffee+expenses@gmail.com';
var OWNER = 'gremiercoffee@gmail.com';
var L_ASK = 'Invoice ?', L_YES = 'Invoice ✓', L_NO = 'Not invoice';
var FLAG_AT = 4, MAYBE_AT = 2, SWEEP_DAYS = 3;

// ── Scoring ──────────────────────────────────────────────────────────────────
var HEB = 'א-ת';
var STRONG = [
  new RegExp('חשבוני(?:ת|ות)'),                                   // invoice(s)
  new RegExp('(?:^|[^' + HEB + '])[והבל]?קבל(?:ה|ות)(?![' + HEB + '])'), // receipt(s), not "התקבלה"
  /חשבון\s*עסקה/, /אישור\s*תשלום/, /חיוב\s*(?:חודשי|כרטיס|בכרטיס)/,
  /\binvoices?\b/i, /\breceipts?\b/i, /\btax\s*invoice\b/i, /\bbilling\s*statement\b/i,
  /\bpayment\s*(?:confirmation|received|receipt)\b/i, /\byour\s*(?:bill|statement)\b/i
];
var WEAK = [
  /סה["״'׳]?כ/, /מע["״'׳]?מ/, /עוסק\s*מורשה|ח\.?\s?פ\.?|ע\.?\s?מ\.?\s/, /תשלום|שולם/, /אישור\s*הזמנה/,
  /₪|\bILS\b|\bNIS\b|ש["״]ח|\$\s?\d|€\s?\d/, /\btotal\b/i, /\bamount\s*(?:due|paid|charged)\b/i,
  /\bVAT\b/i, /\bpaid\b/i, /\border\s*(?:confirmation|confirmed)\b/i, /\bsubscription\b/i, /\bcharged?\b/i
];
// Invoice/receipt services whose links mean "this is a document".
var DOC_HOSTS = /icount|greeninvoice|morning\.co|ezcount|finbotai|rivhit|invoice4u|tranzila|hyp\.co\.il|cardcom|sumit|yeshinvoice|invoice\.stripe|pay\.stripe|paypal\.com\/invoice/i;
var OWN_NAMES = /gremier|גרמיר/i;

function invoiceScore(m) {
  var subject = String(m.subject || ''), body = String(m.body || '').slice(0, 20000), from = String(m.from || '');
  var names = (m.attachments || []).map(function (a) { return a.name || ''; }).join(' ');
  var hasDoc = (m.attachments || []).some(function (a) { return /pdf|image\//i.test(a.type || '') || /\.(pdf|jpe?g|png|webp)$/i.test(a.name || ''); });
  var reasons = [], score = 0;
  function add(n, why) { score += n; reasons.push(why); }
  if (m.own) return { score: -99, reasons: ['sent by Gremier'] };
  if (STRONG.some(function (r) { return r.test(subject); })) add(3, 'subject');
  if (STRONG.some(function (r) { return r.test(names); })) add(3, 'attachment name');
  if (STRONG.some(function (r) { return r.test(body); })) add(2, 'body');
  if (hasDoc) add(1, 'PDF/photo attached');
  if (DOC_HOSTS.test(body) || DOC_HOSTS.test(from)) add(2, 'invoice service');
  var weak = WEAK.filter(function (r) { return r.test(subject + '\n' + body); }).length;
  if (weak) add(Math.min(3, weak), 'amount/VAT words');
  if (m.approvedBefore) add(5, 'you forwarded this sender before');
  if (m.rejectedBefore >= 2 && !m.approvedBefore) add(-4, 'you said no to this sender twice');
  if (m.newsletter && !hasDoc && !STRONG.some(function (r) { return r.test(subject); })) add(-2, 'newsletter');
  return { score: score, reasons: reasons };
}

function invoiceAmount(text) {
  var t = String(text || '');
  var m = t.match(/(?:סה["״'׳]?כ(?:\s*לתשלום)?|total(?:\s*(?:due|paid))?|amount(?:\s*(?:due|paid|charged))?)[^\d₪$€]{0,20}([₪$€]?\s?\d[\d,]*(?:\.\d{1,2})?\s?(?:₪|ש["״]ח|ILS|NIS)?)/i)
    || t.match(/(₪\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:₪|ש["״]ח)|\$\s?\d[\d,]*(?:\.\d{1,2})?|€\s?\d[\d,]*(?:\.\d{1,2})?)/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

// ── Gmail plumbing ───────────────────────────────────────────────────────────
function invLabel(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }
function invProps() { return PropertiesService.getScriptProperties(); }
function invSender(from) { var m = String(from || '').match(/<([^>]+)>/); return (m ? m[1] : String(from || '')).trim().toLowerCase(); }
function invSenderName(from) { var s = String(from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim(); return s || invSender(from); }
function invToken(action, id) {
  var secret = invProps().getProperty('INVOICE_SECRET');
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(action + ':' + id, secret)).replace(/=+$/, '');
}
function invLink(action, id) {
  var url = invProps().getProperty('INVOICE_WEBAPP_URL') || (ScriptApp.getService && ScriptApp.getService().getUrl());
  return url ? url + '?a=' + action + '&id=' + encodeURIComponent(id) + '&t=' + invToken(action, id) : '';
}

function invFacts(message) {
  var from = message.getFrom(), sender = invSender(from), p = invProps();
  var attachments = message.getAttachments({ includeInlineImages: false }).map(function (a) { return { name: a.getName(), type: a.getContentType() }; });
  var unsub = '';
  try { unsub = message.getHeader('List-Unsubscribe'); } catch (e) {}
  var to = [message.getTo(), message.getCc()].join(',').toLowerCase();
  return {
    id: message.getId(), subject: message.getSubject(), from: from, sender: sender, body: message.getPlainBody(), attachments: attachments,
    own: sender === OWNER || OWN_NAMES.test(invSenderName(from)) || to.indexOf(INVOICE_TO) >= 0,
    newsletter: !!unsub, approvedBefore: Number(p.getProperty('ok_' + sender) || 0) > 0, rejectedBefore: Number(p.getProperty('no_' + sender) || 0),
    date: message.getDate()
  };
}

function invButtons(id) {
  var yes = invLink('yes', id), no = invLink('no', id);
  if (!yes) return '<p style="color:#a33">Buttons are off: deploy the script as a web app, then run installInvoiceWatch again.</p>';
  return '<a href="' + yes + '" style="display:inline-block;background:#1f7a3a;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;margin:4px 8px 4px 0">✓ Forward to invoices</a>'
    + '<a href="' + no + '" style="display:inline-block;background:#eee;color:#333;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;margin:4px 0">✗ Not an invoice</a>';
}
function invEsc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function invCard(f, extra) {
  var amount = invoiceAmount(f.subject + '\n' + f.body);
  return '<div style="border:1px solid #ddd;border-radius:12px;padding:12px 14px;margin:10px 0;font-family:Arial,sans-serif">'
    + '<div style="font-size:15px"><b>' + invEsc(invSenderName(f.from)) + '</b>' + (amount ? ' · <b>' + invEsc(amount) + '</b>' : '') + '</div>'
    + '<div dir="auto" style="color:#333;margin:4px 0">' + invEsc(f.subject || '(no subject)') + '</div>'
    + '<div style="color:#777;font-size:12px">' + (f.attachments.length ? '📎 ' + invEsc(f.attachments.map(function (a) { return a.name; }).join(', ')) + ' · ' : '')
    + (extra || '') + '<a href="https://mail.google.com/mail/u/0/#all/' + f.id + '">open email</a></div>'
    + '<div style="margin-top:8px">' + invButtons(f.id) + '</div></div>';
}

function invNotify(f, spam) {
  var amount = invoiceAmount(f.subject + '\n' + f.body);
  var subject = '🧾 Invoice? ' + invSenderName(f.from) + (amount ? ' · ' + amount : '') + ' · ' + (f.subject || '').slice(0, 60);
  var html = '<div style="font-family:Arial,sans-serif;max-width:560px">' + (spam ? '<p style="color:#a33"><b>This one was in Spam.</b> Check it is real before forwarding.</p>' : '')
    + invCard(f) + '<p style="color:#999;font-size:11px">Found by the invoice watcher. Tap a button; nothing is forwarded until you do.</p></div>';
  var sent = GmailApp.createDraft(OWNER, subject, 'Invoice? ' + f.subject + '\nOpen in Gmail to choose.', { htmlBody: html, name: 'Invoice check' }).send();
  invProps().setProperty('n_' + f.id, sent.getThread().getId());
}

// ── The check ────────────────────────────────────────────────────────────────
function checkInvoices() { invRun(false); }
function sweepInvoices() { invRun(true); }

function invRun(deep, quiet) {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return;
  try {
    var p = invProps(), started = Date.now(), last = Number(p.getProperty('last_ok') || 0);
    var since = deep || !last ? started - (quiet ? 30 : SWEEP_DAYS) * 864e5 : last - 2 * 36e5;
    var q = 'in:anywhere -in:sent -in:trash -in:drafts -in:chats -from:' + OWNER + ' after:' + Math.floor(since / 1000);
    var ask = invLabel(L_ASK), failures = 0, found = [], start = 0, threads;
    do {
      threads = GmailApp.search(q, start, 100); start += threads.length;
      threads.forEach(function (thread) {
        thread.getMessages().forEach(function (message) {
          if (Date.now() - started > 270000) { failures++; return; } // Google stops scripts at 6 minutes; the rest waits for the next run
          var id = message.getId();
          if (message.getDate().getTime() < since || p.getProperty('s_' + id)) return;
          try {
            var f = invFacts(message), r = invoiceScore(f);
            if (r.score >= FLAG_AT) {
              var spam = thread.isInSpam();
              if (spam) thread.moveToInbox();
              thread.addLabel(ask);
              if (quiet) found.push(f); else invNotify(f, spam);
            } else if (r.score >= MAYBE_AT) {
              p.setProperty('m_' + id, JSON.stringify({ at: Date.now(), from: f.from, subject: String(f.subject || '').slice(0, 120), why: r.reasons.join(', ') }));
            }
            p.setProperty('s_' + id, String(Date.now()));
          } catch (e) { failures++; console.error('Invoice check failed for ' + id + ': ' + e); }
        });
      });
    } while (threads.length === 100 && start < 1000 && Date.now() - started < 270000);
    if (!failures) p.setProperty('last_ok', String(started));
    if (quiet && found.length) invSummary('🧾 ' + found.length + ' possible invoices from the last 30 days', found, []);
    invPrune(p);
  } finally { lock.releaseLock(); }
}

function invPrune(p) {
  var all = p.getProperties(), old = Date.now() - (SWEEP_DAYS + 2) * 864e5;
  Object.keys(all).forEach(function (k) {
    if (/^s_/.test(k) && Number(all[k]) < old) p.deleteProperty(k);
    if (/^m_/.test(k)) { try { if (JSON.parse(all[k]).at < Date.now() - 2 * 864e5) p.deleteProperty(k); } catch (e) { p.deleteProperty(k); } }
  });
}

// ── Evening summary: still waiting + "maybe" emails (proof it is running) ──────
function dailyInvoiceSummary() {
  var waiting = [], label = GmailApp.getUserLabelByName(L_ASK);
  if (label) label.getThreads(0, 30).forEach(function (t) {
    var m = t.getMessages().filter(function (x) { return invSender(x.getFrom()) !== OWNER; }).pop();
    if (m) waiting.push(invFacts(m));
  });
  var p = invProps(), all = p.getProperties(), maybes = [];
  Object.keys(all).filter(function (k) { return /^m_/.test(k); }).forEach(function (k) {
    try { var m = GmailApp.getMessageById(k.slice(2)); if (m) maybes.push(invFacts(m)); } catch (e) {}
    p.deleteProperty(k);
  });
  invSummary('🧾 Invoices today: ' + waiting.length + ' waiting' + (maybes.length ? ', ' + maybes.length + ' maybe' : ''), waiting, maybes.slice(0, 20));
}
function invSummary(title, waiting, maybes) {
  var html = '<div style="font-family:Arial,sans-serif;max-width:560px">'
    + (waiting.length ? '<h3>Waiting for you</h3>' + waiting.map(function (f) { return invCard(f); }).join('') : '<p>Nothing waiting. ✓</p>')
    + (maybes.length ? '<h3>Maybe (not flagged, check quickly)</h3>' + maybes.map(function (f) { return invCard(f); }).join('') : '')
    + '<p style="color:#999;font-size:11px">The invoice watcher checks your mail every minute. This summary comes every evening; if it stops coming, the watcher has stopped.</p></div>';
  GmailApp.sendEmail(OWNER, title, title, { htmlBody: html, name: 'Invoice check' });
}

// ── The buttons (web app, only the owner can open it) ─────────────────────────
function doGet(e) {
  var a = e && e.parameter && e.parameter.a, id = e && e.parameter && e.parameter.id, t = e && e.parameter && e.parameter.t;
  if (!/^(yes|no)$/.test(a || '') || !id || t !== invToken(a, id)) return invPage('This link is not valid.', '#a33');
  return invPage(invDecide(a, id), a === 'yes' ? '#1f7a3a' : '#555');
}
function invDecide(a, id) {
  var p = invProps(), done = p.getProperty('d_' + id);
  if (done) return done === 'yes' ? 'Already forwarded to invoices ✓' : 'Already marked: not an invoice';
  var message = GmailApp.getMessageById(id); if (!message) return 'That email is gone (deleted?).';
  var thread = message.getThread(), sender = invSender(message.getFrom());
  if (a === 'yes') {
    var hasDoc = message.getAttachments({ includeInlineImages: true }).some(function (x) { return /pdf|image\//i.test(x.getContentType()); });
    var options = { name: 'Gremier Coffee' };
    // No PDF or photo: attach the email itself as a PDF so the expense importer can file it.
    if (!hasDoc) options.attachments = [HtmlService.createHtmlOutput(message.getBody()).getBlob().getAs('application/pdf').setName('receipt-' + id + '.pdf')];
    message.forward(INVOICE_TO, options);
    p.setProperty('ok_' + sender, String(Number(p.getProperty('ok_' + sender) || 0) + 1));
  } else {
    p.setProperty('no_' + sender, String(Number(p.getProperty('no_' + sender) || 0) + 1));
  }
  thread.removeLabel(invLabel(L_ASK)); thread.addLabel(invLabel(a === 'yes' ? L_YES : L_NO));
  p.setProperty('d_' + id, a); p.deleteProperty('m_' + id);
  var n = p.getProperty('n_' + id);
  if (n) { try { var nt = GmailApp.getThreadById(n); nt.markRead(); nt.moveToArchive(); } catch (e) {} }
  return a === 'yes' ? 'Forwarded to invoices ✓' : 'OK, not an invoice';
}
function invPage(text, color) {
  return HtmlService.createHtmlOutput('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="font-family:Arial,sans-serif;text-align:center;padding:48px 16px"><div style="font-size:22px;font-weight:700;color:' + color + '">' + invEsc(text) + '</div><p style="color:#888">You can close this tab.</p></div>').setTitle('Invoice check');
}

// ── Install (run once, after deploying the web app) ───────────────────────────
function installInvoiceWatch() {
  var p = invProps();
  if (!p.getProperty('INVOICE_SECRET')) p.setProperty('INVOICE_SECRET', Utilities.getUuid() + Utilities.getUuid());
  var url = ScriptApp.getService().getUrl();
  if (!url) throw Error('Deploy → New deployment → Web app (Execute as: Me, Who has access: Only myself) first, then run this again.');
  p.setProperty('INVOICE_WEBAPP_URL', url);
  [L_ASK, L_YES, L_NO].forEach(invLabel);
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('checkInvoices') < 0) ScriptApp.newTrigger('checkInvoices').timeBased().everyMinutes(1).create();
  if (have.indexOf('sweepInvoices') < 0) ScriptApp.newTrigger('sweepInvoices').timeBased().everyHours(1).create();
  if (have.indexOf('dailyInvoiceSummary') < 0) ScriptApp.newTrigger('dailyInvoiceSummary').timeBased().everyDays(1).atHour(20).create();
  // First run: the last 30 days, labelled quietly with one summary email instead of one per invoice.
  invRun(true, true);
  p.setProperty('last_ok', String(Date.now()));
}

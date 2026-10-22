/** Alias-only expense attachment importer. Gmail READ-ONLY access.
 * Set the private ingress secret in Script Properties, then authorize and run
 * installExpenseIntake once. No messages are sent, modified or deleted.
 */
var EXPENSE_ALIAS='gremiercoffee+expenses@gmail.com';
var EXPENSE_ENDPOINT='https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/expense-inbox';
function expenseDecode(data){
 // Apps Script's advanced Gmail service can return decoded Byte[] instead of a base64 string.
 if(data&&typeof data==='object'&&typeof data.length==='number')return data;
 if(data&&typeof data.getBytes==='function')return data.getBytes();
 var value=String(data||'').replace(/\s/g,'').replace(/-/g,'+').replace(/_/g,'/');
 while(value.length%4)value+='=';
 try{return Utilities.base64Decode(value);}catch(e){throw Error('Message encoding failed: type='+typeof data+', length='+value.length+', invalid='+value.replace(/[A-Za-z0-9+/=]/g,'').length);}
}
// Receipt links are fetched only from this known PDF host/path, never arbitrary email URLs.
function expenseTrustedPdfUrl(url){return /^https:\/\/s3\.amazonaws\.com\/icount-pdfs\/[A-Za-z0-9_-]+\.pdf(?:\?[^\s<>"']*)?$/i.test(String(url));}
function expensePdfLinks(payload){
 var links=[];
 function walk(part){
  if(/^(text\/plain|text\/html)$/i.test(part.mimeType||'')&&part.body&&part.body.data){
   var text=Utilities.newBlob(expenseDecode(part.body.data)).getDataAsString('UTF-8').replace(/&amp;|&#38;/gi,'&');
   (text.match(/https:\/\/[^\s<>"']+/g)||[]).forEach(function(url){url=url.replace(/[),.;]+$/,'');if(expenseTrustedPdfUrl(url)&&links.indexOf(url)<0)links.push(url);});
  }
  (part.parts||[]).forEach(walk);
 }
 walk(payload);return links;
}
function expenseLinkedPdf(url){
 if(!expenseTrustedPdfUrl(url))throw Error('Unsupported receipt link.');
 var result=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:false});
 if(result.getResponseCode()!==200)throw Error('Could not download linked PDF; source email retained.');
 var bytes=result.getBlob().getBytes();
 if(bytes.length<5||bytes.slice(0,5).join(',')!=='37,80,68,70,45')throw Error('Receipt link did not return a PDF; source email retained.');
 if(bytes.length>20*1024*1024)throw Error('Linked PDF exceeds 20 MB; source email retained.');
 return Utilities.newBlob(bytes,'application/pdf',url.split('?')[0].split('/').pop());
}
function installExpenseIntake(){
 if(!PropertiesService.getScriptProperties().getProperty('EXPENSE_INGRESS_SECRET'))throw Error('Set EXPENSE_INGRESS_SECRET in Script Properties first.');
 if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='importExpenseAttachments';}))ScriptApp.newTrigger('importExpenseAttachments').timeBased().everyMinutes(5).create();
 importExpenseAttachments();
}
function importExpenseAttachments(){
 var lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  var props=PropertiesService.getScriptProperties(),secret=props.getProperty('EXPENSE_INGRESS_SECRET');if(!secret)throw Error('Expense connection secret is missing.');
  if(props.getProperty('expense_query_version')!=='2'){props.deleteProperty('expense_cursor');props.setProperty('expense_query_version','2');}
  var options={q:'{deliveredto:'+EXPENSE_ALIAS+' to:'+EXPENSE_ALIAS+'} newer_than:30d',maxResults:30},cursor=props.getProperty('expense_cursor');if(cursor)options.pageToken=cursor;
  var page;try{page=Gmail.Users.Messages.list('me',options);}catch(e){props.deleteProperty('expense_cursor');throw e;}
  var failures=0;
  (page.messages||[]).forEach(function(item){
   var key='done_'+item.id;if(props.getProperty(key))return;
   try{
    var stage='read message';
    var message=Gmail.Users.Messages.get('me',item.id,{format:'full'}),headers=message.payload.headers||[];
    var addressed=headers.some(function(h){return /^(to|delivered-to|x-original-to)$/i.test(h.name)&&String(h.value).toLowerCase().indexOf(EXPENSE_ALIAS)>=0;});
    if(!addressed)return;
    var attachments=[];
    function walk(part){
     var inline=(part.headers||[]).some(function(h){return /^content-disposition$/i.test(h.name)&&/^inline/i.test(h.value);});
     if(part.filename&&(!inline||part.mimeType==='application/pdf'))attachments.push(part);
     (part.parts||[]).forEach(walk);
    }
    walk(message.payload);
    stage='read PDF links';
    var pdfLinks=attachments.length?[]:expensePdfLinks(message.payload);if(!attachments.length&&!pdfLinks.length)return;
    if(attachments.some(function(a){return !/^(application\/pdf|image\/(jpeg|png|webp))$/i.test(a.mimeType);}))throw Error('Unsupported attachment; source email retained.');
    attachments.forEach(function(a,index){
     stage='decode attachment';
     var content=a.body.data||(a.body.attachmentId?Gmail.Users.Messages.Attachments.get('me',item.id,a.body.attachmentId).data:'');
     if(!content)throw Error('Empty attachment');var bytes=expenseDecode(content);
     if(bytes.length>20*1024*1024)throw Error('Attachment exceeds 20 MB; source email retained.');
     var blob=Utilities.newBlob(bytes,a.mimeType,a.filename);
     var response=UrlFetchApp.fetch(EXPENSE_ENDPOINT,{method:'post',headers:{'x-expense-ingress':secret},payload:{file:blob,recipient:EXPENSE_ALIAS,reference:item.id+':'+index},muteHttpExceptions:true});
     var body=JSON.parse(response.getContentText());if(response.getResponseCode()!==200||!body.saved)throw Error('Expense upload failed; source email retained.');
    });
    pdfLinks.forEach(function(url,index){
     stage='download linked PDF';
     var blob=expenseLinkedPdf(url);
     var response=UrlFetchApp.fetch(EXPENSE_ENDPOINT,{method:'post',headers:{'x-expense-ingress':secret},payload:{file:blob,recipient:EXPENSE_ALIAS,reference:item.id+':link:'+index},muteHttpExceptions:true});
     var body=JSON.parse(response.getContentText());if(response.getResponseCode()!==200||!body.saved)throw Error('Linked PDF upload failed; source email retained.');
    });props.setProperty(key,String(Date.now()));
   }catch(e){failures++;console.error('Expense import needs review for message '+item.id+': '+String(e)+' ['+stage+']');}
  });
  if(page.nextPageToken)props.setProperty('expense_cursor',page.nextPageToken);else props.deleteProperty('expense_cursor');
  var all=props.getProperties();Object.keys(all).filter(function(k){return k.indexOf('done_')===0&&Number(all[k])<Date.now()-35*86400000;}).forEach(function(k){props.deleteProperty(k);});
  var heartbeat=UrlFetchApp.fetch(EXPENSE_ENDPOINT,{method:'post',contentType:'application/json',headers:{'x-expense-ingress':secret},payload:JSON.stringify({action:'heartbeat',error_count:failures}),muteHttpExceptions:true});
  if(heartbeat.getResponseCode()!==200)throw Error('Could not update expense connection status.');
  if(failures)throw Error(failures+' expense email(s) need review. Original messages are unchanged; check execution logs.');
 }finally{lock.releaseLock();}
}

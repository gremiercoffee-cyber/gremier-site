/** Alias-only expense attachment importer. Gmail READ-ONLY access.
 * Set the private ingress secret in Script Properties, then authorize and run
 * installExpenseIntake once. No messages are sent, modified or deleted.
 */
var EXPENSE_ALIAS='gremiercoffee+expenses@gmail.com';
var EXPENSE_ENDPOINT='https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/expense-inbox';
function installExpenseIntake(){
 if(!PropertiesService.getScriptProperties().getProperty('EXPENSE_INGRESS_SECRET'))throw Error('Set EXPENSE_INGRESS_SECRET in Script Properties first.');
 if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='importExpenseAttachments';}))ScriptApp.newTrigger('importExpenseAttachments').timeBased().everyMinutes(5).create();
 importExpenseAttachments();
}
function importExpenseAttachments(){
 var lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  var props=PropertiesService.getScriptProperties(),secret=props.getProperty('EXPENSE_INGRESS_SECRET');if(!secret)throw Error('Expense connection secret is missing.');
  var options={q:'deliveredto:'+EXPENSE_ALIAS+' newer_than:30d',maxResults:30},cursor=props.getProperty('expense_cursor');if(cursor)options.pageToken=cursor;
  var page;try{page=Gmail.Users.Messages.list('me',options);}catch(e){props.deleteProperty('expense_cursor');throw e;}
  var failures=0;
  (page.messages||[]).forEach(function(item){
   var key='done_'+item.id;if(props.getProperty(key))return;
   try{
    var message=Gmail.Users.Messages.get('me',item.id,{format:'full'}),headers=message.payload.headers||[];
    var addressed=headers.some(function(h){return /^(to|delivered-to|x-original-to)$/i.test(h.name)&&String(h.value).toLowerCase().indexOf(EXPENSE_ALIAS)>=0;});
    if(!addressed)return;
    var attachments=[];
    function walk(part){
     var inline=(part.headers||[]).some(function(h){return /^content-disposition$/i.test(h.name)&&/^inline/i.test(h.value);});
     if(part.filename&&(!inline||part.mimeType==='application/pdf'))attachments.push(part);
     (part.parts||[]).forEach(walk);
    }
    walk(message.payload);if(!attachments.length)return;
    if(attachments.some(function(a){return !/^(application\/pdf|image\/(jpeg|png|webp))$/i.test(a.mimeType);}))throw Error('Unsupported attachment; source email retained.');
    attachments.forEach(function(a,index){
     var content=a.body.data||(a.body.attachmentId?Gmail.Users.Messages.Attachments.get('me',item.id,a.body.attachmentId).data:'');
     if(!content)throw Error('Empty attachment');var bytes=Utilities.base64DecodeWebSafe(content);
     if(bytes.length>20*1024*1024)throw Error('Attachment exceeds 20 MB; source email retained.');
     var blob=Utilities.newBlob(bytes,a.mimeType,a.filename);
     var response=UrlFetchApp.fetch(EXPENSE_ENDPOINT,{method:'post',headers:{'x-expense-ingress':secret},payload:{file:blob,recipient:EXPENSE_ALIAS,reference:item.id+':'+index},muteHttpExceptions:true});
     var body=JSON.parse(response.getContentText());if(response.getResponseCode()!==200||!body.saved)throw Error('Expense upload failed; source email retained.');
    });props.setProperty(key,String(Date.now()));
   }catch(e){failures++;console.error('Expense import needs review for message '+item.id+': '+String(e));}
  });
  if(page.nextPageToken)props.setProperty('expense_cursor',page.nextPageToken);else props.deleteProperty('expense_cursor');
  var all=props.getProperties();Object.keys(all).filter(function(k){return k.indexOf('done_')===0&&Number(all[k])<Date.now()-35*86400000;}).forEach(function(k){props.deleteProperty(k);});
  var heartbeat=UrlFetchApp.fetch(EXPENSE_ENDPOINT,{method:'post',contentType:'application/json',headers:{'x-expense-ingress':secret},payload:JSON.stringify({action:'heartbeat',error_count:failures}),muteHttpExceptions:true});
  if(heartbeat.getResponseCode()!==200)throw Error('Could not update expense connection status.');
  if(failures)throw Error(failures+' expense email(s) need review. Original messages are unchanged; check execution logs.');
 }finally{lock.releaseLock();}
}

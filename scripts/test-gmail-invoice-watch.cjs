const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const code=fs.readFileSync('scripts/gmail-invoice-watch.gs','utf8');

function world(mails){
 const props={},labels={},sent=[],forwards=[],threads=mails.map((m,i)=>{
  const t={id:'t'+i,labels:new Set(),spam:!!m.spam,inbox:!m.spam,archived:false,read:false,
   addLabel(l){this.labels.add(l.name);},removeLabel(l){this.labels.delete(l.name);},isInSpam(){return this.spam;},moveToInbox(){this.spam=false;this.inbox=true;},
   markRead(){this.read=true;},moveToArchive(){this.archived=true;},getId(){return this.id;}};
  const msg={getId:()=>'m'+i,getSubject:()=>m.subject||'',getFrom:()=>m.from||'Shop <shop@example.test>',getPlainBody:()=>m.body||'',getBody:()=>'<p>'+(m.body||'')+'</p>',
   getTo:()=>m.to||'gremiercoffee@gmail.com',getCc:()=>'',getDate:()=>new Date(m.date||Date.now()-60e3),getHeader:h=>h==='List-Unsubscribe'?(m.unsub||''):'',
   getAttachments:()=>(m.files||[]).map(([n,t])=>({getName:()=>n,getContentType:()=>t})),getThread:()=>t,
   forward(to,o){if(m.forwardFails)throw Error('boom');forwards.push({id:'m'+i,to,o});}};
  t.getMessages=()=>[msg];t.msg=msg;return t;});
 let failOnce=new Set(mails.map((m,i)=>m.failOnce?'m'+i:null).filter(Boolean));
 const p={getProperty:k=>props[k]??null,setProperty:(k,v)=>{props[k]=String(v);},deleteProperty:k=>{delete props[k];},getProperties:()=>({...props})};
 const c={console,Date,JSON,Math,String,Number,Object,Error,RegExp,
  PropertiesService:{getScriptProperties:()=>p},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  ScriptApp:{getService:()=>({getUrl:()=>'https://script.google.com/macros/s/X/exec'}),getProjectTriggers:()=>[],newTrigger:()=>{const b={timeBased:()=>b,everyMinutes:()=>b,everyHours:()=>b,everyDays:()=>b,atHour:()=>b,create:()=>b};return b;}},
  Utilities:{getUuid:()=>crypto.randomUUID(),computeHmacSha256Signature:(v,k)=>[...crypto.createHmac('sha256',k).update(v).digest()],base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
  HtmlService:{createHtmlOutput:h=>({html:h,setTitle(){return this;},getBlob:()=>({getAs:()=>({setName(n){this.name=n;return this;}})})})},
  GmailApp:{
   getUserLabelByName:n=>labels[n]||null,createLabel:n=>(labels[n]={name:n,getThreads:()=>threads.filter(t=>t.labels.has(n))}),
   search:(q,start)=>{c.lastQuery=q;return start?[]:threads.filter(t=>{if(failOnce.has(t.msg.getId())){failOnce.delete(t.msg.getId());t.msg.getPlainBody=(orig=>()=>{t.msg.getPlainBody=orig;throw Error('temporary');})(t.msg.getPlainBody);}return true;});},
   createDraft:(to,subject,text,o)=>({send:()=>{const nt={id:'n'+sent.length,read:false,archived:false,markRead(){this.read=true;},moveToArchive(){this.archived=true;},getId(){return this.id;}};sent.push({to,subject,html:o.htmlBody,thread:nt});return {getThread:()=>nt};}}),
   sendEmail:(to,subject,text,o)=>sent.push({to,subject,html:o.htmlBody,summary:true}),
   getMessageById:id=>threads.find(t=>t.msg.getId()===id)?.msg||null,
   getThreadById:id=>sent.find(s=>s.thread&&s.thread.id===id)?.thread}};
 vm.runInNewContext(code,c);
 c.PropertiesService.getScriptProperties().setProperty('INVOICE_SECRET','secret');
 const link=(a,id)=>{const h=sent.map(s=>s.html).join('');const m=h.match(new RegExp('\\?a='+a+'&amp;id='+id+'&amp;t=([\\w-]+)'))||h.match(new RegExp('\\?a='+a+'&id='+id+'&t=([\\w-]+)'));return m&&m[1];};
 return {c,props,threads,sent,forwards,labels,link,run:()=>c.checkInvoices()};
}
const score=(c,m)=>c.invoiceScore({...m,attachments:(m.files||[]).map(([name,type])=>({name,type}))}).score;

test('Hebrew and English invoices are flagged; ordinary mail is not',()=>{
 const {c}=world([]);
 for(const m of [
  {subject:'חשבונית מס/קבלה מספר 1043',files:[['1043.pdf','application/pdf']]},
  {subject:'קבלה על תשלום',body:'סה"כ לתשלום 250 ₪'},
  {subject:'Your receipt from Wolt',body:'Total ₪86.50'},
  {subject:'Invoice INV-2231 from Supplier Ltd',files:[['INV-2231.pdf','application/pdf']]},
  {subject:'מסמך חדש מחכה לך',body:'לצפייה במסמך https://www.greeninvoice.co.il/doc/abc סה"כ 1,180.00 ש"ח כולל מע"מ'},
  {subject:'Payment confirmation',body:'Amount charged: $29.00'},
  {subject:'Scan',files:[['חשבונית ספק.pdf','application/pdf']]}
 ])assert(score(c,m)>=4,m.subject);
 for(const m of [
  {subject:'ההזמנה שלך התקבלה',body:'נחזור אליך בקרוב'},
  {subject:'Weekend sale 20% off',body:'Shop now, receipts available in your account',unsub:'x',newsletter:true},
  {subject:'Lunch tomorrow?',body:'See you at 1'},
  {subject:'חשבונית מס 55',own:true}
 ])assert(score(c,m)<4,m.subject);
});

test('a flagged email gets the "Invoice ?" label and one notification with working buttons',()=>{
 const w=world([{subject:'חשבונית מס 77',files:[['77.pdf','application/pdf']],from:'ספק <a@supplier.test>'},{subject:'Hello',body:'hi'}]);
 w.run();
 assert.equal(w.sent.length,1);assert.match(w.sent[0].subject,/Invoice\?/);assert(w.threads[0].labels.has('Invoice ?'));assert(!w.threads[1].labels.has('Invoice ?'));
 w.run();assert.equal(w.sent.length,1,'never notifies twice');
 const t=w.link('yes','m0');assert(t);
 assert.match(w.c.doGet({parameter:{a:'yes',id:'m0',t:'forged'}}).html,/not valid/);
 assert.match(w.c.doGet({parameter:{a:'yes',id:'m0',t}}).html,/Forwarded/);
 assert.equal(w.forwards.length,1);assert.equal(w.forwards[0].to,'gremiercoffee+expenses@gmail.com');assert.equal(w.forwards[0].o.attachments,undefined,'PDF goes as is');
 assert(w.threads[0].labels.has('Invoice ✓'));assert(!w.threads[0].labels.has('Invoice ?'));assert(w.sent[0].thread.archived,'notification archived');
 assert.match(w.c.doGet({parameter:{a:'yes',id:'m0',t}}).html,/Already forwarded/);assert.equal(w.forwards.length,1);
});

test('"Not an invoice" labels it; a receipt without a PDF is forwarded with the email as a PDF',()=>{
 const w=world([{subject:'Your receipt',body:'Total ₪40'},{subject:'Invoice 12',body:'Amount due $10'}]);
 w.run();
 w.c.doGet({parameter:{a:'no',id:'m0',t:w.link('no','m0')}});assert(w.threads[0].labels.has('Not invoice'));assert.equal(w.forwards.length,0);
 w.c.doGet({parameter:{a:'yes',id:'m1',t:w.link('yes','m1')}});assert.equal(w.forwards[0].o.attachments.length,1);
});

test('Spam is checked too and moved to the inbox with a warning; own mail and expense-address mail are skipped',()=>{
 const w=world([{subject:'Invoice 9',files:[['9.pdf','application/pdf']],spam:true},{subject:'חשבונית מס 3',from:'Gremier Coffee <noreply@gremiercoffee.co.il>'},{subject:'קבלה 5',to:'gremiercoffee+expenses@gmail.com'}]);
 w.run();
 assert.match(w.c.lastQuery,/in:anywhere/);assert(!w.threads[0].spam);assert.match(w.sent[0].html,/Spam/);assert.equal(w.sent.length,1);
});

test('a message that fails is retried next run and the check window does not move on',()=>{
 const w=world([{subject:'Invoice 1',body:'Total $5',failOnce:true}]);
 w.run();assert.equal(w.sent.length,0);assert.equal(w.props.last_ok,undefined);
 w.run();assert.equal(w.sent.length,1);assert(w.props.last_ok);
});

test('borderline emails go to the evening summary as "maybe", with buttons',()=>{
 const w=world([{subject:'Your order is confirmed',body:'Total ₪120'},{subject:'Invoice 4',files:[['4.pdf','application/pdf']]}]);
 w.run();assert(w.props.m_m0);
 w.c.dailyInvoiceSummary();const s=w.sent.find(x=>x.summary);
 assert.match(s.subject,/1 waiting, 1 maybe/);assert.match(s.html,/a=yes&amp;id=m0|a=yes&id=m0/);assert.equal(w.props.m_m0,undefined);
});

test('install labels the last 30 days quietly with one summary email',()=>{
 const w=world([{subject:'Invoice 1',body:'Total $5',date:Date.now()-20*864e5},{subject:'קבלה 2',body:'סה"כ 10 ₪',date:Date.now()-2*864e5}]);
 w.c.installInvoiceWatch();
 assert.equal(w.sent.length,1);assert(w.sent[0].summary);assert.match(w.sent[0].subject,/2 possible invoices/);assert(w.props.INVOICE_WEBAPP_URL);
 w.run();assert.equal(w.sent.length,1);
});

test('manifest: web app only for the owner',()=>{
 const m=JSON.parse(fs.readFileSync('scripts/gmail-invoice-appsscript.json','utf8'));
 assert.equal(m.webapp.access,'MYSELF');assert.equal(m.webapp.executeAs,'USER_DEPLOYING');
});

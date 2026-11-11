import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';
const built=await build({stdin:{contents:"export * from './worker/invoices';export * from './shared/invoice-rules';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

const b64u=s=>Buffer.from(s).toString('base64url');
const NOW=Date.parse('2026-11-11T10:00:00Z');
function mail(id,{subject='Hello',from='Shop <shop@example.test>',to='gremiercoffee@gmail.com',text='hi',files=[],spam=false,at=NOW-60e3,unsub=''}={}){
 return {id,threadId:'t-'+id,internalDate:String(at),labelIds:spam?['SPAM']:['INBOX'],payload:{mimeType:'multipart/mixed',headers:[{name:'Subject',value:subject},{name:'From',value:from},{name:'To',value:to},{name:'Date',value:'Wed, 11 Nov 2026'},...(unsub?[{name:'List-Unsubscribe',value:unsub}]:[])],
  parts:[{mimeType:'text/plain',body:{data:b64u(text)}},...files.map(([name,type],i)=>({mimeType:type,filename:name,body:{attachmentId:'att'+i,size:10}}))]}};
}
function setup(mails,{canLabel=true,watchFrom=NOW-3600e3}={}){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('UPDATE invoice_config SET watch_from=?').run(watchFrom);
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};};
 const env={DB:{prepare,batch:async ss=>Promise.all(ss.map(s=>s.run()))},TIMEZONE:'Asia/Jerusalem'};
 const box=new Map(mails.map(x=>[x.id,x])),sent=[],mods=[],labels=[],failOnce=new Set(mails.filter(x=>x.failOnce).map(x=>x.id));
 const g={canLabel,
  async list(q){g.lastQuery=q;return{messages:[...box.keys()].map(id=>({id}))};},
  async get(id){if(failOnce.delete(id))throw Error('temporary');const x=box.get(id);return x?JSON.parse(JSON.stringify(x)):null;},
  async attachment(){return b64u('%PDF-1.7 fixture');},
  async modify(id,add,remove){mods.push({id,add,remove});},
  async labels(){return labels;},async createLabel(name){const l={id:'L'+labels.length,name};labels.push(l);return l;},
  async send(mime){const id='sent'+sent.length;sent.push({id,mime});return{id};}};
 return {env,db,g,sent,mods,labels,tick:(at=NOW)=>m.invoiceTick(env,g,at)};
}
const html=mime=>{const parts=mime.split(/\r\n\r\n/);return Buffer.from(parts.slice(1).join('').split('--')[0].replace(/\s/g,''),'base64').toString('utf8');};
const link=(s,a,id)=>{const h=s.sent.map(x=>html(x.mime)).join('');const t=h.match(new RegExp(`a=${a}&amp;id=${id}&amp;t=([\\w-]+)`))||h.match(new RegExp(`a=${a}&id=${id}&t=([\\w-]+)`));return t&&`https://x/api/invoice/decide?a=${a}&id=${id}&t=${t[1]}`;};
const decide=async(s,url)=>(await m.invoiceDecide(s.env,new Request(url),s.g,NOW+60e3)).text();
const score=x=>m.invoiceScore({from:'Shop <s@x.test>',to:'gremiercoffee@gmail.com',text:'',newsletter:false,attachments:[],...x}).score;

test('Hebrew and English invoices are flagged; ordinary mail, newsletters and own mail are not',()=>{
 for(const x of [
  {subject:'חשבונית מס/קבלה מספר 1043',attachments:[{name:'1043.pdf',type:'application/pdf'}]},
  {subject:'קבלה על תשלום',text:'סה"כ לתשלום 250 ₪'},
  {subject:'Your receipt from Wolt',text:'Total ₪86.50'},
  {subject:'Invoice INV-2231 from Supplier Ltd',attachments:[{name:'INV-2231.pdf',type:'application/pdf'}]},
  {subject:'מסמך חדש מחכה לך',text:'לצפייה במסמך https://www.greeninvoice.co.il/doc/abc סה"כ 1,180.00 ש"ח כולל מע"מ'},
  {subject:'Payment confirmation',text:'Amount charged: $29.00'},
  {subject:'Scan',attachments:[{name:'חשבונית ספק.pdf',type:'application/pdf'}]},
 ])assert(score(x)>=m.FLAG_AT,x.subject);
 for(const x of [
  {subject:'ההזמנה שלך התקבלה',text:'נחזור אליך בקרוב'},
  {subject:'Weekend sale 20% off',text:'Shop now; receipts are in your account',newsletter:true},
  {subject:'Lunch tomorrow?',text:'See you at 1'},
  {subject:'חשבונית מס 55',from:'Gremier Coffee <noreply@gremiercoffee.co.il>'},
  {subject:'קבלה 9',to:'gremiercoffee+expenses@gmail.com'},
 ])assert(score(x)<m.FLAG_AT,x.subject);
 assert.equal(m.invoiceAmount('סה"כ לתשלום: 1,180.00 ₪'),'1,180.00 ₪');assert.equal(m.invoiceAmount('Total due $29.00'),'$29.00');
});

test('an invoice gets "Invoice ?", one email with buttons and is never told twice; other mail is only recorded',async()=>{
 const s=setup([mail('a',{subject:'חשבונית מס 77',files:[['77.pdf','application/pdf']],from:'ספק בע"מ <a@supplier.test>'}),mail('b',{subject:'Lunch?'})]);
 const r=await s.tick();assert.equal(r.flagged,1);assert.equal(r.notified,1);
 assert.match(s.g.lastQuery,/in:anywhere/);assert.match(s.g.lastQuery,/-from:me/);
 assert.deepEqual(s.labels.map(l=>l.name),['Invoice ?','Invoice ✓','Not invoice']);
 assert.deepEqual(s.mods[0],{id:'a',add:['L0'],remove:[]});
 assert.equal(s.sent.length,1);assert.match(s.sent[0].mime,/^From: Invoice check <gremiercoffee@gmail.com>\r\nTo: gremiercoffee@gmail.com/);
 assert(link(s,'yes','a')&&link(s,'no','a'));
 assert.equal(s.db.prepare("SELECT status FROM invoice_mail WHERE message_id='b'").get().status,'skip');
 await s.tick(NOW+300e3);assert.equal(s.sent.length,1);
});

test('✓ forwards the email with its PDF to the invoices address once; forged links do nothing',async()=>{
 const s=setup([mail('a',{subject:'Invoice 12',text:'Amount due $10',files:[['12.pdf','application/pdf']]})]);await s.tick();
 assert.match(await decide(s,'https://x/api/invoice/decide?a=yes&id=a&t=forged'),/isn't valid/);assert.equal(s.sent.length,1);
 assert.match(await decide(s,link(s,'yes','a')),/Forwarded to invoices/);
 const fwd=s.sent[1].mime;assert.match(fwd,/\r\nTo: gremiercoffee\+expenses@gmail.com\r\n/);assert.match(fwd,/filename="12.pdf"/);assert.match(fwd,/Subject: Fwd: Invoice 12/);
 assert.deepEqual(s.mods.at(-2),{id:'a',add:['L1'],remove:['L0']});assert.deepEqual(s.mods.at(-1),{id:'sent0',add:[],remove:['INBOX','UNREAD']});
 assert.match(await decide(s,link(s,'yes','a')),/Already forwarded/);assert.equal(s.sent.length,2);
 assert.equal(s.db.prepare("SELECT ok FROM invoice_senders WHERE sender='shop@example.test'").get().ok,1);
});

test('✗ labels it "Not invoice" and forwards nothing; a receipt with no PDF is forwarded with a note',async()=>{
 const s=setup([mail('a',{subject:'Your receipt',text:'Total ₪40'}),mail('b',{subject:'Receipt 7',text:'Total ₪12',from:'Other <o@x.test>'})]);await s.tick();
 assert.match(await decide(s,link(s,'no','a')),/not an invoice/);assert.deepEqual(s.mods.at(-2),{id:'a',add:['L2'],remove:['L0']});
 assert.equal(s.sent.length,2);
 assert.match(await decide(s,link(s,'yes','b')),/won't file it by itself/);assert.equal(s.sent.length,3);
});

test('Spam is checked and moved to the inbox; mail from before the watcher started is left alone',async()=>{
 const s=setup([mail('a',{subject:'Invoice 9',files:[['9.pdf','application/pdf']],spam:true}),mail('old',{subject:'Invoice 1',files:[['1.pdf','application/pdf']],at:NOW-5*3600e3})]);
 await s.tick();
 assert.deepEqual(s.mods[0],{id:'a',add:['L0','INBOX'],remove:['SPAM']});assert.match(html(s.sent[0].mime),/was in Spam/);
 assert.equal(s.sent.length,1);assert.equal(s.db.prepare("SELECT status FROM invoice_mail WHERE message_id='old'").get().status,'skip');
});

test('a message that fails is retried and the check window does not move on',async()=>{
 const x=mail('a',{subject:'Invoice 1',text:'Total $5'});x.failOnce=true;
 const s=setup([x]);let r=await s.tick();assert.equal(r.complete,false);assert.equal(s.db.prepare('SELECT last_ok FROM invoice_config').get().last_ok,null);
 r=await s.tick(NOW+300e3);assert.equal(r.flagged,1);assert.equal(s.db.prepare('SELECT last_ok FROM invoice_config').get().last_ok,NOW+300e3);
});

test('without the label permission it still emails; borderline mail goes to the 20:00 summary with buttons',async()=>{
 const s=setup([mail('a',{subject:'Your order is confirmed',text:'Total ₪120'}),mail('b',{subject:'Invoice 4',files:[['4.pdf','application/pdf']]})],{canLabel:false});
 await s.tick();assert.equal(s.mods.length,0);assert.equal(s.sent.length,1);
 assert.equal(s.db.prepare("SELECT status FROM invoice_mail WHERE message_id='a'").get().status,'maybe');
 const evening=Date.parse('2026-11-11T18:05:00Z');await s.tick(evening);
 const sum=s.sent.at(-1).mime.replace(/=\?UTF-8\?B\?([^?]+)\?=/g,(_,x)=>Buffer.from(x,'base64').toString('utf8'));assert.match(sum,/Invoices: 1 waiting, 1 maybe/);assert(link(s,'yes','a'));
 await s.tick(evening+300e3);assert.equal(s.sent.length,2,'one summary a day');
});

test('health: stale after 45 minutes without a complete run',async()=>{
 const s=setup([]);s.db.prepare("INSERT INTO google_accounts (email,refresh_token,connected_at,scopes) VALUES ('gremiercoffee@gmail.com','x','2026-11-01','gmail.readonly')").run();
 let h=await m.invoiceHealth(s.env,NOW);assert.equal(h.stale,true);assert.equal(h.canLabel,false);
 await s.tick();h=await m.invoiceHealth(s.env,NOW+60e3);assert.equal(h.stale,false);
});

import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';
const stub={name:'stub',setup(b){b.onResolve({filter:/^@cloudflare\/puppeteer$/},()=>({path:'p',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export default {launch(){throw Error("no browser in tests")}}'}));}};
const built=await build({stdin:{contents:"export * from './worker/expense-intake';export * from './shared/expense-links';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',plugins:[stub]});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

const b64u=s=>Buffer.from(s).toString('base64url');
const NOW=Date.parse('2026-11-13T07:30:00Z'),ALIAS='gremiercoffee+expenses@gmail.com';
function mail(id,{subject='',from='Shop <shop@example.test>',html='',text='',files=[],at=NOW-60e3}={}){
 return {id,threadId:'t'+id,internalDate:String(at),labelIds:['INBOX'],payload:{mimeType:'multipart/mixed',headers:[{name:'Subject',value:subject},{name:'From',value:from},{name:'To',value:ALIAS},{name:'Date',value:'Fri, 13 Nov 2026'}],
  parts:[...(text?[{mimeType:'text/plain',body:{data:b64u(text)}}]:[]),...(html?[{mimeType:'text/html',body:{data:b64u(html)}}]:[]),...files.map(([name,type,content],i)=>({mimeType:type,filename:name,body:{attachmentId:'att'+i,size:content.length},_content:content}))]}};
}
const PDF='%PDF-1.7 '+'x'.repeat(100);
function setup(mails,{links={},failLinks=new Set()}={}){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};};
 const env={DB:{prepare,batch:async ss=>Promise.all(ss.map(s=>s.run()))},TIMEZONE:'Asia/Jerusalem'};
 db.exec(`CREATE TABLE IF NOT EXISTS nudges(id TEXT)`);
 const box=new Map(mails.map(x=>[x.id,x])),opened=[],printed=[],uploads=[];
 const g={canLabel:true,async list(q){g.q=q;return{messages:[...box.keys()].map(id=>({id}))};},async get(id){return JSON.parse(JSON.stringify(box.get(id)||null));},
  async attachment(mid,aid){const p=box.get(mid).payload.parts.find(x=>x.body.attachmentId===aid);return b64u(p._content);}};
 const io={async fetchLink(url){opened.push(url);if(failLinks.has(url))throw Error('link 500');const c=links[url];return c==null?null:{name:'doc.pdf',type:'application/pdf',bytes:new TextEncoder().encode(c)};},
  async printHtml(html,name){printed.push(html);return{name,type:'application/pdf',bytes:new TextEncoder().encode(PDF+html.length)};},
  async upload(doc,ref){uploads.push({ref,name:doc.name,type:doc.type,size:doc.bytes.length});return true;}};
 return {db,g,opened,printed,uploads,tick:(at=NOW)=>m.expenseIntakeTick(env,g,io,at),row:id=>db.prepare('SELECT * FROM expense_intake WHERE message_id=?').get(id)};
}

const RIVHIT='https://api.rivhit.co.il/pdf/FileService.svc/GetDocument/510981632/60e243d9-34d7-41a';
const ADIDA='https://adidahub.co.il/functions/downloadPdf?id=abc&t=1',CONSENT='https://adidahub.co.il/functions/marketingConsentConfirm?id=abc';
const dekelInvoice=mail('dekel',{subject:'דקל בעמ - חשבונית מס קבלה מספר 7296',from:'donotreply <donotreply@rivhit.co.il>',html:`<p>שלום קפה גרמיר,</p><p>מצורף קישור למסמך חשבונית מס קבלה מספר 7296 :</p><a href="${RIVHIT}">לצפיה במסמך לחץ כאן</a><p>נשלח באמצעות <a href="https://www.rivhit.co.il/">www.rivhit.co.il</a></p>`});
const iceInvoice=mail('ice',{subject:'חשבונית מס/קבלה מספר #104840 מ-עדידה יבוא ושיווק בע"מ',html:`<p>חשבונית המס/קבלה שלך מוכנה על סך ₪455.00.</p><a href="${ADIDA}">צפייה בחשבונית</a><p>רוצים לדעת ראשונים? <a href="${CONSENT}">לחצו כאן</a></p><a href="https://www.google.com/maps/search/x">ארלוזורוב 25</a>`});
const iceOrder=mail('iceorder',{subject:'הזמנתך #57993 מאת קרח הארץ התקבלה',html:'<p>קיבלנו את הזמנתך #57993</p><table><tr><td>צידנית</td><td>₪400.00</td></tr></table><a href="https://israelice.co.il/my-account/view-order/57993">צפייה בהזמנה</a>'});

test('the invoice links are found; consent, maps and site links are never opened',()=>{
 assert.deepEqual(m.documentLinks(m.readMessageForTest?.(dekelInvoice)?.html??Buffer.from(dekelInvoice.payload.parts[0].body.data,'base64url').toString(),''),[RIVHIT]);
 const iceHtml=Buffer.from(iceInvoice.payload.parts[0].body.data,'base64url').toString();
 assert.deepEqual(m.documentLinks(iceHtml,''),[ADIDA]);
 assert.deepEqual(m.documentLinks('<a href="https://x.test/unsubscribe?invoice=1">הסרה מרשימת התפוצה</a><a href="https://x.test/view-order/5">צפייה בהזמנה</a>',''),[]);
 // a link pasted on its own (the owner sending it from the phone)
 assert.deepEqual(m.documentLinks('','https://cb10.senzey.com/index.php?account=yz&page=view&doc_id=100398&doc_type=4&export=pdf&lang=he'),['https://cb10.senzey.com/index.php?account=yz&page=view&doc_id=100398&doc_type=4&export=pdf&lang=he']);
 assert.deepEqual(m.documentLinks('','https://ws.meyeden.co.il/API/Document/DownloadDocumentAsync?Token=abc'),['https://ws.meyeden.co.il/API/Document/DownloadDocumentAsync?Token=abc']);
 assert.equal(m.fileKind(new TextEncoder().encode('%PDF-1.4')),'application/pdf');assert.equal(m.fileKind(new TextEncoder().encode('<html>')),null);
});

test("today's Dekel and Kerach Aretz invoices are filed from their links; the order confirmation (no PDF, no invoice link) is left alone",async()=>{
 const s=setup([dekelInvoice,iceInvoice,iceOrder],{links:{[RIVHIT]:PDF,[ADIDA]:PDF}});
 const r=await s.tick();assert.equal(r.filed,2);assert.match(s.g.q,/^to:gremiercoffee\+expenses@gmail\.com /);
 assert.deepEqual(s.opened,[RIVHIT,ADIDA]);assert(!s.opened.includes(CONSENT));
 assert.deepEqual(s.uploads.map(u=>u.ref),['cos:dekel:0','cos:ice:0']);
 assert.equal(s.row('dekel').detail,'link');assert.equal(s.row('iceorder').status,'skip');assert.equal(s.printed.length,0);
 await s.tick(NOW+300e3);assert.equal(s.uploads.length,2,'never filed twice');
});

test('an attached PDF is filed as it is; photos and screenshots are left to the Gmail script',async()=>{
 const big='\x89PNG'+'x'.repeat(40000);
 const s=setup([mail('a',{subject:'Invoice 12',files:[['12.pdf','application/pdf',PDF],['logo.png','image/png',big]]}),mail('p',{files:[['PXL_1.jpg','image/jpeg','\xff\xd8\xff'+'x'.repeat(40000)]]})]);
 await s.tick();assert.deepEqual(s.uploads.map(u=>[u.ref,u.type]),[['cos:a:0','application/pdf']]);assert.equal(s.opened.length,0);assert.equal(s.row('p').status,'skip');
});

test('a link that fails is retried, then the owner is alerted instead of it being dropped',async()=>{
 const s=setup([dekelInvoice],{failLinks:new Set([RIVHIT])});
 for(let i=0;i<4;i++)await s.tick(NOW+i*300e3);
 assert.equal(s.uploads.length,0);const row=s.row('dekel');assert.equal(row.status,'gave_up');assert.equal(row.tries,4);assert.match(row.detail,/link 500/);
 await s.tick(NOW+3600e3);assert.equal(s.opened.length,4,'no more tries after giving up');
});

test('mail from before the intake started is left alone',async()=>{
 const s=setup([mail('old',{subject:'חשבונית מס 1',files:[['1.pdf','application/pdf',PDF]],at:Date.parse('2026-11-12T10:00:00Z')})]);
 await s.tick();assert.equal(s.uploads.length,0);assert.equal(s.row('old').status,'skip');
});

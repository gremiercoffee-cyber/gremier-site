import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync,crc32} from 'node:zlib';
import {build} from 'esbuild';
import {PDFDocument,PDFName,StandardFonts,degrees} from 'pdf-lib';
import {getDocumentProxy} from 'unpdf';

const out=await build({entryPoints:['worker/documents.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-network',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]google\.ts$/},()=>({contents:'export async function accessToken(){throw Error("no network")};export async function accountEmails(){return []}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export function getProvider(){return{async complete(r){globalThis.__asked=r;return globalThis.__fill}}}',loader:'js'}));
}}]});
const docs=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

/** A small valid RGBA PNG (a dark stroke on transparent), like a cropped signature. */
function png(w,h){
 const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++){raw[y*(w*4+1)]=0;for(let x=0;x<w;x++){const o=y*(w*4+1)+1+x*4;const ink=Math.abs(y-h/2-Math.sin(x/6)*h/4)<2;raw[o]=20;raw[o+1]=20;raw[o+2]=60;raw[o+3]=ink?255:0;}}
 const chunk=(t,d)=>{const len=Buffer.alloc(4);len.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc32(td)>>>0);return Buffer.concat([len,td,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 return new Uint8Array(Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
async function pdf(pages){const d=await PDFDocument.create();for(let i=0;i<pages;i++)d.addPage([595,842]);return d.save();}
const imagesOn=page=>{const x=page.node.Resources()?.lookup(PDFName.of('XObject'));return x?x.keys().length:0;};

test('both signatures go on the bottom of every one of 30 pages, side by side, and the original is untouched',async()=>{
 const original=await pdf(30);
 const {bytes,pages}=await docs.stampSignatures(original,[png(180,60),png(150,60)],'bottom-right');
 assert.equal(pages,30);
 const signed=await PDFDocument.load(bytes);
 assert.equal(signed.getPageCount(),30);
 for(const p of signed.getPages())assert.equal(imagesOn(p),2,'two signature images on every page');
 const before=await PDFDocument.load(original);assert.equal(imagesOn(before.getPage(0)),0,'the original file is not changed');
});

test('a locked PDF gets a clear message instead of a broken file',async()=>{
 await assert.rejects(docs.stampSignatures(new Uint8Array([1,2,3]),[png(10,10)]),/couldn't be opened as a PDF/);
});

function memoryEnv(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return{meta:{changes:Number(r.changes)}}}}};
 return {db,env:{DB:{prepare}}};
}

test('signing asks which signatures when there are several and none were named, and uses the named ones',async()=>{
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare}};
 const img='data:image/png;base64,'+Buffer.from(png(40,20)).toString('base64');
 await docs.saveVault(env,{kind:'signature',label:'My signature',image:img});
 await docs.saveVault(env,{kind:'signature',label:"Wife's signature",image:img});
 await docs.saveVault(env,{kind:'text',label:'Business address',text:'12 Herzl St, Beit Shemesh'});
 const {id:f}=await docs.uploadFile(env,{filename:'Mortgage.pdf',mime:'application/pdf',bytes:await pdf(3)});
 const ask=await docs.prepareSignedFile(env,{file_id:f});
 assert.equal(ask.clarification,'Which signatures?');assert.deepEqual(ask.options.sort(),['My signature',"Wife's signature"]);
 const both=await docs.prepareSignedFile(env,{file_id:f,signatures:['my signature','wife']});
 assert.deepEqual(both.signatures,['My signature',"Wife's signature"]);assert.ok(both.file_id);
 const copy=await docs.fileBytes(env,both.file_id);
 assert.equal(copy.filename,'Mortgage (signed).pdf');
 for(const p of (await PDFDocument.load(copy.bytes)).getPages())assert.equal(imagesOn(p),2,'both signatures on every page of the copy');
 assert.equal((await docs.fileInfo(env,both.file_id)).source,'made');
 assert.ok((await docs.vaultSummary(env)).includes('Business address: 12 Herzl St'));
});

test('an uploaded file bigger than one storage piece comes back byte for byte',async()=>{
 const {env}=memoryEnv();
 const big=new Uint8Array(2_100_000);for(let i=0;i<big.length;i++)big[i]=(i*31+7)%256;
 const up=await docs.uploadFile(env,{filename:'scan.jpg',mime:'image/jpeg',bytes:big});
 const back=await docs.fileBytes(env,up.id);
 assert.equal(back.bytes.length,big.length);assert.ok(Buffer.from(back.bytes).equals(Buffer.from(big)));
 const listed=(await docs.recentFiles(env,'2000-01-01')).find(x=>x.id===up.id);
 assert.equal(listed.source,'upload');
});

test('choosing one of several email matches sets the others aside',async()=>{
 const {db,env}=memoryEnv();
 for(const [id,name] of [['a','Form A.pdf'],['b','Form B.pdf']])db.prepare("INSERT INTO found_files(id,account,message_id,part_id,filename,mime,created_at,source,batch,purpose,stored) VALUES(?,'me@x.com','m','2',?,'application/pdf','2026-10-26','email','batch1','fill',1)").run(id,name);
 // already stored, so choosing needs no network
 const r=await docs.chooseFile(env,'b').catch(e=>e);
 if(r instanceof Error)assert.match(r.message,/no network|stored|file/i); else assert.equal(r.file_id,'b');
 assert.equal(db.prepare("SELECT chosen FROM found_files WHERE id='a'").get().chosen,-1);
 assert.equal(db.prepare("SELECT chosen FROM found_files WHERE id='b'").get().chosen,1);
});

test('filling a form types saved details into its fields and keeps the original',async()=>{
 const {env}=memoryEnv();
 const d=await PDFDocument.create();const page=d.addPage([595,842]);const form=d.getForm();
 const name=form.createTextField('applicant_name');name.addToPage(page,{x:50,y:700,width:200,height:20});
 const addr=form.createTextField('addr_line1');addr.addToPage(page,{x:50,y:660,width:200,height:20});
 const ok=form.createCheckBox('agree');ok.addToPage(page,{x:50,y:620,width:15,height:15});
 const phone=form.createTextField('phone');phone.addToPage(page,{x:50,y:580,width:200,height:20});
 await docs.saveVault(env,{kind:'text',label:'Business address',text:'12 Herzl St, Beit Shemesh'});
 const {id}=await docs.uploadFile(env,{filename:'BDOTS.pdf',mime:'application/pdf',bytes:await d.save()});
 globalThis.__fill=JSON.stringify({values:{applicant_name:'Yoni Grey',addr_line1:'12 Herzl St, Beit Shemesh',agree:true,nope:'x'},still_needed:['Phone number']});
 const r=await docs.fillForm(env,{file_id:id,instructions:'my name is Yoni Grey'});
assert.equal(r.filled,3);assert.equal(r.of,4);assert.deepEqual(r.still_needed,[{label:'Phone number',ask:'Phone number'}]);
 assert.match(globalThis.__asked.prompt,/addr_line1/);assert.match(globalThis.__asked.prompt,/12 Herzl St/);
 const copy=await docs.fileBytes(env,r.file_id);assert.equal(copy.filename,'BDOTS (filled).pdf');
 const f2=(await PDFDocument.load(copy.bytes)).getForm();
 assert.equal(f2.getTextField('applicant_name').getText(),'Yoni Grey');assert.ok(f2.getCheckBox('agree').isChecked());
 assert.equal((await PDFDocument.load((await docs.fileBytes(env,id)).bytes)).getForm().getTextField('applicant_name').getText(),undefined,'original unchanged');
 assert.match((await docs.fileInfo(env,r.file_id)).note,/Filled 3 of 4.*Phone number/);
});


/** A flat form: printed labels only, no fill-in boxes. */
async function flatForm(){
 const d=await PDFDocument.create();const page=d.addPage([595,842]);const f=await d.embedFont(StandardFonts.Helvetica);
 page.drawText('Application form',{x:50,y:790,size:16,font:f});
 page.drawText('Full name:',{x:50,y:700,size:11,font:f});
 page.drawText('Address: ______________________________',{x:50,y:660,size:11,font:f});
 page.drawText('ID number:',{x:50,y:620,size:11,font:f});
 page.drawText('Phone:',{x:300,y:620,size:11,font:f});
 page.drawText('Signature: __________________   Date: ________',{x:50,y:560,size:11,font:f});
 return d.save();
}
async function textOn(bytes){
 const doc=await getDocumentProxy(new Uint8Array(bytes));const tc=await (await doc.getPage(1)).getTextContent();
 return tc.items.map(i=>({s:i.str,x:i.transform[4],y:i.transform[5],w:i.width}));
}

test('a flat PDF gets the answers written beside its labels, in the space after each one',async()=>{
 const {env}=memoryEnv();
 const {id}=await docs.uploadFile(env,{filename:'Bank form.pdf',mime:'application/pdf',bytes:await flatForm()});
 globalThis.__fill=JSON.stringify({placements:[
  {what:'Full name',value:'Yoni Grey',anchor:2,where:'after'},
  {what:'Address',value:'12 Herzl St, Beit Shemesh',anchor:3,where:'after'},
 ],still_needed:[{label:'ID number',ask:"What's your ID number?"},'Phone']});
 const r=await docs.fillForm(env,{file_id:id});
 assert.equal(r.written,2);assert.equal(r.scanned,false);
 assert.deepEqual(r.still_needed,[{label:'ID number',ask:"What's your ID number?"},{label:'Phone',ask:'Phone'}]);
 assert.match(r.next,/save_detail/);
 assert.match(globalThis.__asked.prompt,/#2 p1 \(50,700 w\d+\) Full name:/,'the model sees each label with its position');
 const items=await textOn((await docs.fileBytes(env,r.file_id)).bytes);
 const label=items.find(i=>i.s==='Full name:'),name=items.find(i=>i.s==='Yoni Grey');
 assert.ok(name,'the name is real text on the page');
 assert.ok(Math.abs(name.y-label.y)<1&&name.x>label.x+label.w&&name.x<label.x+label.w+10,'right after the label, same line');
 const addrLabel=items.find(i=>i.s.startsWith('Address:')),addr=items.find(i=>i.s.includes('Herzl'));
 assert.ok(addr.x>addrLabel.x+40&&addr.x<addrLabel.x+addrLabel.w,'written on the blank line, not after it');
 const info=await docs.fileInfo(env,r.file_id);
 assert.match(info.note,/Wrote 2 answers onto the page. Still needed: ID number; Phone/);
});

test('answering what was missing: it refills from the clean original and keeps what was written',async()=>{
 const {env}=memoryEnv();
 const {id}=await docs.uploadFile(env,{filename:'Bank form.pdf',mime:'application/pdf',bytes:await flatForm()});
 globalThis.__fill=JSON.stringify({placements:[{what:'Full name',value:'Yoni Grey',anchor:2,where:'after'}],still_needed:[{label:'ID number',ask:'ID?'}]});
 const first=await docs.fillForm(env,{file_id:id});
 // The user answers; the assistant saves it under the label, then fills the copy again.
 await docs.saveVault(env,{kind:'text',label:'ID number',text:'012345678'});
 globalThis.__fill=JSON.stringify({placements:[{what:'Full name',value:'Yoni Grey',anchor:2,where:'after'},{what:'ID number',value:'012345678',anchor:4,where:'after'}],still_needed:[]});
 const second=await docs.fillForm(env,{file_id:first.file_id});
 assert.match(globalThis.__asked.prompt,/Already written on this form[\s\S]*Yoni Grey/,'the model is told what was already written');
 assert.match(globalThis.__asked.prompt,/ID number: 012345678/,'and sees the newly saved detail');
 assert.equal(second.written,2);assert.deepEqual(second.still_needed,[]);
 const info=await docs.fileInfo(env,second.file_id);
 assert.equal(info.parent_id,id,'made from the clean original, not the filled copy');
 assert.equal(info.filename,'Bank form (filled).pdf');
 const items=await textOn((await docs.fileBytes(env,second.file_id)).bytes);
 assert.equal(items.filter(i=>i.s==='Yoni Grey').length,1,'the name is written once, not twice');
 assert.ok(items.some(i=>i.s==='012345678'));
});

test('Hebrew answers go left of a Hebrew label, right to left, with numbers kept in order',async()=>{
 const {env}=memoryEnv();
 const d=await PDFDocument.create();const page=d.addPage([595,842]);
 const {embedFonts,drawValue,runs}=await import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:['worker/pdf-overlay.ts'],bundle:true,write:false,format:'esm',platform:'node'})).outputFiles[0].text).toString('base64'));
 const fonts=await embedFonts(d);
 // a Hebrew form: label at the right edge
 drawValue(page,'שם מלא:',{x:480,y:700,size:11},fonts);
 for(let i=0;i<6;i++)drawValue(page,'שורה '+i,{x:480,y:600-i*20,size:11},fonts);
 const order=runs('רחוב הרצל 12, בית שמש',fonts).map(r=>r.text).join('');
 assert.equal(order,'שמש בית ,12 הרצל רחוב','words right to left, letters left for the font engine, the number stays 12');
 // The font engine itself lays each Hebrew word right to left (so letters must not be flipped twice).
 const fk=(await import('@pdf-lib/fontkit')).default;const src=readFileSync('worker/fonts/hebrew.ts','utf8').match(/"([A-Za-z0-9+/=]{100,})"/)[1];
 const font=fk.create(Buffer.from(src,'base64'));const gid=c=>font.glyphForCodePoint(c.codePointAt(0)).id;
 assert.deepEqual(font.layout('קפה').glyphs.map(g=>g.id),[gid('ה'),gid('פ'),gid('ק')],'drawn left to right as ה פ ק, which reads קפה');
 assert.equal(runs('Apt 4B, Floor 2',fonts).map(r=>r.text).join(''),'Apt 4B, Floor 2','English unchanged');
 const {id}=await docs.uploadFile(env,{filename:'טופס.pdf',mime:'application/pdf',bytes:await d.save()});
 globalThis.__fill=JSON.stringify({placements:[{what:'שם',value:'יוני גריי',anchor:1}],still_needed:[]});
  const r=await docs.fillForm(env,{file_id:id});
 assert.match(globalThis.__asked.prompt,/#1 p1 \(480,700 w\d+\) שם מלא:/,'the label reads as one piece, in reading order');
 assert.equal(r.written,1);
 const items=await textOn((await docs.fileBytes(env,r.file_id)).bytes);
const label=items.find(i=>i.x===480&&i.y===700);
 const val=items.find(i=>i.y===700&&i.x<480);
 assert.ok(val&&val.x+val.w<=label.x,'the answer ends just left of the Hebrew label');
});

test('a scanned form (no text) is read as a picture and answers go where the model points',async()=>{
 const {env}=memoryEnv();
 const {id}=await docs.uploadFile(env,{filename:'scan.pdf',mime:'application/pdf',bytes:await pdf(1)});
 globalThis.__fill=JSON.stringify({placements:[{what:'Name',value:'Yoni Grey',page:0,x:200,y:100,size:10}],still_needed:[]});
 const r=await docs.fillForm(env,{file_id:id});
 assert.equal(r.scanned,true);assert.equal(r.written,1);assert.match(r.check,/checks the placement/);
 assert.equal(globalThis.__asked.attachments[0].kind,'pdf','the page itself was sent to look at');
 const item=(await textOn((await docs.fileBytes(env,r.file_id)).bytes)).find(i=>i.s==='Yoni Grey');
 assert.ok(Math.abs(item.x-119)<1&&Math.abs(item.y-(842-84.2))<1,'thousandths of the page from the top-left');
});

test('nothing to fill yet: it asks for the missing details instead of making an empty copy',async()=>{
 const {env}=memoryEnv();
 const {id}=await docs.uploadFile(env,{filename:'Bank form.pdf',mime:'application/pdf',bytes:await flatForm()});
 globalThis.__fill=JSON.stringify({placements:[],still_needed:[{label:'Home address',ask:"What's your home address?"}]});
 const r=await docs.fillForm(env,{file_id:id});
 assert.equal(r.file_id,undefined);assert.equal(r.still_needed[0].label,'Home address');assert.match(r.next,/save_detail/);
});

test('what is still needed is kept on the newest copy as a form, and goes away once a newer copy answers it',async()=>{
 const {env}=memoryEnv();
 const {id}=await docs.uploadFile(env,{filename:'Bank form.pdf',mime:'application/pdf',bytes:await flatForm()});
 globalThis.__fill=JSON.stringify({placements:[],still_needed:[{label:'Home address',ask:'Your home address?'}]});
 await docs.fillForm(env,{file_id:id});
 let files=await docs.recentFiles(env,'2000-01-01');
 assert.deepEqual(files.find(f=>f.id===id).needed,[{label:'Home address',ask:'Your home address?'}],'nothing filled yet: the form shows on the file itself');
 globalThis.__fill=JSON.stringify({placements:[{value:'Yoni Grey',anchor:2,where:'after'}],still_needed:[{label:'Phone',ask:'Phone?'}]});
 const a=await docs.fillForm(env,{file_id:id});
 files=await docs.recentFiles(env,'2000-01-01');
 assert.deepEqual(files.find(f=>f.id===id).needed,[],'the original no longer asks');
 assert.deepEqual(files.find(f=>f.id===a.file_id).needed,[{label:'Phone',ask:'Phone?'}]);
 assert.match(globalThis.__asked?.system??'',/flat PDF/);
 globalThis.__fill=JSON.stringify({placements:[{value:'Yoni Grey',anchor:2,where:'after'},{value:'058',anchor:5,where:'after'}],still_needed:[]});
 const b=await docs.fillForm(env,{file_id:a.file_id});
 files=await docs.recentFiles(env,'2000-01-01');
 assert.deepEqual(files.find(f=>f.id===a.file_id).needed,[]);assert.deepEqual(files.find(f=>f.id===b.file_id).needed,[]);
});

const angleOf=i=>Math.round(Math.atan2(i.t[1],i.t[0])*180/Math.PI);
async function itemsWithAngle(bytes,pageNo=1){
 const doc=await getDocumentProxy(new Uint8Array(bytes));const tc=await (await doc.getPage(pageNo)).getTextContent();
 return tc.items.map(i=>({s:i.str,t:i.transform,x:i.transform[4],y:i.transform[5],w:i.width}));
}

test('a form printed sideways: the answer is written sideways too, along the label’s line',async()=>{
 const {env}=memoryEnv();
 const d=await PDFDocument.create();const page=d.addPage([595,842]);const f=await d.embedFont(StandardFonts.Helvetica);
 page.drawText('Full name:',{x:300,y:100,size:11,font:f,rotate:degrees(90)});
 for(let i=0;i<6;i++)page.drawText('Line '+i,{x:50,y:700-i*20,size:11,font:f});
 const {id}=await docs.uploadFile(env,{filename:'Sideways.pdf',mime:'application/pdf',bytes:await d.save()});
 globalThis.__fill=JSON.stringify({placements:[{value:'Yoni Grey',anchor:1,where:'after'}],still_needed:[]});
 const r=await docs.fillForm(env,{file_id:id});
 assert.match(globalThis.__asked.prompt,/\[runs up the page\] Full name:/);
 const it=(await itemsWithAngle((await docs.fileBytes(env,r.file_id)).bytes)).find(i=>i.s==='Yoni Grey');
 assert.equal(angleOf(it),90,'written running up the page like the label');
 assert.ok(Math.abs(it.x-300)<1&&it.y>100+40&&it.y<100+70,'just after the label along its line');
});

test('scans: a page stored turned, and a page scanned sideways, both get answers along the printed lines',async()=>{
 const {env}=memoryEnv();
 const d=await PDFDocument.create();
 const turned=d.addPage([595,842]);turned.setRotation(degrees(90)); // shown landscape
 d.addPage([595,842]);
 const {id}=await docs.uploadFile(env,{filename:'scan.pdf',mime:'application/pdf',bytes:await d.save()});
 globalThis.__fill=JSON.stringify({placements:[
  // page 1 as shown (842 wide x 595 tall): a straight line across
  {value:'Gremier Coffee',page:0,x1:100,y1:200,x2:400,y2:200,size:10},
  // page 2 scanned sideways: the printed lines run up the page, so the space runs from bottom to top
  {value:'קפה',page:1,x1:300,y1:900,x2:300,y2:500,size:10},
 ],still_needed:[]});
 const r=await docs.fillForm(env,{file_id:id});
 assert.equal(r.written,2);
 const bytes=(await docs.fileBytes(env,r.file_id)).bytes;
 const a=(await itemsWithAngle(bytes,1)).find(i=>i.s.includes('Gremier'));
 assert.equal(angleOf(a),90,'on the turned page the text is stored turned, so it shows upright');
 assert.ok(Math.abs(a.x-0.2*595)<1&&Math.abs(a.y-0.1*842)<1,'the shown point maps onto the stored page');
 const b=(await itemsWithAngle(bytes,2)).find(i=>/[א-ת]/.test(i.s));
 assert.equal(angleOf(b),90,'runs up the sideways page');
 assert.ok(Math.abs(b.x-0.3*595)<1,'on the line that was marked');
 assert.ok(b.y>842*0.1&&b.y<842*0.5,'Hebrew ends at the far end of the space');
});

test('a signature line gets the saved signature picture (never its id), and a filled scan can be looked over and fixed',async()=>{
 const {env}=memoryEnv();
 const img='data:image/png;base64,'+Buffer.from(png(120,40)).toString('base64');
 const sig=await docs.saveVault(env,{kind:'signature',label:'My signature',image:img});
 assert.ok(!(await docs.vaultSummary(env)).includes(sig.id),'the summary never shows the signature id');
 const {id}=await docs.uploadFile(env,{filename:'scan.pdf',mime:'application/pdf',bytes:await pdf(1)});
 globalThis.__fill=JSON.stringify({placements:[
  {what:'Name',value:'Yoni Grey',page:0,x1:100,y1:100,x2:400,y2:100},
  {what:'Signature',signature:'My signature',page:0,x1:100,y1:900,x2:350,y2:900},
  {what:'Oops',value:sig.id,page:0,x1:100,y1:500,x2:300,y2:500},
 ],still_needed:[]});
 const r=await docs.fillForm(env,{file_id:id});
 assert.equal(r.written,2,'the name and the signature; the id is dropped');
 const doc=await PDFDocument.load((await docs.fileBytes(env,r.file_id)).bytes);
 assert.equal(imagesOn(doc.getPage(0)),1,'the signature is a picture on the page');
 assert.ok(!(await textOn((await docs.fileBytes(env,r.file_id)).bytes)).some(i=>i.s.includes(sig.id.slice(0,8))));
 let listed=(await docs.recentFiles(env,'2000-01-01')).find(f=>f.id===r.file_id);
 assert.equal(listed.scan_check,'due','the app should look it over');
 // the look-over: the name sat too high, move it
 globalThis.__fill=JSON.stringify({moves:[{n:0,x1:100,y1:130,x2:400,y2:130}]});
 const c=await docs.checkPlacement(env,r.file_id,['data:image/jpeg;base64,AAAA']);
 assert.equal(c.moved,1);
 assert.equal(globalThis.__asked.attachments[0].kind,'image');assert.match(globalThis.__asked.prompt,/#0 page 0 "Yoni Grey" line \(100,100\)/);
 const name=(await textOn((await docs.fileBytes(env,r.file_id)).bytes)).find(i=>i.s==='Yoni Grey');
 assert.ok(Math.abs(name.y-(842-0.13*842))<1,'redrawn at the corrected line, in the same copy');
 listed=(await docs.recentFiles(env,'2000-01-01')).find(f=>f.id===r.file_id);
 assert.equal(listed.scan_check,'done');assert.match(listed.note,/placement checked, 1 moved/);
 assert.equal(imagesOn((await PDFDocument.load((await docs.fileBytes(env,r.file_id)).bytes)).getPage(0)),1,'signature still there, once');
});

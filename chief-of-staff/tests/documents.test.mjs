import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync,crc32} from 'node:zlib';
import {build} from 'esbuild';
import {PDFDocument,PDFName} from 'pdf-lib';

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
assert.equal(r.filled,3);assert.equal(r.of,4);assert.deepEqual(r.still_needed,['Phone number']);
 assert.match(globalThis.__asked.prompt,/addr_line1/);assert.match(globalThis.__asked.prompt,/12 Herzl St/);
 const copy=await docs.fileBytes(env,r.file_id);assert.equal(copy.filename,'BDOTS (filled).pdf');
 const f2=(await PDFDocument.load(copy.bytes)).getForm();
 assert.equal(f2.getTextField('applicant_name').getText(),'Yoni Grey');assert.ok(f2.getCheckBox('agree').isChecked());
 assert.equal((await PDFDocument.load((await docs.fileBytes(env,id)).bytes)).getForm().getTextField('applicant_name').getText(),undefined,'original unchanged');
 assert.match((await docs.fileInfo(env,r.file_id)).note,/Filled 3 of 4.*Phone number/);
});

test('a flat PDF with no fields says so instead of pretending',async()=>{
 const {env}=memoryEnv();
 const {id}=await docs.uploadFile(env,{filename:'scan.pdf',mime:'application/pdf',bytes:await pdf(1)});
 const r=await docs.fillForm(env,{file_id:id});
 assert.equal(r.no_fields,true);assert.match(r.clarification,/no fill-in fields/);
});

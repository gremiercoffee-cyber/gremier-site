import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {deflateSync,crc32} from 'node:zlib';
import {build} from 'esbuild';
import {PDFDocument,PDFName} from 'pdf-lib';

const out=await build({entryPoints:['worker/documents.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-network',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]google\.ts$/},()=>({contents:'export async function accessToken(){throw Error("no network")};export async function accountEmails(){return []}',loader:'js'}));
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

test('signing asks which signatures when there are several and none were named, and uses the named ones',async()=>{
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare}};
 const img='data:image/png;base64,'+Buffer.from(png(40,20)).toString('base64');
 await docs.saveVault(env,{kind:'signature',label:'My signature',image:img});
 await docs.saveVault(env,{kind:'signature',label:"Wife's signature",image:img});
 await docs.saveVault(env,{kind:'text',label:'Business address',text:'12 Herzl St, Beit Shemesh'});
 db.prepare("INSERT INTO found_files(id,account,message_id,part_id,filename,mime,created_at) VALUES('f','me@x.com','m','2','Mortgage.pdf','application/pdf','2026-10-26')").run();
 const ask=await docs.prepareSignedFile(env,{file_id:'f'});
 assert.equal(ask.clarification,'Which signatures?');assert.deepEqual(ask.options.sort(),['My signature',"Wife's signature"]);
 const both=await docs.prepareSignedFile(env,{file_id:'f',signatures:['my signature','wife']});
 assert.deepEqual(both.signatures,['My signature',"Wife's signature"]);assert.ok(both.signed_file_id);
 assert.ok((await docs.vaultSummary(env)).includes('Business address: 12 Herzl St'));
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// "Send a WhatsApp to X, Y and Z": numbers come from Contacts / the address book; unclear names are asked about,
// never guessed; the app only prepares links (it sends nothing).
const out=await build({entryPoints:['worker/contacts.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-network',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]google\.ts$/},()=>({contents:'export const CONTACTS_SCOPE="contacts";export async function accessToken(){throw Error("no network in tests")}',loader:'js'}));
}}]});
const {normalizePhone,prepareWhatsApps,openWhatsApps}=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare,batch:async s=>Promise.all(s.map(x=>x.run()))}};
 const contact=(id,name,phones)=>db.prepare("INSERT INTO contacts(id,account,resource,name,phones,seen_at) VALUES(?,?,?,?,?,?)").run(id,'me@x.com','people/'+id,name,JSON.stringify(phones),'2026-10-26');
 return {db,env,contact};
}

test('phone numbers in any format become WhatsApp-ready digits',()=>{
 assert.equal(normalizePhone('054-123 4567'),'972541234567');
 assert.equal(normalizePhone('+972 54 123 4567'),'972541234567');
 assert.equal(normalizePhone('00972541234567'),'972541234567');
 assert.equal(normalizePhone('541234567'),'972541234567');
 assert.equal(normalizePhone('+1 (718) 555-0100'),'17185550100');
 assert.equal(normalizePhone('abc'),null);
});

test('clear names get a personal message each; unclear or unknown ones come back as a question, nothing guessed',async()=>{
 const h=setup();
 h.contact('1','Moshe Katz',['972541111111']);
 h.contact('2','Avi Cohen',['972542222222']);
 h.contact('3','Avi Levi',['972543333333']);
 const r=await prepareWhatsApps(h.env,{recipients:['Moshe','Avi','Shimon','054-999 8888'],message:'Hi {first_name}, the Chanukah party is Sunday.',title:'Chanukah party'});
 assert.deepEqual(r.prepared,['Moshe Katz (+972541111111)','054-999 8888 (+972549998888)']);
 assert.equal(r.which_one[0].asked_for,'Avi');assert.equal(r.which_one[0].options.length,2);
 assert.deepEqual(r.not_found,['Shimon']);assert.ok(r.clarification);
 const rows=await openWhatsApps(h.env);
 assert.equal(rows.length,2);assert.equal(rows[0].text.startsWith('Hi Moshe,')||rows[1].text.startsWith('Hi Moshe,'),true);
 const again=await prepareWhatsApps(h.env,{recipients:['Avi Levi'],message:'Hi {first_name}!'});
 assert.deepEqual(again.prepared,['Avi Levi (+972543333333)']);assert.equal(again.clarification,undefined);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Group emails: what goes out is exactly what the user tapped Send on; a second send to the same group
// within 2 minutes needs a confirmation; copies of what was just sent can't be sent again.
const sentMail=[];
globalThis.__sentMail=sentMail;
const output=await build({entryPoints:['worker/groups.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-network',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]google\.ts$/},()=>({contents:'export const WORKSPACE_SCOPES=[];export const CONTACTS_SCOPE="contacts";export async function accessToken(){};export async function accountEmails(){return []};export async function sendEmail(_env,m){globalThis.__sentMail.push(m);return {id:"x"}}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export function getProvider(){throw Error("Unexpected AI call")}',loader:'js'}));
}}]});
const {sendBroadcast}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare,batch:async s=>Promise.all(s.map(x=>x.run()))}};
 const t='2026-10-25T18:00:00.000Z';
 db.prepare("INSERT INTO contact_groups(id,name,created_at,updated_at) VALUES('g','Night Seder Rabbis',?,?)").run(t,t);
 for(const [id,name,email] of [['p1','Rabbi A','a@example.com'],['p2','Rabbi B','b@example.com']]){
  db.prepare("INSERT INTO people(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)").run(id,name,email,t,t);
  db.prepare("INSERT INTO group_members(group_id,person_id) VALUES('g',?)").run(id);
 }
 const draft=(id,subject,body,created)=>db.prepare("INSERT INTO broadcasts(id,group_id,subject,body,status,results,created_at) VALUES(?,?,?,?,'draft','[]',?)").run(id,'g',subject,body,created);
 return {db,env,draft};
}

test('a second email to the same group within 2 minutes is held for confirmation; the first goes out as written',async()=>{
 sentMail.length=0;const h=setup();
 h.draft('new','Hashgacha reports and Chanukah parties','Thank you for filling out the hashgacha report! What are your Chanukah plans?','2026-10-25T18:48:14.000Z');
 h.draft('old','Hashgacha reminder','Just a quick reminder to fill out the hashgacha.','2026-10-24T20:13:51.000Z');
 const r=await sendBroadcast(h.env,'new',{subject:'Hashgacha reports and Chanukah parties',body:'Thank you for filling out the hashgacha report! What are your Chanukah plans?'});
 assert.equal(r.sent,2);assert.ok(sentMail.every(m=>m.subject==='Hashgacha reports and Chanukah parties'));
 await assert.rejects(sendBroadcast(h.env,'old'),/RECENT_SEND/);
 assert.equal(sentMail.length,2,'the older draft did not go out');
 assert.equal(h.db.prepare("SELECT status FROM broadcasts WHERE id='old'").get().status,'draft','it is still a draft, nothing lost');
 const confirmed=await sendBroadcast(h.env,'old',{force:true});
 assert.equal(confirmed.sent,2,'an explicit "send this one too" still works');
});

test('a saved copy of the message just sent is archived so it cannot be sent again by mistake',async()=>{
 sentMail.length=0;const h=setup();
 h.draft('a','Hashgacha reminder','Hi {first_name},\n\nJust a quick reminder to fill out the hashgacha if you haven’t yet. Thanks!','2026-10-24T20:13:51.000Z');
 h.draft('b','','Hi ,\n\nJust a quick reminder to fill out the hashgacha if you haven’t yet. Thanks!','2026-10-24T20:14:43.000Z');
 h.draft('other','Schedule','No night seder Wednesday.','2026-10-24T20:15:00.000Z');
 await sendBroadcast(h.env,'b');
 assert.ok(h.db.prepare("SELECT archived_at FROM broadcasts WHERE id='a'").get().archived_at,'the duplicate draft is archived');
 assert.equal(h.db.prepare("SELECT archived_at FROM broadcasts WHERE id='other'").get().archived_at,null,'a different draft is untouched');
});

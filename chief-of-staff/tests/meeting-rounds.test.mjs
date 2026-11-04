import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const output=await build({entryPoints:['worker/meeting-rounds.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-network',setup(b){b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export function getProvider(){throw Error("Unexpected paid AI call")}',loader:'js'}));}}]});
const {organizeMeetingRounds,meetingInvitation}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const dbCode=await build({entryPoints:['worker/db.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {updateItem,createItem}=await import(`data:text/javascript;base64,${Buffer.from(dbCode.outputFiles[0].text).toString('base64')}`);
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare,async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const item=(id,title,project=null)=>db.prepare("INSERT INTO items(id,kind,title,notes,status,priority,source,project_id,created_at,updated_at) VALUES(?,'task',?,'Original notes','open',2,'manual',?,'2026-10-17','2026-10-17')").run(id,title,project);
 const project=(id,name)=>db.prepare("INSERT INTO projects(id,name,description,area,status,created_at,updated_at) VALUES(?,?,?,'personal','active','2026-10-17','2026-10-17')").run(id,name,'Specific outcome '+name);
 let calls=0,request;const provider=groups=>({complete:async req=>{calls++;request=req;return JSON.stringify({groups});}});
 const group=(name,ids,project_id=null)=>({project_id,name,description:'Complete '+name,area:'personal',item_ids:ids,confidence:.96,reason:'Tasks explicitly advance this same event and outcome'});
 const invitation=(id,chat,text='Hey, can we meet to discuss how night seder is going?')=>db.prepare("INSERT INTO whatsapp_responses(id,account,chat,chat_id,responded_at,text) VALUES(?,'personal',?,'',?,?)").run(id,chat,new Date().toISOString(),text);
 const round=(ids,project_id=null)=>({project_id,name:'Night Seder student meetings — October 2026',description:'Meet the students invited in this outreach wave about night seder',category:'yeshiva',confidence:.98,reason:'Same explicit purpose in outgoing invitations',members:ids.map(id=>({source_id:id,item_id:null}))});
 return{db,env,item,project,provider,round,invitation,calls:()=>calls,request:()=>request};
}

test('outgoing invitations become one project with separate original obligations, never appointments or reply chores',async()=>{
 const h=setup();h.invitation('a','Avi');h.invitation('b','Ben');h.invitation('x','Supplier','Can we meet to discuss the new roaster?');
 const r=await organizeMeetingRounds(h.env,{provider:h.provider([h.round(['a','b'])])});
 assert.equal(r.created,1);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,2);
 assert.equal(h.db.prepare('SELECT count(*) n FROM calendar_events').get().n,0);
 assert.equal(h.db.prepare('SELECT count(*) n FROM meeting_round_sources').get().n,2);
 assert.ok(h.db.prepare('SELECT * FROM items').all().every(i=>i.status==='open'&&i.due_at===null&&i.reply_required===0&&i.source==='meeting_round'));
 assert.match(h.request().system,/time, contact suffix/);assert.match(h.request().system,/Include people who have not answered/);
});
test('generic incoming scheduling replies and casual check-ins never create work',async()=>{
 const h=setup();h.invitation('a','Avi','Hey, how is night seder going?');h.invitation('b','Ben','Really any time tomorrow works');
 await organizeMeetingRounds(h.env,{provider:h.provider([])});assert.equal(h.calls(),0);
 assert.equal(meetingInvitation('Can we meet to discuss night seder?'),true);
});
test('repeat runs and later replies cannot recreate completed obligations; late invitation reuses the round',async()=>{
 const h=setup();h.invitation('a','Avi');h.invitation('b','Ben');await organizeMeetingRounds(h.env,{provider:h.provider([h.round(['a','b'])])});
 const p=h.db.prepare('SELECT id FROM projects').get().id;
 h.db.prepare("UPDATE items SET status='done' WHERE person='Avi'").run();
 await organizeMeetingRounds(h.env,{force:true,provider:h.provider([])});assert.equal(h.calls(),1);
 h.invitation('c','Chaim');h.invitation('a2','Avi');
 await organizeMeetingRounds(h.env,{force:true,provider:h.provider([h.round(['c','a2'],p)])});
 assert.equal(h.db.prepare('SELECT count(*) n FROM projects').get().n,1);
 assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,3);
 assert.equal(h.db.prepare("SELECT status FROM items WHERE person='Avi'").get().status,'done');
});
test('use an existing unassigned meeting task rather than copying it',async()=>{
 const h=setup();h.invitation('a','Avi');h.invitation('b','Ben');h.item('original','Meet Avi about night seder');const g=h.round(['a','b']);g.members[0].item_id='original';
 await organizeMeetingRounds(h.env,{provider:h.provider([g])});assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,2);assert.ok(h.db.prepare("SELECT project_id FROM items WHERE id='original'").get().project_id);
});
test('bad ids, same-person groups, low confidence, duplicates and locked existing tasks cannot write a partial round',async()=>{
 for(const mode of ['bad','confidence','duplicate','locked']){
 const h=setup();h.invitation('a','Avi');h.invitation('b',mode==='same'?'Avi':'Ben');const g=h.round(['a','b']);
 if(mode==='bad')g.members[1].source_id='fake';if(mode==='confidence')g.confidence=.7;if(mode==='duplicate')g.members.push(g.members[0]);
 if(mode==='locked'){h.item('locked','Meet Avi');h.db.prepare("UPDATE items SET project_assignment_locked=1 WHERE id='locked'").run();g.members[0].item_id='locked';}
 await assert.rejects(organizeMeetingRounds(h.env,{provider:h.provider([g])}));assert.equal(h.db.prepare('SELECT count(*) n FROM projects').get().n,0);
 }
});
test('unrelated invitations are left alone and unchanged inputs do not trigger repeated AI costs',async()=>{
 const h=setup();h.invitation('a','Avi');h.invitation('b','Supplier','Can we meet about the roaster?');await organizeMeetingRounds(h.env,{provider:h.provider([])});
 assert.equal((await organizeMeetingRounds(h.env,{provider:h.provider([])})).skipped,'unchanged');assert.equal(h.calls(),1);
});
test('concurrent passes claim one lease and produce just one round',async()=>{
 const h=setup();h.invitation('a','Avi');h.invitation('b','Ben');const p=h.provider([h.round(['a','b'])]);await Promise.all([organizeMeetingRounds(h.env,{provider:p}),organizeMeetingRounds(h.env,{provider:p})]);assert.equal(h.calls(),1);assert.equal(h.db.prepare('SELECT count(*) n FROM projects').get().n,1);
});

test('deleting a tracked task or project retains provenance so the same invitations never resurface',async()=>{
 const h=setup();h.invitation('a','Avi');h.invitation('b','Ben');await organizeMeetingRounds(h.env,{provider:h.provider([h.round(['a','b'])])});
 h.db.exec('DELETE FROM items; DELETE FROM projects;');await organizeMeetingRounds(h.env,{force:true,provider:h.provider([])});
 assert.equal(h.calls(),1);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,0);
});
test('manual placement during classification aborts a new round rather than creating a partial project',async()=>{
 const h=setup();h.invitation('a','Avi');h.invitation('b','Ben');h.item('original','Meet Avi about night seder');const g=h.round(['a','b']);g.members[0].item_id='original';
 const provider={complete:async()=>{h.db.prepare("UPDATE items SET project_assignment_locked=1 WHERE id='original'").run();return JSON.stringify({groups:[g]});}};
 await organizeMeetingRounds(h.env,{provider});assert.equal(h.db.prepare('SELECT count(*) n FROM projects').get().n,0);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,1);
});

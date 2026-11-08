import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
const output=await build({entryPoints:['worker/projectorganization.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-network',setup(b){b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export function getProvider(){throw Error("Unexpected paid AI call")}',loader:'js'}));}}]});
const {organizeProjects}=await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const dbCode=await build({entryPoints:['worker/db.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {updateItem,createItem}=await import(`data:text/javascript;base64,${Buffer.from(dbCode.outputFiles[0].text).toString('base64')}`);
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare,async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const item=(id,title,project=null,category=null)=>db.prepare("INSERT INTO items(id,kind,title,notes,status,priority,source,project_id,category,created_at,updated_at) VALUES(?,'task',?,'Original notes','open',2,'manual',?,?,'2026-10-17','2026-10-17')").run(id,title,project,category);
 const project=(id,name)=>db.prepare("INSERT INTO projects(id,name,description,area,status,created_at,updated_at) VALUES(?,?,?,'personal','active','2026-10-17','2026-10-17')").run(id,name,'Specific outcome '+name);
 let calls=0,request;const provider=groups=>({complete:async req=>{calls++;request=req;return JSON.stringify({groups});}});
 const group=(name,ids,project_id=null)=>({project_id,name,description:'Complete '+name,area:'personal',item_ids:ids,confidence:.96,reason:'Tasks explicitly advance this same event and outcome'});
 return{db,env,item,project,provider,group,calls:()=>calls,request:()=>request};
}
test('the organizer never creates folders: only files loose work into existing folders of the same area',async()=>{
 const h=setup();h.project('p','Alumni Shabbaton');h.item('k','Shabbaton kickoff','p','yeshiva');h.item('v','Book alumni Shabbaton venue',null,'yeshiva');h.item('m','Find mattresses for winter-break visitors',null,'yeshiva');h.item('e','Email winter-break visitors',null,'yeshiva');
 const r=await organizeProjects(h.env,{provider:h.provider([h.group('Alumni winter-break visit',['m','e']),h.group('Alumni Shabbaton',['v'],'p')])});
 assert.deepEqual(r,{created:0,assigned:1});assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,1);
 assert.equal(h.db.prepare("SELECT project_id FROM items WHERE id='v'").get().project_id,'p');assert.equal(h.db.prepare("SELECT project_id FROM items WHERE id='m'").get().project_id,null);
 assert.match(h.request().system,/never create folders/i);assert.match(h.request().system,/NEVER create a folder on your own/);
});
test('with no folders at all nothing is sent for classification',async()=>{const h=setup();h.item('a','One errand');h.item('b','Another errand');const r=await organizeProjects(h.env,{provider:h.provider([])});assert.equal(r.skipped,'nothing to group');assert.equal(h.calls(),0);});
test('one new task can be assigned to an existing matching goal',async()=>{const h=setup();h.project('p','Winter-break hosting');h.item('a','Arrange guest arrival for winter break');await organizeProjects(h.env,{provider:h.provider([h.group('Winter-break hosting',['a'],'p')])});assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,1);assert.equal(h.db.prepare("SELECT project_id FROM items WHERE id='a'").get().project_id,'p');});
test('a stale AI result cannot move a task the user changes during classification',async()=>{const h=setup();h.project('p','Winter-break hosting');h.item('a','Winter break mattresses');h.item('b','Winter break arrival');const provider={complete:async()=>{await updateItem(h.env,'a',{project_id:null});return JSON.stringify({groups:[h.group('Winter-break hosting',['a'],'p')]});}};const r=await organizeProjects(h.env,{provider});assert.equal(r.assigned,0);assert.equal(h.db.prepare("SELECT project_id FROM items WHERE id='a'").get().project_id,null);});
test('invalid IDs, duplicates, another area and low confidence never write partial organization',async()=>{for(const kind of ['invented','duplicate','area','uncertain']){const h=setup();h.project('p','A concrete outcome');h.item('k','Kickoff','p','coffee');h.item('a','Task A',null,'coffee');h.item('b','Task B',null,kind==='area'?'yeshiva':'coffee');const g=h.group('A concrete outcome',['a','b'],'p');if(kind==='invented')g.item_ids.push('missing');if(kind==='duplicate')g.item_ids.push('a');if(kind==='uncertain')g.confidence=.6;await assert.rejects(organizeProjects(h.env,{provider:h.provider([g])}));assert.equal(h.db.prepare("SELECT COUNT(*) n FROM items WHERE project_id IS NOT NULL AND id!='k'").get().n,0);}});
test('unchanged work is not repeatedly charged',async()=>{const h=setup();h.project('p','Something');h.item('a','One alumni thing');h.item('b','Another alumni thing this week');const provider=h.provider([]);await organizeProjects(h.env,{provider});const next=await organizeProjects(h.env,{provider});assert.equal(next.skipped,'unchanged');assert.equal(h.calls(),1);});
test('reminder timestamps, counters and due dates alone do not cost another model call, but new or edited work does',async()=>{
 const h=setup();h.project('p','Cups');h.item('a','Order cups');h.item('b','Confirm cup sizes');const provider=h.provider([]);
 await organizeProjects(h.env,{provider});
 h.db.prepare("UPDATE items SET updated_at='2031-01-01T00:00:00.000Z',reminded_at='2031-01-01T00:00:00.000Z',heads_up_at='2031-01-01T00:00:00.000Z',due_at='2032-01-01T00:00:00.000Z',snooze_count=4,priority=1").run();
 assert.equal((await organizeProjects(h.env,{provider})).skipped,'unchanged');
 h.db.prepare("UPDATE items SET title='Order paper cups' WHERE id='a'").run();
 assert.notEqual((await organizeProjects(h.env,{provider})).skipped,'unchanged');
});
test('concurrent organization only calls the model once',async()=>{const h=setup();h.project('p','Winter-break hosting');h.item('a','Mattresses');h.item('b','Arrival emails');const provider=h.provider([h.group('Winter-break hosting',['a','b'],'p')]);const result=await Promise.all([organizeProjects(h.env,{provider}),organizeProjects(h.env,{provider})]);assert.equal(h.calls(),1);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,1);assert.ok(result.some(r=>r.skipped==='busy'));});
test('unassigning a task manually is remembered and cannot be overridden by automatic grouping',async()=>{const h=setup();h.project('p','Winter-break hosting');h.item('a','Mattresses','p');h.item('b','Arrival emails');await updateItem(h.env,'a',{project_id:null});const r=await organizeProjects(h.env,{provider:h.provider([])});assert.equal(h.db.prepare("SELECT project_assignment_locked FROM items WHERE id='a'").get().project_assignment_locked,1);assert.ok(!JSON.parse(h.request().prompt).items.some(i=>i.id==='a'));assert.equal(r.assigned,0);});
test('new work from an unmatched incoming message remains eligible for later grouping',async()=>{const h=setup();const item=await createItem(h.env,{title:'Arrival email for winter break',project_id:null,source:'whatsapp'});assert.equal(h.db.prepare('SELECT project_assignment_locked FROM items WHERE id=?').get(item.id).project_assignment_locked,0);});


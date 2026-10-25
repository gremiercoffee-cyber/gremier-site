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
 const item=(id,title,project=null)=>db.prepare("INSERT INTO items(id,kind,title,notes,status,priority,source,project_id,created_at,updated_at) VALUES(?,'task',?,'Original notes','open',2,'manual',?,'2026-10-17','2026-10-17')").run(id,title,project);
 const project=(id,name)=>db.prepare("INSERT INTO projects(id,name,description,area,status,created_at,updated_at) VALUES(?,?,?,'personal','active','2026-10-17','2026-10-17')").run(id,name,'Specific outcome '+name);
 let calls=0,request;const provider=groups=>({complete:async req=>{calls++;request=req;return JSON.stringify({groups});}});
 const group=(name,ids,project_id=null)=>({project_id,name,description:'Complete '+name,area:'personal',item_ids:ids,confidence:.96,reason:'Tasks explicitly advance this same event and outcome'});
 return{db,env,item,project,provider,group,calls:()=>calls,request:()=>request};
}
test('distinct alumni outcomes become separate named projects while an unrelated alumni errand stays standalone',async()=>{
 const h=setup();h.item('m','Find mattresses for winter-break alumni visitors');h.item('e','Email winter-break visitors about arrival');h.item('v','Book alumni Shabbaton venue');h.item('c','Arrange catering for alumni Shabbaton');h.item('x','Reply about alumni database password');
 const r=await organizeProjects(h.env,{provider:h.provider([h.group('Alumni winter-break visit',['m','e']),h.group('Alumni Shabbaton',['v','c'])])});assert.deepEqual(r,{created:2,assigned:4});assert.equal(h.db.prepare("SELECT project_id FROM items WHERE id='x'").get().project_id,null);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM items').get().n,5);assert.match(h.request().system,/shared subject, contact or date alone is insufficient/);assert.match(h.request().system,/different.*event/i);
 const rows=h.db.prepare('SELECT title,notes,priority,status FROM items').all();assert.ok(rows.every(i=>i.notes==='Original notes'&&i.priority===2&&i.status==='open'));assert.equal(h.db.prepare('SELECT COUNT(*) n FROM project_organization_log').get().n,2);
});
test('a lone task is not converted into a project or sent for unnecessary classification',async()=>{const h=setup();h.item('one','One unrelated alumni errand');const r=await organizeProjects(h.env,{provider:h.provider([])});assert.equal(r.skipped,'nothing to group');assert.equal(h.calls(),0);});
test('a task can grow into a project when connected work arrives; original task is moved, not copied',async()=>{const h=setup();h.item('one','Find winter-break mattresses');await organizeProjects(h.env,{provider:h.provider([])});h.item('two','Email arrival instructions for winter break');await organizeProjects(h.env,{provider:h.provider([h.group('Winter-break hosting',['one','two'])])});assert.equal(h.db.prepare('SELECT COUNT(*) n FROM items').get().n,2);assert.ok(h.db.prepare("SELECT project_id FROM items WHERE id='one'").get().project_id);});
test('one new task can be assigned to an existing matching goal without creating a second project',async()=>{const h=setup();h.project('p','Winter-break hosting');h.item('a','Arrange guest arrival for winter break');await organizeProjects(h.env,{provider:h.provider([h.group('Winter-break hosting',['a'],'p')])});assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,1);assert.equal(h.db.prepare("SELECT project_id FROM items WHERE id='a'").get().project_id,'p');});
test('unassigning a task manually is remembered and cannot be overridden by automatic grouping',async()=>{const h=setup();h.project('p','Winter-break hosting');h.item('a','Mattresses','p');h.item('b','Arrival emails');await updateItem(h.env,'a',{project_id:null});const r=await organizeProjects(h.env,{provider:h.provider([])});assert.equal(h.db.prepare("SELECT project_assignment_locked FROM items WHERE id='a'").get().project_assignment_locked,1);assert.ok(!JSON.parse(h.request().prompt).items.some(i=>i.id==='a'));assert.equal(r.assigned,0);});
test('a stale AI result cannot move a task the user changes during classification',async()=>{const h=setup();h.item('a','Winter break mattresses');h.item('b','Winter break arrival');const provider={complete:async()=>{await updateItem(h.env,'a',{project_id:null});return JSON.stringify({groups:[h.group('Winter-break hosting',['a','b'])]});}};const r=await organizeProjects(h.env,{provider});assert.equal(r.assigned,0);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,0);});
test('invalid IDs, duplicate membership, lone new projects and low confidence never write partial organization',async()=>{for(const kind of ['invented','duplicate','one','uncertain']){const h=setup();h.item('a','Task A');h.item('b','Task B');const g=h.group('A concrete outcome',['a','b']);if(kind==='invented')g.item_ids.push('missing');if(kind==='duplicate')g.item_ids.push('a');if(kind==='one')g.item_ids=['a'];if(kind==='uncertain')g.confidence=.6;await assert.rejects(organizeProjects(h.env,{provider:h.provider([g])}));assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,0);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM items WHERE project_id IS NOT NULL').get().n,0);}});
test('a generic topic/date with no clear project connection can remain ungrouped and unchanged work is not repeatedly charged',async()=>{const h=setup();h.item('a','One alumni thing');h.item('b','Another alumni thing this week');const provider=h.provider([]);await organizeProjects(h.env,{provider});const next=await organizeProjects(h.env,{provider});assert.equal(next.skipped,'unchanged');assert.equal(h.calls(),1);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,0);});
test('concurrent organization only calls the model once and creates one copy of a project',async()=>{const h=setup();h.item('a','Mattresses');h.item('b','Arrival emails');const provider=h.provider([h.group('Winter-break hosting',['a','b'])]);const result=await Promise.all([organizeProjects(h.env,{provider}),organizeProjects(h.env,{provider})]);assert.equal(h.calls(),1);assert.equal(h.db.prepare('SELECT COUNT(*) n FROM projects').get().n,1);assert.ok(result.some(r=>r.skipped==='busy'));});
test('new work from an unmatched incoming message remains eligible for later grouping',async()=>{const h=setup();const item=await createItem(h.env,{title:'Arrival email for winter break',project_id:null,source:'whatsapp'});assert.equal(h.db.prepare('SELECT project_assignment_locked FROM items WHERE id=?').get(item.id).project_assignment_locked,0);});

test('an intentional afternoon batch retains its original user context for cross-area session grouping, not just recurring block membership',async()=>{
 const h=setup();h.db.prepare("INSERT INTO situations(id,name,created_at,updated_at) VALUES('coffee','Coffee time','2026-10-18','2026-10-18')").run();
 const context="Here is what I need to do this afternoon: grind beans, finish the app, and sign mortgage papers. Remind me to brew tonight separately.";
 h.db.prepare("INSERT INTO messages(id,role,content,created_at) VALUES('request','user',?,'2026-10-18T12:28:01.000Z')").run(context);
 for(const [id,title,category] of [['grind','Grind beans','coffee'],['app','Finish app','personal'],['papers','Sign papers','personal']]){
  h.item(id,title);h.db.prepare("UPDATE items SET source='voice',block_id='coffee',category=?,created_at='2026-10-18T12:28:12.000Z' WHERE id=?").run(category,id);
 }
 h.item('later','Brew tonight');h.db.prepare("UPDATE items SET kind='reminder',due_at='2026-10-18T20:15:00.000Z' WHERE id='later'").run();
 const session=h.group('Sunday afternoon — 18 October 2026',['grind','app','papers']);
 await organizeProjects(h.env,{provider:h.provider([session])});
 const prompt=JSON.parse(h.request().prompt);assert.ok(prompt.items.filter(i=>i.id!=='later').every(i=>prompt.filing_contexts[i.filing_context]===context&&i.block_name==='Coffee time'&&i.created_at.includes('2026-10-18')));
 assert.match(h.request().system,/intentional work session/);assert.match(h.request().system,/Separate future reminders/);
 const project=h.db.prepare("SELECT id FROM projects WHERE name=?").get(session.name);
 assert.equal(h.db.prepare('SELECT count(*) n FROM items WHERE project_id=?').get(project.id).n,3);
 assert.equal(h.db.prepare("SELECT project_id FROM items WHERE id='later'").get().project_id,null);
});

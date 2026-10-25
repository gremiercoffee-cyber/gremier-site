import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
async function load(entry){const b=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'});return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);}
const timing=await load('worker/attention.ts'),situations=await load('worker/situations.ts'),notifications=await load('worker/notifications.ts'),worker=(await load('worker/index.ts')).default;
const tz='Asia/Jerusalem',morning=new Date('2026-10-18T06:00:00Z'),evening=new Date('2026-10-18T17:15:00Z');
const block={id:'evening',name:'Night yeshiva',active:1,weekdays:'[0,1,2,3,4]',date:null,start_time:'20:15',end_time:'21:15',skip_dates:'',keywords:'',note:'',category:'yeshiva',created_at:'2026-10-15',updated_at:'2026-10-15'};
function setup(){const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone',JSON.stringify(tz));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare},COS_ACCESS_TOKEN:'fixture-only',TIMEZONE:tz};
 const item=(id,kind='reminder',due='2026-11-16T07:00:00.000Z',attached=null)=>db.prepare("INSERT INTO items(id,kind,title,priority,source,status,due_at,block_id,created_at,updated_at) VALUES(?,?,?,2,'manual','open',?,?,?,?)").run(id,kind,'Task '+id,due,attached,morning.toISOString(),morning.toISOString());
 const saveBlock=(id='evening',date=null,keywords='')=>db.prepare("INSERT INTO situations(id,name,active,weekdays,date,start_time,end_time,keywords,category,created_at,updated_at) VALUES(?,'Night yeshiva',1,'[0,1,2,3,4]',?,'20:15','21:15',?,'yeshiva',?,?)").run(id,date,keywords,morning.toISOString(),morning.toISOString());
 return{db,env,item,saveBlock};}
test('future monthly occurrences stay saved but are actionable only at the local reminder time, including DST',()=>{const i={kind:'reminder',due_at:'2026-11-16T07:00:00Z'};assert.equal(timing.actionableItem(i,new Map(),tz,morning),false);assert.equal(timing.actionableItem(i,new Map(),tz,new Date('2026-11-16T06:59:59Z')),false);assert.equal(timing.actionableItem(i,new Map(),tz,new Date('2026-11-16T07:00:00Z')),true);assert.equal(timing.localClock(tz,new Date(i.due_at)).mins,540);assert.equal(timing.actionableItem({kind:'task',due_at:i.due_at},new Map(),tz,morning),true,'real task deadlines may need preparation');});
test('schedule-bound work waits for its window; skips, muted and snoozed items remain quiet',()=>{const blocks=new Map([['evening',block]]),i={kind:'task',block_id:'evening'};assert.equal(timing.actionableItem(i,blocks,tz,morning),false);assert.equal(timing.actionableItem(i,blocks,tz,evening),true);assert.equal(timing.actionableItem({...i,muted:1},blocks,tz,evening),false);assert.equal(timing.actionableItem({...i,nudge_after:'2026-10-19T10:00:00Z'},blocks,tz,evening),false);assert.equal(timing.blockWindow({...block,skip_dates:'2026-10-18'},tz,evening).current,false);});
test('meetings and stale Now cards do not surface early or return on the next recurring day',()=>{const b={...block,id:'meet',date:'2026-10-18',keywords:'wa-meet:A'},state={at:morning,tz,blocks:new Map([['meet',b],['evening',block]]),items:new Map()};const n={type:'meeting',item_id:'meet',created_at:morning.toISOString()};assert.equal(timing.actionableNotice(n,state),false);assert.equal(timing.actionableNotice(n,{...state,at:evening}),true);assert.equal(timing.actionableNotice(n,{...state,at:new Date('2026-10-18T19:00:00Z')}),false);const now={type:'situation',topic_key:'block:evening',created_at:'2026-10-15T17:15:00Z'};assert.equal(timing.actionableNotice(now,{...state,at:evening}),false);assert.equal(timing.actionableNotice({...now,updated_at:evening.toISOString()},{...state,at:evening}),true);});
test('dashboard hides the prepared next-month reminder and early meeting without losing records or the full-day view',async t=>{t.mock.timers.enable({apis:['Date'],now:morning});const h=setup();h.item('monthly');h.item('later-today','reminder','2026-10-18T17:15:00.000Z');h.item('normal','task',null);h.saveBlock('meet','2026-10-18','wa-meet:A');await notifications.recordNotification(h.env,'meeting','Meet A','With A','meet','/');const response=await worker.fetch(new Request('https://fixture/api/dashboard',{headers:{authorization:'Bearer fixture-only'}}),h.env,{waitUntil(){}});assert.equal(response.status,200);const d=await response.json();assert.deepEqual(d.todo.map(i=>i.id),['normal']);assert.equal(d.nudges.some(n=>n.type==='meeting'),false);assert.equal(d.today.some(i=>i.id==='later-today'),true,'daily overview keeps the full day');assert.equal(h.db.prepare("SELECT status FROM items WHERE id='monthly'").get().status,'open');assert.deepEqual(await notifications.activeNotificationIds(h.env,h.db.prepare('SELECT id FROM nudges').all().map(n=>n.id)),[]);});
test('time block suggestions exclude next-month reminders and wrapups retain unfinished attached tasks',async t=>{t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.saveBlock();h.item('monthly');h.item('attached','task',null,'evening');const b=h.db.prepare("SELECT * FROM situations WHERE id='evening'").get();const items=await situations.itemsFor(h.env,b);assert.deepEqual(items.map(i=>i.id),['attached']);const after=new Date('2026-10-18T18:20:00Z'),state=await timing.attentionState(h.env,after);assert.equal(timing.actionableNoticeItem(state.items.get('attached'),{type:'wrapup',topic_key:'block:evening'},state),true);});
test('a scheduled meeting emits one at-time notification and none before or after its window',async t=>{t.mock.timers.enable({apis:['Date'],now:morning});const h=setup();h.saveBlock('meet','2026-10-18','wa-meet:A');assert.equal(await situations.runSituations(h.env),0);assert.equal(h.db.prepare('SELECT count(*) n FROM nudges').get().n,0);t.mock.timers.setTime(evening.getTime());assert.equal(await situations.runSituations(h.env),1);assert.equal(await situations.runSituations(h.env),0);assert.equal(h.db.prepare("SELECT count(*) n FROM nudges WHERE type='meeting'").get().n,1);t.mock.timers.setTime(new Date('2026-10-18T19:00:00Z').getTime());assert.deepEqual(await notifications.activeNotificationIds(h.env,h.db.prepare('SELECT id FROM nudges').all().map(n=>n.id)),[]);});

const actions = await load('worker/actions.ts');
const itemDb = await load('worker/db.ts');
const dashboard = async h => {
 const response=await worker.fetch(new Request('https://fixture/api/dashboard',{headers:{authorization:'Bearer fixture-only'}}),h.env,{waitUntil(){}});
 assert.equal(response.status,200);return response.json();
};
test('a repeating block note has a removal action even with no tasks; hiding only lasts for that alert',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.saveBlock();
 h.db.prepare("UPDATE situations SET note='Inventory fixture' WHERE id='evening'").run();
 const record=()=>notifications.recordNotification(h.env,'situation','Night yeshiva: a reminder','📝 Inventory fixture',null,'/',{topic:'block:evening',itemIds:[]});
 const first=await record();let d=await dashboard(h);
 assert.equal(d.nudges.length,1);assert.deepEqual(d.nudges[0].actions.map(a=>a.id),['clear_note','ok']);
 await actions.applyAction(h.env,first.id,'ok');assert.equal((await dashboard(h)).nudges.length,0);
 assert.equal(h.db.prepare("SELECT note FROM situations WHERE id='evening'").get().note,'Inventory fixture');
 const next=await record();await actions.applyAction(h.env,next.id,'clear_note');
 assert.equal(h.db.prepare("SELECT note FROM situations WHERE id='evening'").get().note,'');
 assert.equal((await dashboard(h)).nudges.length,0);assert.equal(await situations.runSituations(h.env),0);
});
test('removing a repeating note preserves real tasks and stale phone actions cannot remove a newer note',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.saveBlock();h.item('real','task',null,'evening');
 h.db.prepare("UPDATE situations SET note='Old note' WHERE id='evening'").run();
 const n=await notifications.recordNotification(h.env,'situation','1 thing for now','📝 Old note\n• Task real',null,'/',{topic:'block:evening',itemIds:['real']});
 h.db.prepare("UPDATE situations SET note='New note' WHERE id='evening'").run();
 await actions.applyAction(h.env,n.id,'clear_note');assert.equal(h.db.prepare("SELECT note FROM situations WHERE id='evening'").get().note,'New note');
 h.db.prepare("UPDATE situations SET note='Old note' WHERE id='evening'").run();await actions.applyAction(h.env,n.id,'clear_note');
 const d=await dashboard(h);assert.equal(d.nudges[0].items[0].id,'real');assert.equal(d.nudges[0].body,'• Task real');
 assert.equal(h.db.prepare("SELECT status FROM items WHERE id='real'").get().status,'open');
});
test('Done and Not needed close work everywhere while Later leaves it intact until a time is saved',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.item('a','task',null);h.item('b','task',null);
 const a=await notifications.recordNotification(h.env,'reminder','Task a','','a','/');
 await notifications.recordNotification(h.env,'digest','2 things','• Task a\n• Task b',null,'/',{itemIds:['a','b']});
 const pick=await actions.applyAction(h.env,a.id,'reschedule');assert.match(pick.open,/reschedule=1/);
 assert.equal(h.db.prepare('SELECT dismissed FROM nudges WHERE id=?').get(a.id).dismissed,0);
 assert.equal(h.db.prepare("SELECT due_at FROM items WHERE id='a'").get().due_at,null);
 await actions.applyAction(h.env,a.id,'done');const d=await dashboard(h);
 assert.equal(d.nudges.some(n=>n.item_id==='a'||n.items?.some(i=>i.id==='a')),false);
 assert.equal(h.db.prepare("SELECT status FROM items WHERE id='a'").get().status,'done');
 assert.deepEqual(d.nudges.flatMap(n=>n.items??[]).map(i=>i.id),['b']);
 const b=await notifications.recordNotification(h.env,'reminder','Task b','','b','/');await actions.applyAction(h.env,b.id,'notneeded');
 assert.equal(h.db.prepare("SELECT status FROM items WHERE id='b'").get().status,'dropped');assert.equal((await dashboard(h)).nudges.length,0);
 await itemDb.updateItem(h.env,'b',{status:'open'});assert.equal(h.db.prepare("SELECT status FROM items WHERE id='b'").get().status,'open');
});
test('mute suppresses home and phone alerts while preserving the task in storage',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.item('a','task',null);
 const n=await notifications.recordNotification(h.env,'reminder','Task a','','a','/');await actions.applyAction(h.env,n.id,'ignore');
 const again=await notifications.recordNotification(h.env,'reminder','Task a','','a','/');
 assert.equal(h.db.prepare("SELECT status FROM items WHERE id='a'").get().status,'open');assert.equal((await dashboard(h)).nudges.length,0);
 assert.deepEqual(await notifications.activeNotificationIds(h.env,[again.id]),[]);
 assert.deepEqual(actions.actionsFor({type:'reminder',item_id:'a'}).slice(0,3).map(a=>a.id),['done','reschedule','notneeded']);
});

test('Now exposes the original task IDs under their project name and completing them updates the project without extra model calls',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.saveBlock();
 h.db.prepare("INSERT INTO projects(id,name,description,area,created_at,updated_at) VALUES('session','Sunday afternoon — 18 October 2026','This afternoon only','personal',?,?)").run(evening.toISOString(),evening.toISOString());
 h.item('first','task',null,'evening');h.item('second','task',null,'evening');
 h.db.prepare("UPDATE items SET project_id='session' WHERE id IN ('first','second')").run();
 let d=await dashboard(h);assert.equal(d.now_block.items.length,2);assert.ok(d.now_block.items.every(i=>i.project_id==='session'&&i.project==='Sunday afternoon — 18 October 2026'));
 await itemDb.updateItem(h.env,'first',{status:'done'});d=await dashboard(h);assert.deepEqual(d.now_block.items.map(i=>i.id),['second']);assert.equal(d.projects.find(p=>p.id==='session').done_count,1);
 await itemDb.updateItem(h.env,'second',{status:'done'});d=await dashboard(h);assert.equal(d.now_block.count,0);assert.equal(h.db.prepare("SELECT status FROM projects WHERE id='session'").get().status,'done');assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,2);
});

test('Now exists between blocks, suggests available work, and excludes future, muted and snoozed items',async t=>{
 t.mock.timers.enable({apis:['Date'],now:morning});const h=setup();h.saveBlock();
 let d=await dashboard(h);assert.equal(d.now_block.id,'now');assert.deepEqual(d.now_block.items,[]);
 h.item('personal','task',null);h.item('due','reminder','2026-10-18T05:00:00Z');h.item('future');h.item('bound','task',null,'evening');h.item('muted','task',null);h.item('snoozed','task',null);h.item('future-task','task','2026-10-20T05:00:00Z');
 h.db.prepare("UPDATE items SET category='personal' WHERE id='personal'").run();h.db.prepare("UPDATE items SET muted=1 WHERE id='muted'").run();h.db.prepare("UPDATE items SET nudge_after='2026-10-19T05:00:00Z' WHERE id='snoozed'").run();
 d=await dashboard(h);assert.deepEqual(d.now_block.items.map(i=>i.id),['due','personal']);assert.equal(d.now_block.items.find(i=>i.id==='personal').category,'personal');
 await itemDb.updateItem(h.env,'due',{status:'done'});d=await dashboard(h);assert.deepEqual(d.now_block.items.map(i=>i.id),['personal']);
});
test('Now follows the current block while retaining cross-area attached tasks and due reminders',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.saveBlock();h.item('personal','task',null,'evening');h.item('yeshiva','task',null);h.item('coffee','task',null);h.item('due','reminder','2026-10-18T17:00:00Z');
 h.db.prepare("UPDATE items SET category='personal' WHERE id='personal'").run();h.db.prepare("UPDATE items SET category='yeshiva' WHERE id='yeshiva'").run();h.db.prepare("UPDATE items SET category='coffee' WHERE id='coffee'").run();
 let d=await dashboard(h);assert.equal(d.now_block.id,'evening');assert.deepEqual(new Set(d.now_block.items.map(i=>i.id)),new Set(['personal','yeshiva','due']));
 t.mock.timers.setTime(new Date('2026-10-18T19:00:00Z').getTime());d=await dashboard(h);assert.equal(d.now_block.id,'now');assert.equal(d.now_block.items.some(i=>i.id==='personal'),false,'attached work stays in its time window');assert.equal(d.now_block.items.some(i=>i.id==='coffee'),true);
});

const contexts=await load('worker/work-context.ts');
async function commuteFixture(h){
 await situations.saveSituation(h.env,{name:'Commute to yeshiva',category:'yeshiva',activity_mode:'driving',weekdays:[1],start_time:'08:00',end_time:'09:15'});
 await situations.saveSituation(h.env,{name:'At yeshiva',category:'yeshiva',weekdays:[1],start_time:'09:15',end_time:'13:00'});
 return h.db.prepare("SELECT * FROM situations WHERE name='Commute to yeshiva'").get();
}
test('a drive selects calls across all areas and explicit voice work, excluding desk work even when attached',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T05:30:00Z')});const h=setup(),drive=await commuteFixture(h);
 for(const [id,title,category,mode] of [['personal','Call the plumber','personal','unspecified'],['business','Call supplier','coffee','call'],['voice','Plan app changes by voice','personal','voice'],['desk','Finish the app','personal','desk'],['onsite','Talk to Rabbi in person','yeshiva','physical'],['print','Print papers','yeshiva','unspecified']]){
  h.item(id,'task',null,id==='print'?drive.id:null);h.db.prepare('UPDATE items SET title=?,category=?,execution_mode=? WHERE id=?').run(title,category,mode,id);
 }
 h.db.prepare("UPDATE items SET source='gmail' WHERE id='business'").run();h.item('later','reminder','2026-10-19T13:00:00Z');
 const selected=await situations.itemsFor(h.env,drive);assert.deepEqual(new Set(selected.map(i=>i.id)),new Set(['personal','business','voice']));
 const d=await dashboard(h);assert.deepEqual(new Set(d.now_block.items.map(i=>i.id)),new Set(['personal','business','voice']));
 assert.equal(h.db.prepare("SELECT status FROM items WHERE id='print'").get().status,'open');
 assert.equal(contexts.drivingSuitable({title:'Phone charger'}),false);assert.equal(contexts.drivingSuitable({title:'Call for proposals'}),false);assert.equal(contexts.drivingSuitable({title:'להתקשר לאבא'}),true);
});
test('unsuitable reminders and summaries stay quiet while driving, then become actionable at the destination',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T05:30:00Z')});const h=setup();await commuteFixture(h);h.item('desk','task','2026-10-19T05:00:00Z');h.db.prepare("UPDATE items SET execution_mode='desk',category='yeshiva' WHERE id='desk'").run();
 const notice=await notifications.recordNotification(h.env,'overdue','Do desk work','','desk','/');const briefing=await notifications.recordNotification(h.env,'briefing','Today','Full day',null,'/');
 let d=await dashboard(h);assert.equal(d.now_block.items.length,0);assert.equal(d.nudges.length,0);assert.deepEqual(await notifications.activeNotificationIds(h.env,[notice.id,briefing.id]),[]);
 t.mock.timers.setTime(new Date('2026-10-19T06:20:00Z').getTime());d=await dashboard(h);assert.equal(d.now_block.name,'At yeshiva');assert.equal(d.now_block.items[0].id,'desk');assert.equal(d.nudges.some(n=>n.id===briefing.id),true);
});
test('commutes emit one relevant checklist, no destination overview or end-of-drive wrapup, and stay silent without calls',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-19T05:30:00Z')});const h=setup(),drive=await commuteFixture(h);
 h.db.prepare("UPDATE situations SET note='General work overview' WHERE id=?").run(drive.id);h.item('physical','task',null);h.db.prepare("UPDATE items SET title='Print papers',category='yeshiva' WHERE id='physical'").run();
 assert.equal(await situations.runSituations(h.env),0);assert.equal(h.db.prepare('SELECT count(*) n FROM nudges').get().n,0);
 h.item('call','task',null);h.db.prepare("UPDATE items SET title='Call Dad',category='personal' WHERE id='call'").run();h.db.prepare('UPDATE situations SET last_fired=NULL WHERE id=?').run(drive.id);
 assert.equal(await situations.runSituations(h.env),1);assert.equal(await situations.runSituations(h.env),0);
 const n=h.db.prepare("SELECT * FROM nudges WHERE type='situation'").get();assert.equal(n.body,'• Call Dad');
 t.mock.timers.setTime(new Date('2026-10-19T06:20:00Z').getTime());await situations.runSituations(h.env);assert.equal(h.db.prepare("SELECT count(*) n FROM nudges WHERE type='wrapup'").get().n,0);
});
test('overlapping equivalent work blocks only emit the same checklist once',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.saveBlock('one');h.saveBlock('two');h.item('work','task',null);h.db.prepare("UPDATE items SET category='yeshiva' WHERE id='work'").run();
 assert.equal(await situations.runSituations(h.env),1);assert.equal(h.db.prepare("SELECT count(*) n FROM nudges WHERE type='situation'").get().n,1);
});
test('execution mode persists through create/edit/dedup instead of changing projects or reminder times',async()=>{
 const h=setup();const item=await itemDb.createItem(h.env,{title:'Discuss the app plan',execution_mode:'voice'});assert.equal(item.execution_mode,'voice');
 await itemDb.updateItem(h.env,item.id,{notes:'More details'});assert.equal(h.db.prepare('SELECT execution_mode FROM items WHERE id=?').get(item.id).execution_mode,'voice');
 await itemDb.updateItem(h.env,item.id,{execution_mode:'desk'});assert.equal(h.db.prepare('SELECT execution_mode FROM items WHERE id=?').get(item.id).execution_mode,'desk');
});

test('Home inventory contains work regardless of source or alert timing, without a schedule feed',async t=>{
 t.mock.timers.enable({apis:['Date'],now:morning});const h=setup();h.saveBlock();
 await situations.saveSituation(h.env,{name:'Appointment only',date:'2026-10-21',start_time:'20:15',end_time:'21:15'});
 h.db.prepare("INSERT INTO calendar_events(id,summary,start_at,end_at,updated_at) VALUES('calendar','Calendar only','2026-10-21T17:15:00Z','2026-10-21T18:15:00Z','2026-10-18')").run();
 for(const id of ['email','whatsapp','muted','later','attached'])h.item(id,'task',null,id==='attached'?'evening':null);
 h.db.prepare("UPDATE items SET source='gmail' WHERE id='email'").run();h.db.prepare("UPDATE items SET source='whatsapp' WHERE id='whatsapp'").run();h.db.prepare("UPDATE items SET muted=1 WHERE id='muted'").run();h.db.prepare("UPDATE items SET nudge_after='2026-11-01T08:00:00Z' WHERE id='later'").run();h.item('future-reminder');
 const d=await dashboard(h);assert.deepEqual(new Set(d.home_tasks.map(i=>i.id)),new Set(['email','whatsapp','muted','later','attached']));assert.equal('upcoming_events' in d,false);assert.equal(d.home_tasks.some(i=>i.title.includes('Appointment')||i.title.includes('Calendar')),false);assert.equal(d.nudges.length,0);
 await itemDb.updateItem(h.env,'email',{status:'done'});assert.equal((await dashboard(h)).home_tasks.some(i=>i.id==='email'),false);
});

test('active project folders and standalone scheduled tasks remain discoverable outside their Now window',async t=>{
 t.mock.timers.enable({apis:['Date'],now:morning});const h=setup();h.saveBlock();
 for(const id of ['empty','scheduled'])h.db.prepare("INSERT INTO projects(id,name,description,area,created_at,updated_at) VALUES(?,?,'Scope','personal','2026-10-18','2026-10-18')").run(id,id);
 h.item('project-step','task',null,'evening');h.db.prepare("UPDATE items SET project_id='scheduled',category='yeshiva' WHERE id='project-step'").run();h.item('standalone','task',null,'evening');h.item('future-reminder');
 const d=await dashboard(h);assert.ok(d.projects.some(p=>p.id==='empty'));assert.equal(d.projects.find(p=>p.id==='scheduled').items[0].id,'project-step');assert.ok(d.todo.some(i=>i.id==='standalone'));assert.equal(d.now_block.items.some(i=>['standalone','project-step'].includes(i.id)),false);assert.equal(d.todo.some(i=>i.id==='future-reminder'),false);
});
test('approvals and blocked jobs surface while reply and waiting tasks remain in the work inventory',async t=>{
 t.mock.timers.enable({apis:['Date'],now:morning});const h=setup();
 h.db.prepare("INSERT INTO pending_actions(id,action,payload,description,created_at) VALUES('approve','test','{}','Review a proposal','2026-10-18')").run();
 h.item('reply','task',null);h.db.prepare("UPDATE items SET source='whatsapp' WHERE id='reply'").run();h.item('waiting','waiting',null);h.db.prepare("UPDATE items SET updated_at='2026-10-01' WHERE id='waiting'").run();
 h.db.prepare("INSERT INTO missions(id,goal,waiting_on_user,created_at,updated_at) VALUES('blocked','An approved goal','Which option?','2026-10-18','2026-10-18')").run();
 let d=await dashboard(h);assert.deepEqual(new Set(d.home_tasks.map(i=>i.id)),new Set(['reply','waiting']));assert.deepEqual(new Set(d.attention_cards.map(c=>c.id)),new Set(['approvals','mission:blocked']));assert.equal(h.db.prepare("SELECT status FROM pending_actions WHERE id='approve'").get().status,'pending');
 h.db.prepare("UPDATE pending_actions SET status='rejected'").run();await itemDb.updateItem(h.env,'reply',{status:'done'});await itemDb.updateItem(h.env,'waiting',{status:'done'});h.db.prepare("UPDATE missions SET waiting_on_user=NULL").run();d=await dashboard(h);assert.deepEqual(d.attention_cards,[]);
});

test('a dated event takes precedence over an overlapping recurring block, and failures clear after a newer run',async t=>{
 t.mock.timers.enable({apis:['Date'],now:evening});const h=setup();h.saveBlock();await situations.saveSituation(h.env,{name:'Specific appointment',date:'2026-10-18',start_time:'20:15',end_time:'21:00'});
 h.db.prepare("INSERT INTO routines(id,name,instructions,schedule,created_at,updated_at) VALUES('routine','Check results','Fixture','{}','2026-10-18','2026-10-18')").run();
 h.db.prepare("INSERT INTO routine_runs(id,routine_id,started_at,status) VALUES('failed','routine','2026-10-18T07:00:00Z','failed')").run();
 let d=await dashboard(h);assert.equal(d.now_block.name,'Specific appointment');assert.ok(d.attention_cards.some(c=>c.id==='failed:routine'));
 h.db.prepare("INSERT INTO routine_runs(id,routine_id,started_at,status) VALUES('success','routine','2026-10-18T08:00:00Z','done')").run();d=await dashboard(h);assert.equal(d.attention_cards.some(c=>c.id==='failed:routine'),false);
});

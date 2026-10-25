import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';

const result=await build({entryPoints:['worker/notifications.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const notifications=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const migration='0045_notification_threads.sql';
function setup(legacy=false) {
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync('migrations').filter(f=>f.endsWith('.sql') && (!legacy || f!==migration)).sort()) db.exec(readFileSync('migrations/'+file,'utf8'));
  const prepare=sql=>{let args=[];return {bind(...a){args=a;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
  const env={DB:{prepare}};
  const item=(id,status='open',after=null)=>db.prepare('INSERT INTO items (id,kind,title,status,priority,source,created_at,updated_at,nudge_after) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'task','Task '+id,status,2,'manual','2026-10-01','2026-10-01',after);
  const record=(type='reminder',title='Do the thing',itemId='a',options={})=>notifications.recordNotification(env,type,title,'Details',itemId,'/',options);
  return {db,env,item,record};
}
test('migration keeps the latest alert per task and summary, without removing or completing tasks',()=>{
  const h=setup(true);h.item('a');
  const insert=h.db.prepare('INSERT INTO nudges(id,type,title,item_id,created_at) VALUES(?,?,?,?,?)');
  insert.run('old','reminder','Old wording','a','2026-10-01');
  insert.run('new','overdue','New wording','a','2026-10-02');
  insert.run('brief1','briefing','Yesterday',null,'2026-10-01');
  insert.run('brief2','briefing','Today',null,'2026-10-02');
  h.db.exec(readFileSync('migrations/'+migration,'utf8'));
  assert.deepEqual(h.db.prepare('SELECT id FROM nudges WHERE dismissed=0 ORDER BY id').all().map(r=>r.id),['brief2','new']);
  assert.equal(h.db.prepare("SELECT status FROM items WHERE id='a'").get().status,'open');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM nudges').get().n,4);
});
test('repeat and changed wording/types keep one active ID and preserve notification action signatures',async()=>{
  const h=setup();h.item('a');
  const first=await h.record();
  const second=await h.record('overdue','Still due');
  assert.equal(first.id,second.id);assert.equal(second.revision,2);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM nudges WHERE dismissed=0').get().n,1);
  assert.equal(h.db.prepare('SELECT title FROM nudges').get().title,'Still due');
});
test('legacy block reminders and wrap-ups share one subject even when the task count changed',()=>{
  const h=setup(true);
  h.db.prepare("INSERT INTO situations(id,name,end_time,created_at,updated_at) VALUES ('block1','Work','17:00','2026-10-01','2026-10-01')").run();
  const insert=h.db.prepare('INSERT INTO nudges(id,type,title,created_at) VALUES(?,?,?,?)');
  insert.run('block-old','situation','☕ Work until 17:00: 2 things for now','2026-10-01');
  insert.run('block-new','situation','☕ Work until 17:00: 3 things for now','2026-10-02');
  insert.run('wrap','wrapup','🏁 Work is over: did you get to these?','2026-10-03');
  h.db.exec(readFileSync('migrations/'+migration,'utf8'));
  const rows=h.db.prepare("SELECT id,topic_key FROM nudges WHERE dismissed=0").all();
  assert.equal(rows.length,1);assert.equal(rows[0].id,'wrap');assert.equal(rows[0].topic_key,'block:block1');
});
test('concurrent attempts keep one active row; distinct tasks with identical titles stay separate',async()=>{
  const h=setup();h.item('a');h.item('b');
  const ids=await Promise.all(Array.from({length:8},()=>h.record()));
  assert.equal(new Set(ids.map(n=>n.id)).size,1);
  await h.record('reminder','Do the thing','b');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM nudges WHERE dismissed=0').get().n,2);
});
test('daily briefings and catch-up summaries replace yesterday instead of accumulating',async()=>{
  const h=setup();
  await h.record('briefing','Monday briefing',null);
  await h.record('briefing','Tuesday briefing',null);
  const digest=await h.record('digest','3 replies',null);
  const sweep=await h.record('sweep','Midday check',null);
  assert.equal(digest.id,sweep.id);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM nudges WHERE dismissed=0').get().n,2);
});
test('unrelated calendar events stay separate; updates to the same explicit subject stay together',async()=>{
  const h=setup();
  const a=await h.record('event','Meeting',null,{topic:'event:a'});
  const b=await h.record('event','Meeting',null,{topic:'event:b'});
  const a2=await h.record('event','Meeting starts soon',null,{topic:'event:a'});
  assert.notEqual(a.id,b.id);assert.equal(a.id,a2.id);
});
test('dismissing an alert keeps the task, and a later reminder can open a new lifecycle',async()=>{
  const h=setup();h.item('a');const old=await h.record();
  h.db.prepare('UPDATE nudges SET dismissed=1 WHERE id=?').run(old.id);
  const next=await h.record();
  assert.notEqual(next.id,old.id);
  assert.equal(h.db.prepare("SELECT status FROM items WHERE id='a'").get().status,'open');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM nudges WHERE dismissed=0').get().n,1);
});
test('phone cleanup identifies completed, dismissed and snoozed alerts without changing tasks',async()=>{
  const h=setup();h.item('a');h.item('b','done');h.item('c','open','2099-01-01');h.item('d');
  const a=await h.record(),b=await h.record('reminder','b','b'),c=await h.record('reminder','c','c'),d=await h.record('reminder','d','d');
  h.db.prepare('UPDATE nudges SET dismissed=1 WHERE id=?').run(d.id);
  const summary=await h.record('digest','Still waiting',null,{itemIds:['b']});
  assert.deepEqual(await notifications.activeNotificationIds(h.env,[a.id,b.id,c.id,d.id,summary.id]),[a.id]);
  assert.equal(h.db.prepare("SELECT status FROM items WHERE id='c'").get().status,'open');
});
test('catch-ups skip already-pushed direct alerts and existing summaries, but still find unsent quiet tasks',async()=>{
  const h=setup();for(const id of ['a','b','c'])h.item(id);
  const a=await h.record();h.db.prepare('UPDATE nudges SET pushed_at=? WHERE id=?').run('2026-10-15',a.id);
  const digest=await h.record('digest','Waiting',null,{itemIds:['b']});
  h.db.prepare('UPDATE nudges SET pushed_at=? WHERE id=?').run('2026-10-15',digest.id);
  await h.record('waiting','Quiet','c');
  assert.deepEqual(h.db.prepare(`SELECT i.id FROM items i WHERE ${notifications.NOT_ALREADY_ALERTED}`).all().map(i=>i.id),['c']);
  const merged=await notifications.mergeCatchupItems(h.env,[h.db.prepare("SELECT * FROM items WHERE id='c'").get()]);
  assert.deepEqual(merged.map(i=>i.id),['b','c']);
  h.db.prepare("UPDATE items SET status='done' WHERE id='b'").run();
  assert.deepEqual((await notifications.mergeCatchupItems(h.env,merged)).map(i=>i.id),['c']);
});
test('overlapping time-block summaries keep each task once and retain all other unfinished tasks',async()=>{
  const h=setup();for(const id of ['a','b','c'])h.item(id);
  const old=await h.record('wrapup','2 things for now',null,{topic:'block:old',itemIds:['a','b']});
  const fresh=await h.record('situation','2 things for now',null,{topic:'block:new',itemIds:['a','c']});
  const changes=await notifications.reconcileNotificationGroups(h.env);
  assert.equal(changes.updates.length,1);assert.equal(changes.updates[0].id,old.id);
  assert.deepEqual(JSON.parse(h.db.prepare('SELECT item_ids FROM nudges WHERE id=?').get(old.id).item_ids),['b']);
  assert.deepEqual(JSON.parse(h.db.prepare('SELECT item_ids FROM nudges WHERE id=?').get(fresh.id).item_ids),['a','c']);
  const direct=await h.record();h.db.prepare('UPDATE nudges SET pushed_at=? WHERE id=?').run('2026-10-15',direct.id);
  await notifications.reconcileNotificationGroups(h.env);
  assert.deepEqual(JSON.parse(h.db.prepare('SELECT item_ids FROM nudges WHERE id=?').get(fresh.id).item_ids),['c']);
  const latest=await h.record('wrapup','2 things for now',null,{topic:'block:latest',itemIds:['b','c']});
  const last=await notifications.reconcileNotificationGroups(h.env);
  assert.deepEqual(new Set(last.closed),new Set([old.id,fresh.id]));
  assert.deepEqual(new Set(await notifications.activeNotificationIds(h.env,[old.id,fresh.id,direct.id,latest.id])),new Set([direct.id,latest.id]));
  assert.equal(h.db.prepare("SELECT COUNT(*) n FROM items WHERE status='open'").get().n,3);
});

function phone(initial=[]) {
  const events={}, shown=[], visible=[...initial];
  const registration={async getNotifications(){return [...visible]},async showNotification(title,options){
    shown.push({title,...options});
    for(const n of [...visible])if(n.tag===options.tag)n.close();
    const n={title,body:options.body||'',tag:options.tag,data:options.data,close(){const i=visible.indexOf(n);if(i>=0)visible.splice(i,1)}};
    visible.push(n);
  }};
  vm.runInNewContext(readFileSync('public/sw.js','utf8'),{self:{registration,addEventListener(name,fn){events[name]=fn}},URL,console,setTimeout,Promise});
  const push=async data=>{let work;events.push({data:{json:()=>data},waitUntil(p){work=p}});await work};
  const payload=(patch={})=>({title:'Do the thing',body:'Details',tag:'cos:item:a',topic_key:'item:a',legacy_tags:['a'],nudge_id:'n-a',revision:1,url:'/',actions:[{action:'done',title:'Done'}],...patch});
  return {push,payload,shown,visible};
}
test('phone shows one alert, skips identical repeats, and quietly updates changed wording',async()=>{
  const h=phone();await h.push(h.payload());await h.push(h.payload({revision:2}));
  assert.equal(h.shown.length,1);assert.equal(h.visible.length,1);assert.equal(h.shown[0].silent,false);
  await h.push(h.payload({title:'Still due',revision:3}));
  assert.equal(h.shown.length,2);assert.equal(h.visible.length,1);assert.equal(h.shown[1].silent,true);assert.equal(h.shown[1].renotify,false);
});
test('phone keeps separate tasks separate, and replacing a visible old-style alert does not buzz again',async()=>{
  const h=phone();await h.push(h.payload({tag:'a',revision:undefined,topic_key:undefined,legacy_tags:undefined,nudge_id:'legacy'}));
  await h.push(h.payload());
  assert.equal(h.visible.length,1);assert.equal(h.shown.at(-1).silent,true);
  await h.push(h.payload({tag:'cos:item:b',topic_key:'item:b',legacy_tags:['b'],nudge_id:'n-b'}));
  assert.equal(h.visible.length,2);assert.equal(h.shown.at(-1).silent,false);
});
test('concurrent and out-of-order pushes cannot create duplicate toasts or restore older wording',async()=>{
  const h=phone();
  await Promise.all([h.push(h.payload({title:'Latest',revision:3})),h.push(h.payload({title:'Old',revision:1}))]);
  assert.equal(h.shown.length,1);assert.equal(h.visible[0].title,'Latest');
  await h.push(h.payload({tag:'a',nudge_id:'legacy',revision:undefined,topic_key:undefined,legacy_tags:undefined,title:'Queued before update'}));
  assert.equal(h.shown.length,1);
});
test('swiping a phone alert away does not complete a task and a later reminder is allowed to alert again',async()=>{
  const h=phone();await h.push(h.payload());h.visible[0].close();
  await h.push(h.payload({revision:2}));
  assert.equal(h.visible.length,1);assert.equal(h.shown.at(-1).silent,false);
});
test('a newer block replaces a fully-covered old block and quietly trims partially-covered blocks',async()=>{
  const h=phone();
  await h.push(h.payload({tag:'cos:block:old',nudge_id:'old',title:'2 things',body:'• A\n• B'}));
  await h.push(h.payload({tag:'cos:block:partial',nudge_id:'partial',title:'2 things',body:'• A\n• C'}));
  await h.push(h.payload({tag:'cos:block:new',nudge_id:'new',title:'2 things',body:'• A\n• B',
    close_notifications:['old'],notification_updates:[{id:'partial',title:'1 thing',body:'• C',revision:2}]}));
  assert.equal(h.visible.length,2);
  assert.ok(!h.visible.some(n=>n.data.nudge_id==='old'));
  assert.equal(h.visible.find(n=>n.data.nudge_id==='partial').body,'• C');
  assert.equal(h.shown.at(-1).silent,true);
});

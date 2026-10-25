import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { build } from 'esbuild';

async function bundle(entry) {
  const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-paid-model',setup(b){b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export class ProviderUnavailable extends Error {} export async function extendedCache(){return false} export function getProvider(){ throw new Error("Unexpected AI call"); }',loader:'js'}));}}]});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const reminders=await bundle('worker/reminders.ts'), calendar=await bundle('shared/reminders.ts'), routines=await bundle('worker/routines.ts'), missions=await bundle('worker/missions.ts'), ideas=await bundle('worker/ideas.ts');
function setup() {
  const db=new DatabaseSync(':memory:');
  for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${name}`,'utf8'));
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('timezone','"Asia/Jerusalem"');
  const prepare=sql=>{let binds=[];return{bind(...v){binds=v;return this;},async first(){return db.prepare(sql).get(...binds)??null;},async all(){return{results:db.prepare(sql).all(...binds)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...binds).changes)}};}};};
  return{db,TIMEZONE:'Asia/Jerusalem',DB:{prepare,async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}};
}
function insertRule(env) {env.db.prepare('INSERT INTO recurring_reminders(id,title,notes,link,days,time,timezone,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('attendance','Fill out work attendance','Due by the 18th','https://aish-nh.hargal.co.il/default.aspx','[16,17,18]','09:00','Asia/Jerusalem',1,'2026-10-15','2026-10-15');}

test('calendar uses Israel local 09:00 across DST and clamps month-end dates',()=>{
  const rule={days:[16,17,18],time:'09:00',timezone:'Asia/Jerusalem'};
  assert.deepEqual(calendar.monthlySlots(rule,'2026-10'),['2026-10-16T06:00:00.000Z','2026-10-17T06:00:00.000Z','2026-10-18T06:00:00.000Z']);
  assert.equal(calendar.monthlySlots(rule,'2026-11')[0],'2026-11-16T07:00:00.000Z');
  assert.equal(calendar.monthlySlots({...rule,days:[30,31]},'2027-02').length,1);
  assert.equal(calendar.followingMonth('2026-12'),'2027-01');
});
test('one reminder per month; repeats on the 16th/17th/18th and stops that month when done; no AI',async()=>{
  const env=setup();insertRule(env);
  await reminders.syncRecurringReminders(env,new Date('2026-10-15T08:00:00Z'));
  let item=env.db.prepare("SELECT * FROM items WHERE source='recurring_reminder'").get();
  assert.equal(item.kind,'reminder');assert.equal(item.due_at,'2026-10-16T06:00:00.000Z');assert.match(item.notes,/https:\/\/aish-nh/);
  env.db.prepare('UPDATE items SET reminded_at=? WHERE id=?').run('2026-10-16T06:00:00.000Z',item.id);
  await reminders.syncRecurringReminders(env,new Date('2026-10-17T06:00:00Z'));
  item=env.db.prepare('SELECT * FROM items WHERE id=?').get(item.id);
  assert.equal(item.due_at,'2026-10-17T06:00:00.000Z');assert.equal(item.reminded_at,null);
  env.db.prepare('UPDATE items SET reminded_at=? WHERE id=?').run('2026-10-17T06:00:00.000Z',item.id);
  await reminders.syncRecurringReminders(env,new Date('2026-10-17T07:00:00Z'));
  assert.equal(env.db.prepare('SELECT reminded_at FROM items WHERE id=?').get(item.id).reminded_at,'2026-10-17T06:00:00.000Z');
  await reminders.syncRecurringReminders(env,new Date('2026-10-18T06:00:00Z'));
  assert.equal(env.db.prepare('SELECT due_at FROM items WHERE id=?').get(item.id).due_at,'2026-10-18T06:00:00.000Z');
  env.db.prepare("UPDATE items SET status='done' WHERE id=?").run(item.id);
  await reminders.syncRecurringReminders(env,new Date('2026-10-18T07:00:00Z'));
  assert.equal(env.db.prepare('SELECT status FROM items WHERE id=?').get(item.id).status,'done');
  const next=env.db.prepare("SELECT * FROM items WHERE status='open'").get();assert.equal(next.due_at,'2026-11-16T07:00:00.000Z');
  await reminders.syncRecurringReminders(env,new Date('2026-10-18T08:00:00Z'));
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM items').get().n,2);
  env.db.close();
});
test('done on first day suppresses second and third dates; pause and invalid schedules are safe',async()=>{
  const env=setup();insertRule(env);
  await reminders.syncRecurringReminders(env,new Date('2026-10-16T06:00:00Z'));
  env.db.exec("UPDATE items SET status='done',reminded_at='2026-10-16T06:00:00.000Z'");
  await reminders.syncRecurringReminders(env,new Date('2026-10-17T06:00:00Z'));
  await reminders.syncRecurringReminders(env,new Date('2026-10-18T06:00:00Z'));
  assert.equal(env.db.prepare("SELECT due_at FROM items WHERE id='recurring:attendance:2026-10'").get().due_at,'2026-10-16T06:00:00.000Z');
  await reminders.saveRecurringReminder(env,{id:'attendance',active:false});
  assert.equal(env.db.prepare("SELECT muted FROM items WHERE status='open'").get().muted,1);
  await assert.rejects(reminders.saveRecurringReminder(env,{title:'Bad',days:[32]}),/days of the month/);
  await assert.rejects(reminders.saveRecurringReminder(env,{title:'Bad',days:[16],link:'javascript:alert(1)'}),/http/);
  env.db.close();
});
test('AI task runs and missions only create deduplicated approval requests; no paid work before approval',async()=>{
  const env=setup();
  const r=await routines.saveRoutine(env,{name:'Research options',instructions:'Compare options',depth:'quick',oneoff:true,active:false,schedule:{kind:'monthly',day:16,time:'09:00'}});
  const routine={...r,schedule:JSON.stringify(r.schedule)};
  assert.equal((await routines.runRoutine(env,routine)).status,'pending_approval');
  await routines.runRoutine(env,routine);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM pending_actions').get().n,1);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM routine_runs').get().n,0);
  assert.match(env.db.prepare('SELECT description FROM pending_actions').get().description,/one run/);
  const mission=await missions.startMission(env,'Research a supplier',['Find options']);
  assert.equal(mission.status,'pending_approval');assert.equal(env.db.prepare('SELECT COUNT(*) n FROM missions').get().n,0);
  env.db.prepare("INSERT INTO ideas(id,title,summary,transcript,analysis,steps,notes,status,created_at,updated_at) VALUES('idea','Example','','','','[{\"id\":\"step\",\"label\":\"Find options\",\"kind\":\"research\",\"status\":\"suggested\"}]','[]','active','2026-10-15','2026-10-15')").run();
  assert.equal((await ideas.ideaStep(env,'idea','step','do')).status,'pending_approval');
  assert.match(env.db.prepare("SELECT steps FROM ideas WHERE id='idea'").get().steps,/suggested/);
  env.db.close();
});

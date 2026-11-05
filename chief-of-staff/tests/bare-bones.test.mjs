// The bare-bones Chief of Staff (Nov 2026): it only notifies about what the user asked for,
// reminders the user set still arrive, and nothing becomes a task on its own.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
async function load(entry){const b=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'});return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);}
const push=await load('worker/push.ts'),proactive=await load('worker/proactive.ts'),notifications=await load('worker/notifications.ts'),worker=(await load('worker/index.ts')).default;
const tz='Asia/Jerusalem',at=new Date('2026-11-05T09:00:00Z');
function setup(){const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone',JSON.stringify(tz));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare},COS_ACCESS_TOKEN:'fixture-only',TIMEZONE:tz};
 const item=(id,kind,due)=>db.prepare("INSERT INTO items(id,kind,title,priority,source,status,due_at,created_at,updated_at) VALUES(?,?,?,2,'manual','open',?,?,?)").run(id,kind,'Task '+id,due,at.toISOString(),at.toISOString());
 return{db,env,item};}
const count=(h,type)=>h.db.prepare('SELECT count(*) n FROM nudges WHERE type=?').get(type).n;

test('only notifications the user asked for are recorded; suggestions, heads-ups and meeting prep are not',async t=>{
 t.mock.timers.enable({apis:['Date'],now:at});const h=setup();
 for(const type of ['suggest','headsup','waiting','situation','meeting','reply_batch','learn','alumni_visit','helper','customers','event'])
  assert.equal(await push.notify(h.env,type,'Unasked '+type,''),'',type);
 assert.equal(h.db.prepare('SELECT count(*) n FROM nudges').get().n,0);
 assert.ok(await push.notify(h.env,'broken','Google stopped syncing',''));assert.equal(count(h,'broken'),1);
});

test('a reminder the user set still fires from the 5-minute run, and nothing else comes with it',async t=>{
 t.mock.timers.enable({apis:['Date'],now:at});const h=setup();
 h.item('call','reminder',new Date(at.getTime()-60000).toISOString());
 h.item('soon','task',new Date(at.getTime()+5*3600000).toISOString()); // would have earned a heads-up before
 await proactive.runProactive(h.env,{remindersOnly:true});
 assert.equal(count(h,'reminder'),1);assert.equal(count(h,'headsup'),0);
 assert.ok(h.db.prepare("SELECT reminded_at FROM items WHERE id='call'").get().reminded_at);
});

test('Home leaves out old notifications of types that are now off',async t=>{
 t.mock.timers.enable({apis:['Date'],now:at});const h=setup();
 await notifications.recordNotification(h.env,'suggest','Saw this on WhatsApp, add it?','',null,'/');
 await notifications.recordNotification(h.env,'watch','👀 Dana: matches your watch','',null,'/');
 const r=await worker.fetch(new Request('https://fixture/api/dashboard',{headers:{authorization:'Bearer fixture-only'}}),h.env,{waitUntil(){}});
 const d=await r.json();assert.deepEqual(d.nudges.map(n=>n.type),['watch']);
});

test('emails never turn into tasks on their own, and the chat only files what it is asked to',()=>{
 assert.match(readFileSync('worker/google.ts','utf8'),/const AUTO_EMAIL_TASKS = false/);
 const prompt=readFileSync('worker/assistant.ts','utf8');
 assert.match(prompt,/ONLY the ones they ask for/);assert.doesNotMatch(prompt,/quietly build the structure/);
});

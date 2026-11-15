import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

const result=await build({
  entryPoints:['worker/inbox-review.ts'], bundle:true, write:false, platform:'node', format:'esm',
  plugins:[{name:'inbox-fixtures',setup(plugin){
    plugin.onResolve({filter:/^\.\/(google|push|ai)$/},args=>args.importer.endsWith('inbox-review.ts')?{path:args.path,namespace:'fixture'}:undefined);
    plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:{
      './google':'export const accountEmails=async()=>["fixture@example.test"]; export const morningMail=(...args)=>globalThis.inboxMail(...args);',
      './push':'export const sendPush=async(_,p)=>{globalThis.inboxPush.push(p);return {sent:1};};',
      './ai':'export const getProvider=()=>({complete:async()=>JSON.stringify({items:[{index:0,title:"Reply about the quote",reply_required:true}]})});',
    }[args.path]}));
  }}],
});
const audit=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function setup() {
  const db=new DatabaseSync(':memory:');
  for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort()) db.exec(readFileSync('migrations/'+f,'utf8'));
  const prepare=sql=>{
    let args=[];
    return {
      bind(...values){args=values;return this;},
      async first(){return db.prepare(sql).get(...args)??null;},
      async all(){return{results:db.prepare(sql).all(...args)};},
      async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};},
    };
  };
  const env={DB:{prepare,async batch(statements){
    db.exec('BEGIN');
    try{const res=[];for(const s of statements)res.push(await s.run());db.exec('COMMIT');return res;}
    catch(error){db.exec('ROLLBACK');throw error;}
  }}};
  globalThis.inboxPush=[];
  globalThis.inboxMail=async()=>({partial:false,threads:[{
    threadId:'thread',messageId:'email',sender:'Fixture',subject:'Quote',receivedAt:'2026-11-11T05:00:00Z',
    excerpt:'Could you reply?',context:[{mine:false,text:'Could you reply?'}],
  }]});
  return{db,env};
}

test('review uses 6 a.m. Jerusalem in winter and summer',()=>{
  assert.equal(audit.inboxReviewSlot(new Date('2026-11-12T03:59Z')).day,null);
  assert.equal(audit.inboxReviewSlot(new Date('2026-11-12T04:00Z')).day,'2026-11-12');
  assert.equal(audit.inboxReviewSlot(new Date('2026-07-12T03:00Z')).day,'2026-07-12');
  assert.equal(audit.inboxReviewSlot(new Date('2026-11-12T05:00Z')).day,null);
});

test('one batch, no automatic tasks, and replied WhatsApp items leave the review',async()=>{
  const {db,env}=setup();
  db.exec(`INSERT INTO whatsapp_inbox(id,hash,chat,sender,text,received_at,awaiting_reply,reply_ids,messages_json)
    VALUES ('w','w','Fixture','Fixture','request','2026-11-11T05:00:00Z',1,'["wa1","wa2"]','[{"id":"wa1","text":"first request"},{"id":"wa2","text":"second request"}]')`);
  const at=new Date('2026-11-12T04:00Z');
  await audit.runInboxReview(env,at);
  await audit.runInboxReview(env,at);
  assert.equal(globalThis.inboxPush.length,1);
  assert.equal((await audit.inboxReview(env)).entries.length,3);
  assert.equal(db.prepare('SELECT count(*) n FROM items').get().n,0);
  db.exec(`UPDATE whatsapp_inbox SET reply_ids='["wa2"]' WHERE id='w'`);
  assert.deepEqual((await audit.inboxReview(env)).entries.filter(e=>e.source==='whatsapp').map(e=>e.excerpt),['second request']);
  db.close();
});

test('Today creates exactly one task, Not today returns on a new day, No action stays dismissed',async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-12T04:00Z')});
  const {db,env}=setup();
  db.exec(`INSERT INTO whatsapp_inbox(id,hash,chat,sender,text,received_at,awaiting_reply,reply_ids,messages_json)
    VALUES ('w','w','Fixture','Fixture','request','2026-11-11T05:00:00Z',1,'["wa1","wa2"]','[{"id":"wa1","text":"first request"},{"id":"wa2","text":"second request"}]')`);
  await audit.runInboxReview(env,new Date());
  const rows=(await audit.inboxReview(env)).entries;
  const email=rows.find(e=>e.source==='gmail');
  await audit.decideInboxEntry(env,email.id,'today');
  await assert.rejects(()=>audit.decideInboxEntry(env,email.id,'today'),/no longer/);
  assert.equal(db.prepare('SELECT count(*) n FROM items').get().n,1);
  assert.equal(db.prepare('SELECT due_at FROM items').get().due_at,'2026-11-12T21:59:59.000Z');
  await audit.decideInboxEntry(env,rows.find(e=>e.excerpt==='first request').id,'later');
  await audit.decideInboxEntry(env,rows.find(e=>e.excerpt==='second request').id,'dismiss');
  assert.equal((await audit.inboxReview(env)).entries.length,0);
  t.mock.timers.setTime(Date.parse('2026-11-13T04:00Z'));
  await audit.runInboxReview(env,new Date());
  assert.deepEqual((await audit.inboxReview(env)).entries.map(e=>e.excerpt),['first request']);
  db.close();
});

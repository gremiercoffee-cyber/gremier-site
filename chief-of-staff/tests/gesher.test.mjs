import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';
const built=await build({stdin:{contents:"export * from './worker/gesher';export * from './worker/gesher-rules';export {parseMail} from './worker/gesher-gmail';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const time=Date.now();
const notice=(overrides={})=>({id:'notice-1',threadId:'notice-thread',at:time,from:'Dovid Rosman <DRosman@aish.com>',to:m.ACCOUNT,subject:'Fwd: Unsubscribe Notification - Aish Gesher',text:'This person was just unsubscribed from the Aish Gesher list on 11/08/2026.\nContact Info\nEmail   subscriber@example.org\nName Example',auth:'mx.google.com; dmarc=pass (p=NONE) header.from=aish.com;',sent:false,references:'',auto:'',...overrides});
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return{results:db.prepare(sql).all(...args)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}};}};};
 const env={DB:{prepare,batch:async ss=>{db.exec('BEGIN');try{const results=[];for(const s of ss)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 db.prepare('UPDATE gesher_config SET watch_from=?,baseline_done=1').run(time-1000);
 let notices=[notice()],replies=[],sent=[],uncertain=false,manual=false;
 const adapter={async list(q){if(q.startsWith('in:sent rfc822msgid:')){const key=q.split('rfc822msgid:')[1];return{messages:sent.filter(x=>x.rfc===key).map(x=>({id:x.id}))};}if(q.startsWith('in:sent to:'))return{messages:manual?[{id:'old-manual'}]:[]};return{messages:notices.map(x=>({id:x.id}))};},async get(id){return notices.find(x=>x.id===id)||{...notice(),...sent.find(x=>x.id===id),sent:true,from:m.ACCOUNT};},async thread(){return replies;},async send(to,subject,body,rfc){const value={id:'sent-'+(sent.length+1),threadId:'contact-thread',to,subject,body,rfc};sent.push(value);if(uncertain)throw Error('response lost after Gmail accepted');return value;}};
 const one=sql=>db.prepare(sql).get();
 return{db,env,adapter,sent,one,setNotices:x=>notices=x,setReplies:x=>replies=x,setUncertain:x=>uncertain=x,setManual:x=>manual=x,async enable(){db.prepare("UPDATE gesher_config SET mode='enabled',approved_at=?,approved_by='owner-test-fixture',approval_digest=?").run(time-500,await m.approvalDigest());},async tick(){const r=await m.gesherTick(env,adapter);assert.equal(r.ok,true);return r;},reply(text,overrides={}){const o=one("SELECT * FROM gesher_outbox WHERE kind='clarification'");return notice({id:'reply-1',from:'subscriber@example.org',auth:'mx.google.com; dmarc=pass header.from=example.org;',text,at:Date.now()+1000,references:`<${o.rfc_id}>`,...overrides});}};
}
test('notification requires observed sender, DMARC, exact context and one validated labelled email',()=>{
 assert.equal(m.notification(notice()).email,'subscriber@example.org');
 assert.equal(m.notification(notice({from:'Dovid Rosman <DRosman@aish.edu>',auth:'mx.google.com; dmarc=pass header.from=aish.edu;'})).email,'subscriber@example.org');
 assert.equal(m.notification(notice({from:'Dovid Rosman <DRosman@aish.edu>',auth:'mx.google.com; dmarc=pass header.from=example.org;'})).email,null);
 for(const change of [{from:'Someone <impostor@aish.com>'},{auth:'mx.google.com; dmarc=fail header.from=aish.com;'},{text:notice().text+'\nEmail other@example.org'},{text:notice().text.replace('subscriber@example.org','bad@@example.org')},{text:notice().text+'\nUnsubscribed from the Other list.'},{subject:'Other newsletter'}])assert.equal(m.notification(notice(change)).email,null);
});
test('reply parser respects intentional, negatives, ambiguity, quoted history and no response',()=>{
 assert.equal(m.decision('Please resubscribe me.'),'resubscribe');assert.equal(m.decision('It was a mistake.'),'resubscribe');
 assert.equal(m.decision('Please keep me unsubscribed.'),'intentional');assert.equal(m.decision('Do not resubscribe me.'),'intentional');
 for(const x of ['', 'Yes', 'Maybe it was a mistake', 'It was a mistake but do not resubscribe me', 'Could you resubscribe me?', '> Please resubscribe me.', 'It was not a mistake'])assert.equal(m.decision(x),'review');
 assert.equal(m.decision('It was intentional.\nOn Monday Yoni wrote:\nPlease resubscribe me.'),'intentional');
});
test('dry-run and missing approval never send; notifications and cases survive repeated scans',async()=>{
 const h=setup();await h.tick();await h.tick();assert.equal(h.sent.length,0);assert.equal(h.one('SELECT count(*) n FROM gesher_cases').n,1);assert.equal(h.one('SELECT count(*) n FROM gesher_notifications').n,1);
 h.db.exec("UPDATE gesher_config SET mode='enabled',approved_at=1,approved_by='not-an-approval'");await h.tick();assert.equal(h.sent.length,0);
});
test('one clarification, duplicate notification and restart-safe nonresponse generate no repeated mail',async()=>{
 const h=setup();await h.enable();await h.tick();assert.equal(h.sent.length,1);assert.equal(h.sent[0].to,'subscriber@example.org');
 h.setNotices([notice(),notice({id:'duplicate-notice'})]);await h.tick();await h.tick();
 assert.equal(h.sent.length,1);assert.equal(h.one('SELECT count(*) n FROM gesher_cases').n,1);assert.equal(h.one('SELECT count(*) n FROM gesher_notifications').n,2);assert.equal(h.one('SELECT status FROM gesher_cases').status,'contacted');
});
test('explicit verified reply refers once to correct recipient with address; repeated reply never repeats referral',async()=>{
 const h=setup();await h.enable();await h.tick();h.setReplies([h.reply('Please resubscribe me.')]);await h.tick();await h.tick();
 assert.equal(h.sent.length,2);assert.equal(h.sent[1].to,m.REFERRAL);assert.match(h.sent[1].body,/Example \(subscriber@example.org\) asked/);assert.equal(h.one('SELECT status FROM gesher_cases').status,'referred');assert.equal(h.one('SELECT count(*) n FROM gesher_responses').n,1);
});
test('intentional unsubscribe, ambiguous reply, spoofed sender and missing thread reference never refer',async()=>{
 for(const [text,change,state] of [['It was intentional.',{},'intentional'],['Maybe',{},'review'],['Please resubscribe me.',{from:'impostor@example.org'},'review'],['Please resubscribe me.',{references:''},'review']]){
 const h=setup();await h.enable();await h.tick();h.setReplies([h.reply(text,change)]);await h.tick();await h.tick();assert.equal(h.sent.length,1);assert.equal(h.one('SELECT status FROM gesher_cases').status,state);
 }
});
test('uncertain send is reconciled from Gmail after restart without a second send',async()=>{
 const h=setup();await h.enable();h.setUncertain(true);await h.tick();assert.equal(h.one('SELECT state FROM gesher_outbox').state,'uncertain');assert.equal(h.sent.length,1);
 h.setUncertain(false);await h.tick();assert.equal(h.sent.length,1);assert.equal(h.one('SELECT state FROM gesher_outbox').state,'sent');assert.equal(h.one('SELECT status FROM gesher_cases').status,'contacted');
});
test('historical contacts and possible prior manual emails suppress new clarification',async()=>{
 const h=setup();h.setNotices([notice({at:time-2000})]);h.db.exec('UPDATE gesher_config SET baseline_done=0');await h.tick();assert.equal(h.one('SELECT status FROM gesher_cases').status,'historical');
 await h.enable();h.setNotices([notice({id:'new-event'})]);await h.tick();assert.equal(h.sent.length,0);
 const other=setup();await other.enable();other.setManual(true);await other.tick();assert.equal(other.sent.length,0);assert.equal(other.one('SELECT status FROM gesher_cases').status,'review');
});
test('template changes invalidate approval and an overlapping scheduler lease prevents processing',async()=>{
 const h=setup();await h.enable();h.db.exec("UPDATE gesher_config SET approval_digest='old-template'");await h.tick();assert.equal(h.sent.length,0);
 h.db.prepare("INSERT INTO settings(key,value) VALUES('gesher_lock',?)").run(String(Date.now()));const r=await m.gesherTick(h.env,h.adapter);assert.equal(r.busy,true);
});
test('invalid addresses never create a subscriber case or outgoing action',async()=>{
 const h=setup();await h.enable();h.setNotices([notice({text:notice().text.replace('subscriber@example.org','invalid@@example.org')})]);await h.tick();assert.equal(h.sent.length,0);assert.equal(h.one('SELECT count(*) n FROM gesher_cases').n,0);assert.equal(h.one('SELECT status FROM gesher_notifications').status,'review');
});
test('crashed send reservation with no Gmail evidence is never resent',async()=>{
 const h=setup();await h.enable();await h.tick();h.sent.length=0;
 h.db.exec("UPDATE gesher_outbox SET state='sending',gmail_id=NULL;UPDATE gesher_cases SET status='pending',contact_message_id=NULL,contact_thread_id=NULL;");
 await h.tick();await h.tick();assert.equal(h.sent.length,0);assert.equal(h.one('SELECT state FROM gesher_outbox').state,'uncertain');
});
test('partially recorded notification is recovered and stale processing lease can restart',async()=>{
 const h=setup();h.db.prepare("INSERT INTO gesher_notifications(message_id,thread_id,received_at,email,event_key,status,created_at) VALUES(?,?,?,?,?,'accepted',?)").run('notice-1','notice-thread',time,'subscriber@example.org','event',time);
 h.db.prepare("INSERT INTO settings(key,value) VALUES('gesher_lock',?)").run(String(Date.now()-5*60000));await h.tick();assert.equal(h.one('SELECT count(*) n FROM gesher_cases').n,1);assert.equal(h.sent.length,0);
});
test('Gmail adapter preserves full body and trusted authentication headers needed by rules',()=>{
 const body=notice().text;const parsed=m.parseMail({id:'raw',threadId:'thread',internalDate:String(time),labelIds:['INBOX'],payload:{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')},headers:[{name:'From',value:notice().from},{name:'To',value:m.ACCOUNT},{name:'Subject',value:notice().subject},{name:'Authentication-Results',value:notice().auth}]}});assert.equal(m.notification(parsed).email,'subscriber@example.org');assert.equal(parsed.text,body);
});
test('missing or conflicting subscriber names hold referral without guessing',async()=>{
 for(const text of [notice().text.replace('\nName Example',''),notice().text+'\nName Someone Else']){
  const h=setup();h.setNotices([notice({text})]);await h.enable();await h.tick();h.setReplies([h.reply('Please resubscribe me.')]);await h.tick();assert.equal(h.sent.length,1);assert.equal(h.one("SELECT state FROM gesher_outbox WHERE kind='referral'").state,'blocked');
 }
});

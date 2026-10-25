import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({stdin:{contents:`export * from './worker/meeting-prep';export {assistantTools,promptFor,chat} from './worker/assistant';export {detectMeeting} from './worker/meetings';export {actionableNotice} from './worker/attention';export {fetchEvents} from './worker/google';export {default as worker} from './worker/index';`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node'});
const m=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('timezone','"Asia/Jerusalem"');
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 const env={DB:{prepare},COS_ACCESS_TOKEN:'fixture-only',OPENAI_API_KEY:'fixture-never-sent',TIMEZONE:'Asia/Jerusalem'};
 db.prepare("INSERT INTO calendar_events(id,summary,start_at,end_at,updated_at) VALUES('avi','Meeting with Avi','2026-11-10T08:00:00.000Z','2026-11-10T09:00:00.000Z','2026-10-22')").run();
 db.prepare("INSERT INTO situations(id,name,date,start_time,end_time,created_at,updated_at) VALUES('avi2','Meeting with Avi','2026-11-11','20:15','21:15','2026-10-22','2026-10-22')").run();
 const count=table=>db.prepare('SELECT count(*) n FROM '+table).get().n;
 return {db,env,count};
}
const freeze=t=>t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-22T07:00:00Z')});
const firstId='calendar:avi',secondId='schedule:avi2';
test('known meetings include calendar and explicitly dated Schedule events, excluding hidden/recurring blocks',async t=>{
 freeze(t);const h=setup();h.db.prepare("INSERT INTO calendar_events(id,summary,start_at,end_at,hidden,updated_at) VALUES('hidden','Hidden','2026-11-10T08:00:00Z','2026-11-10T09:00:00Z',1,'2026-10-22')").run();
 h.db.prepare("INSERT INTO situations(id,name,weekdays,start_time,created_at,updated_at) VALUES('daily','Daily work','[0,1,2,3,4]','08:00','2026-10-22','2026-10-22')").run();
 const state=await m.meetingPrepState(h.env);assert.deepEqual(state.meetings.map(x=>x.id),[firstId,secondId]);assert.equal(state.meetings[1].starts_at,'2026-11-11T18:15:00.000Z');assert.deepEqual(state.notes,[]);
 assert.equal(m.meetingTime('2026-10-21','20:15','Asia/Jerusalem'),'2026-10-21T17:15:00.000Z');
});
test('a note stays pending even with one exact meeting and no tasks, document or alerts are created',async t=>{
 freeze(t);const h=setup();const draft=await m.proposePrepNote(h.env,{text:'Ask about labels and the new coffee prices.',meeting_ids:[firstId]});
 assert.equal(draft.status,'awaiting_meeting_confirmation');assert.equal(draft.candidates.length,1);assert.equal(h.count('meeting_agenda_notes'),0);assert.equal(h.count('nudges'),0);assert.equal(h.count('items'),0);assert.equal(h.count('meeting_preps'),0);
 const state=await m.meetingPrepState(h.env);assert.equal(state.drafts[0].text,draft.text);await m.confirmPrepNote(h.env,draft.id,firstId);assert.equal((await m.meetingPrepState(h.env)).drafts.length,0);
});
test('ambiguous meetings require selection; repeated additions append and repeated confirmations never duplicate',async t=>{
 freeze(t);const h=setup();const a=await m.proposePrepNote(h.env,{text:'Discuss the prices.',meeting_ids:[firstId,secondId]});assert.deepEqual(a.candidates.map(x=>x.id),[firstId,secondId]);
 await m.confirmPrepNote(h.env,a.id,secondId);await m.confirmPrepNote(h.env,a.id,secondId);await assert.rejects(m.confirmPrepNote(h.env,a.id,firstId));
 const b=await m.proposePrepNote(h.env,{text:'Also ask about delivery.\nלהביא דוגמאות',meeting_ids:[secondId]});await m.confirmPrepNote(h.env,b.id,secondId);
 const notes=(await m.meetingPrepState(h.env)).notes;assert.equal(notes.length,2);assert.ok(notes.every(n=>n.meeting_id===secondId));assert.ok(notes.some(n=>n.text==='Also ask about delivery.\nלהביא דוגמאות'));
});
test('concurrent conflicting selections attach a draft to only one meeting',async t=>{
 freeze(t);const h=setup();const d=await m.proposePrepNote(h.env,{text:'Keep this once.'});
 await Promise.allSettled([m.confirmPrepNote(h.env,d.id,firstId),m.confirmPrepNote(h.env,d.id,secondId)]);assert.equal(h.count('meeting_agenda_notes'),1);
 const note=h.db.prepare('SELECT * FROM meeting_agenda_notes').get(),draft=h.db.prepare('SELECT * FROM meeting_agenda_drafts').get();assert.equal(draft.selected_meeting_id,note.meeting_id);assert.equal(draft.status,'saved');
});
test('same-turn assistant auto-confirmation is blocked; a later user choice can use the same note through voice or text tools',async t=>{
 freeze(t);const h=setup(),tools=m.assistantTools(h.env,'chat',[]),tool=name=>tools.find(t=>t.name===name);
 assert.equal(tools.some(t=>t.name==='meeting_prep_doc'),false);
 const draft=await tool('propose_meeting_prep_note').handler({text:'Discuss contracts',meeting_ids:[firstId]});
 const denied=await tool('confirm_meeting_prep_note').handler({draft_id:draft.id,meeting_id:firstId});assert.match(denied.error,/subsequent/);assert.equal(h.count('meeting_agenda_notes'),0);
 const voice=m.assistantTools(h.env,'voice',[]);await voice.find(t=>t.name==='confirm_meeting_prep_note').handler({draft_id:draft.id,meeting_id:firstId});assert.equal(h.count('meeting_agenda_notes'),1);
 assert.match(m.promptFor(new Set(['meetings'])),/ALWAYS ask them to confirm/);
});
test('cancelled, unknown and discarded meetings cannot take a pending note; rescheduling preserves meeting identity',async t=>{
 freeze(t);const h=setup();const a=await m.proposePrepNote(h.env,{text:'A thought',meeting_ids:[firstId]});await assert.rejects(m.confirmPrepNote(h.env,a.id,'invented'));
 h.db.prepare("UPDATE calendar_events SET hidden=1 WHERE id='avi'").run();await assert.rejects(m.confirmPrepNote(h.env,a.id,firstId));
 const b=await m.proposePrepNote(h.env,{text:'Other thought',meeting_ids:[secondId]});h.db.prepare("UPDATE situations SET date='2026-11-12' WHERE id='avi2'").run();assert.equal(h.count('meeting_agenda_notes'),0);
 const state=await m.meetingPrepState(h.env);assert.ok(state.meetings.some(x=>x.id===secondId&&x.starts_at==='2026-11-12T18:15:00.000Z')); await m.discardPrepDraft(h.env,b.id);await assert.rejects(m.confirmPrepNote(h.env,b.id,'schedule:avi2'));assert.equal(h.count('meeting_agenda_notes'),0);
});
test('notes survive calendar retention and can be edited or removed without changing meetings',async t=>{
 freeze(t);const h=setup();const d=await m.proposePrepNote(h.env,{text:'Original',meeting_ids:[firstId]});await m.confirmPrepNote(h.env,d.id,firstId);
 h.db.prepare("DELETE FROM calendar_events WHERE id='avi'").run();const state=await m.meetingPrepState(h.env);assert.equal(state.notes[0].text,'Original');assert.equal(state.meetings.find(x=>x.id===firstId).available,false);
 await m.editPrepNote(h.env,d.id,'Corrected');assert.equal((await m.meetingPrepState(h.env)).notes[0].text,'Corrected');await m.deletePrepNote(h.env,d.id);assert.equal(h.count('meeting_agenda_notes'),0);assert.equal(h.count('situations'),1);
});
test('unknown meeting keeps the thought pending until a meeting is added',async t=>{
 freeze(t);const h=setup();h.db.exec('DELETE FROM calendar_events; DELETE FROM situations;');const d=await m.proposePrepNote(h.env,{text:'Remember this thought'});assert.deepEqual(d.candidates,[]);assert.equal((await m.meetingPrepState(h.env)).drafts.length,1);
 h.db.prepare("INSERT INTO situations(id,name,date,start_time,created_at,updated_at) VALUES('new','Avi','2026-11-12','10:00','2026-10-22','2026-10-22')").run();await m.confirmPrepNote(h.env,d.id,'schedule:new');assert.equal(h.count('meeting_agenda_notes'),1);
});
test('old WhatsApp add-ons can no longer infer meetings, and prep prompts remain suppressed',async t=>{
 freeze(t);const h=setup();const count=h.count('situations');const r=await m.detectMeeting(h.env,{chat:'Avi',msgs:[{text:'See you tonight!',fromMe:true}]});assert.equal(r.disabled,true);assert.equal(h.count('situations'),count);assert.equal(m.actionableNotice({type:'prep'},{at:new Date(),tz:'Asia/Jerusalem',blocks:new Map(),items:new Map()}),false);
});
test('calendar pagination includes later meetings rather than silently truncating the known list',async()=>{
 const original=globalThis.fetch,urls=[];globalThis.fetch=async url=>{urls.push(String(url));return new Response(JSON.stringify(urls.length===1?{items:[{id:'first',status:'confirmed'}],nextPageToken:'page-2'}:{items:[{id:'second',status:'confirmed'},{id:'cancelled',status:'cancelled'}]}),{headers:{'content-type':'application/json'}});};
 try{const result=await m.fetchEvents('fixture','2026-10-22T00:00:00Z','2027-01-20T00:00:00Z');assert.deepEqual(result.map(e=>e.id),['first','second']);assert.ok(urls[1].includes('pageToken=page-2'));}finally{globalThis.fetch=original;}
});
test('meeting prep endpoints require authentication and save only after a valid picker selection',async t=>{
 freeze(t);const h=setup(),ctx={waitUntil(){}};let r=await m.worker.fetch(new Request('https://fixture/api/meeting-prep'),h.env,ctx);assert.equal(r.status,401);
 const d=await m.proposePrepNote(h.env,{text:'Agenda',meeting_ids:[firstId]});r=await m.worker.fetch(new Request(`https://fixture/api/meeting-prep/drafts/${d.id}/confirm`,{method:'POST',headers:{authorization:'Bearer fixture-only','content-type':'application/json'},body:JSON.stringify({meeting_id:firstId})}),h.env,ctx);assert.equal(r.status,200);assert.equal(h.count('meeting_agenda_notes'),1);
});
const ui=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {MeetingChoices} from './src/components/MeetingPrep';export const render=state=>renderToStaticMarkup(React.createElement(MeetingChoices,{state,onChanged(){}}));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',packages:'external',jsx:'automatic'});
const compiled={exports:{}};new Function('require','module','exports',ui.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
test('picker renders distinct meeting dates, the exact held note, and clear confirmation controls',async t=>{
 freeze(t);const h=setup();await m.proposePrepNote(h.env,{text:'Ask about pricing',meeting_ids:[firstId,secondId]});const html=compiled.exports.render(await m.meetingPrepState(h.env));assert.ok(html.includes('Which meeting is this for?'));assert.ok(html.includes('10 Nov 2026'));assert.ok(html.includes('11 Nov 2026'));assert.ok(html.includes('Ask about pricing'));assert.ok(html.includes('Choose another meeting'));assert.ok(html.includes('Discard this note'));
});

test('confirmed notes follow a rescheduled meeting and later additions use the same agenda',async t=>{
 freeze(t);const h=setup();const d=await m.proposePrepNote(h.env,{text:'Keep with Avi',meeting_ids:[secondId]});await m.confirmPrepNote(h.env,d.id,secondId);
 h.db.prepare("UPDATE situations SET date='2026-11-12' WHERE id='avi2'").run();const state=await m.meetingPrepState(h.env);assert.equal(state.notes[0].meeting_id,secondId);assert.equal(state.meetings.find(x=>x.id===secondId).starts_at,'2026-11-12T18:15:00.000Z');
 const next=await m.proposePrepNote(h.env,{text:'Second thought',meeting_ids:[secondId]});await m.confirmPrepNote(h.env,next.id,secondId);assert.equal((await m.meetingPrepState(h.env)).notes.filter(n=>n.meeting_id===secondId).length,2);
});

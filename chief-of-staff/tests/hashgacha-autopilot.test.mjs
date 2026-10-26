import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// A whole reporting week, against fixture report data: who gets which email, exactly once, never on Shabbat.
globalThis.__mail=[];globalThis.__notes=[];
const out=await build({entryPoints:['worker/hashgacha-autopilot.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'no-network',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]google\.ts$/},()=>({contents:'export async function sendEmail(_e,m){globalThis.__mail.push(m)}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]push\.ts$/},()=>({contents:'export async function notify(_e,type,title,body){globalThis.__notes.push(body)}',loader:'js'}));
}}]});
const ap=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...values){args=values;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 db.prepare("INSERT INTO settings(key,value) VALUES('timezone',?)").run(JSON.stringify('Asia/Jerusalem')); // stored JSON-encoded, like the app does
 // Turned on before this week's filings.
 db.prepare("INSERT INTO settings(key,value) VALUES('hashgacha_autopilot',?)").run(JSON.stringify({enabled:true,enabled_at:'2026-10-26T00:00:00.000Z'}));
 const env={DB:{prepare},HASHGACHA_READ_KEY:'k',HASHGACHA_ANON_KEY:'a'};
 // Report status per class, for the week of Sunday 25 Oct. Tests change it as rabbis file.
 const week={};
 const cls=(id,name,email)=>{week[id]={class_id:id,class_name:'Class '+id,rabbi_name:name,rabbi_email:email,seder:'night',week_of:'2026-10-25',expected:10,submitted:0,last_submission:null};};
 cls(1,'Rabbi Adler','adler@example.com');cls(2,'Rabbi Baum','baum@example.com');cls(3,'Rabbi Cohen','cohen@example.com');cls(4,'Rabbi Dov',null);
 const file=(id,at)=>Object.assign(week[id],{submitted:10,last_submission:at});
 globalThis.fetch=async(_url,init)=>{const {week_date}=JSON.parse(init.body);return new Response(JSON.stringify(week_date==='2026-10-25'?Object.values(week):[]),{headers:{'content-type':'application/json'}});};
 const sends=()=>db.prepare('SELECT kind,name FROM hashgacha_sends ORDER BY sent_at,name').all().map(r=>`${r.kind}:${r.name}`);
 return {db,env,file,sends};
}
const at=s=>new Date(s);
const reset=()=>{globalThis.__mail.length=0;globalThis.__notes.length=0;};

test('the reporting week: this Sunday’s week all week, and on Sunday the week that just ended',()=>{
 assert.equal(ap.reportWeek('Asia/Jerusalem',at('2026-10-29T18:30:00Z')),'2026-10-25');
 assert.equal(ap.reportWeek('Asia/Jerusalem',at('2026-10-31T19:30:00Z')),'2026-10-25');
 assert.equal(ap.reportWeek('Asia/Jerusalem',at('2026-11-01T07:30:00Z')),'2026-10-25');
});

test('Thursday night reminder, thank-you on filing, Saturday-night and Sunday reminders only to whoever is still missing',async()=>{
 reset();const h=setup();
 h.file(1,'2026-10-29T10:00:00.000Z'); // Adler filed Thursday morning
 // Thursday 17:00 local: nothing due yet except Adler's thank-you.
 await ap.runHashgachaAutopilot(h.env,at('2026-10-29T15:00:00Z'));
 assert.deepEqual(h.sends(),['thanks:Rabbi Adler']);
 // Thursday 20:05 local: reminder to Baum and Cohen (not Adler, who filed; Dov has no email and is reported to the user).
 await ap.runHashgachaAutopilot(h.env,at('2026-10-29T18:05:00Z'));
 assert.deepEqual(h.sends().slice(1).sort(),['thursday:Rabbi Baum','thursday:Rabbi Cohen']);
 assert.ok(globalThis.__notes.at(-1).includes('No email on file for: Rabbi Dov'));
 // The next cron run sends nothing again.
 const n=globalThis.__mail.length;await ap.runHashgachaAutopilot(h.env,at('2026-10-29T18:20:00Z'));assert.equal(globalThis.__mail.length,n);
 // Baum files on Friday morning: thanked within the next check.
 h.file(2,'2026-10-30T07:00:00.000Z');
 await ap.runHashgachaAutopilot(h.env,at('2026-10-30T07:15:00Z'));
 assert.ok(h.sends().includes('thanks:Rabbi Baum'));
 // Shabbat afternoon: nothing at all, even a thank-you.
 h.file(3,'2026-10-31T11:00:00.000Z');const before=globalThis.__mail.length;
 await ap.runHashgachaAutopilot(h.env,at('2026-10-31T12:00:00Z'));
 assert.equal(globalThis.__mail.length,before,'quiet on Shabbat');
 // Saturday night after Shabbat: Cohen's thank-you (he filed on Shabbat); nobody missing, so no reminder.
 await ap.runHashgachaAutopilot(h.env,at('2026-10-31T18:30:00Z'));
 assert.ok(h.sends().includes('thanks:Rabbi Cohen'));
 assert.ok(!h.sends().some(s=>s.startsWith('saturday:')));
});

test('anyone still missing gets the Saturday-night reminder after Shabbat, then the last one on Sunday morning, once each',async()=>{
 reset();const h=setup();
 h.file(1,'2026-10-27T10:00:00.000Z');h.file(2,'2026-10-27T11:00:00.000Z'); // Cohen never files
 await ap.runHashgachaAutopilot(h.env,at('2026-10-31T15:40:00Z')); // 17:40 local: Shabbat isn't over yet
 assert.ok(!h.sends().some(s=>s.startsWith('saturday:')));
 await ap.runHashgachaAutopilot(h.env,at('2026-10-31T18:10:00Z')); // 20:10 local
 assert.ok(h.sends().includes('saturday:Rabbi Cohen'));assert.ok(!h.sends().includes('saturday:Rabbi Adler'));
 await ap.runHashgachaAutopilot(h.env,at('2026-11-01T07:15:00Z')); // Sunday 09:15 local
 await ap.runHashgachaAutopilot(h.env,at('2026-11-01T07:30:00Z'));
 assert.deepEqual(h.sends().filter(s=>s.startsWith('sunday:')),['sunday:Rabbi Cohen']);
 const email=globalThis.__mail.find(m=>m.subject.startsWith('Last reminder'));
 assert.equal(email.to,'cohen@example.com');assert.ok(email.body.startsWith('Hi Rabbi Cohen,'));
 // Reports filed before the autopilot was turned on are not thanked weeks later.
 assert.ok(h.sends().filter(s=>s.startsWith('thanks:')).length===2,'Adler and Baum filed after it was on, so both thanked');
});

test('switched off means no emails at all',async()=>{
 reset();const h=setup();
 h.db.prepare("UPDATE settings SET value=? WHERE key='hashgacha_autopilot'").run(JSON.stringify({enabled:false,enabled_at:'2026-10-26T00:00:00.000Z'}));
 await ap.runHashgachaAutopilot(h.env,at('2026-10-29T18:05:00Z'));
 assert.equal(globalThis.__mail.length,0);
});

test('greetings keep a title with the surname ("Hi R\' Heyman"), and use first names otherwise',async()=>{
 const g=await build({entryPoints:['shared/greeting.ts'],bundle:true,write:false,format:'esm',platform:'node'});
 const {greetingName}=await import(`data:text/javascript;base64,${Buffer.from(g.outputFiles[0].text).toString('base64')}`);
 assert.equal(greetingName("R' Heyman"),"R' Heyman");assert.equal(greetingName('R’ Storch'),'R’ Storch');
 assert.equal(greetingName('Rabbi Cohen'),'Rabbi Cohen');assert.equal(greetingName('Moshe Katz'),'Moshe');
});

test('with a start week set, an earlier week gets no reminders and no thank-yous; the start week does',async()=>{
 reset();const h=setup();
 h.db.prepare("UPDATE settings SET value=? WHERE key='hashgacha_autopilot'").run(JSON.stringify({enabled:true,enabled_at:'2026-10-26T00:00:00.000Z',start_week:'2026-11-01'}));
 h.file(1,'2026-10-29T10:00:00.000Z');
 await ap.runHashgachaAutopilot(h.env,at('2026-10-29T15:00:00Z')); // thank-you time for week of 25 Oct
 await ap.runHashgachaAutopilot(h.env,at('2026-10-29T18:05:00Z')); // Thursday reminder time for week of 25 Oct
 await ap.runHashgachaAutopilot(h.env,at('2026-10-31T18:10:00Z'));
 await ap.runHashgachaAutopilot(h.env,at('2026-11-01T07:15:00Z')); // Sunday: still about the week of 25 Oct
 assert.equal(globalThis.__mail.length,0,'nothing about the week of 25 Oct');
 assert.equal(ap.reportWeek('Asia/Jerusalem',at('2026-11-05T18:05:00Z')),'2026-11-01');
});

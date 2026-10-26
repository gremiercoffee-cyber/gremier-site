import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// The computer helper's server side, with a fake model and fake Gmail: claiming jobs, approvals for outside
// agents, hard stops (CAPTCHA, card forms), the user's answers, emailed codes, and finishing.
globalThis.__model=[];globalThis.__prompts=[];globalThis.__notes=[];globalThis.__mail='';
const out=await build({entryPoints:['worker/browser.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fakes',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export function getProvider(){return {complete:async(r)=>{globalThis.__prompts.push(r);const next=globalThis.__model.shift();if(next===undefined)throw Error("no fixture");return typeof next==="function"?next(r):next;}}}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]push\.ts$/},()=>({contents:'export async function notify(_e,type,title,body,item){globalThis.__notes.push({type,title,body,item})}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]google\.ts$/},()=>({contents:'export async function searchEmail(){return globalThis.__mail?[{thread_id:"t",account:"me"}]:[]};export async function readThread(){return {messages:[{text:globalThis.__mail}]}};export async function accessToken(){};export async function accountEmails(){return []}',loader:'js'}));
}}]});
const h=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);

function env(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 return {db,env:{DB:{prepare}}};
}
const page=(over={})=>({url:'https://cosend.example/signup',title:'Sign up',elements:[{n:1,tag:'input',type:'email',label:'Email'},{n:2,tag:'button',label:'Continue with Google'}],text:'Create your account',...over});
const reset=()=>{globalThis.__model.length=0;globalThis.__prompts.length=0;globalThis.__notes.length=0;globalThis.__mail='';};

test('one job at a time: your job is claimed by the computer and resumed by it; another computer waits',async()=>{
 reset();const {env:e}=env();
 const {id}=await h.createJob(e,{instruction:'Make a CoSend account',start_url:'https://cosend.example',source:'you'});
 const a=await h.nextJob(e,'home');assert.equal(a.job.id,id);assert.equal(a.job.resume,false);
 assert.equal((await h.nextJob(e,'laptop')).job,null,'a second computer does not take a job while one is running');
 assert.equal((await h.nextJob(e,'home')).job.resume,true,'the same computer picks up where it left off');
});

test('a job from Codex waits for your Allow (phone notification) and is not run before it',async()=>{
 reset();const {env:e}=env();
 const {id,status}=await h.createJob(e,{instruction:'Enable the People API',source:'Codex'});
 assert.equal(status,'waiting_approval');
 assert.equal(globalThis.__notes[0].type,'helper_approve');assert.match(globalThis.__notes[0].title,/Codex asks/);
 assert.equal((await h.nextJob(e,'home')).job,null);
 await h.decideJob(e,id,'approve');
 assert.equal((await h.nextJob(e,'home')).job.id,id);
});

test('steps use the cheap model, fall back to the strong one if its answer is unusable, and log what was done',async()=>{
 reset();const {env:e}=env();
 const {id}=await h.createJob(e,{instruction:'Make a CoSend account',source:'you'});await h.nextJob(e,'home');
 globalThis.__model.push('sorry, not JSON','{"action":"click","n":2,"thought":"use Google sign-in"}');
 const a=await h.nextAction(e,id,page());
 assert.equal(a.action,'click');assert.equal(a.n,2);
 assert.deepEqual(globalThis.__prompts.map(p=>p.tier),['writer','main']);
 assert.match(globalThis.__prompts[0].system,/never type into password fields/);
 const job=(await h.listJobs(e))[0];assert.equal(job.steps,1);assert.match(job.log,/clicked “Continue with Google”/);
});

test('a CAPTCHA or a card form stops and asks you; your answer goes into the next step',async()=>{
 reset();const {env:e}=env();
 const {id}=await h.createJob(e,{instruction:'Make a CoSend account',source:'you'});await h.nextJob(e,'home');
 const a=await h.nextAction(e,id,page({flags:{captcha:true}}));
 assert.equal(a.action,'ask');assert.equal(globalThis.__prompts.length,0,'no AI spent on a CAPTCHA page');
 assert.equal((await h.jobStatus(e,id)).status,'needs_you');assert.equal(globalThis.__notes.at(-1).type,'helper');
 assert.equal((await h.nextAction(e,id,page())).action,'fail','nothing runs while it waits for you');
 await h.decideJob(e,id,'answer','Done, I solved it');
 globalThis.__model.push('{"action":"click","n":2}');
 await h.nextAction(e,id,page());
 assert.match(globalThis.__prompts.at(-1).prompt,/THE USER ANSWERED YOUR LAST QUESTION: Done, I solved it/);
 const card=await h.nextAction(e,id,page({flags:{card_field:true}}));assert.equal(card.action,'ask');assert.match(card.question,/card or payment/);
});

test('an emailed verification code is looked up in Gmail and handed to the next step',async()=>{
 reset();const {env:e}=env();
 const {id}=await h.createJob(e,{instruction:'Make a CoSend account',source:'you'});await h.nextJob(e,'home');
 globalThis.__mail='Your CoSend verification code is 482913. It expires in 10 minutes.';
 globalThis.__model.push('{"action":"email_code","from":"CoSend"}','{"action":"type","n":1,"text":"482913"}');
 assert.equal((await h.nextAction(e,id,page())).action,'wait');
 await h.nextAction(e,id,page());
 assert.match(globalThis.__prompts.at(-1).prompt,/emailed verification code is 482913/);
});

test('finishing stores the result and screenshot and tells you; a stopped job ends at its next step',async()=>{
 reset();const {env:e}=env();
 const {id}=await h.createJob(e,{instruction:'Enable the People API',source:'you'});await h.nextJob(e,'home');
 await h.finishJob(e,id,{status:'done',result:'Enabled the People API for project chief-of-staff.',screenshot:'data:image/jpeg;base64,AAAA'});
 const j=(await h.listJobs(e))[0];assert.equal(j.status,'done');assert.equal(j.screenshot,'data:image/jpeg;base64,AAAA');
 assert.match(globalThis.__notes.at(-1).title,/Done/);
 const second=await h.createJob(e,{instruction:'Something else',source:'you'});await h.nextJob(e,'home');
 await h.decideJob(e,second.id,'cancel');
 assert.equal((await h.nextAction(e,second.id,page())).action,'fail');
});

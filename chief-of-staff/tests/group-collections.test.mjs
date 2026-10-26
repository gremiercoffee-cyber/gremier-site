import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Collecting answers from a group: confirm on the draft → sending starts a folder with a place per person;
// answers can be written in by hand; saying No (or not deciding) starts nothing.
globalThis.__sent=[];
const stubs={name:'no-network',setup(b){
 b.onLoad({filter:/[\\/]worker[\\/]google\.ts$/},()=>({contents:'export async function sendEmail(_e,m){globalThis.__sent.push(m)};export async function searchEmail(){return []};export async function readThread(){return {messages:[]}};export async function accessToken(){};export async function accountEmails(){return []}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]gworkspace\.ts$/},()=>({contents:'export async function createDoc(){return {file_id:"d",link:"https://docs.example/d",account:"me"}};export async function appendToDoc(){}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]ai\.ts$/},()=>({contents:'export function getProvider(){throw Error("Unexpected AI call")}',loader:'js'}));
 b.onLoad({filter:/[\\/]worker[\\/]push\.ts$/},()=>({contents:'export async function notify(){}',loader:'js'}));
}};
const load=async f=>{const o=await build({entryPoints:[f],bundle:true,write:false,format:'esm',platform:'node',plugins:[stubs]});return import(`data:text/javascript;base64,${Buffer.from(o.outputFiles[0].text).toString('base64')}`);};
const groups=await load('worker/groups.ts');
const trackers=await load('worker/trackers.ts');

function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 return {db,env:{DB:{prepare,batch:async s=>Promise.all(s.map(x=>x.run()))}}};
}

test('confirmed on the draft: sending opens a folder with a place for each rabbi; typed-in answers are filed',async()=>{
 globalThis.__sent.length=0;const {db,env}=setup();
 const g=await groups.saveGroup(env,{name:'Night Seder Rabbis',add:[{name:"R' Heyman",email:'heyman@example.com'},{name:"R' Storch",email:'storch@example.com'}]});
 const d=await groups.draftBroadcast(env,{group:g.id,subject:'Chanukah parties',body:'Hi {first_name}, what are your Chanukah party plans?',collecting:'their Chanukah party plans'});
 assert.equal(d.collect,null,'not decided until the user confirms');assert.equal(d.collect_expecting,'their Chanukah party plans');
 await groups.setCollect(env,d.id,{collect:true});
 const r=await groups.sendBroadcast(env,d.id);assert.equal(r.sent,2);
 const sent=db.prepare('SELECT tracker_id FROM broadcasts WHERE id=?').get(d.id);assert.ok(sent.tracker_id,'a collection was started');
 const tr=db.prepare('SELECT * FROM trackers WHERE id=?').get(sent.tracker_id);
 assert.equal(tr.group_id,g.id);assert.equal(tr.broadcast_id,d.id);assert.equal(tr.expecting,'their Chanukah party plans');assert.equal(tr.backfill_days,0,'only answers from now on');
 let [c]=await trackers.groupCollections(env,g.id);
 assert.deepEqual(c.people.map(p=>p.name).sort(),["R' Heyman","R' Storch"]);assert.equal(c.answered,0);
 await trackers.addManualAnswer(env,c.id,"R' Storch",'Party on the 3rd night, in the Beis Medrash');
 [c]=await trackers.groupCollections(env,g.id);
 assert.equal(c.answered,1);
 const storch=c.people.find(p=>p.name==="R' Storch");assert.ok(storch.answered);assert.equal(storch.answers[0].source,'manual');assert.match(storch.answers[0].text,/3rd night/);
 assert.equal(c.people.find(p=>p.name==="R' Heyman").answered,false);
});

test('saying No, or never deciding, sends the email but starts no collection',async()=>{
 const {db,env}=setup();
 const g=await groups.saveGroup(env,{name:'Rabbis',add:[{name:'Rabbi A',email:'a@example.com'}]});
 const no=await groups.draftBroadcast(env,{group:g.id,subject:'Q',body:'Please reply with your list',collecting:'their lists'});
 await groups.setCollect(env,no.id,{collect:false});await groups.sendBroadcast(env,no.id);
 const later=await groups.draftBroadcast(env,{group:g.id,subject:'Q2',body:'Another question',collecting:'answers'});
 await groups.sendBroadcast(env,later.id,{force:true});
 assert.equal(db.prepare('SELECT COUNT(*) n FROM trackers').get().n,0);
});

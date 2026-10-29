import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';

// Subject topics: "☕ Coffee" and "🛒 Shopping" get their own Telegram topic and chat; the Shopping topic keeps a
// pinned list with a tap-to-tick button per item, kept up to date when the list changes anywhere.
globalThis.__tg=[];globalThis.__chats=[];
const fakes={
 assistant:`export async function chat(env,text,mode,cid,opts){globalThis.__chats.push({text,opts});return{reply:{content:'OK'},actions:[],conversation:{id:'c-'+(opts.subject?.feature??'general')}}}`,
 transcribe:`export async function transcribeAudio(){return{text:''}}`,
 documents:`export async function uploadFile(){return{id:'f'}}`,
};
const out=await build({entryPoints:['worker/telegram.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'fakes',setup(b){
 b.onResolve({filter:/^\.\/(assistant|documents|transcribe)$/},(a)=>/telegram(-cards|-topics)?\.ts$/.test(a.importer)?{path:a.path.slice(2),namespace:'fake'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fake'},(a)=>({contents:fakes[a.path],loader:'js'}));
}}]});
const telegram=await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
const topicsOut=await build({entryPoints:['worker/telegram-topics.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const topics=await import(`data:text/javascript;base64,${Buffer.from(topicsOut.outputFiles[0].text).toString('base64')}`);
let msgId=100,thread=50;
globalThis.fetch=async(url,init)=>{
 const method=String(url).split('/').pop(),body=JSON.parse(init.body);globalThis.__tg.push({method,body});
 const result=method==='createForumTopic'?{message_thread_id:++thread}:{message_id:++msgId};
 return new Response(JSON.stringify({ok:true,result}),{headers:{'content-type':'application/json'}});};
function env(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('telegram',JSON.stringify({owner_id:1,group_id:-100}));
 const prepare=sql=>{let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)??null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:Number(db.prepare(sql).run(...args).changes)}}}}};
 return {db,env:{DB:{prepare,batch:async(st)=>Promise.all(st.map(s=>s.run()))},TELEGRAM_BOT_TOKEN:'fixture'}};
}
const calls=(m)=>globalThis.__tg.filter(t=>t.method===m).map(t=>t.body);
const reset=()=>{globalThis.__tg.length=0;globalThis.__chats.length=0;};
const flush=async(ps)=>{await Promise.all(ps);};

test('a Coffee topic is made once, and what is said there goes to its own coffee chat',async()=>{
 reset();const {env:e}=env();
 const a=await topics.makeSubjectTopic(e,{subject:'coffee'});
 assert.equal(a.created,true);assert.equal(calls('createForumTopic')[0].name,'☕ Coffee');
 const again=await topics.makeSubjectTopic(e,{subject:'Coffee'});
 assert.deepEqual([again.created,again.thread],[false,a.thread]);assert.equal(calls('createForumTopic').length,1);
 const ps=[];
 await telegram.handleUpdate(e,{update_id:5,message:{message_id:9,from:{id:1},chat:{id:-100,type:'supergroup'},is_topic_message:true,message_thread_id:a.thread,text:'bottled 24 classic',date:1}},(p)=>ps.push(p));
 await flush(ps);
 assert.equal(globalThis.__chats[0].opts.subject.feature,'coffee');
 assert.equal(calls('sendMessage').at(-1).message_thread_id,a.thread,'the reply stays in the topic');
});

test('each shopping list gets its own pinned message; a tap takes the item off at once, with Undo',async()=>{
 reset();const {db,env:e}=env();
 const shop=await import(`data:text/javascript;base64,${Buffer.from((await build({entryPoints:['worker/shopping.ts'],bundle:true,write:false,format:'esm',platform:'node'})).outputFiles[0].text).toString('base64')}`);
 await shop.addShoppingItems(e,undefined,[{name:'Milk',quantity:'2'},{name:'Eggs'}]);
 assert.equal(calls('sendMessage').length,0,'no Shopping topic yet: nothing sent');
 await shop.saveShoppingList(e,{name:'Amazon'});await shop.addShoppingItems(e,'Amazon',[{name:'Claritin'}]);
 await topics.makeSubjectTopic(e,{subject:'shopping'});
 const cards=calls('sendMessage').filter(m=>m.reply_markup||/to get/.test(m.text));
 assert.deepEqual(cards.map(c=>c.text.match(/<b>(.+?)<\/b>/)[1]),['Store','Amazon'],'never mixed');
 assert.deepEqual(cards[0].reply_markup.inline_keyboard.map(r=>r[0].text),['⬜ Milk (2)','⬜ Eggs']);
 assert.deepEqual(cards[1].reply_markup.inline_keyboard.map(r=>r[0].text),['⬜ Claritin']);
 assert.equal(calls('pinChatMessage').length,2);
 const storeMsg=calls('pinChatMessage')[0].message_id;
 const milk=db.prepare("SELECT id FROM shopping_items WHERE name='Milk'").get().id;
 const before=globalThis.__tg.length;
 await topics.pressShopping(e,milk,'c',{chat:-100,message_id:storeMsg,reply_markup:cards[0].reply_markup});
 const firstCall=globalThis.__tg[before];
 assert.equal(firstCall.method,'editMessageText','the message changes first, before saving');
 assert.deepEqual(firstCall.body.reply_markup.inline_keyboard.map(r=>r[0].text),['⬜ Eggs','↩️ Undo: Milk (2)']);
 assert.match(firstCall.body.text,/1 to get/);
 assert.equal(db.prepare('SELECT checked FROM shopping_items WHERE id=?').get(milk).checked,1);
 const after=calls('editMessageText').filter(b=>b.message_id===storeMsg).at(-1);
 assert.deepEqual(after.reply_markup.inline_keyboard.map(r=>r[0].text),['⬜ Eggs','↩️ Undo: Milk (2)'],'the refresh agrees');
 await topics.pressShopping(e,milk,'u');
 assert.match(calls('editMessageText').filter(b=>b.message_id===storeMsg).at(-1).text,/2 to get/,'Undo puts it back');
});

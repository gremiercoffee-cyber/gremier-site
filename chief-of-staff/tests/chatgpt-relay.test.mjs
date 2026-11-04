import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {build} from 'esbuild';import {createHash} from 'node:crypto';
import {promptFor,THREAD} from '../runner/chief-chat-relay.mjs';
const buildResult=await build({stdin:{contents:"export {chatgptRelayRoute,RELAY_ORIGIN,RELAY_RESOURCE} from './worker/chatgpt-relay';export {default as worker} from './worker/index';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const m=await import('data:text/javascript;base64,'+Buffer.from(buildResult.outputFiles[0].text).toString('base64'));
const O=m.RELAY_ORIGIN,R=m.RELAY_RESOURCE,callback='https://chatgpt.com/connector_platform_oauth_redirect';
function setup(){
 const db=new DatabaseSync(':memory:');for(const f of readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('migrations/'+f,'utf8'));
 const prepare=sql=>{let a=[];return{bind(...v){a=v;return this;},async first(){return db.prepare(sql).get(...a)??null;},async all(){return{results:db.prepare(sql).all(...a)};},async run(){return{meta:{changes:Number(db.prepare(sql).run(...a).changes)}};}};};
 const env={DB:{prepare,batch:async ss=>{db.exec('BEGIN');try{const a=[];for(const s of ss)a.push(await s.run());db.exec('COMMIT');return a;}catch(e){db.exec('ROLLBACK');throw e;}}},COS_ACCESS_TOKEN:'owner-fixture',AGENT_KEY:'agent-fixture'};
 const call=async(path,method='GET',body,headers={})=>{let r=await m.worker.fetch(new Request(O+path,{method,headers:{...(body instanceof URLSearchParams?{'content-type':'application/x-www-form-urlencoded'}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:body instanceof URLSearchParams?body.toString():JSON.stringify(body)})}),env,{waitUntil(){}});return{status:r.status,headers:r.headers,data:(r.headers.get('content-type')||'').includes('json')?await r.json():await r.text()};};return{db,env,call};
}
async function grant(h,scopes='cos.relay'){
 const reg=await h.call('/api/mcp/oauth/register','POST',{redirect_uris:[callback],token_endpoint_auth_method:'none'});assert.equal(reg.status,201);const client=reg.data.client_id,v='a'.repeat(64),challenge=createHash('sha256').update(v).digest('base64url');
 const q=new URLSearchParams({client_id:client,redirect_uri:callback,response_type:'code',scope:scopes,state:'test-state',resource:R,code_challenge:challenge,code_challenge_method:'S256'});
 const page=await h.call('/api/mcp/oauth/authorize?'+q);assert.equal(page.status,200);assert.ok(!page.data.includes('owner-fixture'));assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
 const request=h.db.prepare('SELECT id FROM cos_oauth_requests ORDER BY rowid DESC LIMIT 1').get();
 const consent=await h.call('/api/mcp/oauth/authorize','POST',{request_id:request.id,approve:true},{origin:O,authorization:'Bearer owner-fixture'});assert.equal(consent.status,200);
 const redirect=new URL(consent.data.redirect);assert.equal(redirect.searchParams.get('iss'),O);assert.equal(redirect.searchParams.get('state'),'test-state');const code=redirect.searchParams.get('code');
 const form=new URLSearchParams({grant_type:'authorization_code',client_id:client,redirect_uri:callback,code,code_verifier:v,resource:R});
 const token=await h.call('/api/mcp/oauth/token','POST',form);assert.equal(token.status,200);return{...token.data,client,form};
}
const tool=(h,token,name,args={})=>h.call('/api/mcp','POST',{jsonrpc:'2.0',id:5,method:'tools/call',params:{name,arguments:args}},token?{authorization:'Bearer '+token}:{});
test('MCP discovery is public but every private tool requires a separate OAuth grant',async()=>{
 const h=setup(),meta=await h.call('/.well-known/oauth-protected-resource');assert.equal(meta.data.resource,R);
 const hello=await h.call('/api/mcp','POST',{id:1,method:'initialize'});assert.equal(hello.data.result.serverInfo.name,'chief-of-staff');
 const tools=await h.call('/api/mcp','POST',{id:2,method:'tools/list'});assert.deepEqual(tools.data.result.tools.map(t=>t.name),['get_tasks','add_task','complete_task','defer_task','get_my_day','get_reminders','add_reminder','get_waiting','search_email','read_email_thread','search_whatsapp','get_alumni_visits','get_projects','find_research','draft_email','ask_chief_of_staff','check_chief_of_staff_request','chief_of_staff_connection']);
 assert.equal((await tool(h,null,'chief_of_staff_connection')).status,401);assert.equal((await tool(h,'owner-fixture','chief_of_staff_connection')).status,401);
 assert.ok(!JSON.stringify(tools.data).includes('owner-fixture'));assert.ok(tools.data.result.tools.every(t=>['cos.relay','cos.tasks.read','cos.tasks.write','cos.life.read','cos.drafts.write'].includes(t.securitySchemes[0].scopes[0])));
});
test('OAuth enforces owner consent, exact ChatGPT callbacks, resource and S256 PKCE',async()=>{
 const h=setup();assert.equal((await h.call('/api/mcp/oauth/register','POST',{redirect_uris:['https://evil.example/callback']})).status,400);
 assert.equal((await h.call('/api/mcp/oauth/authorize?client_id=x&redirect_uri=https://evil.example')).status,400);
 assert.equal((await h.call('/api/mcp/oauth/authorize','POST',{request_id:'x',approve:true},{origin:'https://evil.example',authorization:'Bearer owner-fixture'})).status,401);
 const g=await grant(h);assert.equal((await h.call('/api/mcp/oauth/token','POST',g.form)).status,400);
 assert.equal((await h.call('/api/mcp/oauth/token','POST',new URLSearchParams({...Object.fromEntries(g.form),resource:'https://evil.example'}))).data.error,'invalid_target');
 const serialized=JSON.stringify(h.db.prepare('SELECT * FROM cos_oauth_tokens').all());assert.ok(!serialized.includes(g.access_token));assert.ok(!serialized.includes(g.refresh_token));
});
test('relay goes to one existing chat, retries are idempotent, receipts and grant isolation are explicit',async()=>{
 const h=setup(),g=await grant(h),g2=await grant(h);
 const a=await tool(h,g.access_token,'ask_chief_of_staff',{message:'Read my Amazon list',request_key:'voice-turn-1'});const saved=a.data.result.structuredContent;
 assert.equal(saved.state,'queued');assert.equal(saved.executed,false);assert.equal(saved.thread_id,THREAD);assert.equal(saved.relay.online,false);
 const b=await tool(h,g.access_token,'ask_chief_of_staff',{message:'Read my Amazon list',request_key:'voice-turn-1'});assert.equal(b.data.result.structuredContent.request_id,saved.request_id);
 assert.equal((await tool(h,g.access_token,'ask_chief_of_staff',{message:'Different',request_key:'voice-turn-1'})).data.result.isError,true);
 assert.equal((await tool(h,g2.access_token,'check_chief_of_staff_request',{request_id:saved.request_id})).data.result.isError,true);
 assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,0);assert.equal(h.db.prepare('SELECT count(*) n FROM pending_actions').get().n,0);
 const headers={'x-agent-key':'agent-fixture'};
 assert.equal((await h.call('/api/agent/relay/next','POST',{ready:true})).status,401);
 const next=await h.call('/api/agent/relay/next','POST',{ready:true,detail:'fixture'},headers),r=next.data.request;assert.equal(r.id,saved.request_id);
 assert.equal((await h.call('/api/agent/relay/next','POST',{ready:true},headers)).data.request,null);
 assert.equal((await h.call(`/api/agent/relay/${r.id}/result`,'POST',{claim_token:'wrong',state:'done'},headers)).status,403);
 await h.call(`/api/agent/relay/${r.id}/submitted`,'POST',{claim_token:r.claim_token},headers);
 assert.equal((await tool(h,g.access_token,'check_chief_of_staff_request',{request_id:r.id})).data.result.structuredContent.state,'submitted');
 await h.call(`/api/agent/relay/${r.id}/result`,'POST',{claim_token:r.claim_token,state:'done',answer:'Your confirmed list.'},headers);
 assert.equal((await tool(h,g.access_token,'check_chief_of_staff_request',{request_id:r.id})).data.result.structuredContent.result,'Your confirmed list.');
});
test('expired claims are never replayed, revocation prevents fresh submissions and refresh tokens rotate',async()=>{
 const h=setup(),g=await grant(h);await tool(h,g.access_token,'ask_chief_of_staff',{message:'One request',request_key:'one'});
 const headers={'x-agent-key':'agent-fixture'},r=(await h.call('/api/agent/relay/next','POST',{ready:true},headers)).data.request;
 h.db.prepare('UPDATE cos_relay_requests SET claimed_at=0 WHERE id=?').run(r.id);
 assert.equal((await h.call('/api/agent/relay/next','POST',{ready:true},headers)).data.request,null);assert.equal(h.db.prepare('SELECT state FROM cos_relay_requests').get().state,'uncertain');
 const form=new URLSearchParams({grant_type:'refresh_token',client_id:g.client,refresh_token:g.refresh_token,resource:R});const refreshed=await h.call('/api/mcp/oauth/token','POST',form);assert.equal(refreshed.status,200);assert.equal((await h.call('/api/mcp/oauth/token','POST',form)).status,400);
 await h.call('/api/mcp/oauth/revoke','POST',new URLSearchParams({client_id:g.client,token:refreshed.data.access_token}));assert.equal((await tool(h,g.access_token,'chief_of_staff_connection')).status,401);assert.equal((await tool(h,refreshed.data.access_token,'chief_of_staff_connection')).status,401);
});
test('queue prompt targets the existing chat, preserves the request, and requires an explicit response receipt',()=>{
 const p=promptFor({id:'10000000-0000-4000-8000-000000000001',thread_id:THREAD,message:'What should I do tonight?'});assert.ok(p.includes('What should I do tonight?'));assert.ok(p.includes('relay-response.mjs'));assert.ok(p.includes('sensitive-action review'));
 assert.throws(()=>promptFor({id:'x',thread_id:'other'}));
});

test('direct task tools require fresh explicit scopes; existing relay-only grants cannot read or write tasks',async()=>{
 const h=setup(),old=await grant(h);assert.equal((await tool(h,old.access_token,'get_tasks')).status,401);assert.equal((await tool(h,old.access_token,'add_task',{title:'No',category:'coffee',request_key:'no'})).status,401);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,0);
 const reader=await grant(h,'cos.tasks.read');assert.equal(reader.scope,'cos.tasks.read');assert.equal((await tool(h,reader.access_token,'get_tasks',{category:'yeshiva'})).status,200);assert.equal((await tool(h,reader.access_token,'complete_task',{item_id:'x',expected_title:'x',request_key:'x'})).status,401);
});
test('phone task lookups use live records without a desktop or second model; writes are scoped, specific and retry-safe',async()=>{
 const h=setup(),g=await grant(h,'cos.tasks.read cos.tasks.write');const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Direct tools must not use a relay or inference');};
 try{const args={title:'Arrange alumni spreadsheet',category:'yeshiva',request_key:'new-task'};const a=await tool(h,g.access_token,'add_task',args);assert.equal(a.data.result.isError,undefined);const id=a.data.result.structuredContent.item.id;await tool(h,g.access_token,'add_task',args);assert.equal(h.db.prepare('SELECT count(*) n FROM items').get().n,1);
 assert.equal((await tool(h,g.access_token,'add_task',{...args,title:'Different'})).data.result.isError,true);
 const list=await tool(h,g.access_token,'get_tasks',{category:'yeshiva'});assert.equal(list.data.result.structuredContent.items[0].id,id);assert.equal(h.db.prepare('SELECT count(*) n FROM cos_relay_requests').get().n,0);
 const wrong=await tool(h,g.access_token,'complete_task',{item_id:id,expected_title:'Wrong title',request_key:'wrong'});assert.equal(wrong.data.result.isError,true);assert.equal(h.db.prepare('SELECT status FROM items WHERE id=?').get(id).status,'open');
 const defer=await tool(h,g.access_token,'defer_task',{item_id:id,expected_title:args.title,until:'2099-01-01T09:00:00+02:00',request_key:'later'});assert.equal(defer.data.result.structuredContent.saved,true);assert.equal((await tool(h,g.access_token,'get_tasks',{category:'yeshiva'})).data.result.structuredContent.returned,0);
 const done={item_id:id,expected_title:args.title,request_key:'done'};await tool(h,g.access_token,'complete_task',done);await tool(h,g.access_token,'complete_task',done);assert.equal(h.db.prepare('SELECT status FROM items WHERE id=?').get(id).status,'done');assert.equal(h.db.prepare('SELECT count(*) n FROM cos_relay_requests').get().n,0);
 }finally{globalThis.fetch=original;}
});

test('everyday ChatGPT tools need the new read scope and answer from live records without Codex or inference',async()=>{
 const h=setup(),tasks=await grant(h,'cos.relay cos.tasks.read cos.tasks.write');
 for(const name of ['get_my_day','get_waiting','search_email','get_projects','find_research'])assert.equal((await tool(h,tasks.access_token,name,{query:'x'})).status,401,name);
 assert.equal((await tool(h,tasks.access_token,'draft_email',{to:'a@b.c',subject:'s',body:'b',request_key:'d'})).status,401);
 const g=await grant(h,'cos.relay cos.tasks.read cos.tasks.write cos.life.read cos.drafts.write');
 const t=new Date().toISOString(),soon=new Date(Date.now()+2*3600_000).toISOString();
 h.db.prepare("INSERT INTO items(id,kind,title,status,priority,category,source,created_at,updated_at) VALUES('t1','task','Roast plan','open',2,'coffee','test',?,?)").run(t,t);
 h.db.prepare("INSERT INTO items(id,kind,title,status,priority,category,person,source,created_at,updated_at) VALUES('w1','waiting','Quote from bottle supplier','open',2,'coffee','Dana','test',?,?)").run(t,t);
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('no network in direct tools');};
 try{
  const rem={title:'Call the roaster',due_at:soon,category:'coffee',request_key:'rem-1'};
  const a=await tool(h,g.access_token,'add_reminder',rem);assert.equal(a.data.result.structuredContent.saved,true);await tool(h,g.access_token,'add_reminder',rem);
  assert.equal(h.db.prepare("SELECT count(*) n FROM items WHERE kind='reminder'").get().n,1);
  const day=(await tool(h,g.access_token,'get_my_day',{hours:3,category:'coffee'})).data.result.structuredContent;
  assert.ok(day.tasks.items.some(i=>i.title==='Roast plan'));assert.equal(day.reminders_due[0].title,'Call the roaster');assert.equal(day.waiting_on[0].title,'Quote from bottle supplier');
  assert.equal(day.calendar.source,'unavailable');assert.equal(day.window_hours,3);
  assert.equal((await tool(h,g.access_token,'get_waiting')).data.result.structuredContent.waiting_on[0].person,'Dana');
  const draft=await tool(h,g.access_token,'draft_email',{to:'a@b.c',subject:'Hi',body:'Hello',request_key:'d1'});assert.equal(draft.data.result.isError,true);
  assert.equal(h.db.prepare('SELECT count(*) n FROM pending_actions').get().n,0);assert.equal(h.db.prepare('SELECT count(*) n FROM cos_relay_requests').get().n,0);
 }finally{globalThis.fetch=original;}
});
test('when Codex cannot take relay work it goes to the Claude routine, answers only via its one-time link, and the desktop never sees it',async()=>{
 const h=setup();Object.assign(h.env,{CLAUDE_ROUTINE_URL:'https://routine.example/fire',CLAUDE_ROUTINE_TOKEN:'routine-fixture'});
 const g=await grant(h);const original=globalThis.fetch,fired=[];
 globalThis.fetch=async(url,init)=>{fired.push({url:String(url),body:JSON.parse(init.body)});return new Response('{}',{status:200});};
 try{
  const saved=(await tool(h,g.access_token,'ask_chief_of_staff',{message:'Research cold brew pricing',request_key:'c1'})).data.result.structuredContent;
  assert.equal(saved.state,'submitted');assert.equal(saved.engine,'claude');assert.equal(fired.length,1);
  const sent=JSON.parse(fired[0].body.text);assert.ok(sent.task.includes('Research cold brew pricing'));assert.ok(!JSON.stringify(fired).includes('agent-fixture'));
  const link=new URL(sent.reply_url);assert.equal(link.origin,m.RELAY_ORIGIN);
  assert.equal((await h.call('/api/agent/relay/next','POST',{ready:true},{'x-agent-key':'agent-fixture'})).data.request,null);
  assert.equal((await h.call(link.pathname+'?k='+'0'.repeat(64),'POST',{text:'forged'})).status,404);
  assert.equal((await h.call(link.pathname+link.search,'POST',{text:'Prices are…'})).status,200);
  const done=(await tool(h,g.access_token,'check_chief_of_staff_request',{request_id:saved.request_id})).data.result.structuredContent;
  assert.equal(done.state,'done');assert.equal(done.result,'Prices are…');assert.equal(done.engine,'claude');
  assert.equal((await h.call(link.pathname+link.search,'POST',{text:'again'})).status,404);
  // Codex online with room: stays for the Codex chat.
  await h.call('/api/agent/relay/next','POST',{ready:true},{'x-agent-key':'agent-fixture'});
  const q=(await tool(h,g.access_token,'ask_chief_of_staff',{message:'Build a feature',request_key:'c2'})).data.result.structuredContent;
  assert.equal(q.state,'queued');assert.equal(q.engine,'codex');assert.equal(fired.length,1);
  // Backup set to the API: never fired at Claude.
  h.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('codex_backup','api')").run();h.db.prepare('UPDATE cos_relay_status SET seen_at=0').run();
  assert.equal((await tool(h,g.access_token,'ask_chief_of_staff',{message:'Other',request_key:'c3'})).data.result.structuredContent.state,'queued');assert.equal(fired.length,1);
 }finally{globalThis.fetch=original;}
});

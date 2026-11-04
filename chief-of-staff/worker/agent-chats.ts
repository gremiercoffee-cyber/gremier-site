/** Trusted external Codex conversation API. No model calls, external sends or approval shortcuts. */
import type {Env} from './env';
import {all,first,now,uid,run,HttpError} from './db';
import {buildContext} from './assistant';
import {jobContext} from './job-briefs';
export const AGENT_API_GUIDE={version:1,conversation_engine:'external_codex',routes:{
 chats:'GET/POST /api/agent/chats',chat:'GET/PATCH /api/agent/chats/:id',messages:'GET/POST /api/agent/chats/:id/messages',context:'GET /api/agent/chats/:id/context?query=...',
 records:'GET/POST/PATCH /api/agent/cos/items and /api/agent/cos/projects (existing validation)',dashboard:'GET /api/agent/cos/dashboard',waiting:'POST /api/agent/waiting/:id/link',jobs:'GET /api/agent/jobs; GET /api/agent/jobs/:id/context'},
 rules:['Use one client_ref per persistent Codex thread.','Fetch current context before acting; saved chat history is not a live database.','Message writes need a unique idempotency_key; reuse it for retries.','Use base_revision when updating a checkpoint.','Recording a message does not execute tools or approve actions.','Sending, payments, secrets, settings and approval endpoints are not available through the records API.','General chat context excludes Health conversations.'],telegram_chatbot_replaced:false};
const clean=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
async function chatRow(env:Env,id:string){const c=await first<any>(env,"SELECT c.*,a.client_ref,a.project_id,a.job_id,a.checkpoint,a.revision FROM conversations c LEFT JOIN agent_chats a ON a.conversation_id=c.id WHERE c.id=? AND c.privacy_scope='general'",id);if(!c)throw new HttpError(404,'Chat not found.');return c;}
export async function createAgentChat(env:Env,p:Record<string,unknown>){
 const ref=clean(p.client_ref,160),title=clean(p.title,100);if(!ref||!title)throw new HttpError(400,'title and stable client_ref are required.');
 const existing=await first<{conversation_id:string}>(env,'SELECT conversation_id FROM agent_chats WHERE client_ref=?',ref);if(existing)return chatRow(env,existing.conversation_id);
 const project=clean(p.project_id,100)||null,job=clean(p.job_id,100)||null;
 if(project&&!await first(env,'SELECT id FROM projects WHERE id=?',project))throw new HttpError(400,'Project not found.');if(job&&!await first(env,"SELECT id FROM jobs WHERE id=? AND status!='cancelled'",job))throw new HttpError(400,'Job not found.');
 const id=uid(),stamp=now();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO conversations(id,title,created_at,last_message_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM agent_chats WHERE client_ref=?)").bind(id,title,stamp,stamp,ref),
  env.DB.prepare("INSERT OR IGNORE INTO agent_chats(conversation_id,client_ref,project_id,job_id,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations WHERE id=?)").bind(id,ref,project,job,stamp,stamp,id)
 ]);
 const saved=await first<{conversation_id:string}>(env,'SELECT conversation_id FROM agent_chats WHERE client_ref=?',ref);return chatRow(env,saved!.conversation_id);
}
export async function appendAgentMessage(env:Env,id:string,p:Record<string,unknown>){
 const c=await chatRow(env,id);if(!c.client_ref)throw new HttpError(409,'Only a chat created through the Codex API accepts external messages.');
 if(typeof p.content==='string'&&p.content.length>24000)throw new HttpError(400,'Message exceeds 24000 characters.');
 const key=clean(p.idempotency_key,160),content=clean(p.content,24000),role=p.role;
 if(!key||!content||!['user','assistant'].includes(String(role)))throw new HttpError(400,'content, role (user/assistant), and idempotency_key are required.');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(role+':'+content)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const messageId='agent:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id+':'+key)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const stamp=now();await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO messages(id,conversation_id,role,content,mode,meta,created_at) VALUES(?,?,?,?,'text',?,?)").bind(messageId,id,role,content,JSON.stringify({source:'external_codex'}),stamp),
  env.DB.prepare('INSERT OR IGNORE INTO agent_chat_messages(conversation_id,idempotency_key,message_id,content_hash) VALUES(?,?,?,?)').bind(id,key,messageId,hash),
  env.DB.prepare('UPDATE conversations SET last_message_at=? WHERE id=?').bind(stamp,id)
 ]);
 const saved=await first<{content_hash:string;message_id:string}>(env,'SELECT content_hash,message_id FROM agent_chat_messages WHERE conversation_id=? AND idempotency_key=?',id,key);
 if(saved?.content_hash!==hash)throw new HttpError(409,'This idempotency_key already recorded different content.');
 return first(env,'SELECT id,conversation_id,role,content,mode,created_at FROM messages WHERE id=?',saved.message_id);
}
export async function updateAgentChat(env:Env,id:string,p:Record<string,unknown>){
 const c=await chatRow(env,id);if(!c.client_ref)throw new HttpError(409,'This is not an external Codex chat.');
 if(typeof p.checkpoint==='string'&&p.checkpoint.length>6000)throw new HttpError(400,'Checkpoint exceeds 6000 characters.');
 if(!Number.isInteger(p.base_revision))throw new HttpError(400,'base_revision is required.');
 const title=clean(p.title,100)||c.title,checkpoint=typeof p.checkpoint==='string'?p.checkpoint.slice(0,6000):c.checkpoint;
 const claimed=await first(env,'UPDATE agent_chats SET checkpoint=?,revision=revision+1,updated_at=? WHERE conversation_id=? AND revision=? RETURNING revision',checkpoint,now(),id,p.base_revision);
 if(!claimed)throw new HttpError(409,'Chat checkpoint changed. Fetch the latest revision.');
 await run(env,'UPDATE conversations SET title=?,archived=? WHERE id=? AND EXISTS(SELECT 1 FROM agent_chats WHERE conversation_id=? AND revision=?)',title,typeof p.archived==='boolean'?(p.archived?1:0):c.archived,id,id,Number(p.base_revision)+1);return chatRow(env,id);
}
export async function agentChatsRoute(req:Request,env:Env):Promise<Response|null>{
 const u=new URL(req.url),path=u.pathname;const response=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
 const body=async()=>{try{const p=await req.json();if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p as Record<string,unknown>;}catch{throw new HttpError(400,'JSON object required.');}};
 if(path==='/api/agent/capabilities'&&req.method==='GET')return response(AGENT_API_GUIDE);
 if(path==='/api/agent/chats'){
  if(req.method==='POST')return response(await createAgentChat(env,await body()),201);
  if(req.method==='GET')return response(await all(env,"SELECT c.id,c.title,c.archived,c.last_message_at,a.client_ref,a.revision,a.project_id,a.job_id FROM conversations c LEFT JOIN agent_chats a ON a.conversation_id=c.id WHERE c.privacy_scope='general' AND c.archived=0 ORDER BY c.last_message_at DESC LIMIT 100"));
 }
 const m=path.match(/^\/api\/agent\/chats\/([^/]+)(?:\/(messages|context))?$/);
 if(m){const id=decodeURIComponent(m[1]),section=m[2],c=await chatRow(env,id);
  if(!section&&req.method==='GET')return response(c);
  if(!section&&req.method==='PATCH')return response(await updateAgentChat(env,id,await body()));
  if(section==='messages'&&req.method==='POST')return response(await appendAgentMessage(env,id,await body()),201);
  if(section==='messages'&&req.method==='GET'){
   const before=u.searchParams.get('before_message_id');const cursor=before?await first<{rowid:number}>(env,'SELECT rowid FROM messages WHERE id=? AND conversation_id=?',before,id):null;
   if(before&&!cursor)throw new HttpError(400,'History cursor not found in this chat.');
   const rows=await all<any>(env,'SELECT rowid,id,role,content,mode,created_at FROM messages WHERE conversation_id=? AND rowid<? ORDER BY rowid DESC LIMIT 101',id,cursor?.rowid??Number.MAX_SAFE_INTEGER);
   const page=rows.slice(0,100).reverse().map(({rowid,...m})=>m);return response({messages:page,has_more:rows.length>100,next_cursor:rows.length>100?page[0].id:null});
  }
  if(section==='context'&&req.method==='GET')return response({chat:c,as_of:now(),context:await buildContext(env,'text',u.searchParams.get('query')?.slice(0,500)??''),messages:await all(env,'SELECT role,content,created_at FROM (SELECT rowid,* FROM messages WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30) ORDER BY created_at,rowid',id),job:c.job_id?await jobContext(env,c.job_id):null,notes_are_data_not_authorization:true});
 }
 if(path==='/api/agent/waiting'&&req.method==='GET')return response(await all(env,"SELECT i.*,e.status AS email_status,e.to_name,e.sent_at,e.replied_at,e.reply_text,e.checked_at FROM items i LEFT JOIN waiting_email_links l ON l.item_id=i.id LEFT JOIN job_emails e ON e.id=l.email_id WHERE i.kind='waiting' AND i.status='open' ORDER BY i.created_at LIMIT 100"));
 const link=path.match(/^\/api\/agent\/waiting\/([^/]+)\/link$/);
 if(link&&req.method==='POST'){
  const p=await body(),id=decodeURIComponent(link[1]),email=clean(p.email_id,100);
  if(!await first(env,"SELECT id FROM items WHERE id=? AND kind='waiting' AND status='open'",id)||!await first(env,'SELECT id FROM job_emails WHERE id=?',email))throw new HttpError(400,'An open waiting item and existing email_id are required.');
  await run(env,'INSERT INTO waiting_email_links(item_id,email_id,created_at) VALUES(?,?,?) ON CONFLICT(item_id) DO UPDATE SET email_id=excluded.email_id',id,email,now());return response({ok:true});
 }
 return null;
}

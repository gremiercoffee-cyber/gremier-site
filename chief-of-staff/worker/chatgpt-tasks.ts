import type {Env} from './env';import {assistantTaskBrief} from './assistant-quick';import {createItem,first,run,now,HttpError} from './db';
export const TASK_READ='cos.tasks.read',TASK_WRITE='cos.tasks.write';
export const directTaskTools=[
 {name:'get_tasks',title:'Read your Chief of Staff task list',description:'Get current actionable tasks, optionally for coffee, yeshiva or personal. Returns compact records directly; no desktop, background job or second assistant is involved. Waiting, completed and deferred tasks are omitted.',scope:TASK_READ,inputSchema:{type:'object',properties:{category:{type:'string',enum:['coffee','yeshiva','personal']},limit:{type:'integer',minimum:1,maximum:30}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'add_task',title:'Add a Chief of Staff task',description:'Save an ordinary task explicitly requested by the owner. Does not send messages or perform the task. Supply a stable request_key and reuse it for retries.',scope:TASK_WRITE,inputSchema:{type:'object',properties:{title:{type:'string',maxLength:180},category:{type:'string',enum:['coffee','yeshiva','personal']},due_at:{type:'string',description:'Optional ISO date-time with explicit timezone offset. Ask if the intended date/time is unclear.'},request_key:{type:'string',maxLength:120}},required:['title','category','request_key'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
 {name:'complete_task',title:'Mark a Chief of Staff task done',description:'Mark the task the owner explicitly identified as complete. Use its actual item_id and title from task records; never guess an ID. Does not execute the underlying task. Reuse request_key for retries.',scope:TASK_WRITE,inputSchema:{type:'object',properties:{item_id:{type:'string'},expected_title:{type:'string'},request_key:{type:'string',maxLength:120}},required:['item_id','expected_title','request_key'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}},
 {name:'defer_task',title:'Defer a Chief of Staff task',description:'Hide an explicitly identified task until the owner’s chosen time. Supply its actual item_id and current title, and an ISO time with explicit timezone offset. Ask what later means if unclear. Reuse request_key for retries.',scope:TASK_WRITE,inputSchema:{type:'object',properties:{item_id:{type:'string'},expected_title:{type:'string'},until:{type:'string'},request_key:{type:'string',maxLength:120}},required:['item_id','expected_title','until','request_key'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}}
];
const timestamp=(v:unknown)=>{if(typeof v!=='string'||!/(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw new HttpError(400,'An exact date and time with timezone is required.');return new Date(v).toISOString();};
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
export async function directTaskCall(env:Env,grant:string,name:string,a:Record<string,unknown>){
 if(name==='get_tasks'){if(a.category&&!['coffee','yeshiva','personal'].includes(String(a.category)))throw new HttpError(400,'Unknown category.');const b=await assistantTaskBrief(env,typeof a.category==='string'?a.category:null,Math.min(30,Number(a.limit)||12));return {...b,source:'live_records',timezone:'Asia/Jerusalem'};}
 const key=typeof a.request_key==='string'?a.request_key.trim():'';if(!key||key.length>120)throw new HttpError(400,'A stable request_key is required.');
 const fields=name==='add_task'?{name,title:a.title,category:a.category,due_at:a.due_at??null}:{name,item_id:a.item_id,expected_title:a.expected_title,until:a.until??null};
 const fingerprint=await digest(JSON.stringify(fields));const old=await first<any>(env,'SELECT fingerprint,result FROM cos_task_receipts WHERE grant_id=? AND request_key=?',grant,key);
 if(old){if(JSON.parse(old.result).pending)throw new HttpError(409,'This task request is still processing. Check the task list before retrying.');if(old.fingerprint!==fingerprint)throw new HttpError(409,'Request key was already used for different work.');return JSON.parse(old.result);}
 const reserved=await run(env,'INSERT OR IGNORE INTO cos_task_receipts(grant_id,request_key,fingerprint,result,created_at) VALUES(?,?,?,?,?)',grant,key,fingerprint,JSON.stringify({pending:true}),Date.now());
 if(!reserved.meta.changes)throw new HttpError(409,'This task request is already processing. Check the task list before retrying.');
 try{
 let item:any;
 if(name==='add_task'){
  if(typeof a.title!=='string'||!a.title.trim()||a.title.length>180||!['coffee','yeshiva','personal'].includes(String(a.category)))throw new HttpError(400,'A title and valid category are required.');
  // createItem preserves the existing stable-title deduplication and waiting detection.
  item=await createItem(env,{title:a.title.trim(),category:String(a.category),due_at:a.due_at?timestamp(a.due_at):null,kind:'task',source:'chatgpt'});
 }else{
  const existing=await first<any>(env,"SELECT id,title,status,kind FROM items WHERE id=? AND category IN('coffee','yeshiva','personal')",String(a.item_id||''));
  if(!existing||existing.title!==a.expected_title)throw new HttpError(409,'The task changed or could not be identified. Refresh the list first.');
  if(name==='complete_task'){
   if(!['open','done'].includes(existing.status))throw new HttpError(409,'This task is not open.');
   await run(env,"UPDATE items SET status='done',completed_at=?,updated_at=?,completion_source='chatgpt' WHERE id=? AND status='open'",now(),now(),existing.id);
   item={id:existing.id,title:existing.title,status:'done'};
  }else if(name==='defer_task'){
   if(existing.status!=='open')throw new HttpError(409,'This task is not open.');const until=timestamp(a.until);if(Date.parse(until)<=Date.now())throw new HttpError(400,'Choose a future time.');
   await run(env,"UPDATE items SET nudge_after=?,updated_at=? WHERE id=? AND status='open'",until,now(),existing.id);item={id:existing.id,title:existing.title,status:'open',deferred_until:until};
  }else throw new HttpError(400,'Unknown task action.');
 }
 const result={saved:true,item:{id:item.id,title:item.title,status:item.status,kind:item.kind,...(item.deferred_until?{deferred_until:item.deferred_until}:{})}};
 await run(env,'UPDATE cos_task_receipts SET result=? WHERE grant_id=? AND request_key=? AND fingerprint=?',JSON.stringify(result),grant,key,fingerprint);
 return result;
 }catch(e){await run(env,"DELETE FROM cos_task_receipts WHERE grant_id=? AND request_key=? AND result='{\"pending\":true}'",grant,key);throw e;}
}

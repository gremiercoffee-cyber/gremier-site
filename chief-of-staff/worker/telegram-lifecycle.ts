/** Bot API has no deletion webhook. A no-change edit validates known topics without posting or renaming. */
import type {Env} from './env';
import {all,first,now,run} from './db';
import {tg,tgConfig} from './telegram-api';
export const isMissingTopic=(code:number,description:string)=>code===400&&/\bTOPIC_(?:ID_INVALID|DELETED)\b|message thread not found/i.test(description);
export async function forgetTopic(env:Env,chat:number,topic:number,reason='Telegram confirmed topic missing'){
 const c=await tgConfig(env);if(!c.owner_id||chat!==c.group_id||topic<=1)return false;
 const key=chat+':'+topic,path='$.'+JSON.stringify(key),stamp=now();
 // Keep source history for audit, but remove visible entries and prevent future execution/delivery.
 await env.DB.batch([
  env.DB.prepare("INSERT INTO telegram_topic_state(chat_id,topic_id,state,checked_at,deleted_at,error) VALUES(?,?,'deleted',?,?,?) ON CONFLICT(chat_id,topic_id) DO UPDATE SET state='deleted',checked_at=excluded.checked_at,deleted_at=excluded.deleted_at,error=excluded.error").bind(chat,topic,stamp,stamp,reason),
  env.DB.prepare("UPDATE jobs SET status='cancelled',pinned=0,next_run_at=NULL,updated_at=? WHERE chat_id=? AND topic_id=? AND status!='cancelled'").bind(stamp,chat,topic),
  env.DB.prepare("UPDATE job_runs SET status='skipped',reply_token=NULL,finished_at=?,error='Telegram topic deleted' WHERE job_id IN(SELECT id FROM jobs WHERE chat_id=? AND topic_id=?) AND status IN('queued','running','asking')").bind(stamp,chat,topic),
  env.DB.prepare('UPDATE job_messages SET buttons=NULL WHERE job_id IN(SELECT id FROM jobs WHERE chat_id=? AND topic_id=?)').bind(chat,topic),
  env.DB.prepare("UPDATE conversations SET archived=1,pinned=0 WHERE id=(SELECT json_extract(value,?) FROM settings WHERE key='telegram_threads' AND json_valid(value))").bind(path),
  env.DB.prepare("UPDATE settings SET value=json_remove(value,?) WHERE key IN('telegram_subjects','telegram_threads') AND json_valid(value)").bind(path),
  env.DB.prepare("DELETE FROM settings WHERE key='telegram_shopping_cards' AND json_valid(value) AND json_extract(value,'$.chat')=? AND json_extract(value,'$.thread')=?").bind(chat,topic)
 ]);return true;
}
export async function reconcileTopics(env:Env,force=false){
 const c=await tgConfig(env);if(!env.TELEGRAM_BOT_TOKEN||!c.owner_id||!c.group_id)return {checked:0,deleted:0,unknown:0};
 const known=await all<{topic:number}>(env,"SELECT DISTINCT topic_id AS topic FROM jobs WHERE chat_id=? AND topic_id>1 AND status!='cancelled'",c.group_id);
 const subjects=await first<{value:string}>(env,"SELECT value FROM settings WHERE key='telegram_subjects'");
 if(subjects){try{for(const key of Object.keys(JSON.parse(subjects.value))){const [chat,topic]=key.split(':').map(Number);if(chat===c.group_id&&topic>1&&!known.some(k=>k.topic===topic))known.push({topic});}}catch{}}
 const states=await all<{topic_id:number;checked_at:string|null;state:string}>(env,'SELECT topic_id,checked_at,state FROM telegram_topic_state WHERE chat_id=?',c.group_id);
 const due=known.filter(k=>!states.some(s=>s.topic_id===k.topic&&(s.state==='deleted'||!force&&s.checked_at&&Date.parse(s.checked_at)>Date.now()-4*60000))).sort((a,b)=>String(states.find(s=>s.topic_id===a.topic)?.checked_at??'').localeCompare(String(states.find(s=>s.topic_id===b.topic)?.checked_at??''))).slice(0,20);
 let deleted=0,unknown=0;
 for(const {topic} of due){let state='present',error:string|null=null;
  try{await tg(env,'editForumTopic',{chat_id:c.group_id,message_thread_id:topic});}
  catch(e){const text=String(e);if(/TOPIC_NOT_MODIFIED|topic (?:is )?not modified|message is not modified/i.test(text)){}else if((await first<{state:string}>(env,'SELECT state FROM telegram_topic_state WHERE chat_id=? AND topic_id=?',c.group_id,topic))?.state==='deleted'){deleted++;continue;}else{state='unknown';unknown++;error='Could not verify topic; no data removed.';}}
  await run(env,'INSERT INTO telegram_topic_state(chat_id,topic_id,state,checked_at,error) VALUES(?,?,?,?,?) ON CONFLICT(chat_id,topic_id) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,error=excluded.error',c.group_id,topic,state,now(),error);
 }
 return {checked:due.length,deleted,unknown};
}
export async function syncTopicName(env:Env,chat:number,topic:number,name:string){
 const c=await tgConfig(env);if(chat!==c.group_id||topic<=1||!name.trim())return;
 await run(env,"UPDATE jobs SET title=?,updated_at=? WHERE chat_id=? AND topic_id=? AND status!='cancelled'",name.slice(0,80),now(),chat,topic);
 const path='$.'+JSON.stringify(chat+':'+topic)+'.name';await run(env,"UPDATE settings SET value=json_set(value,?,?) WHERE key='telegram_subjects' AND json_valid(value) AND json_type(value,?) IS NOT NULL",path,name,'$.'+JSON.stringify(chat+':'+topic));
}

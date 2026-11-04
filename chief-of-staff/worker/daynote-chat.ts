import type {Env} from './env';
import {all,first,run,now,uid,HttpError} from './db';
import {daynoteTools} from './daynote';
import {getHealthProvider} from './daynote-ai';
import {localDate,validDate} from '../shared/daynote';
export async function healthChatHistory(env:Env,id:string){
 const conversation=await first<any>(env,"SELECT * FROM conversations WHERE id=? AND privacy_scope='health'",id);if(!conversation)throw new HttpError(404,'Health conversation not found.');
 return {conversation,messages:(await all<any>(env,'SELECT role,content,meta FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 30',id)).reverse()};
}
export async function healthPlanChat(env:Env,text:string,conversationId?:string|null,date=localDate()){
 if(!text.trim()||text.length>4000)throw new HttpError(400,'Enter a message up to 4000 characters.');
 let conversation=conversationId?await first<any>(env,"SELECT * FROM conversations WHERE id=? AND privacy_scope='health'",conversationId):null;
 if(!conversation){const t=now();conversation={id:uid(),title:'Health',privacy_scope:'health',created_at:t,last_message_at:t};await run(env,"INSERT INTO conversations(id,title,privacy_scope,created_at,last_message_at) VALUES(?,'Health','health',?,?)",conversation.id,t,t);}
 const user={id:uid(),role:'user',content:text,mode:'text',created_at:now(),conversation_id:conversation.id};
 await run(env,"INSERT INTO messages(id,role,content,mode,created_at,conversation_id) VALUES(?,'user',?,'text',?,?)",user.id,text,user.created_at,conversation.id);
 const {messages}=await healthChatHistory(env,conversation.id),tools=daynoteTools(env),context=await tools[0].handler({}),provider=getHealthProvider(env);
 const result=await provider.runAgent({tier:'main',purpose:'daynote_chat',maxToolRounds:3,system:'You are the health capability of the owner’s existing Chief of Staff. Respond conversationally and concisely. Use only supplied health records and code-calculated statistics. Never invent readings, statistics, diagnoses, causation or recovery scores. Journals belong to their explicit selected date in Asia/Jerusalem. Explicit today/yesterday refer to calendar_date; otherwise use journal_date. If the owner gives a daily note, use propose_health_note with the correct date, then explain that the extracted answers await confirmation in the app. Never silently enable questions or overwrite answers. Suggestions to track relationships require approval. No general tasks, email, business context or unrelated Telegram topics.',context:JSON.stringify({calendar_date:localDate(),journal_date:validDate(date)?date:localDate(),timezone:'Asia/Jerusalem',records:context}),history:messages.map(m=>({role:m.role,content:m.content})),tools});
 const reply={id:uid(),role:'assistant',content:result.text,mode:'text',meta:JSON.stringify({engine:provider.engine,engines:[...new Set(provider.engines)]}),created_at:now(),conversation_id:conversation.id};
 await run(env,"INSERT INTO messages(id,role,content,mode,meta,created_at,conversation_id) VALUES(?,'assistant',?,'text',?,?,?)",reply.id,reply.content,reply.meta,reply.created_at,conversation.id);
 await run(env,"UPDATE conversations SET last_message_at=? WHERE id=? AND privacy_scope='health'",reply.created_at,conversation.id);
 return {user,reply,conversation,actions:[],engine:provider.engine,engines:[...new Set(provider.engines)]};
}

import type {Env} from './env';
import {all,now} from './db';
import {isWaiting} from '../shared/waiting';
export async function assistantTaskBrief(env:Env,category:string|null,limit=12){
 const bounded=Math.max(1,Math.min(50,limit));
 const rows=await all<any>(env,`SELECT i.id,i.title,i.kind,i.priority,i.due_at,i.category,i.project_id,p.name AS project_name
 FROM items i LEFT JOIN projects p ON p.id=i.project_id
 WHERE i.status='open' AND i.kind IN ('task','reminder','commitment') AND i.muted=0
 AND (i.nudge_after IS NULL OR i.nudge_after<=?) ${category?'AND i.category=?':''}
 ORDER BY i.priority,CASE WHEN i.due_at IS NULL THEN 1 ELSE 0 END,i.due_at,i.created_at DESC LIMIT 100`,now(),...(category?[category]:[]));
 const actionable=rows.filter(i=>!isWaiting(i)),items=actionable.slice(0,bounded);
 return {category,items,has_more:actionable.length>bounded,returned:items.length,as_of:now()};
}
/** Unambiguous list lookups only. Never intercept saves, edits, sending or advice requests. */
export async function quickTaskReply(env:Env,text:string){
 const q=text.toLowerCase().replace(/[’']/g,'').trim();
 if(q.length>220||/\b(add|save|delete|remove|done|finished|completed|mark|send|email|change|reschedule|why|research|compare)\b/.test(q))return null;
 if(!/^(what|show|give|list|pull|tasks\b|\/tasks\b)/.test(q)||!/\b(list|tasks?|to do|todo|work on|stuff)\b/.test(q))return null;
 const categories=['yeshiva','coffee','personal'].filter(c=>new RegExp('\\b'+c+'\\b').test(q));if(categories.length>1)return null;
 const brief=await assistantTaskBrief(env,categories[0]||null),label=brief.category?brief.category==='yeshiva'?'Yeshiva':brief.category==='coffee'?'Coffee':'Personal':'Your';
 return {...brief,text:brief.items.length?`${label} tasks:\n`+brief.items.map((i,n)=>`${n+1}. ${i.title}`).join('\n')+(brief.has_more?'\nMore items are available in Chief of Staff.':''):`No actionable ${brief.category||''} tasks on your list right now.`};
}

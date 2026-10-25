import {isDrivingBlock,drivingSuitable} from './work-context';
/** Deterministic attention timing. Browsing and daily briefings retain the full schedule. */
import type {Item,Nudge} from '../shared/types';
import type {Situation} from './situations';
import type {Env} from './env';
import {all,getSettings} from './db';
export function localClock(tz:string,at=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
 const part=(name:string)=>parts.find(p=>p.type===name)!.value;
 const date=`${part('year')}-${part('month')}-${part('day')}`;
 return {date,mins:Number(part('hour'))*60+Number(part('minute')),dow:new Date(date+'T12:00:00Z').getUTCDay()};
}
export const minute=(s:string|null)=>{const [h,m]=(s||'00:00').split(':').map(Number);return h*60+m;};
export function blockWindow(s:Situation,tz:string,at=new Date()) {
 const c=localClock(tz,at);let days:number[]=[];try{days=JSON.parse(s.weekdays||'[]');}catch{}
 const day=!!s.active&&!!s.start_time&&!(s.skip_dates||'').split(',').map(x=>x.trim()).includes(c.date)&&(s.date?s.date===c.date:days.includes(c.dow));
 const from=minute(s.start_time),to=s.end_time?minute(s.end_time):from+60;
 return {current:day&&c.mins>=from&&c.mins<to,wrapup:day&&c.mins>=to&&c.mins<to+90};
}
type TimedItem=Partial<Item>&{block_id?:string|null;muted?:number;nudge_after?:string|null};
export function actionableItem(i:TimedItem,blocks:Map<string,Situation>,tz:string,at=new Date()) {
 if([...blocks.values()].some(b=>isDrivingBlock(b)&&blockWindow(b,tz,at).current)){
  if(!drivingSuitable(i))return false;
  if(i.execution_mode!=='voice'&&i.due_at&&new Date(i.due_at)>at)return false;
 }
 if(i.status&&i.status!=='open'||i.muted||i.nudge_after&&new Date(i.nudge_after)>at)return false;
 // A reminder is an instruction to act at its time; a task deadline can still need preparation.
 if(i.kind==='reminder'&&i.due_at&&new Date(i.due_at)>at)return false;
 if(i.block_id){const b=blocks.get(i.block_id);if(!b||!blockWindow(b,tz,at).current)return false;}
 return true;
}
export async function attentionState(env:Env,at=new Date(),includeItems=true) {
 const [settings,blocks,items]=await Promise.all([getSettings(env),all<Situation>(env,'SELECT * FROM situations'),includeItems?all<Item&TimedItem>(env,"SELECT * FROM items WHERE status='open'"):Promise.resolve([])]);
 return {at,tz:settings.timezone||'UTC',blocks:new Map(blocks.map(b=>[b.id,b])),items:new Map(items.map(i=>[i.id,i]))};
}
export type AttentionState=Awaited<ReturnType<typeof attentionState>>;
export function actionableNotice(n:Nudge,state:AttentionState) {
 const {blocks,items,tz,at}=state;
 const driving=[...blocks.values()].some(b=>isDrivingBlock(b)&&blockWindow(b,tz,at).current);
 if(n.type==='prep'||n.type==='unanswered')return false;
 if(n.item_id&&items.get(n.item_id)?.completion_source==='hashgacha'&&['overdue','headsup','waiting','email','whatsapp','postponed'].includes(n.type))return false;
 if(n.item_id&&items.get(n.item_id)?.reply_required&&['overdue','headsup','email','whatsapp','postponed'].includes(n.type))return false; // automatic meeting prep offers are retired
 if(driving&&['briefing','digest','sweep','review','learn','idea','customers','prep','wrapup','reply_batch','hashgacha'].includes(n.type))return false;
 if(n.type==='meeting') {const b=n.item_id?blocks.get(n.item_id):undefined;return !!b&&blockWindow(b,tz,at).current;}
 if(n.type==='situation'||n.type==='wrapup') {
  const b=n.topic_key?.startsWith('block:')?blocks.get(n.topic_key.slice(6)):undefined;
  if(driving&&b&&!isDrivingBlock(b))return false;
  // An old recurring block notice must not come back when the same window starts tomorrow.
  if(localClock(tz,new Date(n.updated_at||n.created_at)).date!==localClock(tz,at).date)return false;
  if(b&&!blockWindow(b,tz,at)[n.type==='wrapup'?'wrapup':'current'])return false;
 }
 const item=n.item_id?items.get(n.item_id):undefined;
 return !item||actionableItem(item,blocks,tz,at);
}

/** Wrap-ups can still ask about attached work just after its block ended. */
export function actionableNoticeItem(i:TimedItem,n:Nudge,state:AttentionState){
 const b=i.block_id?state.blocks.get(i.block_id):undefined;
 const wrap=n.type==='wrapup'&&b&&n.topic_key===`block:${b.id}`&&blockWindow(b,state.tz,state.at).wrapup;
 return actionableItem(wrap?{...i,block_id:null}:i,state.blocks,state.tz,state.at);
}

import type {Item} from './types';
const DAY=86400000;
/** Age alone never hides a deadline or an explicitly important task. No records are changed. */
export function olderNonUrgent(item:Item,at=new Date()){
 if(item.due_at||item.priority<=1)return false;
 const touched=Date.parse(item.updated_at||item.created_at);
 return Number.isFinite(touched)&&at.getTime()-touched>=14*DAY;
}
export function focusCandidates<T extends Item>(items:T[],explicitIds:Set<string>,at=new Date()){
 const urgency=(i:Item)=>i.due_at&&Date.parse(i.due_at)<=at.getTime()?0:i.priority<=1?1:explicitIds.has(i.id)?2:3;
 return items.filter(i=>!olderNonUrgent(i,at)||explicitIds.has(i.id)).sort((a,b)=>
  urgency(a)-urgency(b)||Number(explicitIds.has(b.id))-Number(explicitIds.has(a.id))||a.priority-b.priority||Number(!!b.due_at)-Number(!!a.due_at)||String(a.due_at??a.created_at).localeCompare(String(b.due_at??b.created_at)));
}
export function partitionHomeInventory(tasks:Item[],focusIds:Set<string>,at=new Date()){
 const older:Item[]=[],other:Item[]=[];const seen=new Set<string>();
 for(const i of tasks){if(i.status!=='open'||focusIds.has(i.id)||seen.has(i.id))continue;seen.add(i.id);(olderNonUrgent(i,at)?older:other).push(i);}
 return {older,other};
}
export function currentHomeUpdate(stamp:string,tz='Asia/Jerusalem',at=new Date()){
 const value=new Date(stamp);if(!Number.isFinite(value.getTime())||value>at)return false;
 const day=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 return day(value)===day(at);
}

import type {Env} from './env';
import type {AttentionState} from './attention';
import {blockWindow} from './attention';
import {isDrivingBlock} from './work-context';
import {all} from './db';
import type {HomeAttention,PendingAction} from '../shared/types';
/** Read-only signals from sidebar work. No model calls, messages, or job execution. */
export async function homeAttention(env:Env,state:AttentionState,pending:PendingAction[]):Promise<HomeAttention[]> {
 if([...state.blocks.values()].some(b=>isDrivingBlock(b)&&blockWindow(b,state.tz,state.at).current))return [];
 const [blocked,failed]=await Promise.all([
  all<{id:string;goal:string;waiting_on_user:string}>(env,"SELECT id,goal,waiting_on_user FROM missions WHERE status='active' AND waiting_on_user IS NOT NULL AND trim(waiting_on_user)!='' ORDER BY updated_at DESC LIMIT 8"),
  all<{id:string;name:string}>(env,`SELECT r.id,r.name FROM routines r JOIN routine_runs run ON run.routine_id=r.id
   WHERE run.status='failed' AND run.started_at>=? AND run.id=(SELECT latest.id FROM routine_runs latest WHERE latest.routine_id=r.id ORDER BY latest.started_at DESC,latest.rowid DESC LIMIT 1) ORDER BY run.started_at DESC LIMIT 8`,new Date(state.at.getTime()-3*86400000).toISOString()),
 ]);
 const cards:HomeAttention[]=[];
 if(pending.length)cards.push({id:'approvals',title:`${pending.length} approval${pending.length===1?'':'s'} waiting`,body:'Review the proposed actions. Nothing starts without your approval.',url:'/?tab=today'});
 blocked.forEach(m=>cards.push({id:`mission:${m.id}`,title:m.goal,body:m.waiting_on_user,url:'/?tab=tasks'}));
 failed.forEach(r=>cards.push({id:`failed:${r.id}`,title:`Needs attention: ${r.name}`,body:'The latest run failed. Open it to review the error.',url:'/?tab=tasks'}));
 return cards;
}

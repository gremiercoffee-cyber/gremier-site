import type {Env} from './env';
import type {AttentionState} from './attention';
import {blockWindow} from './attention';
import {isDrivingBlock} from './work-context';
import type {HomeAttention,PendingAction} from '../shared/types';
/** Read-only signals from sidebar work. No model calls, messages, or job execution. */
export async function homeAttention(_env:Env,state:AttentionState,pending:PendingAction[]):Promise<HomeAttention[]> {
 if([...state.blocks.values()].some(b=>isDrivingBlock(b)&&blockWindow(b,state.tz,state.at).current))return [];
 const cards:HomeAttention[]=[];
 if(pending.length)cards.push({id:'approvals',title:`${pending.length} approval${pending.length===1?'':'s'} waiting`,body:'Review the proposed actions. Nothing starts without your approval.',url:'/?tab=today'});
 return cards;
}

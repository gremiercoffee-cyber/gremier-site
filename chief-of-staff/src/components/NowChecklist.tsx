import {isWaiting} from '../../shared/waiting';
import {useEffect,useState} from 'react';
import {useImmediateCompletions} from '../useImmediateCompletions';
import type {Dashboard} from '../../shared/types';
import {api} from '../api';
type SessionItem=NonNullable<Dashboard['now_block']>['items'][number];

export default function NowChecklist({items,onChanged,onCountChange}:{items:SessionItem[];onChanged:()=>void;onCountChange?:(count:number)=>void}) {
 const {hidden,error,complete}=useImmediateCompletions(items.map(i=>i.id));
 const [expanded,setExpanded]=useState(false);
 const actionable=items.filter(i=>!isWaiting({kind:"task",title:i.title}));
 const visible=actionable.filter(i=>!hidden.has(i.id));
 const visibleCount=visible.length;
 useEffect(()=>onCountChange?.(visibleCount),[visibleCount,onCountChange]);
 const groups=new Map<string,{name:string|null;items:SessionItem[]}>();
 for(const item of (expanded?visible:visible.slice(0,3))){const key=item.project_id??'';if(!groups.has(key))groups.set(key,{name:item.project??null,items:[]});groups.get(key)!.items.push(item);}
 const done=(id:string)=>complete(id,()=>api.updateItem(id,{status:'done'}),onChanged);
 return <div className="mt-3 space-y-3">
  {actionable.length>0&&visibleCount===0&&<p role="status" className="text-sm text-muted">All checked off.</p>}
  {[...groups].map(([id,group])=><div key={id}>
   {group.name&&<p className="mb-2 text-[14px] font-semibold">🗂️ {group.name}</p>}
   <ul className="space-y-2">{group.items.map(item=><li key={item.id} className="flex items-start gap-3 text-[15px]">
    <button aria-label={`Mark done: ${item.title}`} onClick={()=>done(item.id)} className="mt-0.5 h-7 w-7 shrink-0 rounded-full border-2 border-accent/50 hover:bg-accent/20 disabled:opacity-40"/>
    <button className="text-left leading-snug min-h-9" onClick={()=>window.dispatchEvent(new CustomEvent('cos:reschedule',{detail:item.id}))}>{item.title}</button>
   </li>)}</ul>
  </div>)}
  {visibleCount>3&&<button onClick={()=>setExpanded(!expanded)} aria-expanded={expanded} className="text-xs font-medium text-accent py-2">{expanded?'Show fewer':`+ ${visibleCount-3} more for now`}</button>}
  {error&&<p role="alert" className="text-danger text-sm">{error}</p>}
 </div>;
}

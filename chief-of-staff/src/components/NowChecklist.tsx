import {useEffect} from 'react';
import {useImmediateCompletions} from '../useImmediateCompletions';
import type {Dashboard} from '../../shared/types';
import {api} from '../api';
type SessionItem=NonNullable<Dashboard['now_block']>['items'][number];

export default function NowChecklist({items,onChanged,onCountChange}:{items:SessionItem[];onChanged:()=>void;onCountChange?:(count:number)=>void}) {
 const {hidden,error,complete}=useImmediateCompletions(items.map(i=>i.id));
 const visibleCount=items.filter(i=>!hidden.has(i.id)).length;
 useEffect(()=>onCountChange?.(visibleCount),[visibleCount,onCountChange]);
 const groups=new Map<string,{name:string|null;items:SessionItem[]}>();
 for(const item of items.filter(i=>!hidden.has(i.id))){const key=item.project_id??'';if(!groups.has(key))groups.set(key,{name:item.project??null,items:[]});groups.get(key)!.items.push(item);}
 const done=(id:string)=>complete(id,()=>api.updateItem(id,{status:'done'}),onChanged);
 return <div className="mt-3 space-y-3">
  {items.length>0&&visibleCount===0&&<p role="status" className="text-sm text-muted">All checked off.</p>}
  {[...groups].map(([id,group])=><div key={id}>
   {group.name&&<p className="mb-2 text-[14px] font-semibold">🗂️ {group.name}</p>}
   <ul className="space-y-2">{group.items.map(item=><li key={item.id} className="flex items-start gap-3 text-[15px]">
    <button aria-label={`Mark done: ${item.title}`} onClick={()=>done(item.id)} className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-accent/50 hover:bg-accent/20 disabled:opacity-40"/>
    <button className="text-left leading-snug" onClick={()=>window.dispatchEvent(new CustomEvent('cos:reschedule',{detail:item.id}))}>{item.title}</button>
   </li>)}</ul>
  </div>)}
  {error&&<p role="alert" className="text-danger text-sm">{error}</p>}
 </div>;
}

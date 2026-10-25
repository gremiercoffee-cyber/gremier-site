import type {ShoppingItem} from '../../shared/shopping';
import {shoppingSections} from '../../shared/shopping';
import {Button} from './ui';

export default function ShoppingChecklist({items,at,busy,onToggle,onEdit,isPending}:{items:ShoppingItem[];at:number;busy:boolean;isPending?:(id:string)=>boolean;onToggle:(item:ShoppingItem,checked:boolean)=>void;onEdit:(item:ShoppingItem)=>void}) {
 const {needed,recent,archived}=shoppingSections(items,at);
 const row=(i:ShoppingItem,archive=false)=><div key={i.id} className={`flex items-center gap-3 py-3 border-t border-line/60 ${i.checked&&!archive?'bg-blue-500/5':''}`}>
  <input type="checkbox" className="h-5 w-5 shrink-0 accent-blue-600" aria-label={`Mark ${i.name} ${i.checked?'needed':'purchased'}`} checked={!!i.checked} disabled={busy||isPending?.(i.id)} onChange={e=>onToggle(i,e.target.checked)}/>
  <button className="flex-1 min-w-0 text-left" onClick={()=>onEdit({...i})}>
   <span dir="auto" className={`block ${i.checked?(archive?'line-through text-muted':'line-through text-blue-600'):''}`}>{i.name}{i.quantity&&<span className={i.checked&&!archive?'':'text-muted'}> · {i.quantity}</span>}</span>
   {i.notes&&<span dir="auto" className="block text-xs text-muted">{i.notes}</span>}
   {i.source==='whatsapp'&&<span className="block text-xs text-muted">From your WhatsApp chat</span>}
  </button>
  <Button variant="ghost" disabled={busy||isPending?.(i.id)} onClick={()=>onEdit({...i})}>Edit</Button>
 </div>;
 return <>
  {needed.map(i=>row(i))}
  {recent.length>0&&<section aria-label="Bought in the last 24 hours"><p className="pt-4 pb-2 text-xs font-medium text-blue-600">Bought in the last 24 hours · {recent.length}</p>{recent.map(i=>row(i))}</section>}
  {archived.length>0&&<details className="mt-4 border-t border-line pt-3"><summary className="cursor-pointer text-sm text-muted py-2">Purchased archive · {archived.length}</summary><p className="text-xs text-muted pb-2">Bought more than 24 hours ago. Uncheck to buy again.</p>{archived.map(i=>row(i,true))}</details>}
 </>;
}

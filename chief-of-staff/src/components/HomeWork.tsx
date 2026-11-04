import {isWaiting} from '../../shared/waiting';
import type {Item,Project} from '../../shared/types';
import {partitionHomeInventory} from '../../shared/home-focus';
import {groupHomeWork} from '../../shared/home-work';
import {ItemRow} from './ui';

export default function HomeWork({tasks,projects,inArea,onChanged,focusIds=[]}:{tasks:Item[];projects:Project[];inArea:(category:string|null|undefined)=>boolean;onChanged:()=>void;focusIds?:string[]}) {
 const waiting=tasks.filter(i=>i.status==='open'&&inArea(i.category)&&isWaiting(i));
 const partition=partitionHomeInventory(tasks.filter(i=>inArea(i.category)&&!isWaiting(i)),new Set(focusIds));
 const openItem=(i:Item)=>window.dispatchEvent(new CustomEvent('cos:reschedule',{detail:i.id}));
 const row=(i:Item)=><div key={i.id}>
  <ItemRow item={i} onChange={onChanged} onOpen={openItem} compact/>
  {!!(i as Item&{muted?:number}).muted&&<p className="text-xs text-muted pb-2 pl-8">Alerts muted · still open</p>}
  {(i as Item&{nudge_after?:string}).nudge_after&&Date.parse((i as Item&{nudge_after:string}).nudge_after)>Date.now()&&<p className="text-xs text-muted pb-2 pl-8">Scheduled for later</p>}
 </div>;
 const contents=(items:Item[])=>{
  const groups=groupHomeWork(items,projects);
  return <div className="space-y-3 mt-3">{groups.projects.map(({project,items})=><details key={project.id} className="rounded-xl bg-sunken/50 px-3 py-2"><summary className="cursor-pointer text-sm font-medium">{project.name}<span className="ml-2 text-xs text-muted">{items.length}</span></summary><div className="divide-y divide-line/60 mt-2">{items.map(row)}</div></details>)}{!!groups.standalone.length&&<div className="divide-y divide-line/60">{groups.standalone.map(row)}</div>}</div>;
 };
 return <div className="space-y-3">
  {!!waiting.length&&<details className="rounded-2xl bg-surface border border-line p-4" aria-label="Waiting on others"><summary className="cursor-pointer flex items-center gap-3"><span className="grid place-items-center h-9 w-9 rounded-xl bg-sunken text-lg" aria-hidden="true">📨</span><span className="flex-1"><span className="block text-sm font-medium">Waiting on others</span><span className="block text-xs text-muted mt-0.5">Tracked, with follow-up reminders</span></span><span className="text-xs text-muted">{waiting.length} ▸</span></summary><div className="divide-y divide-line mt-3">{waiting.map(i=><button key={i.id} onClick={()=>openItem(i)} className="w-full text-left py-3"><span className="block text-sm">{i.title.replace(/^(?:wait(?:ing)?\s+(?:for|on)|await(?:ing)?)\s+/i,'')}</span>{i.person&&<span className="text-xs text-muted">{i.person}</span>}</button>)}</div></details>}
  {!!partition.older.length&&<details className="rounded-2xl bg-surface border border-line p-4" aria-label="For later"><summary className="cursor-pointer flex items-center gap-3"><span className="grid place-items-center h-9 w-9 rounded-xl bg-amber-50 text-lg" aria-hidden="true">🗂️</span><span className="flex-1"><span className="block text-sm font-medium">For later</span><span className="block text-xs text-muted mt-0.5">Older tasks without a deadline</span></span><span className="text-xs text-muted">{partition.older.length} ▸</span></summary>{contents(partition.older)}</details>}
  {!!partition.other.length&&<details className="rounded-2xl bg-surface border border-line p-4" aria-label="Other open work"><summary className="cursor-pointer flex items-center gap-3"><span className="grid place-items-center h-9 w-9 rounded-xl bg-sunken text-lg" aria-hidden="true">📋</span><span className="flex-1"><span className="block text-sm font-medium">Other open work</span><span className="block text-xs text-muted mt-0.5">Projects, waiting items and later tasks</span></span><span className="text-xs text-muted">{partition.other.length} ▸</span></summary>{contents(partition.other)}</details>}
  <div className="flex gap-4 px-1 text-xs text-muted"><a href="/?tab=projects" className="hover:text-accent">All projects →</a><a href="/?tab=lists" className="hover:text-accent">All tasks →</a></div>
 </div>;
}

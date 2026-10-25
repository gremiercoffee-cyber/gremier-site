import type {Item,Project} from '../../shared/types';
import {groupHomeWork} from '../../shared/home-work';
import {ItemRow} from './ui';

export default function HomeWork({tasks,projects,inArea,onChanged}:{tasks:Item[];projects:Project[];inArea:(category:string|null|undefined)=>boolean;onChanged:()=>void}) {
 const grouped=groupHomeWork(tasks.filter(i=>inArea(i.category)),projects);
 const openItem=(i:Item)=>window.dispatchEvent(new CustomEvent('cos:reschedule',{detail:i.id}));
 const row=(i:Item)=><div key={i.id}>
  <ItemRow item={i} onChange={onChanged} onOpen={openItem} compact/>
  {!!(i as Item&{muted?:number}).muted&&<p className="text-xs text-muted pb-2 pl-8">Alerts muted · still open</p>}
  {(i as Item&{nudge_after?:string}).nudge_after&&Date.parse((i as Item&{nudge_after:string}).nudge_after)>Date.now()&&<p className="text-xs text-muted pb-2 pl-8">Scheduled for later</p>}
 </div>;
 return <div className="space-y-5">
  {!!grouped.projects.length&&<section aria-label="Projects"><div className="flex justify-between items-baseline mb-2 px-1"><h2 className="text-[11px] font-medium text-muted uppercase tracking-[0.14em]">Projects</h2><a href="/?tab=projects" className="text-xs text-accent">All projects →</a></div>
   <div className="space-y-3">{grouped.projects.map(({project,items})=><details key={project.id} open className="rounded-[20px] bg-surface border border-line px-4 py-3">
    <summary className="cursor-pointer text-[15px] font-medium">{project.name}<span className="ml-2 text-xs text-muted">{items.length} open{project.status==='paused'?' · Paused':''}</span></summary>
    <div className="mt-2 divide-y divide-line/60">{items.map(row)}</div>
   </details>)}</div>
  </section>}
  {!!grouped.standalone.length&&<section aria-label="Standalone tasks"><div className="flex justify-between items-baseline mb-2 px-1"><h2 className="text-[11px] font-medium text-muted uppercase tracking-[0.14em]">Standalone tasks · {grouped.standalone.length}</h2><a href="/?tab=lists" className="text-xs text-accent">All tasks →</a></div><div className="rounded-[20px] bg-surface border border-line px-4 divide-y divide-line/60">{grouped.standalone.map(row)}</div></section>}
  {!grouped.projects.length&&!grouped.standalone.length&&<p className="text-sm text-muted px-1">No open tasks in this view.</p>}
 </div>;
}

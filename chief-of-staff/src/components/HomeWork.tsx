import {isWaiting} from '../../shared/waiting';
import type {Item,Project} from '../../shared/types';
import {groupHomeWork} from '../../shared/home-work';
import {useAreas} from '../areas';
import {ItemRow} from './ui';

/** End of today, in the phone's own time. */
const endOfToday=()=>{const d=new Date();d.setHours(23,59,59,999);return d.getTime();};
/** "Today" = what the user said is for today (or is already late). Nothing is guessed. */
export const isForToday=(i:Item)=>!!i.due_at&&Date.parse(i.due_at)<=endOfToday();

/**
 * Everything that needs doing, plainly: today's first, then one folder per area, then projects.
 * No "now" block, no "for later" sorting: every open task sits in exactly one place.
 */
export default function HomeWork({tasks,projects,onChanged}:{tasks:Item[];projects:Project[];onChanged:()=>void}) {
 const areas=useAreas();
 const open=tasks.filter(i=>i.status==='open');
 const today=open.filter(isForToday);
 const rest=open.filter(i=>!isForToday(i));
 const {projects:inProjects,standalone}=groupHomeWork(rest,projects);
 const waiting=standalone.filter(isWaiting);
 const loose=standalone.filter(i=>!isWaiting(i));
 const folders=new Map<string,Item[]>();
 for(const i of loose){const k=i.category||'other';folders.set(k,[...(folders.get(k)??[]),i]);}
 const order=[...areas.map(a=>a.key),'other'];
 const folderList=[...folders.entries()].sort((a,b)=>(order.indexOf(a[0])+1||99)-(order.indexOf(b[0])+1||99));
 const label=(k:string)=>{const a=areas.find(x=>x.key===k);return a?{icon:a.icon,name:a.label}:{icon:'📋',name:'Other'};};
 const openItem=(i:Item)=>window.dispatchEvent(new CustomEvent('cos:reschedule',{detail:i.id}));
 const row=(i:Item)=><ItemRow key={i.id} item={i} onChange={onChanged} onOpen={openItem} compact/>;
 const folder=(key:string,icon:string,name:string,items:Item[],startOpen=false)=>
  <details key={key} open={startOpen||undefined} className="rounded-2xl bg-surface border border-line px-4 py-3">
   <summary className="cursor-pointer flex items-center gap-3"><span className="text-lg" aria-hidden="true">{icon}</span><span className="flex-1 font-medium text-[15px]">{name}</span><span className="text-xs text-muted">{items.length}</span></summary>
   <div className="mt-2 divide-y divide-line">{items.map(row)}</div>
  </details>;

 if(!open.length)return <p className="px-1 text-sm text-muted">Nothing on your list. Tell me when you want something added.</p>;
 return <div className="space-y-3">
  {!!today.length&&<section aria-label="Today" className="rounded-2xl border border-accent/20 bg-accent/5 px-4 py-3">
   <h2 className="font-semibold text-[15px] text-accent">Today <span className="ml-1 text-xs text-muted font-normal">{today.length}</span></h2>
   <div className="mt-1 divide-y divide-line">{today.map(row)}</div>
  </section>}
  {folderList.map(([k,items])=>{const l=label(k);return folder(k,l.icon,l.name,items);})}
  {!!waiting.length&&folder('waiting','📨','Waiting on others',waiting)}
  {!!inProjects.length&&<details className="rounded-2xl bg-surface border border-line px-4 py-3">
   <summary className="cursor-pointer flex items-center gap-3"><span className="text-lg" aria-hidden="true">🗂️</span><span className="flex-1 font-medium text-[15px]">Projects</span><span className="text-xs text-muted">{inProjects.length}</span></summary>
   <div className="mt-2 space-y-2">{inProjects.map(({project,items})=><details key={project.id} className="rounded-xl bg-sunken/50 px-3 py-2">
    <summary className="cursor-pointer text-sm font-medium">{project.name}<span className="ml-2 text-xs text-muted">{items.length}</span></summary>
    <div className="divide-y divide-line">{items.map(row)}</div>
   </details>)}</div>
  </details>}
 </div>;
}

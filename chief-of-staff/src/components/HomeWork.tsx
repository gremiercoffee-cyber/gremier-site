import {isWaiting} from '../../shared/waiting';
import type {Item,Project} from '../../shared/types';
import {groupHomeWork} from '../../shared/home-work';
import {useAreas} from '../areas';
import {ItemRow} from './ui';
import {openTask} from './TaskSheet';

/** End of today, in the phone's own time. */
const endOfToday=()=>{const d=new Date();d.setHours(23,59,59,999);return d.getTime();};
/** "Today" = what the user said is for today (or is already late). Nothing is guessed. */
export const isForToday=(i:Item)=>!!i.due_at&&Date.parse(i.due_at)<=endOfToday();

/** The area a folder sits in: the server's answer, else where most of its tasks are. */
export function folderArea(project:Project,items:Item[]){
 if(project.section)return project.section;
 const n=new Map<string,number>();for(const i of items)if(i.category)n.set(i.category,(n.get(i.category)??0)+1);
 return [...n.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]??'other';
}

/**
 * The user's own work, in two parts:
 *  - part="today": ⚡ Do now (due today or late). Replies you're waiting on are never here.
 *  - part="areas": one card per area of life, holding its folders and its loose tasks.
 * Every open task sits in exactly one place; waiting items live in "📨 Waiting on".
 */
export default function HomeWork({tasks,projects,onChanged,part}:{tasks:Item[];projects:Project[];onChanged:()=>void;part:'today'|'areas'}) {
 const areas=useAreas();
 const open=tasks.filter(i=>i.status==='open'&&!isWaiting(i));
 const today=open.filter(isForToday);
 const row=(i:Item)=><ItemRow key={i.id} item={i} onChange={onChanged} onOpen={(x:Item)=>openTask(x.id)} compact/>;

 if(part==='today')return today.length?<section aria-label="Do now" className="rounded-[20px] border border-accent/25 bg-accent/5 px-4 py-3">
  <h2 className="flex items-center gap-2 text-[17px] font-semibold">⚡ Do now<span className="text-[13px] font-normal text-muted">{today.length}</span></h2>
  <div className="mt-1 divide-y divide-line">{today.map(row)}</div>
 </section>:null;

 const {projects:inProjects,standalone}=groupHomeWork(open.filter(i=>!isForToday(i)),projects);
 const cards=new Map<string,{folders:{project:Project;items:Item[]}[];loose:Item[]}>();
 const card=(k:string)=>{if(!cards.has(k))cards.set(k,{folders:[],loose:[]});return cards.get(k)!;};
 for(const f of inProjects)card(areas.some(a=>a.key===folderArea(f.project,f.items))?folderArea(f.project,f.items):'other').folders.push(f);
 for(const i of standalone)card(i.category&&areas.some(a=>a.key===i.category)?i.category:'other').loose.push(i);
 const order=[...areas.map(a=>a.key),'other'];
 const list=[...cards.entries()].sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
 if(!list.length)return <p className="px-1 text-sm text-muted">Nothing else on your list. Say "this is a task" when you want one added.</p>;
 const label=(k:string)=>{const a=areas.find(x=>x.key===k);return a?{icon:a.icon,name:a.label}:{icon:'📋',name:'Other'};};
 const plural=(n:number,w:string)=>`${n} ${w}${n===1?'':'s'}`;
 return <section aria-label="Your areas" className="space-y-2.5">
  <h2 className="px-1 text-[17px] font-semibold">🗂️ Your areas</h2>
  <div className="grid gap-2.5 sm:grid-cols-2 items-start">
   {list.map(([k,{folders,loose}])=>{const l=label(k);const total=loose.length+folders.reduce((n,f)=>n+f.items.length,0);
    return <details key={k} className="rounded-[20px] bg-surface border border-line/70 shadow-card px-4 py-3">
     <summary className="cursor-pointer list-none flex items-center gap-3">
      <span className="grid place-items-center h-10 w-10 shrink-0 rounded-2xl bg-sunken text-[20px]" aria-hidden>{l.icon}</span>
      <span className="flex-1 min-w-0"><span className="block text-[15.5px] font-semibold">{l.name}</span>
       <span className="block text-[12.5px] text-muted">{[folders.length?plural(folders.length,'folder'):'',loose.length?plural(loose.length,'task'):''].filter(Boolean).join(' · ')}</span></span>
      <span className="text-[13px] text-muted">{total}</span>
     </summary>
     <div className="mt-2 space-y-1.5">
      {folders.map(({project,items})=><details key={project.id} className="rounded-xl bg-sunken/60 px-3 py-2">
       <summary className="cursor-pointer list-none flex items-center gap-2 text-[14.5px] font-medium"><span aria-hidden>📁</span><span className="flex-1 min-w-0">{project.name}</span><span className="text-xs text-muted font-normal">{items.length}</span></summary>
       <div className="divide-y divide-line">{items.map(row)}</div>
      </details>)}
      {!!loose.length&&<div className="divide-y divide-line">{loose.map(row)}</div>}
     </div>
    </details>;})}
  </div>
 </section>;
}

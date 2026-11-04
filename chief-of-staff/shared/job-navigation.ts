/** The app mirrors work structure, not a flat list of every pinned chat. */
export function jobSections<T extends {id:string;status:string;project_id?:string|null;project_title?:string|null}>(jobs:T[]){
 const visible=jobs.filter(j=>j.status!=='cancelled');
 const active=visible.filter(j=>!['done','stopped','paused'].includes(j.status));
 const groups=new Map<string,{id:string;title:string;jobs:T[]}>();
 for(const job of active){const id=job.project_id??'standalone';if(!groups.has(id))groups.set(id,{id,title:job.project_title??'Other jobs',jobs:[]});groups.get(id)!.jobs.push(job);}
 return {active:[...groups.values()].sort((a,b)=>a.id==='standalone'?1:b.id==='standalone'?-1:a.title.localeCompare(b.title)),paused:visible.filter(j=>j.status==='paused'),finished:visible.filter(j=>['done','stopped'].includes(j.status))};
}

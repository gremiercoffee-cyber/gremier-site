import type {Item,Project} from './types';
/** Every supplied task has exactly one home in the work inventory, independent of Now/alerts. */
export function groupHomeWork(tasks:Item[],projects:Project[]) {
 const byProject=new Map(projects.map(p=>[p.id,{project:p,items:[] as Item[]}]));
 const standalone:Item[]=[],seen=new Set<string>();
 for(const item of tasks){
  if(item.status!=='open'||seen.has(item.id))continue;
  seen.add(item.id);
  const group=item.project_id?byProject.get(item.project_id):undefined;
  if(group)group.items.push(item);else standalone.push(item);
 }
 return {projects:[...byProject.values()].filter(g=>g.items.length),standalone};
}

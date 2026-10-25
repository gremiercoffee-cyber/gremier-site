/** Local completion overlay. Slow/stale refreshes cannot restore a pending check-off. */
export function createImmediateCompletions() {
 let snapshot={hidden:new Set<string>(),error:''};
 const pending=new Set<string>(),listeners=new Set<()=>void>();
 const emit=()=>{snapshot={...snapshot,hidden:new Set(snapshot.hidden)};listeners.forEach(fn=>fn());};
 return {
  subscribe(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};},
  getSnapshot:()=>snapshot,
  reconcile(ids:string[]){const present=new Set(ids);let changed=false;for(const id of snapshot.hidden)if(!pending.has(id)&&!present.has(id)){snapshot.hidden.delete(id);changed=true;}if(changed)emit();},
  async complete(id:string,save:()=>Promise<unknown>,onSaved:()=>void){
   if(pending.has(id)||snapshot.hidden.has(id))return;
   pending.add(id);snapshot.hidden.add(id);snapshot.error='';emit();
   let saved=false;
   try{await save();saved=true;}catch(e){snapshot.hidden.delete(id);snapshot.error=`Could not save. Item restored. ${e instanceof Error?e.message:String(e)}`;}
   finally{pending.delete(id);emit();}
   if(saved){try{onSaved();}catch{snapshot.error='Saved, but the list could not refresh.';emit();}}
  },
 };
}

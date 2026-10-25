import type {ShoppingItem} from '../shared/shopping';
export function createImmediateShopping() {
 type Check={checked:number;checked_at:string|null;pending:boolean};
 let snapshot={checks:new Map<string,Check>(),error:''};const listeners=new Set<()=>void>();
 const emit=()=>{snapshot={...snapshot,checks:new Map(snapshot.checks)};listeners.forEach(fn=>fn());};
 return {
  subscribe(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};},getSnapshot:()=>snapshot,
  reconcile(items:Pick<ShoppingItem,'id'|'checked'>[]){let changed=false;for(const [id,check] of snapshot.checks){const item=items.find(i=>i.id===id);if(!check.pending&&(!item||item.checked===check.checked)){snapshot.checks.delete(id);changed=true;}}if(changed)emit();},
  async toggle(item:ShoppingItem,checked:boolean,save:()=>Promise<unknown>,onSaved:()=>void){
   if(snapshot.checks.get(item.id)?.pending)return;
   const previous=snapshot.checks.get(item.id);
   snapshot.checks.set(item.id,{checked:checked?1:0,checked_at:checked?new Date().toISOString():null,pending:true});snapshot.error='';emit();
   let saved=false;
   try{await save();snapshot.checks.get(item.id)!.pending=false;saved=true;}
   catch(e){if(previous)snapshot.checks.set(item.id,previous);else snapshot.checks.delete(item.id);snapshot.error=`Could not save. Check restored. ${e instanceof Error?e.message:String(e)}`;}
   finally{emit();}
   if(saved){try{onSaved();}catch{snapshot.error='Saved, but the list could not refresh.';emit();}}
  },
 };
}

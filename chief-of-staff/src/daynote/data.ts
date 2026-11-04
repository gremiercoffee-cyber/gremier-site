import {HABIT_CATALOG,emptyJournal,type Habit,type Journal} from '../../shared/daynote';
export type LocalDay={journal:Journal;ack:number;dirty:boolean;edit:string;pending?:{id:string;entry:Journal;base:number;edit:string};conflict?:Journal|null;deleted?:boolean;deletePending?:boolean};
const prefix='daynote.day.';
export function readDay(date:string,habits:Habit[]):LocalDay{try{const s=localStorage.getItem(prefix+date);if(s)return JSON.parse(s);}catch{/* errors on writes are reported by UI */}return{journal:emptyJournal(date,habits),ack:0,dirty:false,edit:''};}
export function writeDay(day:LocalDay){localStorage.setItem(prefix+day.journal.date,JSON.stringify(day));window.dispatchEvent(new Event('daynote:local'));}
export function localDays(){return Object.keys(localStorage).filter(k=>k.startsWith(prefix)).map(k=>JSON.parse(localStorage.getItem(k)!)).filter(Boolean) as LocalDay[];}
export function editDay(date:string,habits:Habit[],fn:(j:Journal)=>Journal){const d=readDay(date,habits);d.journal=fn(d.journal);d.deleted=false;d.dirty=true;d.edit=crypto.randomUUID();writeDay(d);return d;}
export function catalog():Habit[]{try{return JSON.parse(localStorage.getItem('daynote.catalog')||'null')||HABIT_CATALOG;}catch{return HABIT_CATALOG;}}
export function saveLocalHabit(habit:Habit){const hs=catalog(),i=hs.findIndex(h=>h.id===habit.id);if(i<0)hs.push(habit);else hs[i]=habit;localStorage.setItem('daynote.catalog',JSON.stringify(hs));const pending=JSON.parse(localStorage.getItem('daynote.habitQueue')||'{}');pending[habit.id]=habit;localStorage.setItem('daynote.habitQueue',JSON.stringify(pending));window.dispatchEvent(new Event('daynote:local'));}
export function token(){return localStorage.getItem('cos.token')||'';}
export class DaynoteError extends Error{constructor(public status:number,message:string){super(message);}}
export async function call<T=any>(path:string,method='GET',body?:unknown):Promise<T>{
 const form=body instanceof FormData;const r=await fetch('/api/daynote'+path,{method,headers:{authorization:'Bearer '+token(),...(!form&&body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:form?body as FormData:JSON.stringify(body),cache:'no-store'});
 const data=await r.json();if(!r.ok)throw new DaynoteError(r.status,data.error||'Request failed.');return data;
}
export async function mergeServer(state:any){
 const pending=JSON.parse(localStorage.getItem('daynote.habitQueue')||'{}');localStorage.setItem('daynote.catalog',JSON.stringify(state.habits.map((h:Habit)=>pending[h.id]||h).concat(Object.values(pending).filter((h:any)=>!state.habits.some((s:Habit)=>s.id===h.id)))));
 for(const j of state.entries as Journal[]){const local=readDay(j.date,catalog());if(!local.dirty&&!local.pending&&!local.deletePending)writeDay({journal:j,ack:j.revision,dirty:false,edit:''});}
 for(const t of state.deleted||[]){const local=readDay(t.date,catalog());if(!local.dirty&&!local.pending)writeDay({journal:{...emptyJournal(t.date,[]),revision:t.revision},ack:t.revision,dirty:false,edit:'',deleted:true});else if(local.ack<t.revision){local.conflict=null;writeDay(local);}}
}
let active:Promise<void>|undefined;
export async function syncAll(){
 if(active)return active;
 const sync=async()=>{
  const habits=JSON.parse(localStorage.getItem('daynote.habitQueue')||'{}');
  for(const h of Object.values(habits)as Habit[]){await call('/habits','POST',h);const current=JSON.parse(localStorage.getItem('daynote.habitQueue')||'{}');if(JSON.stringify(current[h.id])===JSON.stringify(h))delete current[h.id];localStorage.setItem('daynote.habitQueue',JSON.stringify(current));}
  for(const initial of localDays()){
   let d=readDay(initial.journal.date,catalog());if(d.conflict!==undefined)continue;
   if(d.deletePending){const r=await call('/entries/'+d.journal.date,'DELETE');writeDay({journal:{...emptyJournal(d.journal.date,[]),revision:r.revision},ack:r.revision,dirty:false,edit:'',deleted:true});continue;}
   if(!d.dirty&&!d.pending)continue;
   if(!d.pending){d.pending={id:crypto.randomUUID(),entry:structuredClone(d.journal),base:d.ack,edit:d.edit};writeDay(d);}
   const op=d.pending;
   try{
    const r=await call('/entries/'+d.journal.date,'PUT',{mutation_id:op.id,base_revision:op.base,entry:op.entry});
    const current=readDay(d.journal.date,catalog());current.ack=r.entry?.revision??op.base+1;current.journal.revision=current.ack;
    if(current.edit===op.edit){if(r.entry)current.journal=r.entry;current.dirty=false;}else current.dirty=true;
    current.pending=undefined;writeDay(current);
   }catch(e){if(e instanceof DaynoteError&&e.status===409){const state=await call('/state'),current=readDay(d.journal.date,catalog());current.conflict=state.entries.find((j:Journal)=>j.date===d.journal.date)||null;current.ack=current.conflict?.revision??state.deleted?.find((t:any)=>t.date===d.journal.date)?.revision??current.ack;current.pending=undefined;writeDay(current);}else throw e;}
  }
 };
 active=(navigator.locks?navigator.locks.request('daynote-sync',sync):sync()).finally(()=>{active=undefined;});return active;
}
const audioDB=()=>new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('daynote-private-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('recordings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export async function recording(action:'get'|'put'|'delete',value?:{id:string;date:string;blob:Blob}):Promise<{id:string;date:string;blob:Blob}|null>{const db=await audioDB();return new Promise((resolve,reject)=>{const tx=db.transaction('recordings',action==='get'?'readonly':'readwrite'),s=tx.objectStore('recordings');let result:any=null;const r=action==='get'?s.get('current'):action==='put'?s.put(value,'current'):s.delete('current');r.onsuccess=()=>{if(action==='get')result=r.result||null;};tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};});}
export async function clearLocalDaynote(){for(const k of Object.keys(localStorage))if(k.startsWith('daynote.'))localStorage.removeItem(k);await recording('delete');}

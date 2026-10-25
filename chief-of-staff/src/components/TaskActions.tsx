import {useState} from 'react';
import {api} from '../api';

export default function TaskActions({id,onChanged,onClose}:{id:string;onChanged:()=>void;onClose?:(status:'done'|'dropped')=>Promise<void>}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const close=async(status:'done'|'dropped')=>{setBusy(true);setError('');try{if(onClose)await onClose(status);else{await api.updateItem(id,{status});onChanged();}}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <div className="mt-1.5 flex flex-wrap gap-1.5">
  <button disabled={busy} onClick={()=>close('done')} className="rounded-full bg-ok/15 text-ok px-3 py-1 text-[13px] font-medium disabled:opacity-50">✓ Done</button>
  <button disabled={busy} onClick={()=>window.dispatchEvent(new CustomEvent('cos:reschedule',{detail:id}))} className="rounded-full bg-surface border border-line px-3 py-1 text-[13px] font-medium">Later…</button>
  <button disabled={busy} onClick={()=>close('dropped')} className="rounded-full px-3 py-1 text-[13px] text-muted">Not needed</button>
  {error&&<p role="alert" className="basis-full text-sm text-danger">{error}</p>}
 </div>;
}

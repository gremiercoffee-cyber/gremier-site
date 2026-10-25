import { useEffect,useState } from 'react';
import type { PendingAction } from '../../shared/types';
import { api } from '../api';
import { Button,Card } from './ui';
export default function AiJobApprovals({refreshKey,onChanged}:{refreshKey:number;onChanged:()=>void}) {
  const [pending,setPending]=useState<PendingAction[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>api.aiJobApprovals().then(setPending).catch(e=>setError(e.message));
  useEffect(()=>{void load();const timer=setInterval(load,15000);return()=>clearInterval(timer);},[refreshKey]);
  const decide=async(id:string,decision:'approve'|'reject')=>{setBusy(true);setError('');try{await api.decide(id,decision);await load();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  if(!pending.length&&!error)return null;
  return <Card title="AI jobs waiting for your confirmation">{error&&<p role="alert" className="text-danger">{error}</p>}{pending.map(p=><div key={p.id} className="py-3 border-t border-line"><p className="whitespace-pre-wrap text-sm">{p.description}</p><p className="text-muted text-xs my-2">Nothing has started yet.</p><div className="flex gap-2"><Button disabled={busy} onClick={()=>void decide(p.id,'approve')}>Approve AI job</Button><Button variant="soft" disabled={busy} onClick={()=>void decide(p.id,'reject')}>Don't run</Button></div></div>)}</Card>;
}

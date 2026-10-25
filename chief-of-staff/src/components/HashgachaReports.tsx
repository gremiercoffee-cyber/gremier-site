import {useState} from 'react';
import type {HashgachaCampaign} from '../../shared/hashgacha';
import {api} from '../api';
import {Button} from './ui';
export default function HashgachaReports({campaigns,onChanged}:{campaigns:HashgachaCampaign[];onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const shown=campaigns.filter(c=>c.status==='active'||c.last_checked_at&&Date.now()-Date.parse(c.last_checked_at)<7*86400000);
 if(!shown.length)return null;
 const refresh=async()=>{setBusy(true);setError('');try{await api.refreshHashgacha();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section aria-label="Hashgacha reports" className="space-y-3">{shown.map(c=>{
  const received=c.targets.filter(t=>t.state==='received'),missing=c.targets.filter(t=>t.state==='missing'||t.state==='partial'),unknown=c.targets.filter(t=>t.state==='unknown');
  return <div key={c.id} className="rounded-[20px] bg-surface border border-line p-4 space-y-2">
   <h2 className="font-medium">Hashgacha reports · {received.length} of {c.targets.length} received</h2>
   <p className="text-xs text-muted">Week of {new Date(`${c.week_of}T12:00:00Z`).toLocaleDateString('en-GB',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'})}</p>
   {!!missing.length&&<p className="text-sm">Still missing: {missing.map(t=>t.name).join(', ')}.</p>}
   {!!unknown.length&&<p className="text-sm text-muted">Not yet verified: {unknown.map(t=>t.name).join(', ')}.</p>}
   {received.length===c.targets.length&&!!received.length&&<p className="text-sm text-ok">All reports received. Collection complete.</p>}
   <details><summary className="cursor-pointer text-xs text-accent">Report status by rabbi</summary><ul className="mt-2 divide-y divide-line">{c.targets.map(t=><li key={t.class_id} className="py-2 flex justify-between gap-3 text-sm"><span>{t.name}</span><span className={t.state==='received'?'text-ok':'text-muted'}>{t.state==='received'?'Received':t.state==='partial'?`Partial · ${t.submitted}/${t.expected}`:t.state==='missing'?'Not received':'Not verified'}{t.state!=='received'&&t.item_status&&t.item_status!=='open'?' · follow-up closed':''}</span></li>)}</ul></details>
   {c.last_error&&<p role="alert" className="text-xs text-danger">Could not refresh Hashgacha. Showing the last verified status.</p>}
   <div className="flex gap-2 items-center"><Button variant="ghost" disabled={busy} onClick={()=>void refresh()}>{busy?'Checking…':'Check reports'}</Button><a href="https://nightseder.ygrey.workers.dev" target="_blank" rel="noreferrer" className="text-xs text-accent">Open Hashgacha ↗</a></div>
  </div>;
 })}{error&&<p role="alert" className="text-sm text-danger">{error}</p>}</section>;
}

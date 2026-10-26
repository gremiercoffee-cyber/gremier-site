import {useEffect,useState} from 'react';
import {api,type BroadcastRow,type GroupRow} from '../api';
import {Button,timeAgo} from './ui';
import {useOpenSet} from '../remember';
const field='w-full rounded-xl border border-line bg-bg p-3 text-sm';
const phone=(value:string)=>{const d=value.replace(/\D/g,'');return d.startsWith('0')?`972${d.slice(1)}`:d;};
const personal=(text:string,name:string)=>text.replace(/\{name\}/gi,name).replace(/\{first_name\}/gi,/^(rabbi|rav|dr|reb)\.?\s/i.test(name)?name:name.split(/\s+/)[0]);
export function GroupMessage({b,g,onChanged}:{b:BroadcastRow;g:GroupRow;onChanged:()=>void}){
 const [subject,setSubject]=useState(b.subject),[body,setBody]=useState(b.body),[busy,setBusy]=useState(false),[error,setError]=useState(''),[info,setInfo]=useState(''),[showPhones,setShowPhones]=useState(false);
 const editable=b.status==='draft'&&!b.archived_at,emails=g.members.filter(m=>m.email),phones=g.members.filter(m=>m.phone);
 // Sending is two taps (the button changes to "Tap again…"), the card stays where it is after sending (so nothing
 // slides under your finger), and the server double-checks a second send to the same group within 2 minutes.
 const [confirming,setConfirming]=useState(false),[sent,setSent]=useState(''),[recent,setRecent]=useState('');
 useEffect(()=>{if(!confirming)return;const t=setTimeout(()=>setConfirming(false),5000);return()=>clearTimeout(t);},[confirming]);
 const old=Date.now()-Date.parse(b.created_at)>12*3600_000?new Date(b.created_at).toLocaleDateString([],{weekday:'short',day:'numeric',month:'short'}):null;
 const sendNow=async(force:boolean)=>{setBusy(true);setError('');setRecent('');setConfirming(false);
  try{const r=await api.sendGroupMessage(b.id,{subject,body,force});const failed=r.skipped.filter(s=>s.error!=='no email').length;setSent(`✓ Sent to ${r.sent} of ${r.total}${failed?` · ${failed} didn't go through (see the Archive on the Groups page)`:''}.`);}
  catch(e){const m=(e as Error).message;if(m.startsWith('RECENT_SEND:'))setRecent(m.slice('RECENT_SEND:'.length).trim());else setError(m);}
  finally{setBusy(false);}};
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const save=()=>api.draftGroupMessage({id:b.id,group:g.id,subject,body});
 const results=(()=>{try{return JSON.parse(b.results) as {name:string;ok:boolean;error?:string}[];}catch{return [];}})();
 const waText=(name?:string)=>`${subject?`*${subject}*\n\n`:''}${name?personal(body,name):body.replace(/\{(?:first_name|name)\}/gi,'')}`;
 if(sent)return <section className="rounded-2xl bg-sunken p-4 space-y-2"><p className="text-sm font-semibold">To: {g.name}</p><p className="text-sm font-medium" dir="auto">{subject||'(no subject)'}</p><p role="status" className="text-sm text-ok">{sent}</p><Button variant="soft" onClick={onChanged}>Done</Button></section>;
 return <section className="rounded-2xl bg-sunken p-4 space-y-3">
  <p className="text-sm font-semibold">To: {g.name}</p><p className={`text-xs ${old&&b.status==='draft'&&!b.archived_at?'text-amber-700 font-medium':'text-muted'}`}>{b.archived_at?`Archived ${timeAgo(b.archived_at)}`:b.status==='draft'?(old?`Older draft, from ${old} — check it's still what you want`:'Draft — review and send'):b.status==='sending'?'Sending…':`${b.status} — check delivery details`}</p>
  {editable?<><input aria-label={`Subject for ${g.name}`} className={field} value={subject} onChange={e=>setSubject(e.target.value)} disabled={busy} placeholder="Email subject"/><textarea aria-label={`Message to ${g.name}`} className={field} rows={5} value={body} onChange={e=>setBody(e.target.value)} disabled={busy} dir="auto"/></>:<><p className="font-medium">{b.subject}</p><p className="text-sm whitespace-pre-wrap" dir="auto">{b.body}</p></>}
  {editable&&<><details><summary className="cursor-pointer text-xs text-muted">Email recipients ({emails.length})</summary><ul className="text-xs mt-2 space-y-1">{emails.map(m=><li key={m.id}>{m.name} · {m.email}</li>)}</ul></details>
   <div className="flex flex-wrap gap-2"><Button variant="soft" disabled={busy||!body.trim()} onClick={()=>void act(async()=>{await save();setInfo('Draft saved.');})}>Save draft</Button>
    <Button variant={confirming?'danger':undefined} disabled={busy||!body.trim()||!emails.length} onClick={()=>{if(!confirming){setConfirming(true);return;}void sendNow(false);}}>{busy?'Sending…':confirming?`Tap again to send to ${emails.length} people${old?` (draft from ${old})`:''}`:`Send to ${g.name} (${emails.length} emails)`}</Button>
    <a href={`https://wa.me/?text=${encodeURIComponent(waText())}`} target="_blank" rel="noreferrer" onClick={e=>{if(busy||!body.trim()){e.preventDefault();return;}void act(save);}} className="rounded-full bg-surface px-4 py-2 text-sm">WhatsApp — choose chat</a>
    {!!phones.length&&<Button variant="soft" disabled={busy} onClick={()=>setShowPhones(!showPhones)}>WhatsApp each ({phones.length})</Button>}
   </div>
   {showPhones&&<ul className="text-sm space-y-2">{phones.map(m=><li key={m.id} className="flex justify-between gap-2"><span>{m.name}</span><a href={`https://wa.me/${phone(m.phone!)}?text=${encodeURIComponent(waText(m.name))}`} onClick={()=>void act(save)} target="_blank" rel="noreferrer" className="text-accent">Open WhatsApp</a></li>)}</ul>}
   <Button variant="ghost" disabled={busy} onClick={()=>void act(async()=>{await save();await api.archiveGroupMessage(b.id);})}>Sent in WhatsApp — archive</Button>
   <Button variant="ghost" disabled={busy} onClick={()=>void act(()=>api.deleteGroupMessage(b.id))}>Delete draft</Button>
  </>}
  {!!results.length&&<ul className="text-xs space-y-1">{results.map((r,i)=><li key={i} className={r.ok?'text-muted':'text-danger'}>{r.name}: {r.ok?'Sent':r.error}</li>)}</ul>}
  {!editable&&!b.archived_at&&b.status!=='sending'&&<Button variant="ghost" disabled={busy} onClick={()=>void act(()=>api.archiveGroupMessage(b.id))}>Archive after reviewing delivery</Button>}
  {recent&&<div role="alert" className="rounded-xl bg-amber-500/15 p-3 text-sm space-y-2"><p dir="auto">{recent}</p><div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy} onClick={()=>void sendNow(true)}>Yes, send this one too</Button><Button variant="ghost" onClick={()=>setRecent('')}>No, don't send</Button></div></div>}
  {error&&<p role="alert" className="text-sm text-danger">{error}</p>}{info&&<p role="status" className="text-sm">{info}</p>}
 </section>;
}
/**
 * Group drafts the assistant made in THIS conversation (created since `since`), folded to one line each:
 * tap to review, edit and send. Older drafts live on the Groups page, not in every chat.
 */
export default function GroupDraftApprovals({refreshKey,onChanged,since}:{refreshKey:number;onChanged:()=>void;since:string}){
 const [drafts,setDrafts]=useState<BroadcastRow[]>([]),[groups,setGroups]=useState<GroupRow[]>([]),[error,setError]=useState('');
 const [opened,setOpened]=useOpenSet('cos.groupDraftsOpen');
 const load=async()=>{try{const [d,g]=await Promise.all([api.groupDrafts(),api.groups()]);setDrafts(d);setGroups(g);setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void load();},[refreshKey]);
 const mine=drafts.filter(b=>b.created_at>=since);
 if(!mine.length&&!error)return null;
 return <div className="space-y-2 mt-4">{mine.map(b=>{const g=groups.find(g=>g.id===b.group_id);return g?
  <details key={b.id} open={opened.has(b.id)} onToggle={e=>setOpened(b.id,e.currentTarget.open)} className="rounded-2xl bg-sunken px-4 py-3">
   <summary className="cursor-pointer text-sm font-medium">✉️ Draft to {g.name}<span className="text-muted font-normal"> · {b.subject||'no subject'} · tap to review</span></summary>
   <div className="mt-3"><GroupMessage b={b} g={g} onChanged={()=>{void load();onChanged();}}/></div>
  </details>:null;})}{error&&<p role="alert" className="text-danger text-sm">{error}</p>}</div>;
}

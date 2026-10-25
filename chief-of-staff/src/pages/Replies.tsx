import {useEffect,useRef,useState} from 'react';
import {api,type ReplyCard} from '../api';
import {Button,DictateButton} from '../components/ui';

export function replyWhatsAppLink(card:ReplyCard,text:string){return `https://wa.me/${card.phone??''}?text=${encodeURIComponent(text)}`;}
export default function Replies({serverTranscription,onDataChanged,refreshKey}:{serverTranscription:boolean;onDataChanged:()=>void;refreshKey:number}){
 const [cards,setCards]=useState<ReplyCard[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({}),[input,setInput]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[opened,setOpened]=useState<Record<string,boolean>>({});
 const numbers=useRef(new Map<string,number>()),next=useRef(1),dirty=useRef(new Set<string>());
 const load=async()=>{try{const rows=await api.replies();for(const c of rows)if(!numbers.current.has(c.id))numbers.current.set(c.id,next.current++);setCards(rows);setDrafts(old=>Object.fromEntries(rows.map(c=>[c.id,dirty.current.has(c.id)?old[c.id]??'':c.suggested??''])));setLoading(false);}catch(e){setError((e as Error).message);setLoading(false);}};
 useEffect(()=>{void load();},[refreshKey]);
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await load();onDataChanged();}catch(e){setError((e as Error).message);await load();}finally{setBusy(false);}};
 const batch=async(text=input)=>{
  if(!text.trim()||busy)return;setBusy(true);setError('');setMessage('');
  try{for(const c of cards)if(dirty.current.has(c.id)){await api.saveReplyDraft(c.id,drafts[c.id]??'');dirty.current.delete(c.id);}
   const r=await api.batchReplies(text,cards.map(c=>({id:c.id,number:numbers.current.get(c.id)!})));
   if(r.clarification)setMessage(r.clarification);else{for(const c of r.changed)dirty.current.delete(c.id);setInput('');setMessage(`${r.changed.length} updated. Review the drafts, then send.`);}
   await load();onDataChanged();
  }catch(e){setError((e as Error).message);await load();}finally{setBusy(false);}
 };
 return <div className="flex flex-col min-h-full">
  <p className="text-sm text-muted mb-4">{cards.length} waiting. Say “number 1, tell him Tuesday works; number 2, no reply needed.” Numbers stay fixed while you work here.</p>
  {loading&&<p className="text-sm text-muted">Loading replies…</p>}
  <div className="space-y-3 flex-1">{cards.map(c=><ReplySheetCard key={c.id} c={c} number={numbers.current.get(c.id)!} draft={drafts[c.id]??''} busy={busy} opened={!!opened[c.id]}
   onEdit={text=>{dirty.current.add(c.id);setDrafts({...drafts,[c.id]:text});}}
   onSave={()=>void act(async()=>{await api.saveReplyDraft(c.id,drafts[c.id]??'');dirty.current.delete(c.id);setMessage('Draft saved.');})}
   onDismiss={()=>{const previous=cards;setCards(rows=>rows.filter(row=>row.id!==c.id));void act(async()=>{try{await api.dismissReply(c.id);}catch(e){setCards(previous);throw e;}});}}
   onOpen={()=>{setOpened({...opened,[c.id]:true});void api.saveReplyDraft(c.id,drafts[c.id]??'').catch(e=>setError(e.message));}}
   onSent={()=>void act(async()=>{await api.markReplied(c.id);dirty.current.delete(c.id);})}
   onSend={()=>void act(async()=>{const r=await api.sendReply(c.id,drafts[c.id]??'');dirty.current.delete(c.id);setMessage(r.message);})}
  />)}</div>
  {!loading&&!cards.length&&<p className="text-sm text-muted py-6">No replies waiting.</p>}
  <div className="sticky bottom-0 bg-bg border-t border-line py-3 mt-4 space-y-2">
   {error&&<p role="alert" className="text-sm text-danger">{error}</p>}{message&&<p role="status" className="text-sm text-accent">{message}</p>}
   <textarea aria-label="Instructions for numbered replies" placeholder="Number 1, say… Number 2, don't worry about it…" value={input} onChange={e=>setInput(e.target.value)} disabled={busy} rows={2} className="w-full rounded-2xl bg-sunken p-3 text-sm"/>
   <div className="flex items-center gap-2"><DictateButton serverTranscription={serverTranscription} onText={text=>{setInput(text);void batch(text);}}/><Button disabled={busy||!input.trim()||!cards.length} onClick={()=>void batch()}>{busy?'Updating…':'Draft / update replies'}</Button></div>
  </div>
 </div>;
}
export function ReplySheetCard({c,number,draft,busy,opened,onEdit,onSave,onDismiss,onOpen,onSent,onSend}:{c:ReplyCard;number:number;draft:string;busy:boolean;opened:boolean;onEdit:(text:string)=>void;onSave:()=>void;onDismiss:()=>void;onOpen:()=>void;onSent:()=>void;onSend:()=>void}){
 return <section className="rounded-[20px] bg-surface border border-line p-4 space-y-3">
  <div className="flex items-start gap-3"><span className="h-8 min-w-8 rounded-full bg-accent text-accent-ink grid place-items-center font-semibold">{number}</span><div className="flex-1"><h2 className="font-medium">{c.person??'Someone'}</h2><p className="text-xs text-muted">{c.channel==='email'?'Email':'WhatsApp'}{c.subject?` · ${c.subject}`:''}</p></div>
   <button disabled={busy} onClick={onDismiss} title="No reply needed" aria-label={`No reply needed for number ${number}`} className="rounded-full border-2 border-danger text-danger h-8 w-8 grid place-items-center text-lg shrink-0">×</button>
  </div>
  <blockquote className="border-l-2 border-line pl-3 text-sm whitespace-pre-wrap" dir="auto">{c.said}</blockquote>
  <textarea aria-label={`Draft for number ${number}`} value={draft} onChange={e=>onEdit(e.target.value)} disabled={busy} rows={3} placeholder="Your editable draft appears here" className="w-full rounded-xl bg-sunken p-3 text-sm" dir="auto"/>
  <div className="flex flex-wrap items-center gap-2"><Button variant="soft" disabled={busy} onClick={onSave}>Save draft</Button>
   {c.channel==='email'?<Button disabled={busy||!draft.trim()||!!c.delivery_status} onClick={onSend}>Send email</Button>:<>
    <a href={draft.trim()?replyWhatsAppLink(c,draft):undefined} onClick={e=>{if(busy||!draft.trim()){e.preventDefault();return;}onOpen();}} target="_blank" rel="noreferrer" aria-disabled={busy||!draft.trim()} className="rounded-full bg-accent text-accent-ink px-4 py-2 text-sm">{c.phone?'Open their WhatsApp':'Choose WhatsApp chat'}</a>
    {opened&&<Button variant="soft" disabled={busy} onClick={onSent}>I sent it — mark replied</Button>}
   </>}
  </div>
  {c.delivery_status&&<p role="status" className="text-sm text-muted">A send was already attempted. Check Gmail before sending again.</p>}
 </section>;
}

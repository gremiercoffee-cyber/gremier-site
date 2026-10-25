import {useEffect,useState} from 'react';
import type {MeetingPrepState,PrepMeeting,PrepNote} from '../../shared/meeting-prep';
import {api} from '../api';
import {Button,Card} from './ui';

export function meetingLabel(m:PrepMeeting,tz:string){
 return `${m.title} · ${new Date(m.starts_at).toLocaleString('en-GB',{timeZone:tz,weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}`;
}
export function useMeetingPrep(refreshKey:number){
 const [state,setState]=useState<MeetingPrepState|null>(null),[error,setError]=useState('');
 const load=async()=>{try{setState(await api.meetingPrep());setError('');}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},15000);return()=>clearInterval(timer);},[refreshKey]);
 return {state,error,load};
}
export function MeetingChoices({state,onChanged}:{state:MeetingPrepState;onChanged:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[all,setAll]=useState<Record<string,boolean>>({});
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 if(!state.drafts.length)return null;
 return <Card title="Which meeting is this for?">
  <p className="text-sm text-muted mb-3">Your thoughts are held here until you choose the meeting.</p>
  {state.drafts.map(d=>{
   const candidates=all[d.id]||!d.candidates.length?state.meetings.filter(m=>m.available):d.candidates.map(m=>state.meetings.find(current=>current.id===m.id)??{...m,available:false});
   return <div key={d.id} className="border-t border-line py-3 space-y-2">
    <p className="text-sm whitespace-pre-wrap">{d.text}</p>
    <div className="flex flex-col items-stretch gap-2">{candidates.map(m=><Button key={m.id} variant="soft" disabled={busy||!m.available} className="!rounded-xl !justify-start text-left" onClick={()=>void act(()=>api.confirmMeetingNote(d.id,m.id))}>{meetingLabel(m,state.timezone)}</Button>)}</div>
    {!candidates.length&&<p className="text-sm text-muted">No upcoming meeting found. Tell the assistant the meeting and date to add it to Schedule; your note will stay here.</p>}
    <div className="flex flex-wrap gap-2">{!all[d.id]&&!!d.candidates.length&&<Button variant="ghost" disabled={busy} onClick={()=>setAll({...all,[d.id]:true})}>Choose another meeting</Button>}<Button variant="ghost" disabled={busy} onClick={()=>void act(()=>api.discardMeetingNote(d.id))}>Discard this note</Button></div>
   </div>;
  })}
  {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
 </Card>;
}
export default function MeetingPrepConfirmations({refreshKey,onChanged}:{refreshKey:number;onChanged:()=>void}){
 const {state,error,load}=useMeetingPrep(refreshKey);
 return <>{state&&<MeetingChoices state={state} onChanged={()=>{void load();onChanged();}}/>}{error&&<p role="alert" className="text-sm text-danger">Meeting notes: {error}</p>}</>;
}
function SavedNote({note,onChanged}:{note:PrepNote;onChanged:()=>void}){
 const [editing,setEditing]=useState(false),[text,setText]=useState(note.text),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const act=async(remove=false)=>{setBusy(true);setError('');try{if(remove)await api.deleteMeetingNote(note.id);else await api.editMeetingNote(note.id,text);setEditing(false);onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <div className="py-3 border-t border-line">
  {editing?<><textarea aria-label="Edit meeting note" value={text} onChange={e=>setText(e.target.value)} className="w-full rounded-xl bg-sunken p-3 min-h-24"/><Button disabled={busy||!text.trim()} onClick={()=>void act()}>Save</Button><Button variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button></>:<><p className="text-sm whitespace-pre-wrap">{note.text}</p><div className="flex gap-2 mt-1"><Button variant="ghost" disabled={busy} onClick={()=>{setText(note.text);setEditing(true);}}>Edit</Button><Button variant="ghost" disabled={busy} onClick={()=>void act(true)}>Remove note</Button></div></>}
  {error&&<p role="alert" className="text-danger text-sm">{error}</p>}
 </div>;
}
export function MeetingsPage({refreshKey,onChanged,onAsk}:{refreshKey:number;onChanged:()=>void;onAsk:(text:string)=>void}){
 const {state,error,load}=useMeetingPrep(refreshKey);
 if(!state)return <p className="text-sm text-muted" role={error?'alert':undefined}>{error||'Loading meetings…'}</p>;
 const changed=()=>{void load();onChanged();};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:state.timezone}).format(new Date());
 const isPast=(m:PrepMeeting)=>new Intl.DateTimeFormat('en-CA',{timeZone:state.timezone}).format(new Date(m.starts_at))<today;
 const upcoming=state.meetings.filter(m=>m.available&&!isPast(m)),past=state.meetings.filter(m=>(!m.available||isPast(m))&&state.notes.some(n=>n.meeting_id===m.id));
 const meeting=(m:PrepMeeting)=><details key={m.id} className="rounded-[20px] bg-surface border border-line p-4" open={state.notes.some(n=>n.meeting_id===m.id)||undefined}>
  <summary className="cursor-pointer font-medium text-[15px]">{meetingLabel(m,state.timezone)}<span className="block text-xs text-muted font-normal mt-1">{m.source==='calendar'?'Calendar':'Schedule'}{!m.available?' · No longer scheduled':''} · {state.notes.filter(n=>n.meeting_id===m.id).length} notes</span></summary>
  {m.location&&<p className="text-sm text-muted mt-2">{m.location}</p>}
  <div className="mt-3">{state.notes.filter(n=>n.meeting_id===m.id).map(n=><SavedNote key={n.id} note={n} onChanged={changed}/>)}</div>
  <Button variant="soft" disabled={!m.available} onClick={()=>onAsk(`Add a thought to the meeting prep for ${meetingLabel(m,state.timezone)} (meeting ID ${m.id}).`)}>Add a thought</Button>
 </details>;
 return <div className="space-y-4"><p className="text-sm text-muted">Tell me “add this to my meeting with…” whenever something occurs to you. Choose the meeting, and your notes stay together here.</p>
  <MeetingChoices state={state} onChanged={changed}/>
  <div className="space-y-3">{upcoming.map(meeting)}</div>
  {!upcoming.length&&<p className="text-sm text-muted">No upcoming meetings saved. Tell me the meeting and date, or connect your calendar.</p>}
  {!!past.length&&<details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm">Saved meeting archive · {past.length}</summary><div className="space-y-3 mt-3">{past.slice().reverse().map(meeting)}</div></details>}
  {error&&<p role="alert" className="text-danger text-sm">{error}</p>}
 </div>;
}

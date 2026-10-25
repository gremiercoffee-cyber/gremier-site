import type {Env} from './env';
import type {PrepMeeting,PrepNote,MeetingPrepState} from '../shared/meeting-prep';
import {all,first,getSettings,HttpError,now,run,uid} from './db';

/** Resolve a local meeting time with the offset on that date, including DST. */
export function meetingTime(date:string,time:string,tz:string) {
 const target=Date.parse(`${date}T${time}:00Z`);let result=target;
 for(let i=0;i<3;i++){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(result));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  const shown=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  result+=target-shown;
 }
 return new Date(result).toISOString();
}

export async function prepMeetings(env:Env):Promise<PrepMeeting[]> {
 const tz=(await getSettings(env)).timezone||'Asia/Jerusalem';
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:tz}).format(new Date());
 const [calendar,schedule,saved]=await Promise.all([
  all<{id:string;summary:string;start_at:string;location:string|null}>(env,"SELECT id,summary,start_at,location FROM calendar_events WHERE hidden=0 AND all_day=0 AND COALESCE(end_at,start_at)>=? ORDER BY start_at",now()),
  all<{id:string;name:string;date:string;start_time:string;note:string}>(env,"SELECT id,name,date,start_time,note FROM situations WHERE active=1 AND date>=? AND start_time IS NOT NULL AND (skip_dates IS NULL OR instr(skip_dates,date)=0) ORDER BY date,start_time",date),
  all<PrepMeeting>(env,'SELECT * FROM meeting_agenda_meetings'),
 ]);
 const live:PrepMeeting[]=[...calendar.map(e=>({id:`calendar:${e.id}`,title:e.summary||'Untitled meeting',starts_at:e.start_at,source:'calendar' as const,location:e.location})),...schedule.map(s=>({id:`schedule:${s.id}`,title:s.name,starts_at:meetingTime(s.date,s.start_time,tz),source:'schedule' as const,location:null}))];
 const merged=new Map(saved.map(m=>[m.id,{...m,available:false}]));for(const m of live)merged.set(m.id,{...m,available:true});
 return [...merged.values()].sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.title.localeCompare(b.title));
}
export async function meetingPrepState(env:Env):Promise<MeetingPrepState> {
 const [meetings,notes,drafts,settings]=await Promise.all([prepMeetings(env),all<PrepNote>(env,'SELECT * FROM meeting_agenda_notes ORDER BY created_at,id'),all<{id:string;text:string;candidates:string;created_at:string}>(env,"SELECT * FROM meeting_agenda_drafts WHERE status='pending' ORDER BY created_at,id"),getSettings(env)]);
 return {meetings,notes,drafts:drafts.map(d=>({...d,candidates:JSON.parse(d.candidates) as PrepMeeting[]})),timezone:settings.timezone||'Asia/Jerusalem'};
}
export async function proposePrepNote(env:Env,p:{text?:string;meeting_ids?:string[]}) {
 const text=String(p.text??'').trim();if(!text||text.length>12000)throw new HttpError(400,'Supply your note, up to 12000 characters.');
 const meetings=await prepMeetings(env),ids=[...new Set(p.meeting_ids??[])];
 const candidates=ids.length?ids.map(id=>{const m=meetings.find(m=>m.id===id);if(!m||!m.available)throw new HttpError(400,'That meeting is unavailable. Read the meeting list again.');return m;}):meetings.filter(m=>m.available);
 const existing=await first<{id:string}>(env,"SELECT id FROM meeting_agenda_drafts WHERE status='pending' AND text=? AND candidates=?",text,JSON.stringify(candidates));
 const id=existing?.id??uid();
 if(!existing)await run(env,'INSERT INTO meeting_agenda_drafts(id,text,candidates,created_at) VALUES(?,?,?,?)',id,text,JSON.stringify(candidates),now());
 return {id,status:'awaiting_meeting_confirmation',question:'Which meeting should this note go with?',text,candidates,message:candidates.length?'Ask which meeting to attach this note to. Nothing has been attached yet.':'The note is held safely. Ask the user to add the meeting to Schedule, then choose it in Meetings.'};
}
/** One conditional insert makes retries and concurrent selections idempotent. */
export async function confirmPrepNote(env:Env,draftId:string,meetingId:string) {
 const d=await first<{id:string;text:string;candidates:string;status:string;selected_meeting_id:string|null}>(env,'SELECT * FROM meeting_agenda_drafts WHERE id=?',draftId);
 if(!d)throw new HttpError(404,'Note not found.');
 const previous=await first<PrepNote>(env,'SELECT * FROM meeting_agenda_notes WHERE id=?',draftId);
 if(previous){if(previous.meeting_id!==meetingId)throw new HttpError(409,'This note was already saved to another meeting.');await run(env,"UPDATE meeting_agenda_drafts SET status='saved',selected_meeting_id=? WHERE id=?",meetingId,draftId);return {ok:true,already_saved:true};}
 if(d.status!=='pending')throw new HttpError(409,'This note is no longer waiting for confirmation.');
 const meeting=(await prepMeetings(env)).find(m=>m.id===meetingId);
 if(!meeting||!meeting.available)throw new HttpError(400,'Choose an available meeting.');
 // A live cancellation/hidden event cannot receive new notes, but old notes stay readable.
 if(meeting.source==='calendar'&&!await first(env,'SELECT 1 FROM calendar_events WHERE id=? AND hidden=0',meeting.id.slice(9)))throw new HttpError(409,'This meeting is no longer available.');
 if(meeting.source==='schedule'){
  if(!await first(env,'SELECT 1 FROM situations WHERE id=? AND date IS NOT NULL AND active=1',meeting.id.slice(9)))throw new HttpError(409,'This meeting has moved or been removed. Choose it again.');
 }
 await run(env,'INSERT OR REPLACE INTO meeting_agenda_meetings(id,title,starts_at,source,location) VALUES(?,?,?,?,?)',meeting.id,meeting.title,meeting.starts_at,meeting.source,meeting.location);
 await run(env,"INSERT OR IGNORE INTO meeting_agenda_notes(id,meeting_id,text,created_at) SELECT id,?,text,? FROM meeting_agenda_drafts WHERE id=? AND status='pending'",meeting.id,now(),draftId);
 const saved=await first<PrepNote>(env,'SELECT * FROM meeting_agenda_notes WHERE id=?',draftId);
 if(!saved||saved.meeting_id!==meetingId)throw new HttpError(409,'This note was already handled.');
 await run(env,"UPDATE meeting_agenda_drafts SET status='saved',selected_meeting_id=? WHERE id=?",meeting.id,draftId);
 return {ok:true,meeting:meeting.title,message:`Added to ${meeting.title}.`};
}
export async function discardPrepDraft(env:Env,id:string){await run(env,"UPDATE meeting_agenda_drafts SET status='discarded' WHERE id=? AND status='pending' AND NOT EXISTS(SELECT 1 FROM meeting_agenda_notes WHERE id=?)",id,id);return {ok:true};}
export async function editPrepNote(env:Env,id:string,text:string){
 if(!text.trim()||text.length>12000)throw new HttpError(400,'Supply a note up to 12000 characters.');
 await run(env,'UPDATE meeting_agenda_notes SET text=? WHERE id=?',text.trim(),id);return {ok:true};
}
export async function deletePrepNote(env:Env,id:string){await run(env,'DELETE FROM meeting_agenda_notes WHERE id=?',id);return {ok:true};}

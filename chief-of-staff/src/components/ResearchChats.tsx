import { useEffect, useRef, useState } from "react";
import { api, type JobChat, type JobBriefVersion, type JobChatRow } from "../api";
import {jobSections} from "../../shared/job-navigation";
import type {Project} from "../../shared/types";
import { Button, Empty, Markdown, timeAgo } from "./ui";

/** Research chats pinned in the side panel: tap one to open it; the dot means new answers. */
export function PinnedResearch({ jobs, activeId, onOpen }: { jobs: JobChatRow[]; activeId: string | null; onOpen: (id: string) => void }) {
  const sections=jobSections(jobs.filter(j=>j.pinned));
  if(!sections.active.length&&!sections.paused.length&&!sections.finished.length)return null;
  const row=(j:JobChatRow)=><button key={j.id} onClick={()=>onOpen(j.id)} className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-left ${activeId===j.id?'bg-sunken':'hover:bg-sunken'}`}><span className="flex-1 min-w-0 truncate">{j.title}</span>{j.unread>0&&<span className="h-2 w-2 rounded-full bg-accent shrink-0" aria-label="New"/>}</button>;
  return <nav className="px-2 pt-3 space-y-1" aria-label="Projects and jobs">
    <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Projects & jobs</p>
    {sections.active.map(g=><details key={g.id} open={sections.active.length<=2||g.jobs.some(j=>j.id===activeId)}><summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">{g.title} <span className="opacity-60">{g.jobs.length}</span></summary><div className="ml-2 border-l border-line">{g.jobs.map(row)}</div></details>)}
    {!!sections.paused.length&&<details open={sections.paused.some(j=>j.id===activeId)}><summary className="cursor-pointer px-3 py-2 text-xs text-muted">Paused ({sections.paused.length})</summary>{sections.paused.map(row)}</details>}
    {!!sections.finished.length&&<details open={sections.finished.some(j=>j.id===activeId)}><summary className="cursor-pointer px-3 py-2 text-xs text-muted">Finished & stopped ({sections.finished.length})</summary>{sections.finished.map(row)}</details>}
  </nav>;
}

const STATUS: Record<string, string> = { pending: "Waiting for Start", active: "On", paused: "Paused", stopped: "Stopped", done: "Report ready" };

/** A digestible overview first; correspondence and execution history stay behind deliberate controls. */
export function ResearchChat({id,onChanged}:{id:string;onChanged:()=>void}){
 const [chat,setChat]=useState<JobChat|null>(null),[error,setError]=useState(''),[text,setText]=useState(''),[sending,setSending]=useState(false);
 const [tab,setTab]=useState<'overview'|'conversation'>('overview'),[older,setOlder]=useState(false),[projects,setProjects]=useState<Project[]>([]),[history,setHistory]=useState<JobBriefVersion[]>([]),[refreshing,setRefreshing]=useState(false);
 const requestVersion=useRef(0),end=useRef<HTMLDivElement>(null),follow=useRef(false);
 const load=()=>{const version=++requestVersion.current;return api.job(id).then(c=>{if(version===requestVersion.current){setChat(c);setError('');}}).catch(e=>{if(version===requestVersion.current){setError(e.message);if(/removed|deleted|not found/i.test(e.message))setChat(null);}});};
 useEffect(()=>{void api.projects().then(setProjects).catch(()=>{});},[]);
 useEffect(()=>{setChat(null);setHistory([]);setTab('overview');setOlder(false);follow.current=false;void load().then(onChanged);return()=>{requestVersion.current++;};},[id]);
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible')void load();},chat?.busy||chat?.knowledge.stale?15000:60000);return()=>clearInterval(t);},[id,chat?.busy,chat?.knowledge.stale]);
 useEffect(()=>{if(tab==='conversation'&&follow.current)end.current?.scrollIntoView({block:'end'});},[tab,chat?.messages.length,sending]);
 const press=async(data:string)=>{try{await api.jobButton(data);await load();onChanged();}catch(e){setError((e as Error).message);}};
 const send=async()=>{const t=text.trim();if(!t||sending)return;follow.current=true;setTab('conversation');setSending(true);setText('');try{await api.jobMessage(id,t);}catch(e){setError((e as Error).message);setText(t);}await load();setSending(false);onChanged();};
 const refresh=async()=>{setRefreshing(true);try{await api.jobBriefRefresh(id);await load();}catch(e){setError((e as Error).message);}finally{setRefreshing(false);}};
 if(!chat)return <p className="text-sm text-muted mt-4">{error||'Opening job…'}</p>;
 const k=chat.knowledge,b=k.brief,emails=k.emails,drafts=emails.filter(e=>e.status==='draft'),waiting=emails.filter(e=>e.status==='sent');
 const recent=emails.filter(e=>e.replied_at&&e.reply_text&&Date.parse(e.replied_at)>Date.now()-7*86400000).sort((a,b)=>String(b.replied_at).localeCompare(String(a.replied_at))).slice(0,2);
 const short=(value:string,n=420)=>value.length>n?value.slice(0,n).replace(/\s+\S*$/,'')+'…':value;
 const synopsis=b?.summary??(chat.busy?'Working on your request. The overview will update when there is something useful to report.':chat.status==='pending'?'This job is ready to start. Review the request below.':'No current synopsis yet. Update the overview to bring the latest information together.');
 const messages=older?chat.messages:chat.messages.slice(-8);
 const pending=chat.messages.filter(m=>m.buttons?.length);
 const tone=k.state==='Needs you'?'bg-amber-50 text-amber-800':k.state==='Working'?'bg-indigo-50 text-indigo-700':'bg-sunken text-muted';
 return <div className="h-full flex flex-col">
  <header className="shrink-0 pt-3 pb-3 border-b border-line/70">
   <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-semibold uppercase tracking-widest text-muted truncate">{k.project_title||'Your work'}</p><span className={`rounded-full px-3 py-1 text-[11px] font-medium ${tone}`}>{k.state}</span></div>
   <h2 className="font-semibold tracking-tight text-2xl leading-tight mt-2">{chat.title}</h2>
   <div className="flex items-center gap-1 mt-3 bg-sunken/70 rounded-full p-1 w-fit" aria-label="Job view">
    {(['overview','conversation'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{follow.current=false;setTab(t);}} className={`px-4 py-1.5 rounded-full text-sm transition-colors ${tab===t?'bg-surface shadow-sm font-medium':'text-muted'}`}>{t==='overview'?'Overview':'Conversation'}</button>)}
   </div>
  </header>
  <div className="flex-1 min-h-0 overflow-y-auto py-4 space-y-4">
   {tab==='overview'?<>
    <section aria-label="Current project brief" className="rounded-3xl border border-indigo-100 bg-gradient-to-br from-surface to-indigo-50/60 p-5 shadow-card">
     <div className="flex justify-between items-center gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">At a glance</h3><span className="text-[11px] text-muted">{b?timeAgo(b.updated_at):'Not updated yet'}</span></div>
     <div className="text-[17px] leading-relaxed mt-3"><Markdown text={short(synopsis)}/></div>
     {synopsis.length>420&&<details className="mt-3"><summary className="cursor-pointer text-xs text-accent">Read full synopsis</summary><div className="text-sm mt-2"><Markdown text={synopsis}/></div></details>}
     {k.stale&&<p className="text-xs text-muted mt-3" role="status">New information received · overview updating</p>}
    </section>
    {(b?.questions.length||drafts.length)>0&&<section className="rounded-3xl bg-amber-50/80 border border-amber-200/70 p-5" aria-label="Needs your attention">
     <h3 className="font-semibold text-[15px] text-amber-900">Needs you</h3>
     <div className="space-y-2 mt-3">{b?.questions.slice(0,3).map((q,i)=><p key={i} className="text-sm leading-relaxed flex gap-2"><span className="text-amber-600">•</span>{q}</p>)}</div>
     {!!drafts.length&&<p className="text-sm mt-2">{drafts.length} {drafts.length===1?'draft is':'drafts are'} ready for your review below.</p>}
    </section>}
    <div className="grid gap-3 md:grid-cols-2">{b?.next_action&&<section className="rounded-3xl bg-surface border border-line p-5 shadow-card"><p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Up next</p><div className="text-[15px] leading-relaxed mt-2"><Markdown text={short(b.next_action,280)}/></div></section>}
    {b?.recommendation&&<section className="rounded-3xl bg-surface border border-line p-5"><p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Recommendation</p><div className="text-sm leading-relaxed mt-2"><Markdown text={short(b.recommendation,280)}/></div></section>}
    </div>
    {!!emails.length&&<div className="grid grid-cols-3 gap-2" aria-label="Correspondence summary">{[[waiting.length,'Awaiting reply'],[emails.filter(e=>e.status==='replied').length,'Replied'],[drafts.length,'Drafts']].map(([n,label])=><div key={label} className="rounded-2xl border border-line bg-surface p-3 text-center"><p className="font-semibold text-xl">{n}</p><p className="text-[10px] text-muted mt-1">{label}</p></div>)}</div>}
    {!!recent.length&&<section className="space-y-2" aria-label="Recent updates"><h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted px-1">Latest updates</h3>{recent.map(e=><article key={e.id} className="rounded-2xl bg-surface border border-line p-4"><div className="flex justify-between gap-2"><h4 className="text-sm font-semibold truncate">{e.to_name||e.to_email}</h4><span className="text-[10px] text-muted shrink-0">{timeAgo(e.replied_at!)}</span></div><p className="text-sm text-muted leading-relaxed mt-2 whitespace-pre-wrap">{short(e.reply_text!,180)}</p></article>)}</section>}
    {!!drafts.length&&<details className="rounded-2xl border border-line bg-surface p-4"><summary className="cursor-pointer text-sm font-medium">Review drafts ({drafts.length})</summary><div className="space-y-3 mt-3">{drafts.map(e=><article key={e.id} className="border-t border-line pt-3"><h4 className="text-sm font-semibold">To {e.to_name||e.to_email}</h4><p className="text-xs text-muted mt-1">{e.subject} · {e.to_email}</p><p className="whitespace-pre-wrap text-sm my-3">{e.body}</p><Button onClick={()=>void press('esend:'+e.id)}>Send this draft</Button></article>)}</div></details>}
    {!!pending.length&&<details className="rounded-2xl border border-line bg-surface p-4" open={chat.status==='pending'}><summary className="cursor-pointer text-sm font-medium">Ready for review</summary>{pending.slice(-3).map(m=><div key={m.id} className="mt-3 text-sm"><Markdown text={short(m.text,500)}/><div className="flex flex-wrap gap-2 mt-2">{m.buttons?.flat().map(a=><Button key={a.data} variant="soft" onClick={()=>void press(a.data)}>{a.text}</Button>)}</div></div>)}</details>}
    <details className="rounded-2xl border border-line p-4"><summary className="cursor-pointer text-sm text-muted">More details</summary>
     <div className="space-y-4 mt-4 text-sm">
      <details><summary className="cursor-pointer">Original request</summary><p className="whitespace-pre-wrap text-muted mt-2">{k.instructions}</p></details>
      {!!emails.length&&<details><summary className="cursor-pointer">All correspondence ({emails.length})</summary>{emails.map(e=><details key={e.id} className="mt-3"><summary className="cursor-pointer">{e.to_name||e.to_email} · {e.status==='uncertain'?'Send unconfirmed':e.status}</summary><p className="whitespace-pre-wrap mt-2">{e.reply_text||e.body}</p></details>)}</details>}
      {!!k.reports.length&&<details><summary className="cursor-pointer">Full reports</summary>{k.reports.map(r=><details key={r.id} className="mt-3"><summary className="cursor-pointer text-muted">Report · {timeAgo(r.finished_at)}</summary><Markdown text={r.result}/></details>)}</details>}
      <details><summary className="cursor-pointer" onClick={()=>{if(!history.length)void api.jobBriefHistory(id).then(setHistory).catch(e=>setError(e.message));}}>Previous versions</summary>{history.map(v=><details key={v.source_revision} className="mt-2"><summary className="cursor-pointer text-muted">{timeAgo(v.created_at)} · Version {v.source_revision}</summary><Markdown text={JSON.parse(v.document).summary}/></details>)}</details>
      <p className="text-xs text-muted">Last checked {k.last_checked?timeAgo(k.last_checked):'not yet'}</p>
     </div>
    </details>
    <details className="px-1 pb-2"><summary className="cursor-pointer text-xs text-muted">Manage job</summary><div className="space-y-3 mt-3"><label className="text-xs text-muted" htmlFor="job-project">Project</label><select id="job-project" value={k.project_id??''} className="w-full rounded-xl bg-sunken p-3 text-sm" onChange={async e=>{try{await api.jobProject(id,e.target.value||null);await load();onChanged();}catch(e){setError((e as Error).message);}}}><option value="">Standalone job</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><p className="text-xs text-muted">{chat.schedule}</p><div className="flex flex-wrap gap-2"><Button variant="soft" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?'Updating…':'Update overview'}</Button><Button variant="ghost" onClick={async()=>{try{await api.jobPin(id,!chat.pinned);await load();onChanged();}catch(e){setError((e as Error).message);}}}>{chat.pinned?'Unpin':'Pin'}</Button>{chat.status==='active'&&<Button variant="ghost" onClick={()=>void press('pause:'+id)}>Pause</Button>}{chat.status==='paused'&&<Button variant="soft" onClick={()=>void press('resume:'+id)}>Resume</Button>}</div>{k.telegram.error&&<p className="text-xs text-danger">{k.telegram.error}</p>}</div></details>
   </>:<>
    {chat.messages.length>8&&!older&&<button className="text-xs text-muted w-full py-2" onClick={()=>setOlder(true)}>Show earlier messages</button>}
    {messages.map(m=><article key={m.id} className={`rounded-2xl p-4 text-sm leading-relaxed ${m.role==='you'?'bg-accent/10 ml-6':'bg-surface border border-line mr-3'}`}><Markdown text={short(m.text,500)}/>{m.text.length>500&&<details className="mt-2"><summary className="text-xs text-accent cursor-pointer">Read full message</summary><Markdown text={m.text}/></details>}{m.buttons&&<div className="flex flex-wrap gap-2 mt-3">{m.buttons.flat().map(a=><Button key={a.data} variant="soft" onClick={()=>void press(a.data)}>{a.text}</Button>)}</div>}<p className="text-[10px] text-muted mt-2">{timeAgo(m.created_at)}</p></article>)}
    {(sending||chat.busy)&&<p className="text-xs text-muted px-1">{sending?'Sending your instruction…':'Working on this job…'}</p>}<div ref={end}/>
   </>}
  </div>
  {error&&<p role="alert" className="text-xs text-danger pb-2">{error}</p>}
  <form className="shrink-0 flex gap-2 items-end pb-3 pt-2 border-t border-line/50" onSubmit={e=>{e.preventDefault();void send();}}><textarea aria-label="Message about this job" value={text} onChange={e=>setText(e.target.value)} rows={1} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Ask or give the next instruction…" className="flex-1 min-w-0 resize-none rounded-2xl bg-sunken px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent/30"/><Button type="submit" disabled={!text.trim()||sending}>Send</Button></form>
 </div>;
}

/** Every research chat, for the Tasks tab: pinned ones first; pin/unpin from here too. */
export function ResearchList({ jobs, onOpen, onNew, onChanged }: { jobs: JobChatRow[]; onOpen: (id: string) => void; onNew: () => void; onChanged: () => void }) {
  const sections=jobSections(jobs);
  const row=(j:JobChatRow)=><div key={j.id} className="rounded-2xl bg-sunken/60 p-3 flex items-start gap-3"><button onClick={()=>onOpen(j.id)} className="flex-1 min-w-0 text-left"><p className="text-[15px] font-medium truncate">{j.unread>0&&<span className="inline-block h-2 w-2 rounded-full bg-accent mr-1.5"/>}{j.title}</p><p className="text-xs text-muted">{STATUS[j.status]??j.status} · {j.schedule.split(' · ')[0]}</p>{j.current_summary&&<p className="text-xs text-muted line-clamp-2 mt-1 leading-relaxed">{j.current_summary}</p>}</button><Button variant="ghost" onClick={async()=>{await api.jobPin(j.id,!j.pinned);onChanged();}}>{j.pinned?'Unpin':'Pin'}</Button></div>;
  return <div className="space-y-3">
    <div className="flex items-center gap-2"><h3 className="font-medium flex-1">Projects & jobs</h3><Button onClick={onNew}>+ New job</Button></div>
    {!jobs.length&&<Empty>No jobs yet. Tell me what to work on in Telegram.</Empty>}
    {sections.active.map(g=><section key={g.id} className="space-y-2"><h4 className="text-sm font-medium text-muted">{g.title}</h4>{g.jobs.map(row)}</section>)}
    {!!sections.paused.length&&<details><summary className="cursor-pointer text-sm text-muted py-2">Paused ({sections.paused.length})</summary><div className="space-y-2">{sections.paused.map(row)}</div></details>}
    {!!sections.finished.length&&<details><summary className="cursor-pointer text-sm text-muted py-2">Finished & stopped ({sections.finished.length})</summary><div className="space-y-2">{sections.finished.map(row)}</div></details>}
  </div>;
}

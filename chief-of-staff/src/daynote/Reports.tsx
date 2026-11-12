import {useEffect,useState} from 'react';
import {call} from './data';
import {periodLabel,metricInfo} from '../../shared/daynote-reports';

type Item={id:string;kind:'week'|'month';period_start:string;period_end:string;status:string;direction:string|null;headline:string|null;ready_at:string|null};
type Focus={title:string;why:string;how:string;evidence:string;sources?:string[]};
type Report={id:string;kind:'week'|'month';period_start:string;period_end:string;status:string;stats:any;analysis:null|{direction:string;headline:string;summary:string;findings:{metric:string;verdict:string;text:string}[];focus:Focus[];watch?:string};sources:string[];model:string|null;ready_at:string|null};

const DIRECTION:Record<string,[string,string]>={better:['Heading the right way','good'],steady:['Holding steady','steady'],worse:['Slipping','bad'],mixed:['Mixed','mixed'],not_enough_data:['Not enough data','none']};
const VERDICT:Record<string,string>={better:'Better',worse:'Worse',steady:'Steady',unusual:'Off your usual',unknown:'Too few days'};
const host=(u:string)=>{try{return new URL(u).hostname.replace(/^www\./,'');}catch{return u;}};
const fmt=(v:number|null,d=1)=>v===null||v===undefined?'—':Number(v).toFixed(d);
const signed=(v:number|null,d=1)=>v===null||v===undefined?'':(v>0?'+':'')+Number(v).toFixed(d);
const dur=(m:number|null)=>m===null||m===undefined?'—':`${Math.floor(m/60)}h ${String(Math.round(m%60)).padStart(2,'0')}m`;

export function Reports(){
 const [items,setItems]=useState<Item[]|null>(null),[error,setError]=useState(''),[open,setOpen]=useState<string|null>(()=>new URLSearchParams(location.search).get('report'));
 useEffect(()=>{call('/reports').then(setItems).catch(e=>setError(e.message));},[]);
 if(open)return <ReportView id={open} onBack={()=>{setOpen(null);call('/reports').then(setItems).catch(()=>{});}}/>;
 const groups:[string,Item[]][]=[['Weekly',(items||[]).filter(i=>i.kind==='week')],['Monthly',(items||[]).filter(i=>i.kind==='month')]];
 return <section className="dn-reports"><h1>Reports</h1><p className="dn-muted">Each week (ready Sunday morning) and month (ready on the 1st), a look at which way your sleep and recovery are heading and what to focus on next.</p>
  {error&&<p role="alert" className="dn-error">{error}</p>}
  {!items&&!error&&<p className="dn-muted">Loading…</p>}
  {items&&!items.length&&<p className="dn-card">Your first reports are being prepared. They appear here when ready.</p>}
  {groups.map(([title,list])=>list.length>0&&<div key={title} className="dn-report-group"><h2>{title}</h2>{list.map(i=>{const [label,tone]=DIRECTION[i.direction||'']||['',''];return <button key={i.id} className="dn-card dn-report-item" onClick={()=>setOpen(i.id)}><span className="dn-report-period">{periodLabel(i.kind,i.period_start,i.period_end)}</span>{i.status==='ready'?<><span className={'dn-direction tone-'+tone}>{label}</span><span className="dn-report-headline">{i.headline}</span></>:<span className="dn-muted">{i.status==='failed'?'Could not be written yet. It will be retried.':'Being written…'}</span>}</button>;})}</div>)}
 </section>;
}

function ReportView({id,onBack}:{id:string;onBack:()=>void}){
 const [r,setR]=useState<Report|null>(null),[error,setError]=useState('');
 useEffect(()=>{call('/reports/'+encodeURIComponent(id)).then(setR).catch(e=>setError(e.message));},[id]);
 const a=r?.analysis,s=r?.stats,[label,tone]=DIRECTION[a?.direction||'']||['',''];
 const finding=(k:string)=>a?.findings?.find(f=>f.metric===k)?.text;
 return <section className="dn-reports dn-report"><button className="dn-trend-back" onClick={onBack}>← All reports</button>
  {error&&<p role="alert" className="dn-error">{error}</p>}
  {r&&<><p className="dn-eyebrow">{r.kind==='week'?'WEEKLY REPORT':'MONTHLY REPORT'}</p><h1>{periodLabel(r.kind,r.period_start,r.period_end)}</h1>
  {!a?<p className="dn-card">{r.status==='failed'?'This report could not be written yet. It will be retried automatically.':'This report is still being written. Check back in a few minutes.'}</p>:<>
   <div className="dn-card dn-report-verdict"><span className={'dn-direction tone-'+tone}>{label}</span><h2>{a.headline}</h2><p>{a.summary}</p>{a.watch&&<p className="dn-report-watch"><strong>Keep an eye on:</strong> {a.watch}</p>}</div>
   {a.focus?.length>0&&<><h2 className="dn-report-section">What to focus on {r.kind==='week'?'this week':'this month'}</h2>{a.focus.map((f,i)=><article key={i} className="dn-card dn-focus"><span className="dn-focus-number">{i+1}</span><h3>{f.title}</h3><p>{f.why}</p><p><strong>How:</strong> {f.how}</p><p className="dn-focus-evidence"><strong>The research:</strong> {f.evidence}</p>{(f.sources||[]).length>0&&<p className="dn-sources">{f.sources!.map(u=><a key={u} href={u} target="_blank" rel="noreferrer">{host(u)} ↗</a>)}</p>}</article>)}</>}
  </>}
  {s&&<><h2 className="dn-report-section">How each measure moved</h2><div className="dn-card dn-report-table">
   <p className="dn-fine">Compared with the {r.kind==='week'?'week':'month'} before. “Usual” is your median over the previous 60 days. Changes inside normal day-to-day variation count as steady.</p>
   {s.metrics.map((m:any)=>{const info=metricInfo(m.key),d=info?.decimals??1,isSleep=m.key==='sleep_minutes';return <div key={m.key} className="dn-report-row"><div className="dn-report-row-head"><strong>{m.label}</strong><span className={'dn-verdict v-'+m.judgment}>{VERDICT[m.judgment]}</span></div>
    <div className="dn-report-row-values"><span><b>{isSleep?dur(m.current):fmt(m.current,d)}</b>{!isSleep&&<small> {m.unit}</small>}<small className="dn-days"> · {m.days} days</small></span><span>Before {isSleep?dur(m.previous):fmt(m.previous,d)}{m.change!==null&&<small> ({isSleep?signed(m.change,0)+' min':signed(m.change,d)})</small>}</span><span>Usual {isSleep?dur(m.usual):fmt(m.usual,d)}</span></div>
    {finding(m.key)&&<p className="dn-report-note">{finding(m.key)}</p>}</div>;})}
   <div className="dn-report-row"><div className="dn-report-row-head"><strong>Sleep timing</strong></div><div className="dn-report-row-values"><span>Bedtime <b>{s.sleep_timing.average_bedtime||'—'}</b></span><span>Spread ±{s.sleep_timing.bedtime_spread_minutes??'—'} min{s.sleep_timing.previous_bedtime_spread_minutes!==null&&<small> (before ±{s.sleep_timing.previous_bedtime_spread_minutes})</small>}</span><span>Wake <b>{s.sleep_timing.average_wake||'—'}</b></span></div><div className="dn-report-row-values"><span>{s.sleep_timing.nights_under_6h} {s.sleep_timing.nights_under_6h===1?'night':'nights'} under 6h</span><span>{s.sleep_timing.nights_7h_or_more} {s.sleep_timing.nights_7h_or_more===1?'night':'nights'} 7h+</span><span>{s.sleep_timing.nights} nights recorded</span></div>{finding('sleep_timing')&&<p className="dn-report-note">{finding('sleep_timing')}</p>}</div>
   <div className="dn-report-row"><div className="dn-report-row-head"><strong>Exercise</strong></div><div className="dn-report-row-values"><span><b>{s.exercise.sessions}</b> sessions · {s.exercise.minutes} min</span><span>Before {s.exercise.previous_sessions} · {s.exercise.previous_minutes} min</span></div>{finding('exercise')&&<p className="dn-report-note">{finding('exercise')}</p>}</div>
   <div className="dn-report-row"><div className="dn-report-row-head"><strong>Journal</strong></div><div className="dn-report-row-values"><span><b>{s.journal.days_logged}</b> days logged</span><span>{s.journal.completed} completed</span><span>{s.journal.morning_ratings} morning ratings</span></div>{finding('journal')&&<p className="dn-report-note">{finding('journal')}</p>}</div>
  </div></>}
  {r&&r.sources?.length>0&&<details className="dn-card dn-report-sources"><summary>All sources ({r.sources.length})</summary><ul>{r.sources.map(u=><li key={u}><a href={u} target="_blank" rel="noreferrer">{host(u)}</a></li>)}</ul></details>}
  {a&&<p className="dn-fine">Numbers calculated by the app from your watch and journal. Written {r?.ready_at?new Date(r.ready_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'Asia/Jerusalem'}):''}{r?.model?' by GPT-6.1 Sol, checked against the research linked above':''}. Times are Israel time. Patterns in your own data, not a diagnosis.</p>}
  </>}
 </section>;
}

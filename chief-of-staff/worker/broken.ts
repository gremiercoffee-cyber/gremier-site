/** Alerts only when something is actually broken; no status screen. The computer being off is not "broken":
 * the home-computer helpers are only checked while at least one of them is reporting in. Each problem alerts
 * once (again after a day if it is still broken) and its notice clears itself when it is fixed. */
import type {Env} from './env';
import {all,first,run} from './db';
import {notify} from './push';

type Problem={key:string;title:string;body:string};
const MIN=60_000;
const seen=(v:unknown)=>{const t=typeof v==='number'?v:Date.parse(String(v??''));return Number.isFinite(t)?t:0;};
async function setting(env:Env,table:'settings'|'daynote_settings',key:string){const r=await first<{value:string}>(env,`SELECT value FROM ${table} WHERE key=?`,key).catch(()=>null);try{return r?JSON.parse(r.value):null;}catch{return r?.value??null;}}

export async function findProblems(env:Env,at=Date.now()):Promise<Problem[]>{return (await scan(env,at)).problems;}
async function scan(env:Env,at:number){
 const out:Problem[]=[];
 // Google: a connection that errors and hasn't synced for 2 hours needs reconnecting.
 for(const a of await all<{email:string;last_error:string|null;last_sync_at:string|null}>(env,'SELECT email,last_error,last_sync_at FROM google_accounts'))
  if(a.last_error&&at-seen(a.last_sync_at)>120*MIN)out.push({key:'google:'+a.email,title:`Google stopped syncing for ${a.email}`,body:'Email and calendar for this account are not updating. Reconnect it in Settings.'});
 // Home-computer helpers, judged only while the computer is on (any helper seen in the last 10 minutes).
 const relay=await first<{seen_at:number}>(env,'SELECT seen_at FROM cos_relay_status WHERE id=1').catch(()=>null);
 const helpers=[
  {key:'whatsapp',name:'WhatsApp helper',at:seen(await setting(env,'settings','bridge_last_seen')),fix:'WhatsApp messages are not reaching Chief of Staff. Check the WhatsApp add-on in Chrome.'},
  {key:'codex',name:'Codex helper',at:seen((await setting(env,'settings','codex_runner'))?.seen_at),fix:'Research and coding jobs cannot run on Codex. Restart the Codex helper (or the computer).'},
  {key:'relay',name:'ChatGPT relay',at:seen(relay?.seen_at),fix:'Longer requests from ChatGPT cannot reach the Codex chat; Claude takes them meanwhile.'},
  {key:'health',name:'Health journal helper',at:seen((await setting(env,'daynote_settings','ai_runner'))?.at),fix:'The health journal is using the API instead of your plans. Restart the computer to restart it.'},
 ].filter(h=>h.at>0);
 const computerOn=helpers.some(h=>at-h.at<10*MIN);
 if(computerOn)
  for(const h of helpers)if(at-h.at>45*MIN)out.push({key:'helper:'+h.key,title:`${h.name} stopped`,body:h.fix});
 // Claude backup failed to start recently.
 const claudeErr=seen(await setting(env,'settings','claude_routine_error'));
 if(claudeErr&&at-claudeErr<3*60*MIN)out.push({key:'claude',title:'Claude backup is not starting',body:'Jobs fall back to the API until it works. The Claude routine or its token may need renewing.'});
 // Invoice watcher (gremiercoffee@gmail.com): stopped, or not allowed to label mail yet.
 const inv=await import('./invoices').then(m=>m.invoiceHealth(env,at)).catch(()=>null);
 if(inv?.stale)out.push({key:'invoices',title:'Invoice check stopped',body:'New invoices in gremiercoffee@gmail.com are not being checked. Open Settings and reconnect Google if it shows an error.'});
 if(inv?.connected&&!inv.canLabel)out.push({key:'invoices:labels',title:'Invoice check: allow labels',body:'Invoices are found and you get the email, but they cannot go under "Invoice ?" in Gmail yet. Settings → Google → Allow invoice labels.'});
 return {problems:out,computerOn};
}

export async function checkBroken(env:Env,at=Date.now()){
 const state:Record<string,{at:number;nudge:string}>=(await setting(env,'settings','broken_alerts'))??{};
 const {problems,computerOn}=await scan(env,at),keys=new Set(problems.map(p=>p.key));
 let sent=0;
 for(const p of problems){
  const old=state[p.key];if(old&&at-old.at<24*60*MIN)continue;
  state[p.key]={at,nudge:await notify(env,'broken',p.title,p.body)};sent++;
 }
 // While the computer is off its helpers can't be judged: keep their alerts as they are.
 for(const [k,v] of Object.entries(state))if(!keys.has(k)&&(computerOn||!k.startsWith('helper:'))){await run(env,'UPDATE nudges SET dismissed=1 WHERE id=?',v.nudge);delete state[k];}
 await run(env,"INSERT OR REPLACE INTO settings (key,value) VALUES ('broken_alerts',?)",JSON.stringify(state));
 return {problems:problems.length,sent};
}

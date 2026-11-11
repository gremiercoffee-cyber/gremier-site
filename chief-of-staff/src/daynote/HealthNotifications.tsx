import {useEffect,useState} from 'react';
import {DAYNOTE_NOTIFICATION_DEFAULTS,type DaynotePreferences} from '../../shared/daynote-alerts';
import {call} from './data';

export async function connectHealthPush(requestPermission=false){
 if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('Notifications are not supported here. On iPhone, open Health Journal from your Home Screen.');
 const permission=requestPermission?await Notification.requestPermission():Notification.permission;
 if(permission!=='granted'){if(requestPermission)throw Error('Allow notifications in your phone settings to receive reminders.');return;}
 const {key}=await call('/notifications');if(!key)throw Error('Notifications are temporarily unavailable.');
 const registration=await navigator.serviceWorker.register('/daynote/sw.js',{scope:'/daynote/'});
 if(!registration.active)await new Promise<void>((resolve,reject)=>{const worker=registration.installing||registration.waiting;if(!worker)return reject(Error('Notifications are still starting. Please try again.'));const timer=setTimeout(()=>reject(Error('Notifications are still starting. Please try again.')),20000);const changed=()=>{if(worker.state==='activated'){clearTimeout(timer);worker.removeEventListener('statechange',changed);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);worker.removeEventListener('statechange',changed);reject(Error('Could not start notifications. Please try again.'));}};worker.addEventListener('statechange',changed);changed();});
 const raw=Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 const sub=await registration.pushManager.getSubscription()??await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:raw});
 await call('/notifications/subscribe','POST',sub.toJSON());return true;
}
export function HealthNotifications({preferences,onSaved}:{preferences?:Partial<DaynotePreferences>;onSaved:()=>Promise<unknown>}){
 const [p,setP]=useState({...DAYNOTE_NOTIFICATION_DEFAULTS,...preferences}),[status,setStatus]=useState<any>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{setP({...DAYNOTE_NOTIFICATION_DEFAULTS,...preferences});},[preferences]);
 const refresh=()=>call('/notifications').then(setStatus);
 useEffect(()=>{void refresh().catch(()=>{});},[]);
 async function action(f:()=>Promise<unknown>){setBusy(true);setMessage('');try{await f();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <section className="dn-card dn-notification-settings"><p className="dn-eyebrow">YOUR DAILY RHYTHM</p><h2>A gentle nudge, when it helps.</h2>
 <p>{status?.existing_devices&&!status?.health_devices?'Your existing Chief of Staff devices can receive these. Enable this app for a direct Health Journal notification.':'Morning, evening and meaningful changes. You choose what reaches you.'}</p>
 <button disabled={busy} onClick={()=>void action(async()=>{await connectHealthPush(true);await refresh();setMessage('Notifications are enabled on this device.');})}>Enable notifications on this device</button>
 <form onSubmit={e=>{e.preventDefault();void action(async()=>{await call('/preferences','PUT',p);await onSaved();setMessage('Your reminder settings are saved.');});}}>
 <label className="dn-toggle"><input type="checkbox" checked={p.morning_reminders} onChange={e=>setP({...p,morning_reminders:e.target.checked})}/> After I wake up: how do you feel, and any unfinished journal</label>
 <label className="dn-toggle"><input type="checkbox" checked={p.reminders} onChange={e=>setP({...p,reminders:e.target.checked})}/> Evening journal</label>
 <label className="dn-label">Evening · Israel time<input type="time" value={p.reminder_time} onChange={e=>setP({...p,reminder_time:e.target.value})}/></label>
 <label className="dn-toggle"><input type="checkbox" checked={p.health_alerts} onChange={e=>setP({...p,health_alerts:e.target.checked})}/> Unusual health patterns</label>
 <p className="dn-fine">A cautious heads-up when several readings move outside your own usual range. This can reflect poor sleep, stress, exercise, alcohol or illness; it cannot tell you whether you are getting sick. Daytime only, at most once per day.</p>
 <label className="dn-toggle"><input type="checkbox" checked={p.weekly_summary} onChange={e=>setP({...p,weekly_summary:e.target.checked})}/> Sunday evening summary</label>
 <p className="dn-fine">Completed check-ins are skipped. No notifications over Shabbos. Reminder times follow Asia/Jerusalem, including daylight saving.</p>
 <button className="dn-primary" disabled={busy}>Save notification settings</button></form>{message&&<p role="status">{message}</p>}</section>;
}

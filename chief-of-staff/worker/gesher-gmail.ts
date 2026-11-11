import type {Env} from './env';
import {accessToken} from './google';
import {ACCOUNT,type Mail} from './gesher-rules';
const URL='https://gmail.googleapis.com/gmail/v1/users/me';
const decode=(s:string)=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)));
const encode=(s:string)=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function parseMail(m:any):Mail{
 const h=(name:string)=>m.payload?.headers?.find((x:any)=>x.name.toLowerCase()===name.toLowerCase())?.value||'';
 const parts=(p:any,mime:string):string=>p.mimeType===mime&&p.body?.data?decode(p.body.data):(p.parts||[]).map((x:any)=>parts(x,mime)).filter(Boolean).join('\n');
 const text=parts(m.payload,'text/plain')||parts(m.payload,'text/html').replace(/<\/(?:tr|p|div)>|<br\s*\/?>/gi,'\n').replace(/<\/(?:td|th)>/gi,'\t').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
 return{id:m.id,threadId:m.threadId,at:Number(m.internalDate),from:h('From'),to:h('To'),subject:h('Subject'),text,auth:h('Authentication-Results'),sent:!!m.labelIds?.includes('SENT'),references:h('In-Reply-To')+' '+h('References'),auto:h('Auto-Submitted')};
}
export async function gmailAdapter(env:Env){
 const token=await accessToken(env,ACCOUNT);
 const api=async(path:string,init:RequestInit={})=>{const res=await fetch(URL+path,{...init,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error(`Gesher Gmail HTTP ${res.status}`);return res.json() as Promise<any>;};
 return{
  async list(q:string,page?:string|null){const p=new URLSearchParams({q,maxResults:'10'});if(page)p.set('pageToken',page);return api('/messages?'+p);},
  async get(id:string){return parseMail(await api('/messages/'+encodeURIComponent(id)+'?format=full'));},
  async thread(id:string){const r=await api('/threads/'+encodeURIComponent(id)+'?format=full');return(r.messages||[]).map(parseMail) as Mail[];},
  async send(to:string,subject:string,body:string,rfcId:string){
   if(/[\r\n]/.test(to+subject+rfcId))throw Error('Invalid mail headers');
   const raw=encode([`From: Yoni Grey <${ACCOUNT}>`,`To: ${to}`,`Subject: =?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`,`Message-ID: <${rfcId}>`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',btoa(String.fromCharCode(...new TextEncoder().encode(body)))].join('\r\n'));
   // Gmail send has no idempotency key. Never retry this POST after an uncertain outcome.
   return api('/messages/send',{method:'POST',body:JSON.stringify({raw})});
  }
 };
}
export type GmailAdapter=Awaited<ReturnType<typeof gmailAdapter>>;

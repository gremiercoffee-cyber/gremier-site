export const ACCOUNT='ygrey@aish.edu', REFERRAL='jzaldin@aish.edu', SENDER='drosman@aish.com', VERSION='gesher-v2';
export const SENDERS=[SENDER,'drosman@aish.edu'];
export const templates={
 clarification:{subject:'A quick question about the Aish Gesher newsletter',body:`Hi,

I received a notification that you unsubscribed from the Aish Gesher newsletter. Was that intentional, or did it happen by mistake?

If it was a mistake and you would like to receive the newsletter again, please let me know.

Best,
Yoni Grey`},
 referral:{subject:'Aish Gesher newsletter — resubscription request',body:`Hi,

{name} ({email}) asked to receive the Aish Gesher newsletter again.

Please arrange their resubscription.

Thank you,
Yoni Grey`}
};
export interface Mail {id:string;threadId:string;at:number;from:string;to:string;subject:string;text:string;auth:string;sent:boolean;references:string;auto:string;}
export function address(value:string){const v=value.trim();const match=v.match(/^[^<>\r\n]*<([^<>]+)>$/);const a=(match?match[1]:v).toLowerCase();return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(a)&&a.length<=254&&!a.includes('..')?a:null;}
export function authenticated(m:Mail,expected:string){const domain=expected.split('@')[1].replace(/\./g,'\\.');return address(m.from)===expected&&/^mx\.google\.com;/i.test(m.auth.trim())&&new RegExp(`dmarc=pass\\b[^;]*header\\.from=${domain}(?:[;\\s]|$)`,'i').test(m.auth);}
export function notification(m:Mail){
 if(m.sent||!SENDERS.some(sender=>authenticated(m,sender)))return{email:null,reason:'Unverified sender or authentication'};
 if(!m.to.toLowerCase().includes(ACCOUNT)||! /^(?:(?:fwd?|re):\s*)*Unsubscribe Notification\s*[-–]\s*Aish Gesher\s*$/i.test(m.subject))return{email:null,reason:'Wrong recipient or subject'};
 const dates=[...m.text.matchAll(/This person was just unsubscribed from the Aish Gesher list on (\d{2}\/\d{2}\/\d{4})\./gi)].map(x=>x[1]);
 if(dates.length!==1)return{email:null,reason:'Missing or ambiguous unsubscribe event'};
 const other=[...m.text.matchAll(/unsubscribed from the (.+?) list/gi)].some(x=>x[1].toLowerCase()!=='aish gesher');
 if(other)return{email:null,reason:'Conflicting newsletter context'};
 const values=[...m.text.matchAll(/^\s*Email[ \t:]+([^\s<>]+)[ \t]*$/gim)].map(x=>x[1]);
 const emails=[...new Set(values.map(address))];
 if(emails.length!==1||!emails[0]||[ACCOUNT,REFERRAL,...SENDERS].includes(emails[0]))return{email:null,reason:'Missing, invalid or ambiguous labelled subscriber address'};
 const [month,day,year]=dates[0].split('/').map(Number),d=new Date(Date.UTC(year,month-1,day));
 if(d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return{email:null,reason:'Invalid event date'};
 const names=[...new Set([...m.text.matchAll(/^[ \t]*Name[ \t:]+([^\r\n]+)$/gim)].map(x=>x[1].trim()))];
 const name=names.length===1&&names[0].length<=100&&/^[\p{L}\p{M}][\p{L}\p{M} .,'’\-]*$/u.test(names[0])?names[0]:null;
 return{email:emails[0],name,event:`${emails[0]}:${dates[0]}`,reason:null};
}
export function freshText(text:string){const out=[];for(const l of text.split(/\r?\n/)){if(/^\s*(On .+wrote:|[-_]{2,}|From:|Sent:|Subject:)/i.test(l))break;if(!/^\s*>/.test(l))out.push(l);}return out.join('\n').trim();}
export function decision(text:string):'intentional'|'resubscribe'|'review'{
 const t=freshText(text).toLowerCase().replace(/[’]/g,"'").replace(/\s+/g,' ').trim();
 // Exact short affirmative statements only: mixed, conditional, questions and free-form text require review.
 if(/^(?:yes[, ]+)?(?:it was intentional|i unsubscribed intentionally|please keep me unsubscribed|do not resubscribe me|don't resubscribe me|please do not contact me again)[.!]?$/.test(t))return'intentional';
 if(/^(?:yes[, ]+)?(?:it was a mistake|that was a mistake|i unsubscribed by mistake|i unsubscribed accidentally|please resubscribe me|please add me back(?: to the (?:aish gesher )?(?:newsletter|list))?|i would like to resubscribe)[.!]?$/.test(t))return'resubscribe';
 return'review';
}

export const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const kinds=new Set(['page_view','product_view','category_view','bar_builder','pack_builder','cart_add','cart_open','checkout_open','pay_click','payment_error','active','member_signin']);
const pages=new Set(['Home','Shop','Coffee bars','Account','Gift cards','About','Cart','Checkout','Payment','Order confirmation','Product','6-pack builder','Coffee bar builder','Store locations','Delivery information','Privacy & terms']);
export function cleanJourney(raw:any){
 if(raw?.consent!==true||!uuid(raw.visitor_id)||!uuid(raw.session_id)||!Array.isArray(raw.events)||!raw.events.length||raw.events.length>20)throw Error('invalid_batch');
 const events=raw.events.map((e:any)=>{
  if(!uuid(e.id)||!kinds.has(e.kind)||!pages.has(e.page))throw Error('invalid_event');
  return {id:e.id,kind:e.kind,page:e.page,product_id:uuid(e.product_id)?e.product_id:null,
   category:['bottles','minis','bulk','syrups','coffeebars','giftcards','all'].includes(e.category)?e.category:null,
   seconds:e.kind==='active'?Math.min(30,Math.max(0,Math.floor(Number(e.seconds)||0))):0};
 });
 let referrer='Direct';
 try{const u=new URL(raw.referrer);if(['http:','https:'].includes(u.protocol)&&!/(^|\.)gremiercoffee\.co\.il$/i.test(u.hostname))referrer=u.hostname.toLowerCase().slice(0,100);}catch{}
 return {visitor_id:raw.visitor_id,session_id:raw.session_id,events,referrer,
  device:['Phone','Tablet','Computer'].includes(raw.device)?raw.device:'Other',language:raw.language==='he'?'he':'en'};
}
export function dateRange(raw:any,now=new Date()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(now);
 const valid=(s:any)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 const end=raw.to||today,start=raw.from||new Date(now.getTime()-6*86400000).toISOString().slice(0,10);
 if(!valid(start)||!valid(end)||end<start||end>today||Date.parse(end)-Date.parse(start)>730*86400000)throw Error('invalid_period');
 return {start,end};
}
export function jerusalemMidnight(day:string){
 const target=Date.parse(day+'T00:00:00Z');let utc=target;
 const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<3;i++){const p=Object.fromEntries(f.formatToParts(new Date(utc)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));utc+=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
 return new Date(utc).toISOString();
}
// Analytics can never make a valid checkout fail. IDs are random and never affect pricing.
export async function linkJourneyOrder(db:any,context:any,orderId:string){
 if(!uuid(context?.visitor_id)||!uuid(context?.session_id))return;
 try{
  const signal=AbortSignal.timeout(700);
  const s=await db.from('web_sessions').select('id').eq('id',context.session_id).eq('visitor_id',context.visitor_id).gte('started_at',new Date(Date.now()-12*3600000).toISOString()).abortSignal(signal).maybeSingle();
  if(s.data)await db.from('web_order_links').insert({order_id:orderId,session_id:s.data.id}).abortSignal(signal);
 }catch{/* analytics is optional */}
}

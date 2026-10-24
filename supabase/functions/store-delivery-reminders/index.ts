import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {isServiceOrAdmin} from '../_shared/security.ts';
import {sendWebPushToAdmins} from '../_shared/web-push.ts';
import {storeDeliverySuggestions} from '../_shared/store-delivery-reminders.ts';
async function pages(makeQuery:any){const rows:any[]=[];for(let start=0;start<100000;start+=1000){const r=await makeQuery().range(start,start+999);if(r.error||!Array.isArray(r.data))throw Error('source_unavailable');rows.push(...r.data);if(r.data.length<1000)return rows;}throw Error('reporting_limit');}
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('POST required',{status:405});
 if(!await isServiceOrAdmin(req))return new Response('Forbidden',{status:403});
 try {
  const body=await req.json().catch(()=>({}));
  const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||keys.default||keys.service_role,{auth:{persistSession:false}});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const since=new Date(Date.parse(today+'T12:00:00Z')-180*86400000).toISOString().slice(0,10);
  const [stores,deliveries,jobs]=await Promise.all([
   pages(()=>db.from('stores').select('id,name,is_active').order('id')),
   pages(()=>db.from('store_deliveries').select('id,store_id,delivery_date,qty_large,qty_small,qty_unfiltered,qty_dairy_free,qty_syrup').gte('delivery_date',since).lte('delivery_date',today).order('id')),
   pages(()=>db.from('jobs').select('id,type,date,done,store_name').eq('done',false).eq('type','delivery').order('id'))
  ]);
  const candidates=storeDeliverySuggestions(stores,deliveries,jobs,today);
  if(body.dry_run===true)return Response.json({dry_run:true,candidates});
  let notified=0;
  for(const candidate of candidates){
   const claim=await db.from('store_delivery_alerts').insert({store_id:candidate.store_id,last_delivery_date:candidate.last_delivery_date,expected_date:candidate.expected_date});
   if(claim.error){if(claim.error.code==='23505')continue;throw Error('claim_failed');}
   const title=`${candidate.name} may need a delivery`;
   const text=`Usually every ${candidate.cycle_days} days; last delivered ${candidate.last_delivery_date}. Estimated next delivery: ${candidate.expected_date}. Check with the store before scheduling.`;
   const url='/admin.html?tab=orders';
   const log=await db.from('notification_log').insert({title,body:text,kind:'store_delivery_suggestion',url});
   if(log.error)throw Error('notification_log_failed');
   await sendWebPushToAdmins(db,{title,body:text,url,tag:`store-delivery-${candidate.store_id}-${candidate.last_delivery_date}`});
   notified++;
  }
  return Response.json({candidates:candidates.length,notified});
 }catch{return Response.json({error:'store_delivery_reminders_failed'},{status:500});}
});

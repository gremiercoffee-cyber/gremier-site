import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {isServiceOrAdmin} from '../_shared/security.ts';
import {cleanJourney,dateRange,jerusalemMidnight,uuid} from '../_shared/web-journey-model.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const key=()=>Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'))[0] as string;
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'POST_required'},405);
 try{
  const body=await req.text();if(body.length>18000)return json({error:'batch_too_large'},413);
  const raw=JSON.parse(body),db=createClient(Deno.env.get('SUPABASE_URL')!,key(),{auth:{persistSession:false}});
  if(['report','visitor'].includes(raw.action)){
   if(!await isServiceOrAdmin(req))return json({error:'admin_only'},403);
   const {start,end}=dateRange(raw);
   if(raw.action==='report'){
    const r=await db.rpc('web_report',{from_day:start,to_day:end,testing:raw.testing===true,visitor_offset:Math.max(0,Math.min(100000,Math.floor(Number(raw.visitor_offset)||0)))});
    if(r.error)throw Error('report_unavailable');
    const ids=(r.data.breakdowns||[]).filter((x:any)=>x.dimension==='product').map((x:any)=>x.label).filter(uuid);
    const p=ids.length?await db.from('products').select('id,name_en').in('id',ids):{data:[]};
    return json({...r.data,products:p.data||[],from:start,to:end});
   }
   if(!uuid(raw.visitor_id))return json({error:'invalid_visitor'},400);
   const nextDay=new Date(Date.parse(end+'T12:00:00Z')+86400000).toISOString().slice(0,10);
   const sessions=await db.from('web_sessions').select('*').eq('visitor_id',raw.visitor_id).eq('is_test',raw.testing===true).gte('started_at',jerusalemMidnight(start)).lt('started_at',jerusalemMidnight(nextDay)).order('started_at',{ascending:false}).limit(50);
   if(sessions.error)throw Error('journey_unavailable');
   const ids=(sessions.data||[]).map(s=>s.id);
   const events=ids.length?await db.from('web_events').select('id,session_id,sequence,created_at,kind,page,product_id,category,seconds').in('session_id',ids).neq('kind','active').order('sequence').limit(3001):{data:[]};
   if(events.error)throw Error('journey_unavailable');
   const pids=[...new Set((events.data||[]).map(e=>e.product_id).filter(Boolean))];
   const products=pids.length?await db.from('products').select('id,name_en').in('id',pids):{data:[]};
   return json({sessions:sessions.data,events:(events.data||[]).slice(0,3000),products:products.data||[],truncated:(events.data||[]).length>3000});
  }
  if(raw.action!=='collect')return json({error:'unsupported_action'},400);
  const origin=req.headers.get('origin')||'';
  if(!/^https:\/\/(www\.)?gremiercoffee\.co\.il$/.test(origin)&&!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))return json({error:'origin_not_allowed'},403);
  if(/bot|spider|crawler|headless/i.test(req.headers.get('user-agent')||''))return json({ok:true,ignored:true});
  const p=cleanJourney(raw);let member=null;
  const token=(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
  if(token&&token.split('.').length===3){const u=await db.auth.getUser(token);if(u.data?.user)member=u.data.user.id;}
  const result=await db.rpc('web_collect',{p,member,testing:origin.startsWith('http:')});
  if(result.error)throw Error('collection_unavailable');
  return json(result.data);
 }catch(e){const error=e instanceof Error?e.message:'request_failed';return json({error:/^[a-z_]+$/.test(error)?error:'request_failed'},400);}
});

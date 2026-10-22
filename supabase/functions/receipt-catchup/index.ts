import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {isServiceOrAdmin} from '../_shared/security.ts';
import {runReceiptCatchup} from '../_shared/receipt-catchup.ts';
Deno.serve(async req=>{
  if(req.method!=='POST')return new Response('POST required',{status:405});
  if(!await isServiceOrAdmin(req))return new Response('Forbidden',{status:403});
  try {
    const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||keys.default||keys.service_role;
    const db=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false}});
    return Response.json(await runReceiptCatchup(db));
  } catch {return Response.json({error:'receipt_catchup_failed'},{status:500});}
});

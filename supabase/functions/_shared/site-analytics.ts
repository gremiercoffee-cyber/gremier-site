/** Calendar days in Jerusalem, shared by traffic and checkout activity. */
export function siteAnalyticsPeriod(daysIn: unknown, now = new Date()) {
 const days=[1,7,30].includes(Number(daysIn))?Number(daysIn):7;
 const format=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const parts=(date:Date)=>Object.fromEntries(format.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const local=parts(now),target=Date.UTC(local.year,local.month-1,local.day-(days-1));
 let utc=target;
 // Resolve the UTC offset at the start date itself, including DST transitions.
 for(let i=0;i<3;i++){const p=parts(new Date(utc));utc+=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
 return {days,since:new Date(utc).toISOString(),until:now.toISOString(),time_zone:'Asia/Jerusalem'};
}
export async function siteShoppingActivity(sb:any,period:ReturnType<typeof siteAnalyticsPeriod>){
 try{
  const browsers=async(kind:string)=>{
   const result=await sb.from('site_events').select('sid').eq('kind',kind).gte('created_at',period.since).lte('created_at',period.until).limit(20000);
   if(result.error||result.data?.length===20000)throw Error('Activity unavailable');
   return new Set((result.data||[]).map((r:any)=>r.sid)).size;
  };
  const result=await sb.from('orders').select('payment_status,customer_name').eq('source','website').gte('created_at',period.since).lte('created_at',period.until);
  if(result.error)throw Error('Orders unavailable');
  const real=(result.data||[]).filter((o:any)=>!/^test\b/i.test(o.customer_name||''));
  const [cart,checkout,pay]=await Promise.all([browsers('cart_add'),browsers('checkout_open'),browsers('pay_click')]);
  return {cart,checkout,pay,orders:real.length,paid:real.filter((o:any)=>o.payment_status==='paid').length};
 }catch{return {error:'Shopping activity is temporarily unavailable.'};}
}

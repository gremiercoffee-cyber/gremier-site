const dayMs=86400000;
const stamp=(date:string)=>Date.parse(date+'T12:00:00Z');
const iso=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const median=(values:number[])=>{const v=values.slice().sort((a,b)=>a-b),n=v.length;return n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2;};
const name=(value:unknown)=>String(value||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function storeDeliverySuggestions(stores:any[],deliveries:any[],jobs:any[],today:string){
 const now=stamp(today),result:any[]=[];
 for(const store of stores){
  if(store.is_active===false)continue;
  const dates=[...new Set<string>(deliveries.filter(d=>d.store_id===store.id&&d.delivery_date<=today&&
   (!['large','small','dairy_free','unfiltered','syrup'].some(k=>d['qty_'+k]!=null)||
    ['large','small','dairy_free','unfiltered','syrup'].reduce((s,k)=>s+Number(d['qty_'+k]||0),0)>0)
  ).map(d=>String(d.delivery_date).slice(0,10)))].filter(d=>Number.isFinite(stamp(d))).sort().slice(-6);
  if(dates.length<4)continue;
  const gaps=dates.slice(1).map((d,i)=>(stamp(d)-stamp(dates[i]))/dayMs),cycle=Math.round(median(gaps));
  if(cycle<3||cycle>60||gaps.some(g=>g<cycle*.5||g>cycle*2))continue;
  const last=dates.at(-1)!,due=iso(stamp(last)+cycle*dayMs),daysUntil=Math.round((stamp(due)-now)/dayMs);
  if(daysUntil>1||daysUntil < -7)continue;
  const scheduled=jobs.some(j=>!j.done&&j.type==='delivery'&&j.date>=last&&j.date<=iso(now+14*dayMs)&&
   (j.store_id===store.id||name(j.store_name)===name(store.name)));
  if(scheduled)continue;
  result.push({store_id:store.id,name:store.name,last_delivery_date:last,expected_date:due,cycle_days:cycle});
 }
 return result.sort((a,b)=>a.expected_date.localeCompare(b.expected_date));
}

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
  ).map(d=>String(d.delivery_date).slice(0,10)))].filter(d=>Number.isFinite(stamp(d))).sort();
  // Deliveries within 2 days of each other are one restock (a top-up), not two cycles.
  const restocks:string[]=[];
  for(const d of dates)if(!restocks.length||(stamp(d)-stamp(restocks.at(-1)!))/dayMs>2)restocks.push(d);else restocks[restocks.length-1]=d;
  if(restocks.length<4)continue;
  // The whole loaded history (180 days), not just the last few gaps: a recent burst of
  // deliveries can't redefine the store's usual cycle, and one long gap doesn't either.
  const gaps=restocks.slice(1).map((d,i)=>(stamp(d)-stamp(restocks[i]))/dayMs),cycle=Math.round(median(gaps));
  const usual=gaps.filter(g=>g>=cycle*.5&&g<=cycle*2).length;
  if(cycle<3||cycle>60||usual<3||usual<gaps.length*.6)continue;
  const last=restocks.at(-1)!,due=iso(stamp(last)+cycle*dayMs),daysUntil=Math.round((stamp(due)-now)/dayMs);
  if(daysUntil>1||daysUntil < -7)continue;
  const scheduled=jobs.some(j=>!j.done&&j.type==='delivery'&&j.date>=last&&j.date<=iso(now+14*dayMs)&&
   (j.store_id===store.id||name(j.store_name)===name(store.name)));
  if(scheduled)continue;
  result.push({store_id:store.id,name:store.name,last_delivery_date:last,expected_date:due,cycle_days:cycle});
 }
 return result.sort((a,b)=>a.expected_date.localeCompare(b.expected_date));
}

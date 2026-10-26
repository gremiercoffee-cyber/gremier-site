const coffeeNames:Record<string,string>={classic:'Classic',unfiltered:'Unfiltered',houseBlend:'House Blend',colombia:'Colombia',decaf:'Decaf'};
/** Phone widget: show all ready drains first; otherwise show the next scheduled drain. */
export function widgetDrains(rows:any[],now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
 const today=`${p.year}-${p.month}-${p.day}`,localNow=`${today}T${p.hour}:${p.minute}`;
 const key=(x:any)=>x.date+'T'+(x.time||'00:00').slice(0,5);
 const pending=rows.filter(x=>coffeeNames[x.product]&&[1,1.5,2,3].includes(Number(x.kg))&&(x.source_brew_id||/^drain\b/i.test(x.label||''))).sort((a,b)=>key(a).localeCompare(key(b)));
 const ready=pending.filter(x=>key(x)<=localNow);
 const shown=ready.length?ready:pending.slice(0,1);if(!shown.length)return null;
 return {title:ready.length?'Ready to drain':'Next drain',buttons:shown.map(x=>({id:'drain_'+x.id,icon:'🧪',label:coffeeNames[x.product],sub:(x.date===today?'Today':x.date)+' '+(x.time||'').slice(0,5),kind:'form',section:'Draining',action:'complete_drain',args:{job_id:x.id},title:'Drain '+coffeeNames[x.product],submit:'Mark drained',fields:[]}))};
}

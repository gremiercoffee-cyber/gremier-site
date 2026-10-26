import {sendWebPushToAdmins} from './web-push.ts';
const names:Record<string,string>={classic:'Classic',unfiltered:'Unfiltered',houseBlend:'House Blend',colombia:'Colombia',decaf:'Decaf'};
const beanLimits:Record<string,number>={classic:9,houseBlend:3,colombia:3,decaf:1};
export function productionAlerts(stock:any,jobs:any[],today:string){
 const alerts:any[]=[],until=new Date(new Date(today+'T12:00:00Z').getTime()+14*86400000).toISOString().slice(0,10);
 const pending=jobs.filter(j=>!j.done&&j.date<=until);
 for(const b of stock.beans)if(Number(b.kg)<=beanLimits[b.type]&&!b.ordered)alerts.push({key:'beans:'+b.type,title:`Order ${names[b.type]||b.type} beans`,body:`${b.kg}kg left. Consider placing an order.`,url:'/admin?tab=stock'});
 const titleOf=(pid:string)=>{const product=(stock.products||[]).find((p:any)=>p.id===pid||(p.variations||[]).some((v:any)=>v.type==='ops_settings'&&v.stock_key===pid));return product?.name_en||pid.replaceAll('_',' ');};
 const textOf=(pid:string)=>pid+' '+titleOf(pid).toLowerCase();
 const needed:Record<string,number>={},scheduled:Record<string,number>={};
 for(const j of pending){
  if(j.type==='delivery'){
   for(const [pid,q] of Object.entries(j.quantities||{}))needed[pid]=(needed[pid]||0)+Number(q);
   for(const type of j.jerry_cans||[]){const pid=({classic:'jerry_can',houseBlend:'jerry_can_houseblend',colombia:'jerry_can_colombia',decaf:'jerry_can_decaf'} as any)[type];if(pid)needed[pid]=(needed[pid]||0)+1;}
  }
  if(j.type==='bottling'){const units=/mini/.test(textOf(j.product))?Number(j.liters)*4:/jerry/.test(textOf(j.product))?Number(j.liters)/5:Number(j.liters);scheduled[j.product]=(scheduled[j.product]||0)+units;}
 }
 const required:Record<string,number>={},yieldByType:Record<string,number>={};
 const recipe=(key:string)=>{const pid=textOf(key);return ({coffee:/unfilter/.test(pid)?'unfiltered':/house|blend/.test(pid)?'houseBlend':/colombia/.test(pid)?'colombia':/decaf/.test(pid)?'decaf':'classic',liters:/mini/.test(pid)?.25:/jerry/.test(pid)?5:1,ratio:['vanilla_mini','original_mini','caramel_mini'].includes(key)?.29:/unfilter/.test(pid)?.4:/house|blend|colombia|decaf/.test(pid)?.5:.43});};
 for(const j of pending){if(j.type==='bottling'){const r=recipe(j.product);required[r.coffee]=(required[r.coffee]||0)+Number(j.liters||0)*r.ratio;}
  if(j.type==='drain'||j.type==='brew'&&!pending.some(d=>d.type==='drain'&&d.source_brew_id===j.id)){const liters=({'1':6.4,'1.5':9.5,'2':12.7,'3':19} as any)[String(j.kg)]||0;yieldByType[j.product]=(yieldByType[j.product]||0)+liters;}}
 for(const [pid,units] of Object.entries(needed)){if(!/mini|liter|blend|jerry/.test(textOf(pid))||/syrup|dispenser/.test(textOf(pid)))continue;const available=Number(stock.inventory.find((i:any)=>i.product===pid)?.qty||0)+(scheduled[pid]||0),gap=Math.max(0,units-available),r=recipe(pid);required[r.coffee]=(required[r.coffee]||0)+gap*r.liters*r.ratio;}
 for(const c of stock.concentrate){const demand=required[c.type]||0,available=Number(c.liters)+(yieldByType[c.type]||0);if(available>=Math.max(5,demand))continue;
  alerts.push({key:'concentrate:'+c.type,title:`Brew ${names[c.type]||c.type}`,body:`${c.liters}L concentrate left.${demand>Number(c.liters)?` Upcoming production needs about ${demand.toFixed(1)}L.`:''} Schedule a brew?`,url:`/admin?tab=production&production_plan=brew&product=${encodeURIComponent(c.type)}`});}
 for(const i of stock.inventory){
  if(!/mini|liter|blend|jerry/.test(textOf(i.product))||/syrup|dispenser|dairy_free/.test(textOf(i.product)))continue;
  const threshold=/mini/.test(textOf(i.product))?24:/jerry/.test(textOf(i.product))?1:12;
  const target=Math.max(threshold,needed[i.product]||0),gap=Math.ceil(target-Number(i.qty)-(scheduled[i.product]||0));
  if(gap<=0)continue;
  const label=titleOf(i.product);
  alerts.push({key:'bottle:'+i.product,title:`Bottle ${label}`,body:`${i.qty} in stock. ${needed[i.product]?`Upcoming deliveries need ${needed[i.product]}.`:'Stock is low.'} Schedule ${gap} more?`,url:`/admin?tab=production&production_plan=bottle&product=${encodeURIComponent(i.product)}&units=${gap}`});
 }
 return alerts;
}
export async function notifyProductionNeeds(sb:any,today:string){
 const tables=['beans','concentrate','inventory','jobs','products'];
 const result=await Promise.all(tables.map(t=>t==='jobs'?sb.from(t).select('*').eq('done',false):sb.from(t).select('*')));if(result.some(r=>r.error))throw Error('Production alert data unavailable');
 const stock=Object.fromEntries(tables.map((t,i)=>[t,result[i].data||[]]));
 const alerts=productionAlerts(stock,stock.jobs,today),active=new Set(alerts.map(a=>a.key));
 const {data:states,error}=await sb.from('production_alert_state').select('key,active');if(error)throw error;
 for(const state of states||[])if(state.active&&!active.has(state.key))await sb.rpc('claim_production_alert',{p_key:state.key,p_active:false});
 for(const a of alerts){const {data:claim,error}=await sb.rpc('claim_production_alert',{p_key:a.key,p_active:true});if(error)throw error;if(!claim)continue;
  const {error:logError}=await sb.from('notification_log').insert({title:a.title,body:a.body,url:a.url,kind:'production_low_stock'});if(logError){await sb.rpc('claim_production_alert',{p_key:a.key,p_active:false});throw logError;}
  await sendWebPushToAdmins({title:a.title,body:a.body,url:a.url,tag:'production-'+a.key,actions:[{action:'schedule_production',title:a.key.startsWith('beans:')?'View beans':'Schedule'}]});
 }
 return alerts.length;
}

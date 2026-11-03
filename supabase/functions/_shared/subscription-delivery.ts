/** Monthly subscriptions arrive in one of two windows each month, chosen at checkout. */
export const SUBSCRIPTION_WINDOWS:Record<string,{start:number,end:number,label:string}>={early:{start:1,end:5,label:'1st–5th of the month'},mid:{start:15,end:20,label:'15th–20th of the month'}};
/** The next date inside a monthly window, on or after today: today itself while the window is open. */
export function subscriptionWindowDate(window: string, today: string): string|null {
 const w=SUBSCRIPTION_WINDOWS[window];if(!w)return null;
 const base=new Date(today+'T12:00:00Z'),day=base.getUTCDate();
 if(day>=w.start&&day<=w.end)return today;
 return new Date(Date.UTC(base.getUTCFullYear(),base.getUTCMonth()+(day>w.end?1:0),w.start,12)).toISOString().slice(0,10);
}
/** Delivery targets are independent of card billing dates and are not guaranteed appointments. */
export function subscriptionDeliveryRule(interval: string, chosen: unknown, today: string, window?: unknown) {
 // New monthly subscriptions must pick a window (callers pass it); weekly ones keep the date rule below.
 if(interval==='monthly'&&window!==undefined){
  const w=String(window||'');if(!SUBSCRIPTION_WINDOWS[w])throw Error('Choose when your monthly delivery should arrive: the 1st–5th or the 15th–20th');
  return {mode:'window',window:w,first_date:subscriptionWindowDate(w,today),interval};
 }
 const date=String(chosen||'').trim();
 if(!date)return {mode:'billing'};
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||date<today)throw Error('Choose a valid future subscription delivery date');
 const parsed=new Date(date+'T12:00:00Z');
 return {mode:'preferred',first_date:date,billing_anchor:today,day:parsed.getUTCDate(),weekday:parsed.getUTCDay(),interval};
}
export function subscriptionDeliveryTarget(info: Record<string,unknown>, today: string): string|null {
 if(info.delivery_type==='pickup')return null;
 const subscription=info.subscription as Record<string,unknown>|undefined;
 const rule=subscription?.delivery_schedule as Record<string,unknown>|undefined;
 if(!rule)return null; // Older subscriptions retain their existing scheduling behavior.
 if(rule.mode==='billing')return today;
 if(rule.mode==='window')return subscriptionWindowDate(String(rule.window),today);
 if(rule.mode!=='preferred')return null;
 if(!info.recurring_child&&typeof rule.first_date==='string'&&rule.first_date>=today)return rule.first_date;
 const base=new Date(today+'T12:00:00Z');
 if(info.recurring_child&&typeof rule.billing_anchor==='string'&&typeof rule.first_date==='string'){
  const anchor=new Date(rule.billing_anchor+'T12:00:00Z'),first=new Date(rule.first_date+'T12:00:00Z');
  if(Number.isFinite(anchor.getTime())&&Number.isFinite(first.getTime())){
   let target:string;
   if(subscription?.interval==='weekly'){
    const cycles=Math.max(1,Math.floor((base.getTime()-anchor.getTime())/(7*86400000)));
    first.setUTCDate(first.getUTCDate()+cycles*7);target=first.toISOString().slice(0,10);
   }else{
    const cycles=Math.max(1,(base.getUTCFullYear()-anchor.getUTCFullYear())*12+base.getUTCMonth()-anchor.getUTCMonth());
    const year=first.getUTCFullYear(),month=first.getUTCMonth()+cycles,day=Number(rule.day);
    target=new Date(Date.UTC(year,month,Math.min(day,new Date(Date.UTC(year,month+1,0)).getUTCDate()),12)).toISOString().slice(0,10);
   }
   return target<today?today:target;
  }
 }

 if(subscription?.interval==='weekly'){
  const weekday=Number(rule.weekday);if(!Number.isInteger(weekday)||weekday<0||weekday>6)return null;
  base.setUTCDate(base.getUTCDate()+(weekday-base.getUTCDay()+7)%7);return base.toISOString().slice(0,10);
 }
 const day=Number(rule.day);if(!Number.isInteger(day)||day<1||day>31)return null;
 const candidate=(year:number,month:number)=>new Date(Date.UTC(year,month,Math.min(day,new Date(Date.UTC(year,month+1,0)).getUTCDate()),12)).toISOString().slice(0,10);
 const current=candidate(base.getUTCFullYear(),base.getUTCMonth());
 return current>=today?current:candidate(base.getUTCFullYear(),base.getUTCMonth()+1);
}
export const SUBSCRIPTION_DELIVERY_NOTE='Target date only: delivery may arrive a few days before or after. Billing dates do not change.';

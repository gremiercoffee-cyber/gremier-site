(function(root){
 'use strict';
 const syrup=p=>p.category==='syrups'||/syrup|סירופ/i.test((p.name_en||'')+' '+(p.name_he||''));
 const eligible=p=>!!p&&p.is_active!==false&&!p.is_subscription&&p.category!=='subscriptions'&&!p.is_coffee_bar&&['bottles','minis','bulk','syrups'].includes(p.category);
 const large=p=>p.category==='bulk'||/\b5\s*(?:l\b|lit[er]+)|5\s*ליטר|ג.?ריקן/i.test((p.name_en||'')+' '+(p.name_he||''));
 function quote(chosen,products){
  const byId=new Map(products.map(p=>[String(p.id),p])),seen=new Set(),contents=[];let regular=0,total=0,coffeeCount=0,hasLarge=false;
  if(!Array.isArray(chosen)||!chosen.length||chosen.length>30)throw Error('Choose coffee for your subscription');
  for(const item of chosen){
   const id=String(item.product_id||''),p=byId.get(id),qty=Number(item.qty);
   if(!eligible(p)||seen.has(id)||!Number.isInteger(qty)||qty<1||qty>20)throw Error('Invalid subscription item');
   seen.add(id);const raw=Math.round(Number(p.price)*100);if(!Number.isSafeInteger(raw)||raw<=0)throw Error('Invalid subscription price');
   const price=syrup(p)?raw:Math.round(raw*.9);regular+=raw*qty;total+=price*qty;
   if(!syrup(p)){coffeeCount+=qty;hasLarge=hasLarge||large(p);}
   contents.push({product_id:id,name_en:p.name_en,name_he:p.name_he||p.name_en,price:price/100,regular_price:raw/100,qty});
  }
  if(!coffeeCount)throw Error('Add coffee alongside your syrup subscription');
  return {contents,total:total/100,regular:regular/100,deliveryEligible:coffeeCount>=2||hasLarge,coffeeCount};
 }
 const api={syrup,eligible,large,quote};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.GremierSubscriptionModel=api;
})(typeof window==='undefined'?globalThis:window);

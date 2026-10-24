const {test}=require('node:test'),assert=require('node:assert/strict');
const {storeDeliverySuggestions:predict}=require('../supabase/functions/_shared/store-delivery-reminders.ts');
const stores=[{id:'s',name:'Example Store',is_active:true}];
const deliveries=['2026-10-01','2026-10-08','2026-10-15','2026-10-22'].map(delivery_date=>({store_id:'s',delivery_date,qty_large:12}));
test('consistent delivery history produces a suggestion near the next due date',()=>{
 assert.equal(predict(stores,deliveries,[],'2026-10-27').length,0);
 assert.deepEqual(predict(stores,deliveries,[],'2026-10-28')[0],{store_id:'s',name:'Example Store',last_delivery_date:'2026-10-22',expected_date:'2026-10-29',cycle_days:7});
 assert.equal(predict(stores,deliveries,[],'2026-10-29').length,1);
});
test('insufficient, inactive, irregular, and stale stores do not generate guessed reminders',()=>{
 assert.equal(predict(stores,deliveries.slice(1),[],'2026-10-28').length,0);
 assert.equal(predict([{...stores[0],is_active:false}],deliveries,[],'2026-10-28').length,0);
 assert.equal(predict(stores,[{...deliveries[0],delivery_date:'2026-08-01'},...deliveries.slice(1)],[],'2026-10-28').length,0);
 assert.equal(predict(stores,deliveries,[],'2026-11-20').length,0);
});
test('a scheduled delivery suppresses the suggestion but completed or unrelated jobs do not',()=>{
 const job={type:'delivery',store_name:' example   STORE ',date:'2026-10-29',done:false};
 assert.equal(predict(stores,deliveries,[job],'2026-10-28').length,0);
 assert.equal(predict(stores,deliveries,[{...job,done:true}],'2026-10-28').length,1);
 assert.equal(predict(stores,deliveries,[{...job,store_name:'Other'}],'2026-10-28').length,1);
 assert.equal(predict(stores,deliveries,[{...job,date:'2026-10-01'}],'2026-10-28').length,1);
});
test('same-day duplicates, empty deliveries and future deliveries do not distort cadence',()=>{
 const extra=[...deliveries,{...deliveries[2]},{...deliveries[0],delivery_date:'2026-10-23',qty_large:0},{...deliveries[0],delivery_date:'2026-11-01'}];
 assert.deepEqual(predict(stores,extra,[],'2026-10-28'),predict(stores,deliveries,[],'2026-10-28'));
});
test('AI briefing is off by default and cannot contact the AI provider',async()=>{
 global.Deno={env:{get:()=>undefined}};let calls=0;const original=global.fetch;global.fetch=()=>{calls++;throw Error('must not call');};
 try{const {generateAiBriefing}=require('../supabase/functions/_shared/daily-briefing.ts');assert.equal(await generateAiBriefing({}),null);assert.equal(calls,0);}finally{global.fetch=original;}
});

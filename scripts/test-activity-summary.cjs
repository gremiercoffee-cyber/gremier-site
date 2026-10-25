const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {siteAnalyticsPeriod,siteShoppingActivity}=require('../supabase/functions/_shared/site-analytics.ts');
test('Today and seven-day windows start at Jerusalem midnight through the DST change',()=>{
 const today=siteAnalyticsPeriod(1,new Date('2026-10-25T15:00:00Z'));
 assert.equal(today.since,'2026-10-24T21:00:00.000Z');assert.equal(today.until,'2026-10-25T15:00:00.000Z');
 assert.equal(siteAnalyticsPeriod(1,new Date('2026-10-26T15:00:00Z')).since,'2026-10-25T22:00:00.000Z');
 assert.equal(siteAnalyticsPeriod(7,new Date('2026-10-25T15:00:00Z')).since,'2026-10-18T21:00:00.000Z');
});
test('shopping actions count browsers and orders separately within the same dates',async()=>{
 const period=siteAnalyticsPeriod(1,new Date('2026-10-25T15:00Z')),bounds=[];
 const sb={from(table){let kind;const q={select(){return q},eq(key,value){if(key==='kind')kind=value;return q},gte(key,value){bounds.push(value);return q},lte(key,value){bounds.push(value);return q},limit(){return q},then(resolve){return Promise.resolve({data:table==='orders'?[{payment_status:'paid',customer_name:'Real'},{payment_status:'unpaid',customer_name:'Real'},{payment_status:'paid',customer_name:'Test fixture'}]:[{sid:'one'},{sid:'one'},{sid:kind}]}).then(resolve)}};return q}};
 const data=await siteShoppingActivity(sb,period);assert.equal(data.orders,2);assert.equal(data.paid,1);assert.equal(data.cart,2);assert(bounds.every(v=>v===period.since||v===period.until));
});
test('database errors show unavailable instead of false zero activity',async()=>{
 const q={select(){return q},eq(){return q},gte(){return q},lte(){return q},then(resolve){return Promise.resolve({error:{message:'offline'}}).then(resolve)}};
 assert.match((await siteShoppingActivity({from:()=>q},siteAnalyticsPeriod(1))).error,/unavailable/);
});
async function render(data){const nodes={actList:{},visitorsCard:{},visDays:{value:'1'},visBody:{},'tab-activity':{style:{display:'none'}}},window={showTab(){}};
 vm.runInNewContext(fs.readFileSync('admin-visitors.js','utf8'),{window,document:{getElementById:id=>nodes[id]},callAdminFunction:async()=>({res:{ok:true},data}),Date,Number,Math});
 await window.adminLoadVisitors();return nodes.visBody.innerHTML;
}
test('zero traffic and nonzero shopping never create an impossible conversion funnel',async()=>{
 const html=await render({configured:true,visits:0,views:0,funnel:{orders:2,paid:1,cart:7,checkout:6,pay:2}});
 assert.match(html,/Orders placed/);assert.match(html,/Paid orders/);assert.match(html,/Shopping actions · browsers/);
 assert(!html.includes('From visit to order'));assert(!html.includes('86%'));assert.match(html,/0 recorded visits/);
});
test('unavailable traffic does not hide valid order and shopping counts',async()=>{
 const html=await render({configured:false,funnel:{orders:2,paid:1,cart:7,checkout:6,pay:2}});
 assert.match(html,/Paid orders/);assert.match(html,/traffic · unavailable/);
});

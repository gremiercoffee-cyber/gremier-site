const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../admin-sales.js');
const products=[{id:'mini',name_en:'Classic Mini 4-Pack',category:'minis',variations:[{type:'ops_settings',pack_size:4}]},{id:'large',name_en:'Classic',category:'bottles'},{id:'syrup',name_en:'Vanilla Syrup',category:'bottles'},{id:'bar',name_en:'Coffee Bar',is_coffee_bar:true}];
test('online packs and subscription contents count actual bottles, excluding services and syrup',()=>{
 assert.equal(m.itemUnits({product_id:'mini',qty:2},products).mini,8);
 assert.equal(m.itemUnits({name_en:'Mini House Blend 4-Pack',qty:3},products).mini,12);
 assert.equal(m.itemUnits({product_id:'mini',qty:0},products).mini,0);
 assert.equal(m.itemUnits({product_id:'large',qty:1},products).large,1);
 assert.equal(m.selected(m.itemUnits({product_id:'syrup',qty:3},products),'all'),0);
 assert.equal(m.selected(m.itemUnits({product_id:'bar',qty:2},products),'all'),0);
 assert.equal(m.selected(m.itemUnits({name_en:'3 × 5L Classic Dark Roast',qty:2},products),'all'),0);
 const sub=m.itemUnits({qty:2,subscription_items:[{product_id:'large',qty:3},{product_id:'mini',qty:1}]},products);assert.equal(sub.large,6);assert.equal(sub.mini,8);
 assert.equal(m.itemUnits({name_en:'Mystery Mini Pack',qty:2},[]).unknown,2);
});
const data={products,stores:[{id:'a',name:'Store A'},{id:'b',name:'Store B'}],orders:[{created_at:'2026-09-30T22:00:00Z',payment_status:'paid',items:[{product_id:'mini',qty:2},{product_id:'large',qty:1}]},{created_at:'2026-10-05',payment_status:'pending',items:[{product_id:'large',qty:100}]},{created_at:'2026-10-05',payment_status:'paid',status:'refunded',items:[{product_id:'large',qty:100}]},{created_at:'2026-10-05',payment_status:'paid',delivery_info:{is_test:true},items:[{product_id:'large',qty:100}]}],deliveries:[{store_id:'a',delivery_date:'2026-10-02',qty_large:10,qty_small:5,qty_unfiltered:2,qty_dairy_free:1,quantities:{classic_liter:100}},{store_id:'b',delivery_date:'2026-10-03',qty_large:3,qty_small:7},{store_id:'a',delivery_date:'2026-09-30',qty_large:4,qty_small:2}]};
test('store aggregates remain authoritative over guessed flavor quantities and paid-order exclusions apply',()=>{
 const rows=m.records(data),oct=m.summarize(rows,{from:'2026-10-01',to:'2026-10-31'});
 assert.equal(oct.large,14);assert.equal(oct.mini,20);assert.equal(oct.unfiltered,2);assert.equal(oct.dairyFree,1);assert.equal(m.selected(oct,'large'),16);assert.equal(m.selected(oct,'all'),37);assert.equal(oct.days,31);
 assert.equal(oct.channels.online.mini,8);assert.equal(oct.channels.store.mini,12);
});
test('store and channel filters compare periods independently and include both range endpoints',()=>{
 const rows=m.records(data),p={from:'2026-10-01',to:'2026-10-02'};
 const a=m.summarize(rows,p,{channel:'stores',stores:['a']});assert.equal(m.selected(a,'all'),18);assert.equal(a.channels.online.mini,0);assert.equal(a.groups.size,1);
 const online=m.summarize(rows,p,{channel:'online',stores:['b']});assert.equal(m.selected(online,'all'),9);
 const september=m.summarize(rows,{from:'2026-09-01',to:'2026-09-30'},{channel:'stores',stores:['a']});assert.equal(m.selected(september,'all'),6);
 assert.throws(()=>m.summarize(rows,{from:'2026-02-30',to:'2026-10-01'}));assert.throws(()=>m.summarize(rows,{from:'2026-10-02',to:'2026-10-01'}));
});
test('period presets respect year boundaries and leap days',()=>{
 assert.deepEqual(m.preset('lastmonth',new Date('2026-01-10T12:00Z')),{from:'2025-12-01',to:'2025-12-31'});
 assert.deepEqual(m.preset('lastmonth',new Date('2024-03-10T12:00Z')),{from:'2024-02-01',to:'2024-02-29'});
});
test('CSV protects user labels and store names from formula execution',()=>{
 assert.equal(m.csvCell('=SUM(1,2)'), '"\'=SUM(1,2)"');assert.equal(m.csvCell('Store "A"'),'"Store ""A"""');assert.equal(m.csvCell(12),'"12"');
});
test('store bottle breakdowns separate regular liters, minis and unfiltered without double counting',()=>{
 const v={large:10,mini:5,unfiltered:2,dairyFree:1};
 assert.deepEqual(m.bottleBreakdown(v).map(p=>[p.key,p.count]),[['large',10],['mini',5],['unfiltered',2],['dairyFree',1]]);
 for(const type of ['all','large','mini','unfiltered','dairyFree'])assert.equal(m.bottleBreakdown(v,type).reduce((s,p)=>s+p.count,0),m.selected(v,type));
 assert.deepEqual(m.bottleBreakdown(v,'large').map(p=>p.key),['large','unfiltered']);
});
test('specific months include full month boundaries across years and leap February',()=>{
 assert.deepEqual(m.monthRange('2024-02'),{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(m.monthRange('2026-02'),{from:'2026-02-01',to:'2026-02-28'});
 assert.deepEqual(m.monthRange('2025-12'),{from:'2025-12-01',to:'2025-12-31'});
 for(const value of ['','2026-13','2026-00','2026-2'])assert.throws(()=>m.monthRange(value));
});
test('Jewish months match known new-year dates and distinguish both Adars in leap years',()=>{
 // Hebcal: 1 Tishrei 5784 = 2023-09-16; 1 Tishrei 5787 = 2026-09-12.
 const leap=m.hebrewMonths(5784),ordinary=m.hebrewMonths(5786),next=m.hebrewMonths(5787);
 assert.equal(leap[0].from,'2023-09-16');assert.equal(next[0].from,'2026-09-12');
 assert.equal(leap.length,13);assert.equal(ordinary.length,12);
 assert.deepEqual(leap.filter(x=>x.name.startsWith('Adar')).map(x=>x.name),['Adar I','Adar II']);
 assert.equal(ordinary.filter(x=>x.name.startsWith('Adar')).length,1);
 for(const months of [leap,ordinary,next])months.forEach((p,i)=>{
  assert.ok([29,30].includes(m.days(p)));
  if(i)assert.equal(p.from,m.shift(months[i-1].to,1));
 });
 assert.equal(m.shift(ordinary.at(-1).to,1),next[0].from);
 leap[0].from='bad';assert.equal(m.hebrewMonths(5784)[0].from,'2023-09-16');
 assert.throws(()=>m.hebrewMonths(5787.5));assert.throws(()=>m.hebrewMonths(0));
});

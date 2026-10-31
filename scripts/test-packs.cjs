const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('../supabase/functions/_shared/pack-model.ts');
const P=(id,name,category,price,extra={})=>({id,name_en:name,name_he:name,category,price,is_active:true,variations:[],...extra});
const ops=n=>[{type:'ops_settings',pack_size:n}];
const cat=[P('c','Classic Dark Roast','bottles',49),P('h','House Blend Medium Roast','bottles',49),P('s','Vanilla Bean Syrup','bottles',59),
 P('o','Original Cremier 4-Pack','minis',59,{variations:ops(4)}),P('v','Vanilla Cremier 4 Pack','minis',59,{variations:ops(4)}),
 P('L','Build your own 6-pack (liters)','bottles',279,{variations:[{type:'pack',size:6,pool:'bottles',discount:0.05}]}),
 P('M','Build your own 6-pack (minis)','minis',84,{variations:[{type:'pack',size:6,pool:'minis',discount:0.05}]})];
const by=new Map(cat.map(p=>[p.id,p]));
test('6 liters at 5% off, in whole shekels, with their contents',()=>{
 const q=m.quotePack(by.get('L'),[{product_id:'c',qty:4},{product_id:'h',qty:2}],by);
 assert.equal(q.full,294);assert.equal(q.total,279);assert.equal(q.label_en,'4× Classic Dark Roast, 2× House Blend Medium Roast');
});
test('6 minis: a quarter of a 4-pack each, 5% off',()=>{
 const q=m.quotePack(by.get('M'),[{product_id:'o',qty:3},{product_id:'v',qty:3}],by);
 assert.equal(q.full,88.5);assert.equal(q.total,84);assert.deepEqual(q.contents.map(c=>c.per_product),[4,4]);
});
test('exactly six, from the right shelf, no syrups or packs inside',()=>{
 assert.throws(()=>m.quotePack(by.get('L'),[{product_id:'c',qty:5}],by),/exactly 6/);
 assert.throws(()=>m.quotePack(by.get('L'),[{product_id:'c',qty:5},{product_id:'s',qty:1}],by),/Invalid pack item/);
 assert.throws(()=>m.quotePack(by.get('L'),[{product_id:'c',qty:5},{product_id:'o',qty:1}],by),/Invalid pack item/);
 assert.throws(()=>m.quotePack(by.get('L'),[{product_id:'c',qty:5},{product_id:'L',qty:1}],by),/Invalid pack item/);
 assert.throws(()=>m.quotePack(by.get('L'),[{product_id:'c',qty:7}],by),/Invalid pack item/);
});

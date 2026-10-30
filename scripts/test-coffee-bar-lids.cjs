const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Babel=require('@babel/standalone');
const model=require('../coffee-bar-order.js'),scene=require('../storefront-bar-layout.js');
const lid={name:'25 domed lids',bar_lids:25,price:10,max:20};
const product={id:'9361ff6e-4227-44cc-a23a-428a002f1f4c',name_en:'Premium Coffee Bar',is_coffee_bar:true,variations:[{type:'choice',name:'Guests',options:[25,50,75,100,125].map((n,i)=>({label:String(n),price:349+i*250}))},{type:'addons',items:[lid]}]};
function planner(){const c={window:{},document:{readyState:'loading',addEventListener(){}},addEventListener(){},products:[product],lang:'en',isCoffeeBarProduct:p=>p.is_coffee_bar,getProductAddons:p=>p.variations.find(v=>v.type==='addons').items};let s=fs.readFileSync('storefront-planner.js','utf8').replace("  if (document.readyState === 'loading')","  window.testApi={state,suggestion};\n  if (document.readyState === 'loading')");vm.runInNewContext(s,c);return c.window.testApi;}
test('lids are not standard; opting in prices every 25 guests and updates quantities with package size',()=>{
 const p=planner();assert.equal(p.suggestion().lids,0);const base=p.suggestion().total;p.state.lids=true;assert.equal(p.suggestion().total,base+20);assert.equal(p.suggestion().lids,50);assert.deepEqual(Array.from(p.suggestion().qty[0]),[0,2]);
 for(const guests of [25,50,75,100,125]){p.state.guests=guests;const plan=p.suggestion();assert.equal(plan.lids,guests);assert.equal(plan.lidPrice,guests/25*10)}
 p.state.lids=false;assert.equal(p.suggestion().lids,0);
});
test('lids survive server validation, exact order description and scheduling; client prices are ignored',()=>{
 const source=fs.readFileSync('supabase/functions/create-website-order/index.ts','utf8');const helpers=source.slice(source.indexOf('function normalizeVariationOption('),source.indexOf('function computeDeliveryFee('));const c={...model};vm.runInNewContext(Babel.transform(helpers,{presets:['typescript'],filename:'price.ts'}).code+'\nthis.price=computeUnitPrice;',c);
 const item={selected_variations:{Guests:{label:'50',price:599}},selected_addons:[{name:lid.name,qty:2,price:0.01}]};
 assert.equal(c.price(product,item),619);const config=model.buildCoffeeBarConfiguration(product,item);assert.equal(config.lids,50);assert.match(model.describeCoffeeBar(config),/50 domed lids/);
 const job=model.coffeeBarSchedulePrefill({id:'order',items:[{product_id:product.id,qty:2,coffee_bar_configuration:config}]},[product]);assert.equal(job.coffeeBarConfiguration.bars.length,2);assert.equal(job.coffeeBarConfiguration.bars[0].lids,50);
 assert.equal(model.buildCoffeeBarConfiguration(product,{...item,selected_addons:[]}).lids,undefined);
});
test('preview contains lids only when selected and keeps them on the table',()=>{
 const plan={classic:2,mix:{},dispensers:1,milkLiters:5,guests:50,syrupCounts:{caramel:1,vanilla:1,sugar:1}};
 assert.equal(scene.layout(plan).items.filter(i=>i.kind==='lids').length,0);const result=scene.layout({...plan,lids:50});const lids=result.items.filter(i=>i.kind==='lids');assert.equal(lids.length,2);assert.equal(lids.reduce((n,i)=>n+i.units,0),50);for(const i of lids){assert.equal(i.bottom,0);assert.ok(i.x+i.w<=result.width)}
});

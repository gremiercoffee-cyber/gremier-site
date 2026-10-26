const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Babel = require('@babel/standalone');
const api = require('../coffee-bar-order.js');
const FULL = '9361ff6e-4227-44cc-a23a-428a002f1f4c';
const BASIC = 'c211cedd-ef93-4dba-9a6e-b2edb1add6e0';
const product = (full = true, extra = []) => ({id:full ? FULL : BASIC, variations:[
  {type:'choice',name:'Guests',options:[{label:'25',price:349},{label:'50',price:599}]},
  {type:'addons',items:[{name:'House Blend',per_jug:true,price:49},{name:'Colombian',per_jug:true,price:49},
    {name:'Parve milk',per_liter:true,price:7},{name:'Extra dispenser',max:3,price:49},
    {name:'Vanilla syrup',bar_syrup:'vanilla',price:59},{name:'Syrup (caramel or vanilla)',max:2,price:59},...extra]}
]});
const item = (selected_addons = [], extra = {}) => ({product_id:FULL,qty:1,selected_variations:{Guests:{label:'50',price:599}},selected_addons,...extra});

test('full bar preserves exact coffee, half-parve milk and included equipment', () => {
  const config = api.buildCoffeeBarConfiguration(product(),item([{name:'House Blend',qty:1},{name:'Parve milk',liters:3},{name:'Extra dispenser',qty:1}]));
  assert.deepEqual(config.coffee.map(x=>[x.key,x.jugs]),[['classic',1],['houseBlend',1]]);
  assert.deepEqual(config.milk.map(x=>[x.key,x.liters]),[['dairy',2],['parve',3]]);
  assert.equal(config.dispensers,2);
  assert.deepEqual(config.syrups.map(x=>x.key),['caramel','vanilla','sugar']);
  assert.equal(config.cups,50); assert.equal(config.straws,50);
  assert.match(api.describeCoffeeBar(config),/1× House Blend 5L/);
  assert.match(api.describeCoffeeBar(config),/3L Parve milk \(type not specified\)/);
});

test('basic vanilla-only order has sugar and vanilla, no caramel, milk or dispenser', () => {
  const config = api.buildCoffeeBarConfiguration(product(false),item([{name:'Vanilla syrup'}],{product_id:BASIC}));
  assert.deepEqual(config.syrups.map(x=>x.key),['sugar','vanilla']);
  assert.deepEqual(config.milk,[]); assert.equal(config.dispensers,0);
  assert.match(api.describeCoffeeBar(config),/0 dispensers/);
});

test('named milk types retain separate canonical names and quantities', () => {
  const p = product(true,[{name:'Milk A',per_liter:true,milk_type:'type_a',milk_label:'Selected milk A'},
    {name:'Milk B',per_liter:true,milk_type:'type_b',milk_label:'Selected milk B'}]);
  const config = api.buildCoffeeBarConfiguration(p,item([{name:'Milk A',liters:2},{name:'Milk B',liters:3}]));
  assert.deepEqual(config.milk.map(x=>[x.key,x.name,x.liters]),[['type_a','Selected milk A',2],['type_b','Selected milk B',3]]);
  assert.throws(()=>api.buildCoffeeBarConfiguration(p,item([{name:'Milk A',liters:4},{name:'Milk B',liters:3}])),/milk allowance/);
});

test('missing guest selection requires confirmation rather than guessing 25', () => {
  assert.equal(api.buildCoffeeBarConfiguration(product(),item([],{selected_variations:{},selected_guests:50})),null);
  assert.equal(api.coffeeBarSchedulePrefill({items:[item([],{selected_variations:{}})]},[product()]),null);
});

test('saved snapshot survives catalog changes, item quantity and scheduling', () => {
  const config = api.buildCoffeeBarConfiguration(product(false),item([{name:'Vanilla syrup'}]));
  const order = {id:'order-test',customer_phone:'test',items:[{qty:2,coffee_bar_configuration:config}]};
  const scheduled = api.coffeeBarSchedulePrefill(order,[{id:BASIC,variations:[]}]);
  assert.equal(scheduled.people,100); assert.equal(scheduled.dispensers,0);
  assert.deepEqual(scheduled.jerryCans,['classic','classic','classic','classic']);
  assert.deepEqual(scheduled.cbSyrups,{sugar_syrup:2,vanilla_syrup:2});
  assert.equal(scheduled.websiteOrderId,'order-test');
  assert.deepEqual(scheduled.coffeeBarConfiguration.bars,[config,config]);
});

test('legacy generic syrup remains explicitly unspecified', () => {
  const config = api.buildCoffeeBarConfiguration(product(false),item([{name:'Syrup (caramel or vanilla)',qty:2}]));
  assert.match(api.describeCoffeeBar(config),/2× Syrup \(flavour not recorded\)/);
  assert.equal(config.syrups.some(x=>x.key==='caramel'),false);
});

function pendingApi() {
  const source = fs.readFileSync('supabase/functions/_shared/pending-delivery.ts','utf8').replace(/^import .*;\r?\n/gm,'');
  const code = Babel.transform(source,{presets:['typescript'],filename:'pending-delivery.ts'}).code.replace(/^export /gm,'');
  const context = {...api,console,Intl,Date,Math,subscriptionDeliveryTarget:()=>null,describeItemExtras:()=>''};
  vm.runInNewContext(code+'\nglobalThis.schedule=autoScheduleDelivery;',context);
  return context.schedule;
}

test('automatic scheduling writes exact saved choices and keeps zero dispensers', async () => {
  const config = api.buildCoffeeBarConfiguration(product(false),item([{name:'Vanilla syrup'}]));
  let saved;
  const db = {from(table){const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:null}),
    insert:async(value)=>{assert.equal(table,'jobs');saved=value;return {error:null}},update(){return q}};return q}};
  await pendingApi()(db,{id:'test',customer_name:'Test',items:[{product_id:BASIC,qty:1,coffee_bar_configuration:config}],delivery_info:{delivery_type:'regular'}},'pending');
  assert.equal(saved.delivery_type,'coffeebar'); assert.equal(saved.people,50);assert.equal(saved.dispensers,0);
  assert.deepEqual(Array.from(saved.jerry_cans),['classic','classic']);
  assert.equal(saved.cb_syrups.vanilla_syrup,1);assert.equal(saved.cb_syrups.caramel_syrup,undefined);
  assert.deepEqual(saved.coffee_bar_configuration.bars[0],config);
});

test('admin row round-trip preserves customer selections and zero dispensers', () => {
  const source=fs.readFileSync('admin-src/react-1.jsx','utf8');
  const start=source.indexOf('function rowToJob2('), end=source.indexOf('\n}',source.indexOf('function jobToRow2('))+2;
  assert.ok(start>=0 && end>start);
  const context={};vm.runInNewContext(source.slice(start,end)+'\nglobalThis.convert={rowToJob2,jobToRow2};',context);
  const config={version:1,bars:[api.buildCoffeeBarConfiguration(product(false),item([{name:'Vanilla syrup'}]))]};
  const row=context.convert.jobToRow2(context.convert.rowToJob2({id:'test',dispensers:0,coffee_bar_configuration:config}));
  assert.equal(row.dispensers,0);assert.deepEqual(row.coffee_bar_configuration,config);
});

test('server price and guest resolution agree with the saved configuration', () => {
  const source=fs.readFileSync('supabase/functions/create-website-order/index.ts','utf8');
  const helpers=source.slice(source.indexOf('function normalizeVariationOption('),source.indexOf('function computeDeliveryFee('));
  const code=Babel.transform(helpers,{presets:['typescript'],filename:'price.ts'}).code;
  const context={...api};vm.runInNewContext(code+'\nglobalThis.price=computeUnitPrice;globalThis.guest=resolveGuestSelection;',context);
  const p=product(),i=item([{name:'House Blend',qty:1},{name:'Parve milk',liters:3},{name:'Extra dispenser',qty:1}]);
  assert.equal(context.price(p,i),599+49+21+49);
  assert.equal(context.guest(p,i).guests,api.buildCoffeeBarConfiguration(p,i).guests);
});

test('notification text uses saved choices instead of mutable raw add-on labels', () => {
  const source=fs.readFileSync('supabase/functions/_shared/order-notify.ts','utf8');
  const helpers=source.slice(source.indexOf('export function describeItemExtras('),source.indexOf('\nexport ',source.indexOf('export function describeItemExtras(')+1));
  const code=Babel.transform(helpers,{presets:['typescript'],filename:'notification.ts'}).code.replace(/^export /gm,'');
  const context={...api};vm.runInNewContext(code+'\nglobalThis.describe=describeItemExtras;',context);
  const config=api.buildCoffeeBarConfiguration(product(false),item([{name:'Vanilla syrup'}]));
  const description=context.describe({coffee_bar_configuration:config,selected_addons:[{name:'Wrong syrup'}]});
  assert.match(description,/Vanilla syrup/);assert.match(description,/2× Classic 5L/);
  assert.doesNotMatch(description,/Wrong syrup|Caramel/);
});

test('extras bought with the bar are recorded on it and listed in its description', () => {
  const item = { selected_variations: { Guests: { label: '50', price: 599 } }, selected_guest_price: 599,
    bar_extras: [{ product_id: 'jug-colombia', name_en: '5L Colombia Light Roast', qty: 1 }, { product_id: 'mini', name_en: 'Classic Mini 4-Pack', qty: 2 }, { product_id: 'bad', qty: 0 }] };
  const config = api.buildCoffeeBarConfiguration(product(true), item);
  assert.deepEqual(config.extras, [{ product_id: 'jug-colombia', name: '5L Colombia Light Roast', qty: 1 }, { product_id: 'mini', name: 'Classic Mini 4-Pack', qty: 2 }]);
  assert.match(api.describeCoffeeBar(config), /\+ 1× 5L Colombia Light Roast · \+ 2× Classic Mini 4-Pack$/);
  assert.equal(api.buildCoffeeBarConfiguration(product(true), { ...item, bar_extras: null }).extras, undefined);
});

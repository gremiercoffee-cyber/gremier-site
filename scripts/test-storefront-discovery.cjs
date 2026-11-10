const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const discovery=require('../storefront-discovery.js');
const category=p=>/syrup/i.test(p.name_en)?'syrups':p.category;
test('shelves retain every shop product once with its original price and subscription metadata',()=>{
 const rows=[...Array.from({length:6},(_,i)=>({id:'b'+i,category:'bottles',price:49+i,variations:[{type:'subscription'}]})),{id:'mini',category:'minis',price:59},{id:'bulk',category:'bulk',price:169},{id:'syrup',name_en:'Vanilla Syrup',category:'bottles',price:59},{id:'bar',category:'coffeebars'},{id:'other',category:'accessories',price:19.99}];
 const groups=discovery.groups(rows,category,false);assert.deepEqual(groups.map(s=>s.key),['bottles','minis','bulk','syrups','coffeebars','extras']);assert.equal(groups[2].title,'Wholesale');
 const flattened=groups.flatMap(s=>s.items);assert.equal(new Set(flattened.map(p=>p.id)).size,flattened.length);assert.equal(flattened.length,rows.length);for(const p of flattened)assert.equal(p,rows.find(x=>x.id===p.id));
 assert.deepEqual(discovery.pages(groups[0].items).map(p=>p.length),[4,2]);assert.equal(discovery.groups(rows,category,true)[2].title,'סיטונאי');
});
test('storefront inline scripts parse after integrating real cards and routes',()=>{
 const html=fs.readFileSync('index.html','utf8');for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!m[1].includes('application/ld+json')&&m[2].trim())new vm.Script(m[2]);
 assert.match(html,/GremierDiscovery\.renderShop\(grid,list,shopCategoryOf,productCardHTML/);assert.match(html,/href="#coffeebars\/build" onclick="openCoffeeBarFromHome\(event\)"/);
});
test('home collage retains three liter bottles and adds two lattes and a syrup',()=>{
 const names=['House Blend Medium Roast','Original Cream Latte','Classic Dark Roast','Caramel Cream Latte','Colombia Light Roast','Vanilla Bean Syrup'];
 const rows=names.map(name_en=>({name_en,is_active:true,images:['/'+name_en+'.webp']}));
 rows[1].images.push('/products/original-cream-latte-single-v2.webp');
 rows.push({name_en:'Dairy Free Cremier 4 pack',is_active:false,images:['/hidden.webp']});
 const host={innerHTML:''};
 const document={querySelectorAll:()=>[],getElementById:()=>host};
 const context={document};
 vm.runInNewContext(fs.readFileSync('storefront-discovery.js','utf8'),context);
 context.GremierDiscovery.home(rows,false,src=>src);
 assert.equal((host.innerHTML.match(/<img /g)||[]).length,6);
 for(const name of names)assert.ok(host.innerHTML.includes(`alt="${name}"`));
 assert.ok(host.innerHTML.includes('/products/original-cream-latte-single-v2.webp'));
 assert.ok(!host.innerHTML.includes('hidden.webp'));
});

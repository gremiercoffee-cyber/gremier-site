const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {shouldShow}=require('../storefront-boot.js');
test('a cold opening gets the reveal; repeat loads and browser history do not',()=>{
 assert.equal(shouldShow({last:0,now:2000000}),true);
 assert.equal(shouldShow({last:1900000,now:2000000}),false);
 assert.equal(shouldShow({last:1000,now:2000000}),true);
 assert.equal(shouldShow({last:0,now:2000000,type:'back_forward'}),false);
});
test('payment, OAuth, email cart links and embedded checkout never get an overlay',()=>{
 for(const extra of [{search:'?payment=return'},{search:'?payme_sale_id=123'},{search:'?code=oauth'},{hash:'#access_token=abc'},{hash:'#checkout'},{search:'?cart=id.2'},{framed:true}])assert.equal(shouldShow({last:0,now:2000000,...extra}),false);
});
function boot(){
 const classes=new Set(),timeouts=[],listeners={},overlay={setAttribute(){},classList:{add(){}},remove(){overlay.removed=true}};
 const document={documentElement:{classList:{add:k=>classes.add(k),remove:k=>classes.delete(k)}},getElementById:id=>id==='gremierBoot'?overlay:{addEventListener:(event,cb)=>{listeners.skip=cb}},querySelectorAll:()=>[],addEventListener:(event,cb)=>{listeners[event]=cb}};
 const root={localStorage:{getItem:()=>null,setItem(){}},location:{search:'',hash:''},performance:{getEntriesByType:()=>[{type:'navigate'}]},setTimeout:(cb,ms)=>{timeouts.push({cb,ms});return timeouts.length},clearTimeout(){},requestAnimationFrame:cb=>cb(),addEventListener:(event,cb)=>{listeners[event]=cb}};root.parent=root;
 vm.runInNewContext(fs.readFileSync('storefront-boot.js','utf8'),{window:root,document,URLSearchParams,Date,Promise,clearTimeout(){}});
 return {root,classes,timeouts,listeners,overlay};
}
test('ready content dismisses immediately without waiting for an animation minimum',async()=>{
 const x=boot();assert.ok(x.classes.has('gremier-boot'));await x.root.GremierBoot.ready();assert.ok(!x.classes.has('gremier-boot'));
 await x.root.GremierBoot.ready();assert.equal(x.timeouts.filter(t=>t.ms===320).length,1);
});
test('a stalled page fails open and the Continue button lets visitors dismiss early',()=>{
 const x=boot();x.timeouts.find(t=>t.ms===3500).cb();assert.ok(!x.classes.has('gremier-boot'));
 const y=boot();y.listeners.click({target:{closest:()=>true}});assert.ok(!y.classes.has('gremier-boot'));
});
test('initialization happens once and readiness is wired after page restoration',()=>{
 const html=fs.readFileSync('index.html','utf8');assert.equal((html.match(/^init\(\);$/gm)||[]).length,1);assert.match(html,/restorePageFromUrl\(\);[\s\S]{0,30}window\.GremierBoot\?\.ready\(\)/);
 const css=fs.readFileSync('storefront-boot.css','utf8');assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/boot-fail-open \.25s 4s/);
});

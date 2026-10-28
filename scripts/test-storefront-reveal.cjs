const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('storefront-reveal.js','utf8');
function setup({reduced=false}={}){
 let intersect,mutate,motionChange,scan,focus;const options={},observed=new Set();let enters=0;
 const page={};const element=top=>{const classes=new Set();return {top,isConnected:true,parentElement:{closest:()=>null},classList:{add(c){classes.add(c);if(c==='gremier-enter')enters++},remove:c=>classes.delete(c),contains:c=>classes.has(c)},getBoundingClientRect(){return {top:this.top,bottom:this.top+200,left:0,right:300,width:300,height:200}},closest(selector){return selector==='.page.active'?page:this},addEventListener(){},removeEventListener(){}}};
 const first=element(100),later=element(1000),elements=[first,later];page.querySelectorAll=s=>s.startsWith('img')?[]:elements;
 const motion={matches:reduced,addEventListener:(event,fn)=>motionChange=fn};
 class IO{constructor(fn,o){intersect=fn;Object.assign(options,o)}observe(e){observed.add(e)}unobserve(e){observed.delete(e)}disconnect(){observed.clear()}}
 class MO{constructor(fn){mutate=fn}observe(){}}
 const document={body:{},querySelector:()=>page,querySelectorAll:()=>elements.filter(e=>e.classList.contains('gremier-enter')),addEventListener:(event,fn)=>focus=fn};
 vm.runInNewContext(source,{window:{IntersectionObserver:IO,MutationObserver:MO,matchMedia:()=>motion},IntersectionObserver:IO,MutationObserver:MO,document,innerWidth:390,innerHeight:844,requestAnimationFrame:fn=>{scan=fn;return 1},WeakSet,Set});
 return {first,later,options,motion,observed,enter:()=>intersect([{target:later,isIntersecting:true}]),mutate:()=>{mutate([{type:'childList'}]);scan()},reduce:()=>{motion.matches=true;motionChange()},focus:()=>focus({target:later}),enters:()=>enters};
}
test('first screen is immediate; off-screen sections wait until actually inside the screen',()=>{
 const x=setup();assert.ok(!x.first.classList.contains('gremier-pending'));assert.ok(x.later.classList.contains('gremier-pending'));assert.equal(x.options.rootMargin,'0px 0px -96px 0px');
 x.enter();assert.ok(!x.later.classList.contains('gremier-pending'));assert.ok(x.later.classList.contains('gremier-enter'));
});
test('DOM refresh while scrolling cannot silently cancel a queued reveal; it plays only once',()=>{
 const x=setup();x.later.top=300;x.mutate();assert.ok(x.later.classList.contains('gremier-pending'));x.enter();x.enter();assert.equal(x.enters(),1);
});
test('reduced motion and keyboard focus always expose content immediately',()=>{
 const off=setup({reduced:true});assert.equal(off.observed.size,0);assert.ok(!off.later.classList.contains('gremier-pending'));
 const toggled=setup();toggled.reduce();assert.equal(toggled.observed.size,0);assert.ok(!toggled.later.classList.contains('gremier-pending'));
 const focus=setup();focus.focus();assert.ok(!focus.later.classList.contains('gremier-pending'));focus.enter();assert.equal(focus.enters(),0);
});
test('the home page includes whole sections, with reduced-motion and no-script fallbacks',()=>{
 assert.match(source,/#homePage > \.section/);const css=fs.readFileSync('storefront-reveal.css','utf8');assert.match(css,/@media \(prefers-reduced-motion:no-preference\)/);assert.match(css,/\.gremier-pending/);assert.doesNotMatch(css,/visibility:hidden|display:none/);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const numbers=require('../admin-stock-numbers.js');
test('stock units: concentrate half litres, beans full kg, whole bottles and labels',()=>{
 assert.equal(numbers.bump(22,.5,1),22.5);assert.equal(numbers.bump(22,.5,-1),21.5);
 assert.equal(numbers.bump(1.975,.5,1),2.475);assert.equal(numbers.bump(.1,.5,-1),0);
 assert.equal(numbers.bump(1.5,1,1),2.5);assert.equal(numbers.parse('1.5',.001),1.5);
 assert.equal(numbers.parse('1.5',1),null);assert.equal(numbers.parse('022'),22);
 for(const raw of ['', ' ', '-1','1e3','NaN','1.2.3','1000001'])assert.equal(numbers.parse(raw),null);
});
function harness(onCommit,props={}){
 const Babel=require('@babel/standalone');let source=fs.readFileSync('admin-src/react-2.jsx','utf8');source=source.slice(source.indexOf('function NumRow('),source.indexOf('// ── CONCENTRATE'));
 const slots=[],refs=[],effects=[];let si=0,ri=0,ei=0,tree;
 const c={window:{GremierStockNumbers:numbers},SS:{row:{},lbl:{},btn:{},inp:{}},Promise,NaN,Number,String,
 React:{createElement(type,props,...children){return {type,props:props||{},children:children.flat()}}},
 useState(init){const n=si++;if(!(n in slots))slots[n]=init;return [slots[n],v=>{slots[n]=typeof v==='function'?v(slots[n]):v}]},
 useRef(init){const n=ri++;return refs[n]||=( {current:init})},
 useEffect(fn,deps){const n=ei++;if(!effects[n]||deps.some((x,i)=>x!==effects[n][i])){effects[n]=deps;fn()}}};
 vm.createContext(c);vm.runInContext(Babel.transform(source,{presets:['react']}).code,c);
 let values={label:'Classic',value:0,onCommit,...props};
 const render=updates=>{values={...values,...updates};si=ri=ei=0;tree=c.NumRow(values);return tree};
 const find=(type)=>{const out=[];function walk(x){if(!x||typeof x!=='object')return;if(x.type===type)out.push(x);x.children?.forEach(walk)}walk(tree);return out};render();return {render,find};
}
const flush=()=>new Promise(r=>setImmediate(r));
test('clearing and typing 22 saves once on blur, without inserting 0',async()=>{
 const saved=[],h=harness(async v=>saved.push(v));let input=h.find('input')[0];let selected=false;
 input.props.onFocus({target:{select(){selected=true}}});input.props.onChange({target:{value:''}});h.render();assert.equal(h.find('input')[0].props.value,'');assert.equal(saved.length,0);
 h.find('input')[0].props.onChange({target:{value:'022'}});h.render();assert.equal(h.find('input')[0].props.value,'22');h.find('input')[0].props.onBlur();await flush();assert.deepEqual(saved,[22]);assert.ok(selected);
});
test('rapid button taps are serialized and a pending save cannot overwrite newer edits',async()=>{
 const saves=[],releases=[];const h=harness(v=>{saves.push(v);return new Promise(r=>releases.push(r))},{value:22,step:.5});
 h.find('button')[1].props.onClick();h.find('button')[1].props.onClick();h.render();assert.equal(h.find('input')[0].props.value,'23');await flush();assert.deepEqual(saves,[22.5]);
 h.render({value:22.5});assert.equal(h.find('input')[0].props.value,'23');releases[0]();await flush();assert.deepEqual(saves,[22.5,23]);releases[1]();await flush();
});
test('invalid fractional bottle count does not save; failed save can be retried',async()=>{
 const saves=[],h=harness(async v=>{saves.push(v);if(saves.length===1)throw Error('network')});
 h.find('input')[0].props.onChange({target:{value:'2.5'}});h.render();h.find('input')[0].props.onBlur();await flush();assert.equal(saves.length,0);
 h.find('input')[0].props.onChange({target:{value:'22'}});h.render();h.find('input')[0].props.onBlur();await flush();h.render();h.find('input')[0].props.onBlur();await flush();assert.deepEqual(saves,[22,22]);
});

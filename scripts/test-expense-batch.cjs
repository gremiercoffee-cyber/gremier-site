const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('admin-finance.js','utf8');
function fixture({pdfFailure=false}={}){
 const ids=['a','b','c','d','e'],nodes={},shares=[],calls=[];
 function node(id){return nodes[id]||=( {textContent:'',innerHTML:'',disabled:false,children:[],setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},append(v){this.children.push(v)},scrollIntoView(){this.scrolled=true},focus(){this.focused=true},click(){return this.onclick?.()}});}
 const context={File,Blob,Uint8Array,Date,console,Set,Promise,
  document:{querySelectorAll:()=>ids.map(value=>({value})),createElement:type=>type==='canvas'?{width:0,height:0,getContext:()=>({fillRect(){},drawImage(){}}),toBlob:cb=>cb(new Blob(['image'],{type:'image/jpeg'}))}:node('created-'+Math.random())},
  get:node,status:(id,message)=>node(id).textContent=message,esc:String,phone:String,today:()=> '2026-10-25',
  call:async(name,body)=>{calls.push(body);return {url:'https://private.test/'+body.id}},fetch:async()=>({ok:true,blob:async()=>new Blob(['original'])}),
  createImageBitmap:async()=>({width:3000,height:4000,close(){}}),URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},setTimeout(){},
  root:{open(){}},navigator:{canShare:({files})=>files.every(f=>f instanceof File),share:async payload=>shares.push(payload)},
  expenseFiles:ids.map((id,i)=>({id,original_name:id,mime_type:i===2?'application/pdf':'image/jpeg'})),expenseSettings:{whatsapp_number:'972500000000'},batch:null,
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('let pdfLibrary=null'),source.indexOf('const originalShow=root.showTab')),context);
 context.pdfFixture={getDocument:()=>({promise:pdfFailure?Promise.reject(Error('PDF unreadable')):Promise.resolve({numPages:1,getPage:async()=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve()}),cleanup(){}})}),destroy:async()=>{}})};
 vm.runInContext('pdfLibrary=pdfFixture',context);
 return {context,nodes,node,shares,calls};
}
test('five selected receipts become five separate files passed to a single share call',async()=>{
 const f=fixture();await f.context.prepareBatch();
 assert.equal(f.context.batch.files.length,5);assert.equal(new Set(f.context.batch.files.map(x=>x.name)).size,5);
 assert.deepEqual(Array.from(f.context.batch.files,x=>x.name),['expense-01.jpg','expense-02.jpg','expense-03-page-01.jpg','expense-04.jpg','expense-05.jpg']);
 assert(f.context.batch.files.every(x=>x.type==='image/jpeg'));
 await f.node('expenseShare').onclick();assert.equal(f.shares.length,1);assert.equal(f.shares[0].files.length,5);
 assert.equal(f.calls.filter(x=>x.action==='filed').length,0);
 assert.equal(f.node('expensePrepared').scrolled,true);assert.equal(f.node('expensePrepared').focused,true);
 assert.match(f.node('expenseBatchStatus').textContent,/5 separate JPG files/);
 assert.equal(f.node('expensePrepare').disabled,false);assert.equal(f.node('expensePrepare')['aria-busy'],undefined);
});
test('conversion failure leaves all originals unfiled and shows the error beside the button',async()=>{
 const f=fixture({pdfFailure:true});await f.context.prepareBatch();
 assert.equal(f.context.batch,null);assert.equal(f.shares.length,0);assert.equal(f.calls.filter(x=>x.action==='filed').length,0);
 assert.match(f.node('expenseBatchStatus').textContent,/PDF unreadable.*No documents were marked filed/);
 assert.equal(f.node('expensePrepare').disabled,false);assert.equal(f.node('expensePrepare').textContent,'Prepare selected batch');
});

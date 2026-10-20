const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {customerFields,normalizeManualInput,manualPayload}=require('../supabase/functions/_shared/manual-receipt-model.ts');
const {resultDocument}=require('../supabase/functions/_shared/finbot-receipt-model.ts');
const id='12345678-1234-1234-1234-123456789abc',cid='22345678-1234-1234-1234-123456789abc',bid='32345678-1234-1234-1234-123456789abc',sid='42345678-1234-1234-1234-123456789abc';
const base=()=>({id,customer_id:cid,amount:'123.45',payment_date:'2026-10-20',payment_method:'bank_transfer',description:'Fixture payment',email_requested:false,billing_ids:[],billed_total_minor:null});
const checkDetails=()=>({bank_code:'12',branch:'345',account:'12345678',check_number:'123456',check_date:'2026-11-15'});
test('manual receipts preserve exact cash/bank payments; optional contact data; tax ID',()=>{
 const input=normalizeManualInput(base(),new Date('2026-10-20T10:00Z')),customer=customerFields({name:'Fixture synagogue',tax_id:'123456789'}),p=manualPayload(input,customer,new Date('2026-10-20T10:00Z'));
 assert.equal(p.type,'1');assert.equal(p.vatType,false);assert.equal(p.payments[0].type,'1');assert.equal(p.payments[0].sum,123.45);assert.equal(p.items[0].price,123.45);
 assert.equal(p.customer.tax,'123456789');assert.equal(p.customer.phone,undefined);assert.equal(p.customer.email,undefined);
 assert.equal(manualPayload({...input,payment_method:'cash'},customer).payments[0].type,'0');
 assert.throws(()=>manualPayload({...input,email_requested:true},customer));
 for(const change of [{amount:'0'},{amount:'12.345'},{payment_method:'payme'},{payment_date:'2026-02-30'},{payment_date:'2099-01-01'},{billing_ids:[bid,bid],billed_total_minor:100},{billing_ids:[bid],billed_total_minor:null}])assert.throws(()=>normalizeManualInput({...base(),...change},new Date('2026-10-20T10:00Z')));
 assert.throws(()=>customerFields({name:'Fixture',tax_id:'123'}));assert.throws(()=>customerFields({name:'Fixture',phone:'bad'}));
});
test('check and Bit use FinBot types 3 and 8, with complete check data and separate dates',()=>{
 const input=normalizeManualInput({...base(),payment_method:'check',payment_details:checkDetails(),payment_reference:'customer ref'},new Date('2026-10-20T10:00Z'));
 const p=manualPayload(input,{name:'Fixture business',address:'Example street 1',phone:'050-1234567',tax_id:'123456789'},new Date('2026-10-20T10:00Z'));
 assert.deepEqual(p.payments[0],{type:'3',date:'15/11/2026',sum:123.45,bankName:12,bankBranch:345,bankAccount:12345678,checkNumber:123456,transactionNumber:'customer ref'});
 assert.equal(p.date,'20/10/2026');assert.equal(input.payment_date,'2026-10-20');assert.equal(p.customer.address,'Example street 1');assert.equal(p.customer.phone,'0501234567');
 const bit=normalizeManualInput({...base(),payment_method:'bit',payment_details:checkDetails(),payment_reference:'BIT-123'},new Date('2026-10-20T10:00Z'));
 const payment=manualPayload(bit,{name:'Fixture'}).payments[0];assert.equal(payment.type,'8');assert.equal(payment.transactionNumber,'BIT-123');assert.equal(payment.checkNumber,undefined);assert.deepEqual(bit.payment_details,{});
});
test('missing or invalid check information, oversize amounts and silent truncation are rejected',()=>{
 for(const key of Object.keys(checkDetails())){
  const details=checkDetails();delete details[key];assert.throws(()=>normalizeManualInput({...base(),payment_method:'check',payment_details:details},new Date('2026-10-20T10:00Z')));
 }
 for(const change of [{account:'12345678901234567890'},{bank_code:'bank'},{check_date:'2026-02-30'}])assert.throws(()=>normalizeManualInput({...base(),payment_method:'check',payment_details:{...checkDetails(),...change}},new Date('2026-10-20T10:00Z')));
 assert.throws(()=>normalizeManualInput({...base(),payment_reference:'a'.repeat(41)},new Date('2026-10-20T10:00Z')));
 assert.throws(()=>normalizeManualInput({...base(),amount:'10000000'},new Date('2026-10-20T10:00Z')));
 assert.throws(()=>customerFields({name:'Fixture',address:'a'.repeat(101)}));
});
function service(mode='ok',store=false){
 const rows=new Map(),calls=[],customer={id:cid,name:'Fixture customer',email:'',phone:'',tax_id:'',store_id:store?sid:null,updated_at:mode==='customer_changed'?'2026-10-20T12:00:00Z':''};let handler;
 const db={from(table){let filters=[],changes;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},is(){return q},in(){return q},update(v){changes=v;return q},
  async maybeSingle(){return {data:table==='business_receipts'?rows.get(id)||null:null,error:null}},
  async single(){if(table==='receipt_customers')return {data:customer};const r=rows.get(id);if(changes)Object.assign(r,changes);return {data:r}},
  then(resolve){if(table==='store_billing')return Promise.resolve({data:[{id:bid,store_id:sid,year:2026,month:10,total:200,paid_at:mode==='paid'?'2026-10-20':null,cancelled_at:null}]}).then(resolve);if(changes&&rows.has(id))Object.assign(rows.get(id),changes);return Promise.resolve({error:null}).then(resolve);}};return q;},
  async rpc(name,args){if(name==='claim_business_receipt'){if(rows.has(id))return {data:{created:false,receipt:rows.get(id)}};const row={...args.d,status:'issuing'};rows.set(id,row);return {data:{created:true,receipt:row}};}Object.assign(rows.get(id),{status:'issued',document_url:args.doc_url,issued_at:new Date().toISOString()});return {error:null};},
  storage:{from(){return {upload:async()=>({error:null})}}}};
 const context={Request,Response,File,TextEncoder,Uint8Array,URL,AbortSignal,crypto,btoa,console,Date,
  Deno:{env:{get:k=>({FINBOT_API_KEY:'fixture',SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture'})[k]},serve:fn=>handler=fn},
  createClient:()=>db,isServiceOrAdmin:async()=>mode!=='denied',forbidden:()=>Response.json({error:'admin_only'},{status:403}),customerFields,normalizeManualInput,manualPayload,resultDocument,
  originalPdf:async()=>new TextEncoder().encode('%PDF-1.7 fixture'),
  fetch:async(url,options)=>{calls.push({url,options});if(mode==='timeout')throw Error('network timeout');return Response.json({status:1,data:'https://api.finbotai.co.il/fixture.pdf'});}};
 const code=fs.readFileSync('supabase/functions/business-receipts/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(code,{mode:'strip'}),context);
 return {rows,calls,request:async body=>{const response=await handler(new Request('https://fixture.test',{method:'POST',body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}};
}
test('preview never calls FinBot and requires existing customer data',async()=>{const s=service();const r=await s.request({...base(),action:'preview'});assert.equal(r.body.creates_document,false);assert.equal(s.calls.length,0);assert.equal(s.rows.size,0);});
test('check validation fails before claiming or contacting FinBot; issued check details are retained',async()=>{
 const s=service();assert.equal((await s.request({...base(),action:'issue',payment_method:'check',payment_received:true,not_already_receipted:true})).status,400);assert.equal(s.calls.length,0);assert.equal(s.rows.size,0);
 const body={...base(),action:'issue',payment_method:'check',payment_details:checkDetails(),payment_received:true,not_already_receipted:true};
 const result=await s.request(body);assert.equal(result.body.receipt.status,'issued');assert.equal(s.rows.get(id).payment_details.check_number,'123456');
 assert.equal(JSON.parse(s.calls[0].options.body).payments[0].type,'3');
 assert.equal((await s.request({...body,payment_details:{...checkDetails(),check_number:'999'}})).status,400);assert.equal(s.calls.length,1);
});
test('receipt review shows all customer and payment details and escapes untrusted names',()=>{
 const code=fs.readFileSync('admin-finance.js','utf8'),ctx={esc:s=>String(s??'').replaceAll('<','&lt;'),money:n=>'ILS '+n/100,today:()=> '2026-10-20'};
 vm.runInNewContext(code.slice(code.indexOf('function receiptReviewDetails('),code.indexOf('async function review()',code.indexOf('function receiptReviewDetails('))),ctx);
 const text=ctx.receiptReviewDetails({...base(),amount_minor:12345,payment_method:'check',payment_details:checkDetails(),customer:{name:'<Fixture>',tax_id:'123456789',phone:'0501234567',address:'Example street 1',email:'example@example.test'},bills:[],email_requested:true});
 for(const value of ['&lt;Fixture>','123456789','0501234567','Example street 1','example@example.test','12345678','123456','2026-11-15'])assert.ok(text.includes(value));assert.ok(!text.includes('<Fixture>'));
});
test('store amount overrides reveal the adjustment reason only when needed',()=>{
 const source=fs.readFileSync('admin-finance.js','utf8'),nodes={manualAmount:{value:''},manualAdjustmentGroup:{hidden:true},manualAdjustment:{required:false},manualSettlement:{hidden:true,textContent:''}};
 let selection=[];const ctx={selectedBills:()=>selection,money:n=>'ILS '+n/100,get:id=>nodes[id]};
 vm.runInNewContext(source.slice(source.indexOf('function updateSettlement('),source.indexOf('function receiptReviewDetails(')),ctx);
 ctx.updateSettlement();assert.equal(nodes.manualSettlement.hidden,true);assert.equal(nodes.manualAdjustmentGroup.hidden,true);
 selection=[{total:100},{total:150}];nodes.manualAmount.value='250';ctx.updateSettlement();assert.equal(nodes.manualAdjustmentGroup.hidden,true);assert.match(nodes.manualSettlement.textContent,/2 months.*250/);
 nodes.manualAmount.value='230';ctx.updateSettlement();assert.equal(nodes.manualAdjustmentGroup.hidden,false);assert.equal(nodes.manualAdjustment.required,true);assert.match(nodes.manualSettlement.textContent,/Difference ILS -20/);
 nodes.manualAmount.value='250';ctx.updateSettlement();assert.equal(nodes.manualAdjustmentGroup.hidden,true);assert.equal(nodes.manualAdjustment.required,false);
 selection=[];ctx.updateSettlement();assert.equal(nodes.manualSettlement.hidden,true);
});
test('admin-only issuance and explicit payment confirmation',async()=>{assert.equal((await service('denied').request({...base(),action:'issue'})).status,403);const s=service();assert.equal((await s.request({...base(),action:'issue'})).status,400);assert.equal(s.calls.length,0);});
test('a customer edited after review must be previewed again before any issuance or email',async()=>{const s=service('customer_changed');const r=await s.request({...base(),action:'issue',payment_received:true,not_already_receipted:true});assert.equal(r.body.error,'customer_changed_refresh_preview');assert.equal(s.calls.length,0);assert.equal(s.rows.size,0);});
test('successful issuance stores original PDF and replays cannot create another receipt',async()=>{const s=service(),body={...base(),action:'issue',payment_received:true,not_already_receipted:true};const first=await s.request(body);assert.equal(first.body.receipt.status,'issued');assert.equal(first.body.receipt.pdf_path,`business/${id}/receipt.pdf`);assert.equal(s.calls.length,1);assert.equal((await s.request(body)).body.already_claimed,true);assert.equal(s.calls.length,1);assert.equal((await s.request({...body,amount:150})).status,400);});
test('uncertain provider outcome stays blocked, never retried',async()=>{const s=service('timeout'),body={...base(),action:'issue',payment_received:true,not_already_receipted:true};assert.equal((await s.request(body)).body.do_not_reissue,true);assert.equal(s.rows.get(id).status,'needs_review');await s.request(body);assert.equal(s.calls.length,1);});
test('store settlement rejects paid months and undocumented amount overrides',async()=>{const input={...base(),action:'preview',billing_ids:[bid],billed_total_minor:20000};assert.equal((await service('paid',true).request(input)).status,400);const s=service('ok',true);assert.equal((await s.request(input)).body.error,'adjustment_reason_required');assert.equal((await s.request({...input,adjustment_reason:'Spoiled goods adjustment'})).body.creates_document,false);assert.equal(s.calls.length,0);});

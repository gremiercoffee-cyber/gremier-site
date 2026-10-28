const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync('storefront-engage.js','utf8');
function form(initial=0){
 const calls=[],nodes={'.fb-order':{},'.fb-hint':{hidden:true},textarea:{value:'Lovely coffee'},'.fb-box':{},'.fb-done':{addEventListener(){}}};
 const send={disabled:false,textContent:'Send',classList:{contains:()=>false}};nodes['.fb-send']=send;
 const el={querySelector:s=>nodes[s],querySelectorAll:()=>[],addEventListener:(name,fn)=>el.click=fn,remove(){}};
 const ctx={document:{createElement:()=>el,body:{appendChild(){}}},$:()=>null,T:x=>x,he:()=>false,esc:v=>String(v).replaceAll('<','&lt;'),put(){},engage:async b=>{calls.push(b);return b.action==='feedback_context'?{ok:true,order_number:12,items:[{name_en:'Classic jug',qty:2}]}:{ok:true};}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function writeSheet('),source.indexOf('  function arriveFromFeedbackEmail()'))+'\nthis.open=writeSheet;',ctx);
 ctx.open('order','token',initial,'site');
 return {ctx,el,nodes,send,calls,submit:()=>el.click({target:{closest:s=>s==='.fb-send'?send:null}})};
}
test('one form includes order context and saves rating and comment together only on Send',async()=>{
 const x=form(5);await Promise.resolve();assert.match(x.nodes['.fb-order'].innerHTML,/Classic jug.*×2/);
 assert.equal(x.calls.filter(b=>b.action==='feedback').length,0);await x.submit();
 const saved=x.calls.filter(b=>b.action==='feedback');assert.equal(saved.length,1);assert.equal(saved[0].rating,5);assert.equal(saved[0].comment,'Lovely coffee');assert.equal(saved[0].source,'site');
});
test('rating required, duplicate clicks blocked, failed send retains comment for retry',async()=>{
 const empty=form();await empty.submit();assert.equal(empty.calls.filter(b=>b.action==='feedback').length,0);assert.equal(empty.nodes['.fb-hint'].hidden,false);
 const x=form(4);let resolve;x.ctx.engage=b=>{x.calls.push(b);return new Promise(r=>resolve=r)};
 const sending=x.submit();await x.submit();assert.equal(x.calls.filter(b=>b.action==='feedback').length,1);resolve({error:'offline'});await sending;
 assert.equal(x.send.disabled,false);assert.equal(x.nodes.textarea.value,'Lovely coffee');assert.equal(x.nodes['.fb-hint'].hidden,false);
});
test('email rating links open the combined form without saving the rating first',()=>{
 const section=source.slice(source.indexOf('  function arriveFromFeedbackEmail()'),source.indexOf('  async function feedbackCard()'));
 const opened=[];const ctx={URLSearchParams,location:{search:'?fb=order.token&r=4'},stripParams(){},put(){},whenLanguageSet:fn=>fn(),writeSheet:(...args)=>opened.push(args)};
 vm.runInNewContext(section+'\narriveFromFeedbackEmail();',ctx);assert.deepEqual(opened,[['order','token',4,'email']]);
});
function backend(){
 let handler,answer=null;const mails=[];const order={id:'11111111-1111-4111-8111-111111111111',order_number:12,customer_name:'Customer',customer_email:'customer@example.com',items:[{name_en:'Classic jug',qty:2}]};
 const sb={from(table){let write;return {select(){return this},eq(){return this},maybeSingle:async()=>({data:table==='orders'?order:answer}),upsert:async row=>{answer=row;return {error:null}}}}};
 let code=fs.readFileSync('supabase/functions/engage/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');code=stripTypeScriptTypes(code);
 vm.runInNewContext(code,{Deno:{env:{get:()=>''},serve:fn=>handler=fn},createClient:()=>sb,signToken:async()=> 'valid',notifyOwner:async(...m)=>mails.push(m),ensureReferralCode:async()=>null,Response,Date,URLSearchParams,console});
 return {mails,request:body=>handler({method:'POST',json:async()=>({order_id:order.id,t:'valid',...body})})};
}
test('backend sends one complete email, suppresses identical retries, and protects order details',async()=>{
 const x=backend();const denied=await x.request({action:'feedback_context',t:'wrong'});assert.equal(denied.status,403);
 const context=await (await x.request({action:'feedback_context'})).json();assert.equal(context.items[0].qty,2);assert.equal(context.customer_email,undefined);
 const response=await x.request({action:'feedback',rating:5,comment:'Excellent'});assert.equal(response.status,200);assert.equal(x.mails.length,1);assert.match(x.mails[0][1],/5\/5/);assert.match(x.mails[0][1],/Excellent/);assert.match(x.mails[0][1],/Classic jug ×2/);
 await x.request({action:'feedback',rating:5,comment:'Excellent'});assert.equal(x.mails.length,1);
});
test('request email has one feedback call to action and an escaped order reminder',()=>{
 const src=fs.readFileSync('supabase/functions/admin-tools/index.ts','utf8');
 let code=src.slice(src.indexOf('function feedbackEmail('),src.indexOf('\nasync function optoutUrlFor'))+'\n'+src.slice(src.indexOf('function orderRecap('),src.indexOf('// One-off "what do you think'));
 code=stripTypeScriptTypes(code);const ctx={};vm.createContext(ctx);vm.runInContext(code,ctx);
 const mail=ctx.feedbackEmail({created_at:'2026-10-28',customer_name:'<Customer>',items:[{name_en:'Classic jug',qty:2}]},false,[1,2,3,4,5].map(r=>'https://example.com/?fb=id.token&r='+r));
 assert.match(mail.text,/Classic jug ×2/);assert.equal((mail.html.match(/<a /g)||[]).length,1);assert.match(mail.html,/&write=1/);assert.match(mail.html,/&lt;Customer&gt;/);
});

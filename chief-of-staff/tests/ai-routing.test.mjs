import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(path) {
  const r=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
}
const {getProvider}=await load('worker/ai.ts');
const {modelRoute}=await load('worker/ai-routing.ts');
const config={MODEL_MAIN:'gpt-6.1-terra',MODEL_FAST:'gpt-6-luna',MODEL_CAREFUL:'careful-fixture'};
const usage={input_tokens:1200,output_tokens:140,total_tokens:1340,input_tokens_details:{cached_tokens:800},output_tokens_details:{reasoning_tokens:80}};
const message=text=>({type:'message',id:'msg_'+Math.random(),role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]});
const answer=(text,output)=>({id:'resp_'+Math.random(),object:'response',status:'completed',output:output??[message(text)],usage});
const call=(name,args={},id='call1')=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:id,id:'fc_'+id,status:'completed'});
const brainRequest=(overrides={})=>({tier:'main',purpose:'chat:text',system:'Follow the existing approval rules.',context:'Private context only for Terra.',history:[{role:'user',content:'Remind me tomorrow.'}],tools:[],...overrides});
async function mocked(responses,fn) {
  const original=globalThis.fetch,requests=[],logs=[];
  const env={...config,OPENAI_API_KEY:'test-key-never-sent',DB:{prepare:(sql)=>({bind(...args){if(/usage_log/.test(sql))logs.push(args);return this},async run(){return {meta:{changes:1}}}})}};
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init?.body??await url.text());requests.push({url:String(url),body});
    assert.ok(responses.length,'Unexpected API request');
    const next=responses.shift();return new Response(JSON.stringify(typeof next==='function'?next(body):next),{headers:{'content-type':'application/json'}});
  };
  try {await fn(getProvider(env),requests,logs);assert.equal(responses.length,0,'Unused response fixture');}
  finally {globalThis.fetch=original;}
}

test('all judgment purposes use Terra despite legacy fast labels; unknown work also stays with the brain',()=>{
  for(const purpose of ['whatsapp_triage','email_triage','shopping_triage','meeting_detect','watch_check','watch_keywords','tracker_check','wa_match','learn','reply_style','tidy','project_match','brain_dump','briefing','rundown','weekly_review','customers_due','meeting_notes','task_plan','task_escalate','idea_plan','reply_decision','project_organization','reply_batch','voice_decision','browser_step','new_judgment']) {
    assert.equal(modelRoute(config,purpose,'fast').model,'gpt-6.1-terra',purpose);
    assert.equal(modelRoute(config,purpose,'fast').effort,'low',purpose);
  }
  for(const purpose of ['title','reply_draft','chat_wording'])assert.equal(modelRoute(config,purpose,'main').model,'gpt-6-luna');
  assert.equal(modelRoute({...config,MODEL_BRAIN:'custom-brain'},'whatsapp_triage').model,'custom-brain');
});

test('a tiny JSON classification has a reasoning allowance, uses Responses low, and records model and cache usage',async()=>{
  await mocked([answer('{"needed":false}')],async(p,requests,logs)=>{
    assert.equal(await p.complete({tier:'fast',purpose:'whatsapp_triage',system:'Return JSON',prompt:'Thanks!',maxTokens:5}),'{"needed":false}');
    const req=requests[0];assert.ok(req.url.endsWith('/responses'));assert.equal(req.body.model,'gpt-6.1-terra');
    assert.equal(req.body.reasoning.effort,'low');assert.ok(req.body.max_output_tokens>=2048);
    assert.equal(logs[0][1],'gpt-6.1-terra');assert.equal(logs[0][2],'whatsapp_triage');assert.equal(logs[0][5],800);
  });
});

test('incomplete judgment is never accepted as a classification or silently downgraded to Luna',async()=>{
  await mocked([{...answer('{"needed":'),status:'incomplete'}],async(p,requests)=>{
    await assert.rejects(p.complete({tier:'fast',purpose:'email_triage',system:'JSON',prompt:'Message'}),/could not finish/);
    assert.equal(requests.length,1);
  });
});

test('Terra executes tools, preserves reasoning across rounds and dynamically loaded tools, Luna receives no authority or full context',async()=>{
  const reasoning={type:'reasoning',id:'reason1',summary:[]};let saved=0;
  const tools=[{name:'load_tools',description:'Load filing',input_schema:{type:'object',properties:{}},handler:async()=>{
    tools.push({name:'create_item',description:'Save',input_schema:{type:'object',properties:{title:{type:'string'}}},handler:async()=>{saved++;return {id:'saved',status:'open'}}});return {loaded:true};
  }}];
  await mocked([
    answer('',[reasoning,call('load_tools')]),
    answer('',[call('create_item',{title:'Attendance'},'call2')]),
    answer('Saved Attendance for tomorrow; id saved.'),
    {choices:[{message:{role:'assistant',content:'I saved your attendance reminder for tomorrow.'}}],usage:{prompt_tokens:200,completion_tokens:15,total_tokens:215}},
  ],async(p,requests,logs)=>{
    const result=await p.runAgent(brainRequest({tools,renderReply:true,cacheKey:'cos-chat'}));
    assert.equal(saved,1);assert.equal(result.toolCalls.length,2);assert.match(result.text,/saved your attendance/);
    assert.equal(requests[1].body.input.some(i=>i.id==='reason1'),true);
    assert.equal(requests[1].body.input.some(i=>i.type==='function_call_output'&&i.call_id==='call1'),true);
    assert.equal(requests[1].body.tools.some(t=>t.name==='create_item'),true);
    assert.equal(requests[0].body.tools[0].strict,false);assert.equal(requests[0].body.reasoning.effort,'low');
    const writer=requests[3].body;assert.equal(writer.model,'gpt-6-luna');assert.equal(writer.tools,undefined);
    assert.equal(JSON.stringify(writer).includes('Private context only for Terra.'),false);
    assert.match(writer.messages[1].content,/execution_receipts/);
    assert.deepEqual(logs.map(l=>l[1]),['gpt-6.1-terra','gpt-6.1-terra','gpt-6.1-terra','gpt-6-luna']);
    assert.equal(logs[3][2],'chat_wording');
  });
});

test('a pending paid job stays pending and save-only work avoids a redundant Terra round',async()=>{
  let queued=0;
  await mocked([
    answer('Research requested; waiting for human approval.',[call('save_task'),message('Research requested; waiting for human approval.')]),
    {choices:[{message:{content:'Your research is waiting for approval.'}}]},
  ],async(p,requests)=>{
    await p.runAgent(brainRequest({renderReply:true,noFollowUp:['save_task'],tools:[{name:'save_task',description:'Request approval',input_schema:{type:'object',properties:{}},handler:async()=>{queued++;return {status:'pending_approval'}}}]}));
    assert.equal(queued,1);assert.equal(requests.length,2);assert.match(requests[1].body.messages[1].content,/pending_approval/);
    assert.match(requests[1].body.messages[0].content,/pending approval is not a completed action/);
  });
});

test('tool errors go back to Terra for a decision instead of reusing a premature success message',async()=>{
  await mocked([answer('Done',[call('save'),message('Done')]),answer('Save failed. Nothing was created.')],async(p,requests)=>{
    const r=await p.runAgent(brainRequest({noFollowUp:['save'],tools:[{name:'save',description:'Save',input_schema:{},handler:async()=>{throw new Error('Invalid time')}}]}));
    assert.match(r.text,/failed/);assert.equal(r.toolCalls[0].error,'Invalid time');assert.equal(requests.length,2);
    assert.match(JSON.stringify(requests[1].body.input),/Invalid time/);
  });
});

test('round limit disables tools and never executes a late mutation',async()=>{
  let mutations=0;
  await mocked([answer('',[call('save')])],async(p,requests)=>{
    const r=await p.runAgent(brainRequest({maxToolRounds:0,tools:[{name:'save',description:'Save',input_schema:{},handler:async()=>mutations++}]}));
    assert.equal(mutations,0);assert.equal(requests[0].body.tool_choice,'none');assert.match(r.text,/could not finish/);
  });
});

test('a wording failure does not retry saved actions',async()=>{
  let saved=0;
  await mocked([answer('Reminder saved.',[call('save'),message('Reminder saved.')]),{choices:[]}],async(p)=>{
    const r=await p.runAgent(brainRequest({renderReply:true,noFollowUp:['save'],tools:[{name:'save',description:'Save',input_schema:{},handler:async()=>{saved++;return {ok:true}}}]}));
    assert.equal(saved,1);assert.equal(r.text,'Reminder saved.');
  });
});

test('refusals are preserved without a wording call',async()=>{
  await mocked([answer('',[{...message(''),content:[{type:'refusal',refusal:'I cannot do that.'}]}])],async(p,requests)=>{
    assert.equal((await p.runAgent(brainRequest({renderReply:true}))).text,'I cannot do that.');assert.equal(requests.length,1);
  });
});

test('research uses the brain and preserves the paid search limit',async()=>{
  await mocked([answer('Report',[message('Report'),{type:'web_search_call',id:'search1',status:'completed'}])],async(p,requests)=>{
    const r=await p.research({purpose:'task_research',system:'Research',prompt:'Approved query',maxSearches:2});
    assert.equal(requests[0].body.model,'gpt-6.1-terra');assert.equal(requests[0].body.max_tool_calls,2);assert.equal(r.searches,1);
  });
});

// Chat speed: direct Terra answers retain judgment while removing the mandatory rewrite.
test('direct chat uses one Terra request, low verbosity, and no separate writer even if legacy rendering is enabled',async()=>{
 await mocked([answer('Yes, tomorrow works.')],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true,renderReply:true}));assert.equal(r.text,'Yes, tomorrow works.');assert.equal(requests.length,1);assert.equal(requests[0].body.model,'gpt-6.1-terra');assert.equal(requests[0].body.text.verbosity,'low');assert.match(requests[0].body.input[0].content,/Hard ceiling: 180 words/);assert.ok(!requests[0].body.input[0].content.includes('compact factual handoff'));assert.equal(r.metrics.rounds,1);});
});
test('a simple reminder is confirmed from the successful receipt in a single model round',async()=>{
 let writes=0;await mocked([answer('',[call('create_item',{kind:'reminder',title:'Call David',due_at:'2026-10-19T07:00:00Z'})])],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true,history:[{role:'user',content:'Remind me to call David tomorrow.'}],tools:[{name:'create_item',description:'Save',input_schema:{},handler:async()=>{writes++;return{id:'saved',kind:'reminder',due_at:'2026-10-19T07:00:00Z'}}}]}));assert.equal(writes,1);assert.equal(r.text,'Reminder set.');assert.equal(requests.length,1);});
});
test('direct chat never releases a premature success message when a save is awaiting approval',async()=>{
 await mocked([answer('Done.',[call('save_task'),message('Done.')]),answer('Awaiting your approval.')],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true,noFollowUp:['save_task'],tools:[{name:'save_task',description:'Approval',input_schema:{},handler:async()=>({status:'pending_approval'})}]}));assert.equal(r.text,'Awaiting your approval.');assert.equal(requests.length,2);assert.match(JSON.stringify(requests[1].body.input),/pending_approval/);});
});
test('a failed reminder save must return to Terra and cannot receive the short success confirmation',async()=>{
 await mocked([answer('Reminder set.',[call('create_item',{kind:'reminder'}),message('Reminder set.')]),answer('That time is invalid. When should I remind you?')],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true,noFollowUp:['create_item'],tools:[{name:'create_item',description:'Save',input_schema:{},handler:async()=>{throw Error('Invalid time')}}]}));assert.match(r.text,/invalid/);assert.equal(requests.length,2);});
});
test('independent read-only lookups run concurrently, retain result order, and unchanged duplicate reads are reused',{timeout:2000},async()=>{
 const started=[],completed=[];let release;const barrier=new Promise(resolve=>{release=resolve});let reads=0;
 const tool={name:'read',readOnly:true,description:'Read',input_schema:{},handler:async({id})=>{reads++;started.push(id);if(started.length===2)release();await barrier;completed.push(id);return{id};}};
 await mocked([answer('',[call('read',{id:'a'},'a1'),call('read',{id:'b'},'b'),call('read',{id:'a'},'a2')]),answer('Two records found.')],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true,tools:[tool]}));assert.equal(reads,2);assert.deepEqual(started,['a','b']);assert.equal(completed.length,2);assert.deepEqual(r.toolCalls.map(t=>t.result.id),['a','b','a']);assert.deepEqual(requests[1].body.input.filter(i=>i.type==='function_call_output').map(i=>i.call_id),['a1','b','a2']);});
});
test('writes stay ordered between reads and invalidate cached lookups',async()=>{
 let value=0,reads=0;const tools=[{name:'read',readOnly:true,description:'Read',input_schema:{},handler:async()=>{reads++;return{value}}},{name:'save',description:'Save',input_schema:{},handler:async()=>({value:++value})}];
 await mocked([answer('',[call('read',{},'before'),call('read',{},'cached'),call('save',{},'write'),call('read',{},'after')]),answer('Updated.')],async(p,requests)=>{await p.runAgent(brainRequest({directReply:true,tools}));assert.equal(value,1);assert.equal(reads,2);const out=requests[1].body.input.filter(i=>i.type==='function_call_output').map(i=>JSON.parse(i.output).value);assert.deepEqual(out,[0,0,1,1]);});
});
test('read cache keys retain nested query differences',async()=>{
 let reads=0;const tool={name:'read',readOnly:true,description:'Read',input_schema:{},handler:async({filter})=>{reads++;return filter;}};
 await mocked([answer('',[call('read',{filter:{name:'one'}},'one'),call('read',{filter:{name:'two'}},'two')]),answer('Two results.')],async(p)=>{await p.runAgent(brainRequest({directReply:true,tools:[tool]}));assert.equal(reads,2);});
});
test('the reply guard bounds accidental essays and preserves explicit approval/failure warnings without more AI calls',async()=>{
 const essay=Array(400).fill('Extra explanation.').join(' ');await mocked([answer(essay)],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true}));assert.ok(r.text.split(/\s+/).length<=180);assert.ok(r.text.length<=1600);assert.equal(requests.length,1);});
 await mocked([answer('',[call('save')]),answer(essay)],async(p)=>{const r=await p.runAgent(brainRequest({directReply:true,tools:[{name:'save',description:'Save',input_schema:{},handler:async()=>({status:'pending_approval'})}]}));assert.ok(r.text.endsWith('Approval is still required.'));assert.ok(r.text.split(/\s+/).length<=180);});
});
test('reminder shortcut does not swallow a question that needs an actual answer',async()=>{
 await mocked([answer('',[call('create_item',{kind:'reminder'})]),answer('Reminder set. Daily is sufficient because the deadline is next week.')],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true,history:[{role:'user',content:'Remind me tomorrow. Why should I do this daily?'}],tools:[{name:'create_item',description:'Save',input_schema:{},handler:async()=>({id:'saved',kind:'reminder',due_at:'2026-10-19'})}]}));assert.equal(requests.length,2);assert.match(r.text,/because/);});
});

test('a result that requires interpretation still returns to Terra rather than taking the fast save-only shortcut',async()=>{
 await mocked([answer('Idea saved.',[call('capture_idea'),message('Idea saved.')]),answer('Idea saved. Next: compare suppliers, estimate costs, then choose a launch date.')],async(p,requests)=>{const r=await p.runAgent(brainRequest({directReply:true,noFollowUp:['capture_idea'],tools:[{name:'capture_idea',description:'Idea',input_schema:{},handler:async()=>({id:'idea',now_do_this:'Summarize the next steps',steps:['Compare suppliers','Estimate costs']})}]}));assert.equal(requests.length,2);assert.match(r.text,/Next:/);});
});

test('save and final confirmation are submitted together and released in one AI call',async()=>{
 let writes=0;
 await mocked([answer('',[call('remember',{content:'Yeshiva evenings'},'save'),call('finish_reply',{reply:'Remembered.'},'finish')])],async(p,requests)=>{
  const result=await p.runAgent(brainRequest({batchReply:true,directReply:true,noFollowUp:['remember'],history:[{role:'user',content:'Remember my evenings are for yeshiva.'}],tools:[{name:'remember',description:'Save memory',input_schema:{type:'object',properties:{}},handler:async()=>{writes++;return {id:'memory'};}}]}));
  assert.equal(writes,1);assert.equal(requests.length,1);assert.equal(result.text,'Remembered.');assert.equal(result.metrics.rounds,1);
 });
});
test('batched confirmation cannot conceal failed writes or a lookup requiring interpretation',async()=>{
 await mocked([answer('',[call('update_item',{},'save'),call('finish_reply',{reply:'Done.'},'finish')])],async(p,requests)=>{
  const result=await p.runAgent(brainRequest({batchReply:true,directReply:true,noFollowUp:['update_item'],tools:[{name:'update_item',description:'Save',input_schema:{type:'object',properties:{}},handler:async()=>{throw Error('No such item');}}]}));assert.equal(requests.length,1);assert.match(result.text,/could not be saved/);assert.doesNotMatch(result.text,/^Done/);
 });
 await mocked([answer('',[call('search_items',{},'read'),call('finish_reply',{reply:'Nothing pending.'},'finish')]),answer('One task is pending.')],async(p,requests)=>{
  const result=await p.runAgent(brainRequest({batchReply:true,directReply:true,noFollowUp:['update_item'],tools:[{name:'search_items',readOnly:true,description:'Read',input_schema:{type:'object',properties:{}},handler:async()=>[{id:'task'}]}]}));assert.equal(requests.length,2);assert.equal(result.text,'One task is pending.');
 });
});

test('the 24-hour prompt cache is requested once, remembered when refused, and never breaks a call',async()=>{
  const original=globalThis.fetch,seen=[];
  const env={...config,OPENAI_API_KEY:'test-key-never-sent',DB:{prepare:()=>({bind(){return this},async run(){return {meta:{changes:1}}}})}};
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init?.body??await url.text());seen.push(body);
    if(body.prompt_cache_retention)return new Response(JSON.stringify({error:{message:"Unsupported parameter: 'prompt_cache_retention' is not supported with this model.",type:'invalid_request_error'}}),{status:400,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify(answer('{"ok":true}')),{headers:{'content-type':'application/json'}});
  };
  try {
    const p=getProvider(env);
    assert.equal(await p.complete({tier:'fast',purpose:'meeting_detect',system:'JSON',prompt:'a'}),'{"ok":true}');
    assert.equal(seen.length,2,'tried with the extended cache, then without');
    assert.equal(seen[0].prompt_cache_retention,'24h');assert.equal(seen[1].prompt_cache_retention,undefined);
    assert.equal(seen[1].prompt_cache_key,'cos:meeting_detect');
    await p.complete({tier:'fast',purpose:'meeting_detect',system:'JSON',prompt:'b'});
    assert.equal(seen.length,3,'does not retry the refused option on later calls');assert.equal(seen[2].prompt_cache_retention,undefined);
  } finally {globalThis.fetch=original;}
});

test('unset configuration defaults to Luna; filling in forms and the helper retry use the careful model',()=>{
 assert.equal(modelRoute({},'new_judgment').model,'gpt-6-luna');
 assert.equal(modelRoute({},'chat:text','brain').model,'gpt-6-luna');
 for(const purpose of ['fill_form','fill_check','browser_step_retry','read_file']){
  assert.equal(modelRoute({MODEL_BRAIN:'gpt-6-luna'},purpose).model,'gpt-6.1-terra',purpose);
  assert.equal(modelRoute({MODEL_BRAIN:'gpt-6-luna',MODEL_CAREFUL:'custom-careful'},purpose).model,'custom-careful',purpose);
 }
 assert.equal(modelRoute({MODEL_BRAIN:'gpt-6-luna'},'browser_step','writer').model,'gpt-6-luna');
});

test('a chat message with a PDF goes to the careful model; a picture stays on the everyday one',async()=>{
 await mocked([answer('A form.'),answer('A photo.')],async(p,requests)=>{
  await p.runAgent(brainRequest({directReply:true,attachments:[{kind:'file',name:'f.pdf',dataUrl:'data:application/pdf;base64,AA=='}]}));
  await p.runAgent(brainRequest({directReply:true,attachments:[{kind:'image',name:'p.jpg',dataUrl:'data:image/jpeg;base64,AA=='}]}));
  assert.equal(requests[0].body.model,'careful-fixture');assert.equal(requests[1].body.model,config.MODEL_MAIN);
 });
});

test('background research uses the brain with its existing search cap',async()=>{
 assert.equal(modelRoute({MODEL_BRAIN:'custom-brain',MODEL_MAIN:'legacy-brain'},'chat:text').model,'custom-brain');
 await mocked([answer('Queued')],async(p,requests)=>{await p.startBackground({system:'Research',prompt:'Approved fixture',maxSearches:3});assert.equal(requests[0].body.model,'gpt-6.1-terra');assert.equal(requests[0].body.max_tool_calls,3);assert.equal(requests[0].body.background,true);});
});

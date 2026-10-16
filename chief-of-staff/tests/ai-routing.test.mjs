import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(path) {
  const r=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
}
const {getProvider}=await load('worker/ai.ts');
const {modelRoute}=await load('worker/ai-routing.ts');
const config={MODEL_MAIN:'gpt-6.1-sol',MODEL_FAST:'gpt-6-luna'};
const usage={input_tokens:1200,output_tokens:140,total_tokens:1340,input_tokens_details:{cached_tokens:800},output_tokens_details:{reasoning_tokens:80}};
const message=text=>({type:'message',id:'msg_'+Math.random(),role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]});
const answer=(text,output)=>({id:'resp_'+Math.random(),object:'response',status:'completed',output:output??[message(text)],usage});
const call=(name,args={},id='call1')=>({type:'function_call',name,arguments:JSON.stringify(args),call_id:id,id:'fc_'+id,status:'completed'});
const brainRequest=(overrides={})=>({tier:'main',purpose:'chat:text',system:'Follow the existing approval rules.',context:'Private context only for Sol.',history:[{role:'user',content:'Remind me tomorrow.'}],tools:[],...overrides});
async function mocked(responses,fn) {
  const original=globalThis.fetch,requests=[],logs=[];
  const env={...config,OPENAI_API_KEY:'test-key-never-sent',DB:{prepare:()=>({bind(...args){logs.push(args);return this},async run(){return {meta:{changes:1}}}})}};
  globalThis.fetch=async(url,init)=>{
    const body=JSON.parse(init?.body??await url.text());requests.push({url:String(url),body});
    assert.ok(responses.length,'Unexpected API request');
    const next=responses.shift();return new Response(JSON.stringify(typeof next==='function'?next(body):next),{headers:{'content-type':'application/json'}});
  };
  try {await fn(getProvider(env),requests,logs);assert.equal(responses.length,0,'Unused response fixture');}
  finally {globalThis.fetch=original;}
}

test('all judgment purposes use Sol despite legacy fast labels; unknown work also stays with the brain',()=>{
  for(const purpose of ['whatsapp_triage','email_triage','shopping_triage','meeting_detect','watch_check','watch_keywords','tracker_check','wa_match','learn','reply_style','tidy','project_match','brain_dump','briefing','rundown','weekly_review','customers_due','meeting_notes','task_plan','task_escalate','idea_plan','reply_decision','new_judgment']) {
    assert.equal(modelRoute(config,purpose,'fast').model,'gpt-6.1-sol',purpose);
    assert.equal(modelRoute(config,purpose,'fast').effort,'low',purpose);
  }
  for(const purpose of ['title','reply_draft','chat_wording'])assert.equal(modelRoute(config,purpose,'main').model,'gpt-6-luna');
  assert.equal(modelRoute({...config,MODEL_BRAIN:'custom-brain'},'whatsapp_triage').model,'custom-brain');
});

test('a tiny JSON classification has a reasoning allowance, uses Responses low, and records model and cache usage',async()=>{
  await mocked([answer('{"needed":false}')],async(p,requests,logs)=>{
    assert.equal(await p.complete({tier:'fast',purpose:'whatsapp_triage',system:'Return JSON',prompt:'Thanks!',maxTokens:5}),'{"needed":false}');
    const req=requests[0];assert.ok(req.url.endsWith('/responses'));assert.equal(req.body.model,'gpt-6.1-sol');
    assert.equal(req.body.reasoning.effort,'low');assert.ok(req.body.max_output_tokens>=2048);
    assert.equal(logs[0][1],'gpt-6.1-sol');assert.equal(logs[0][2],'whatsapp_triage');assert.equal(logs[0][5],800);
  });
});

test('incomplete judgment is never accepted as a classification or silently downgraded to Luna',async()=>{
  await mocked([{...answer('{"needed":'),status:'incomplete'}],async(p,requests)=>{
    await assert.rejects(p.complete({tier:'fast',purpose:'email_triage',system:'JSON',prompt:'Message'}),/could not finish/);
    assert.equal(requests.length,1);
  });
});

test('Sol executes tools, preserves reasoning across rounds and dynamically loaded tools, Luna receives no authority or full context',async()=>{
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
    assert.equal(JSON.stringify(writer).includes('Private context only for Sol.'),false);
    assert.match(writer.messages[1].content,/execution_receipts/);
    assert.deepEqual(logs.map(l=>l[1]),['gpt-6.1-sol','gpt-6.1-sol','gpt-6.1-sol','gpt-6-luna']);
    assert.equal(logs[3][2],'chat_wording');
  });
});

test('a pending paid job stays pending and save-only work avoids a redundant Sol round',async()=>{
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

test('tool errors go back to Sol for a decision instead of reusing a premature success message',async()=>{
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
    assert.equal(requests[0].body.model,'gpt-6.1-sol');assert.equal(requests[0].body.max_tool_calls,2);assert.equal(r.searches,1);
  });
});

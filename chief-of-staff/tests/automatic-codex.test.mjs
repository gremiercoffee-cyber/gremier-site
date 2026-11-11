import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionPrompt,retry} from '../runner/automatic-codex.mjs';
import {THREAD} from '../runner/chief-chat-relay.mjs';
test('headless prompt preserves owner scope and approval gates',()=>{const p=executionPrompt({id:'10000000-0000-4000-8000-000000000001',thread_id:THREAD,message:'Build the requested feature'});assert.match(p,/Build the requested feature/);assert.match(p,/HARD SAFETY GATE/);assert.match(p,/never duplicate completed work/);assert.throws(()=>executionPrompt({id:'bad',thread_id:THREAD}));});
test('transport retries bounded failures without executing additional jobs',async()=>{let n=0;assert.equal(await retry(async()=>{if(++n<3)throw Error('offline');return 'receipt';},{sleep:async()=>{}}),'receipt');assert.equal(n,3);n=0;await assert.rejects(retry(async()=>{n++;throw Error('offline');},{sleep:async()=>{}}));assert.equal(n,4);});

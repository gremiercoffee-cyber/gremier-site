// Run only by the existing Chief of Staff chat after handling a relayed owner request.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {api,root} from './chief-chat-relay.mjs';
const [id,state,file]=process.argv.slice(2);
if(!/^[-a-f0-9]{36}$/.test(id||'')||!['done','needs_user','failed'].includes(state)||!file)throw Error('Usage: relay-response.mjs <request-id> <done|needs_user|failed> <answer-file>');
const receiptFile=join(root,'.local','relay-claims',id+'.json');
const receipt=JSON.parse(readFileSync(receiptFile,'utf8'));
if(receipt.phase==='answered')throw Error('This request already has a response receipt.');
const answer=readFileSync(file,'utf8');if(!answer.trim()||answer.length>20000)throw Error('Answer must contain 1–20000 characters.');
await api(`/api/agent/relay/${id}/result`,{claim_token:receipt.claim_token,state,answer});
writeFileSync(receiptFile,JSON.stringify({phase:'answered'}),{mode:0o600});
console.log('Chief of Staff response saved.');

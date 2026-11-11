// Scheduler calls the existing Chief of Staff backend; no Gmail tokens or email bodies live on this computer.
import {api} from './chief-chat-relay.mjs';
import {root} from './chief-chat-relay.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
function status(result){mkdirSync(join(root,'.local'),{recursive:true});writeFileSync(join(root,'.local','gesher-monitor-status.json'),JSON.stringify({at:new Date().toISOString(),...result}));}
try{const result=await api('/api/agent/gesher/tick',{wait:50});status(result);console.log(JSON.stringify(result));if(result.ok===false)process.exitCode=1;}catch{status({ok:false,error:'Transport unavailable'});console.error('Gesher monitor transport failed; next scheduled check retries safely.');process.exitCode=1;}

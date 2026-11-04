// Local client for the existing CoS agent API. Never prints or embeds credentials.
import {readFileSync} from 'node:fs';
const [method='GET',path='/capabilities',payloadFile]=process.argv.slice(2);
if(!/^\/(?:capabilities|chats|cos|jobs|waiting)(?:[/?]|$)/.test(path))throw Error('Use a documented agent API path.');
const key=process.env.COS_AGENT_KEY||readFileSync('C:/Users/Yoni/.tokens/cos-agent-key.txt','utf8').trim();
const body=payloadFile?readFileSync(payloadFile,'utf8'):undefined;
const r=await fetch('https://chief-of-staff.gremiercoffee.workers.dev/api/agent'+path,{method,headers:{'x-agent-key':key,'content-type':'application/json'},body});
const data=await r.json();if(!r.ok){console.error(JSON.stringify({status:r.status,error:data.error}));process.exitCode=1;}else console.log(JSON.stringify(data,null,2));

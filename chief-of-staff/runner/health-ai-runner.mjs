// Private inference transport. No health payloads on disk or in logs; no UI automation.
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';import {homedir} from 'node:os';import {fileURLToPath} from 'node:url';
import {codexExe} from './chief-chat-relay.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),work=join(root,'.local','health-inference');
const tokenDir=join(homedir(),'.tokens'),API=process.env.COS_API_ORIGIN||'https://chief-of-staff.gremiercoffee.workers.dev';
export function claudeExe(){const base=join(homedir(),'AppData','Local','Claude-Data'),files=[];for(const a of existsSync(base)?readdirSync(base):[]){const p=join(base,a,'claude-code');for(const v of existsSync(p)?readdirSync(p):[])for(const h of readdirSync(join(p,v))){const f=join(p,v,h,'claude.exe');if(existsSync(f))files.push(f);}}return files.sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs)[0];}
function claudeToken(){for(const f of ['claude-code-oauth.txt']){const p=join(tokenDir,f);if(existsSync(p)){const s=readFileSync(p,'utf8').trim();if(s.startsWith('sk-ant-oat'))return s;}}return null;}
export function cleanReply(text,json){const s=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');if(!s)throw Error('empty');if(json)JSON.parse(s);return s;}
function childEnv(){return Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(API_KEY|AGENT_KEY|TOKEN|SECRET|PASSWORD)/i.test(k)));}
export function infer(engine,req,{spawnFn=spawn,timeoutMs=engine==='codex'?45000:22000}={}){
 return new Promise(resolve=>{
  mkdirSync(work,{recursive:true});let exe,args,env=childEnv();
  const prompt=`Private Health Journal inference. Do not access files, shell, connectors, web, messages or other chats. Only reason over the supplied context. Return just the requested response, with no code fences.\n\nINSTRUCTIONS:\n${req.system}\n\nINPUT DATA:\n${req.prompt}${req.json?'\n\nReturn valid JSON only.':''}`;
  try{if(engine==='codex'){exe=codexExe();args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','-s','read-only','--disable','shell_tool','--disable','unified_exec','--disable','apps','--disable','multi_agent','--disable','skill_search','-c','project_doc_max_bytes=0','-c','web_search="disabled"','-c','mcp_servers={}','-c','plugins={}','-c','approval_policy="never"','-c','model_reasoning_effort="low"','-m',process.env.COS_HEALTH_CODEX_MODEL||'gpt-6.1-terra','--json','-'];}
   else{exe=claudeExe();if(!exe)throw Error('missing');const token=claudeToken();if(token)env.CLAUDE_CODE_OAUTH_TOKEN=token;args=['-p','--model','sonnet','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--no-session-persistence','--output-format','json','--max-turns','1'];}
  }catch{return resolve({ok:false,reason:'unavailable'});}
  let buf='',last='',settled=false;const p=spawnFn(exe,args,{cwd:work,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const finish=r=>{if(settled)return;settled=true;clearTimeout(timer);resolve(r);};
  const timer=setTimeout(()=>{p.kill();finish({ok:false,reason:'timeout'});},timeoutMs);
  p.stdout.on('data',d=>{buf+=d;if(buf.length>250000){p.kill();finish({ok:false,reason:'too_large'});return;}if(engine==='codex'){for(let i;(i=buf.indexOf('\n'))>=0;){const line=buf.slice(0,i);buf=buf.slice(i+1);try{const m=JSON.parse(line);if(m.type==='item.completed'&&m.item?.type==='agent_message')last=m.item.text;}catch{}}}});
  p.stderr.on('data',()=>{}); // Never log prompts, credential errors, or provider transcripts.
  p.on('error',()=>finish({ok:false,reason:'unavailable'}));
  p.on('close',code=>{if(code!==0)return finish({ok:false,reason:'provider_failed'});try{if(engine==='claude'){const r=JSON.parse(buf);if(r.is_error)throw Error();last=r.result;}finish({ok:true,text:cleanReply(last,req.json),engine});}catch{finish({ok:false,reason:'invalid_reply'});}});p.stdin.on('error',()=>{});p.stdin.end(prompt);
 });
}
export async function inferWithFallback(req,deps={infer}){for(const engine of ['codex','claude']){const r=await deps.infer(engine,req);if(r.ok)return r;}return {ok:false,reason:'plans_unavailable'};}
async function api(path,body){const key=process.env.COS_AGENT_KEY||readFileSync(join(tokenDir,'cos-agent-key.txt'),'utf8').trim();const r=await fetch(API+'/api/agent/health-ai/'+path,{method:'POST',headers:{'content-type':'application/json','x-agent-key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(path==='next'?70000:12000)});if(!r.ok)throw Error('transport');return r.json();}
let lastEngine=null;
export async function tick(){let codex=false;try{codex=!!codexExe()}catch{}const {request:r}=await api('next',{wait:50,codex,claude:!!claudeExe(),last_engine:lastEngine});if(!r)return false;const result=await inferWithFallback(r.payload);if(result.ok)lastEngine=result.engine;await api(r.id+'/result',{claim_token:r.claim_token,...(result.ok?{text:result.text,engine:result.engine}:{})});return true;}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){if(process.argv.includes('--probe')){const engine=process.argv.includes('--claude')?'claude':'codex';const r=await infer(engine,{system:'Return JSON only.',prompt:'Return {"connected":true}.',json:true});console.log(JSON.stringify(r.ok?{ok:true,engine:r.engine,connected:JSON.parse(r.text).connected}:{ok:false,engine,reason:r.reason}));}else do{const t0=Date.now();let busy=false;try{busy=await tick()}catch{console.error('Health AI transport unavailable; will retry.')}if(process.argv.includes('--once'))break;await new Promise(r=>setTimeout(r,busy||Date.now()-t0>20000?1000:30000));}while(true);}

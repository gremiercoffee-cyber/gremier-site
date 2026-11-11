// Owner-supplied Google Takeout only. Default is a local preview; --apply adds new IDs without overwriting history.
import {spawnSync} from 'node:child_process';import {readFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url)),args=process.argv.slice(2),archive=args.find(a=>!a.startsWith('--'));
if(!archive||args.some(a=>a.startsWith('--')&&a!=='--apply'))throw Error('Usage: node scripts/daynote_import.mjs <owner-takeout.zip> [--apply]');
const parsed=spawnSync('python',['-c',"import sys,json;sys.path.insert(0,'scripts');from daynote_takeout import parse_archive;p,s=parse_archive(sys.argv[1]);print(json.dumps({'points':p,'summary':s}))",archive],{cwd:root,encoding:'utf8',maxBuffer:30*1024*1024,env:{...process.env,PYTHONUTF8:'1'}});
if(parsed.status!==0)throw Error('Archive validation failed; no records written. Use the allowlisted Takeout parser to inspect the archive.');
const {points,summary}=JSON.parse(parsed.stdout);console.log(JSON.stringify({mode:args.includes('--apply')?'add-new-records':'preview-only',...summary}));
if(!args.includes('--apply'))process.exit(0);
const compiled=await build({stdin:{contents:"export {compactSleepMeasurement} from './shared/daynote-scores';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node'}),m=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const token=readFileSync('C:/Users/Yoni/.tokens/cloudflare-gremiercoffee.txt','utf8').trim(),endpoint='https://api.cloudflare.com/client/v4/accounts/dc73ca97eef41fb2bd0a80c0835bee95/d1/database/7b4ec7b1-cece-4e94-adf7-67e8ad5067ee/query';
let writes=0;
for(let offset=0;offset<points.length;offset+=10){
 const batch=points.slice(offset,offset+10).map(p=>p.type==='sleep'?m.compactSleepMeasurement(p):p),params=[];
 for(const p of batch)params.push(p.id,p.type,p.date,p.start_at,p.end_at,p.value,JSON.stringify(p.raw),new Date().toISOString());
 const sql='INSERT INTO daynote_measurements(id,type,date,start_at,end_at,value,raw,updated_at) VALUES '+batch.map(()=>'(?,?,?,?,?,?,?,?)').join(',')+' ON CONFLICT(id) DO NOTHING';
 const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({sql,params})});
 if(!response.ok)throw Error('Import stopped after acknowledged batches. Original records are preserved; retrying is safe.');
 const result=await response.json();if(!result.success)throw Error('D1 did not acknowledge this batch. Retrying is safe.');writes+=result.result.reduce((n,r)=>n+(r.meta?.changes||0),0);
}
console.log(JSON.stringify({acknowledged_candidates:points.length,reported_changes_including_triggers:writes,overwrite_existing:false,raw_hr_imported:false,scores:'Incremental nightly refresh follows through the existing app.'}));

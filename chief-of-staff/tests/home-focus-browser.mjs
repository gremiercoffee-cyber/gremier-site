// Synthetic local Home fixtures. No production tasks, messages or reminders are changed.
import {spawn} from 'node:child_process';import {chromium} from 'playwright';import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5183'],{windowsHide:true,stdio:'ignore'});
for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:5183/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('cos.token','synthetic-only');localStorage.setItem('cos.area','all');});
const stamp=new Date().toISOString(),old=new Date(Date.now()-30*86400000).toISOString();
const item=(id,title,category='coffee',extra={})=>({id,title,category,kind:'task',status:'open',priority:2,due_at:null,created_at:stamp,updated_at:stamp,notes:'',source:'manual',...extra});
let tasks=[item('a','Grind beans'),item('b','Prepare bottles'),item('c','Pay invoice','personal',{priority:1,due_at:stamp}),item('d','Print labels'),item('e','Call Avi','yeshiva'),item('old','Old catalog idea','coffee',{created_at:old,updated_at:old}),item('later','Look at next week','personal'),item('wait','Wait for Fixture quote','coffee',{kind:'waiting'})];
const nowIds=new Set(['a','b','c','d','e']);const dash=()=>({today:[],overdue:[],waiting:[],pending:[],projects:[],events:[],counts:{task:tasks.length},timezone:'Asia/Jerusalem',home_projects:[],home_tasks:tasks,now_block:{id:'now',name:'Ready to work on',category:null,until:null,items:tasks.filter(t=>nowIds.has(t.id)),count:tasks.filter(t=>nowIds.has(t.id)).length},nudges:[{id:'brief',type:'briefing',title:'Today briefing',body:'LONG BRIEFING HIDDEN BY DEFAULT',created_at:stamp,actions:[]},{id:'stale',type:'review',title:'Old noisy update',body:'Stale update',created_at:old,actions:[]}],attention_cards:[]});
await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let data=[];
 if(path==='/api/health')data={ok:true,configured:true,model:true,transcription:true};else if(path==='/api/settings')data={name:'Yoni',timezone:'Asia/Jerusalem'};else if(path==='/api/dashboard')data=dash();else if(path==='/api/areas')data=[{key:'coffee',label:'Coffee',icon:'☕'},{key:'yeshiva',label:'Yeshiva',icon:'📚'},{key:'personal',label:'Personal',icon:'🏠'}];
 else if(req.method()==='PATCH'&&path.startsWith('/api/items/')){const id=path.split('/').at(-1);await new Promise(r=>setTimeout(r,1000));tasks=tasks.filter(i=>i.id!==id);data={ok:true};}
 else if(path==='/api/meeting-prep')data={meetings:[],notes:[],drafts:[],pending:[],timezone:'Asia/Jerusalem'};
 await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
});
try{
 await page.goto('http://127.0.0.1:5183/');await page.getByRole('button',{name:'Mark done: Grind beans',exact:true}).waitFor();
 assert.equal(await page.locator('section[aria-label="Now"] button[aria-label^="Mark done"]').count(),3);
 assert.equal(await page.getByText('Old catalog idea',{exact:true}).isVisible(),false);
 assert.equal(await page.getByText('LONG BRIEFING HIDDEN BY DEFAULT',{exact:false}).isVisible(),false);
 assert.equal(await page.getByRole('button',{name:'Mark done: Wait for Fixture quote',exact:true}).count(),0);
 await page.locator('details[aria-label="Waiting on others"] > summary').click();assert.equal(await page.getByRole('button',{name:'Fixture quote',exact:true}).isVisible(),true);await page.locator('details[aria-label="Waiting on others"] > summary').click();
 assert.equal(await page.getByText('Old noisy update',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:'.local/home-focus-mobile.png',fullPage:false});
 await page.getByRole('button',{name:'+ 2 more for now',exact:true}).click();assert.equal(await page.locator('section[aria-label="Now"] button[aria-label^="Mark done"]').count(),5);
 await page.getByRole('button',{name:'Show fewer',exact:true}).click();
 await page.locator('details[aria-label="For later"] > summary').click();assert.equal(await page.getByText('Old catalog idea',{exact:true}).isVisible(),true);await page.locator('details[aria-label="For later"] > summary').click();
 await page.getByRole('button',{name:'☕ Coffee',exact:true}).click();assert.equal(await page.getByText('Pay invoice',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Mark done: Grind beans',exact:true}).click();await page.waitForTimeout(100);assert.equal(await page.getByRole('button',{name:'Mark done: Grind beans',exact:true}).count(),0,'completion disappears before network acknowledgement');
 await page.waitForTimeout(1200);assert.deepEqual(errors,[]);
 await page.getByRole('button',{name:'All',exact:true}).click();await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local/home-focus-desktop.png',fullPage:false});
 console.log('Home: three-item focus, collapsed older work, fresh-only updates, area filters, no horizontal overflow and immediate completion verified.');
}finally{await browser.close();server.kill();}

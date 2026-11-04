// Synthetic local mobile UI only. No production reads or messages.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5182'],{windowsHide:true,stdio:'ignore'});
for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:5182/')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('cos.token','synthetic-only'));
const stamp=new Date().toISOString();let pin=true,project=null;
const row={id:'fixture',title:'Mini-bottle packaging',status:'active',pinned:true,unread:0,schedule:'once',last_text:'Three candidates compared',last_at:stamp,kind:'once',engine:'codex',model:null};
const knowledge={title:row.title,instructions:'Find printed carriers',project_id:null,project_title:null,revision:2,state:'Waiting externally',stale:false,last_checked:stamp,telegram:{synced:true,error:null},brief:{summary:'Three suppliers compared. Awaiting two quotes.',recommendation:'Compare a divided box with a carrier.',next_action:'Review incoming quotes.',questions:['One colour or full colour?'],source_revision:2,updated_at:stamp},emails:[{id:'e',number:1,to_name:'Fixture supplier',to_email:'supplier@example.test',subject:'Quote',body:'Please quote',status:'replied',reply_text:'Synthetic quote only',replied_at:stamp}],reports:[{id:'r',result:'Synthetic full research report',finished_at:stamp}]};
await page.route('**/api/**',async route=>{const url=new URL(route.request().url()),path=url.pathname;let data=[];
 if(path==='/api/health')data={ok:true,configured:true,model:true};
 else if(path==='/api/settings')data={name:'Fixture',timezone:'Asia/Jerusalem'};
 else if(path==='/api/jobs')data=[{...row,pinned:pin}];
 else if(path==='/api/jobs/fixture')data={...row,pinned:pin,busy:false,knowledge:{...knowledge,project_id:project},messages:[{id:'m',role:'bot',text:'Earlier conversation message',created_at:stamp}]};
 else if(path==='/api/projects')data=[{id:'p',name:'Packaging launch',status:'active',area:'business'}];
 else if(path.endsWith('/project')){project=route.request().postDataJSON().project_id;data={ok:true};}
 else if(path.endsWith('/pin')){pin=route.request().postDataJSON().pinned;data={ok:true};}
 else if(path.endsWith('/brief/history'))data=[{source_revision:1,document:JSON.stringify({...knowledge.brief,summary:'Earlier brief'}),created_at:stamp}];
 await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
});
try{
 await page.goto('http://127.0.0.1:5182/?job=fixture');
 await page.getByRole('heading',{name:'At a glance',exact:true}).waitFor();
 assert.ok(await page.getByRole('heading',{name:'At a glance',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight;}));
 assert.ok(await page.getByText('Three suppliers compared. Awaiting two quotes.').isVisible());
 assert.equal(new URL(page.url()).searchParams.get('job'),'fixture');await page.reload();await page.getByRole('heading',{name:'At a glance',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByText('Manage job',{exact:true}).click();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/project')),page.getByLabel('Project',{exact:true}).selectOption('p')]);assert.equal(project,'p');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/pin')),page.getByRole('button',{name:'Unpin',exact:false}).click()]);assert.equal(pin,false);assert.ok(await page.getByText('Waiting externally',{exact:true}).isVisible());
 await page.getByText('Manage job',{exact:true}).click();
 assert.equal(await page.getByText('Earlier conversation message',{exact:true}).isVisible(),false);
 assert.equal(await page.getByText('Synthetic full research report',{exact:true}).isVisible(),false);
 await page.reload();await page.getByRole('heading',{name:'At a glance',exact:true}).waitFor();await page.screenshot({path:'.local/job-overview-mobile.png',fullPage:false});
 await page.getByText('More details',{exact:true}).click();await page.getByText('Previous versions',{exact:true}).click();await page.getByText('Version 1',{exact:false}).click();assert.ok(await page.getByText('Earlier brief',{exact:true}).isVisible());
 await page.getByText('More details',{exact:true}).click();
 await page.getByRole('button',{name:'Conversation',exact:true}).click();assert.ok(await page.getByText('Earlier conversation message',{exact:true}).isVisible());await page.getByRole('button',{name:'Overview',exact:true}).click();
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'.local/job-overview-desktop.png',fullPage:false});assert.deepEqual(errors,[]);console.log('Mobile brief visible on open; folder assignment, pin independence, history and no horizontal overflow verified.');
}finally{await browser.close();server.kill();}

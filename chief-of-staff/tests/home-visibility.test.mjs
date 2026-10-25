import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import HomeWork from './src/components/HomeWork';export {groupHomeWork} from './shared/home-work';export const render=(tasks,projects)=>renderToStaticMarkup(React.createElement(HomeWork,{tasks,projects,inArea:()=>true,onChanged(){}}));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',packages:'external',jsx:'automatic'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {render,groupHomeWork}=compiled.exports;
const task=(id,extra={})=>({id,title:'Work '+id,kind:'task',status:'open',priority:2,notes:null,due_at:null,created_at:new Date().toISOString(),...extra});
test('every open item has exactly one inventory location, with orphan projects falling back to standalone',()=>{
 const tasks=[task('assigned',{project_id:'project'}),task('orphan',{project_id:'missing'}),task('email',{source:'gmail'}),task('muted',{muted:1}),task('later',{nudge_after:'2099-01-01'}),task('assigned',{project_id:'project'}),task('closed',{status:'done'})];
 const grouped=groupHomeWork(tasks,[{id:'project',name:'Related outcome',status:'paused'}]);
 assert.deepEqual(grouped.projects[0].items.map(i=>i.id),['assigned']);assert.deepEqual(grouped.standalone.map(i=>i.id),['orphan','email','muted','later']);
});
test('Home lists every project and all standalone work without alert filters or truncation; projects start folded and remember what you open',()=>{
 const tasks=[task('first',{project_id:'project'}),task('second',{project_id:'project'}),...Array.from({length:15},(_,i)=>task('single'+i)),task('muted',{muted:1}),task('later',{nudge_after:'2099-01-01'})];
 const html=render(tasks,[{id:'project',name:'Related outcome',status:'active'}]);assert.ok(html.includes('<details'));assert.ok(!html.includes('<details open=""'),'projects start folded; the open/closed choice is remembered on the device');assert.ok(html.includes('Related outcome'));for(const item of tasks)assert.ok(html.includes(item.title),item.id);assert.ok(html.includes('Alerts muted'));assert.ok(html.includes('Scheduled for later'));assert.equal(html.includes('Upcoming events'),false);
});

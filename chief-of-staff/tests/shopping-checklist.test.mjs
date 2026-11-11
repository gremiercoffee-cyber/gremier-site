import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import ShoppingChecklist from './src/components/ShoppingChecklist';export const render=(items,at)=>renderToStaticMarkup(React.createElement(ShoppingChecklist,{items,at,busy:false,onToggle(){},onEdit(){}}));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',packages:'external',jsx:'automatic'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {render}=compiled.exports;
test('recent purchases remain blue outside a collapsed archive, which retains restore controls',()=>{
 const item=(id,checked,checked_at)=>({id,list_id:'store',name:id,quantity:'',notes:'',checked,checked_at,source:'manual',created_at:'2026-10-01',updated_at:checked_at??'2026-10-01'});
 const html=render([item('Needed',0,null),item('Recent',1,'2026-10-18T12:00:00Z'),item('Older',1,'2026-10-16T12:00:00Z')],Date.parse('2026-10-18T13:00:00Z'));
 const [visible,archive]=html.split('<details');assert.ok(visible.includes('Mark Recent needed'));assert.ok(visible.includes('line-through text-blue-600'));assert.ok(!visible.includes('Older'));
 assert.ok(archive.includes('Purchased archive'));assert.ok(archive.includes('Mark Older needed'));assert.ok(!archive.split('>')[0].includes('open'));
 assert.ok(!render([item('Needed',0,null)],Date.now()).includes('<details'));
});

test('Store shows route headings and preserves independent purchase sections; other lists have no aisle headings',()=>{const item=(id,name,list='store')=>({id,list_id:list,name,quantity:'2',notes:'keep this note',checked:0,checked_at:null,source:'manual',created_at:'2026-11-05',updated_at:'2026-11-05'});const html=render([item('w','Wipes'),item('b','Bread'),item('h','Herring'),item('o','Oatmeal')],Date.now());assert.ok(html.indexOf('Spices &amp; oatmeal')<html.indexOf('Bread, pita &amp; challah'));assert.ok(html.indexOf('Mark Oatmeal')<html.indexOf('Mark Bread'));assert.ok(html.indexOf('Mark Herring')<html.indexOf('Mark Wipes'));assert.ok(html.includes('keep this note'));const other=render([item('w','Wipes','amazon'),item('b','Bread','amazon')],Date.now());assert.ok(other.indexOf('Mark Wipes')<other.indexOf('Mark Bread'));assert.ok(!other.includes('Spices &amp; oatmeal'));});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const bundle=await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import NowChecklist from './src/components/NowChecklist';export const render=items=>renderToStaticMarkup(React.createElement(NowChecklist,{items,onChanged(){}}));`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',packages:'external',jsx:'automatic'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const {render}=compiled.exports;
test('Now renders a project heading and individually accessible completion buttons, retaining optional wording',()=>{
 const html=render([{id:'a',title:'Grind beans',project_id:'p',project:'Sunday afternoon — 18 October 2026'},{id:'b',title:'Print stickers (optional)',project_id:'p',project:'Sunday afternoon — 18 October 2026'},{id:'c',title:'An unrelated task'}]);
 assert.equal((html.match(/Sunday afternoon/g)||[]).length,1);
 for(const title of ['Grind beans','Print stickers (optional)','An unrelated task'])assert.ok(html.includes(`aria-label="Mark done: ${title}"`));
 assert.equal((html.match(/aria-label="Mark done:/g)||[]).length,3);
});


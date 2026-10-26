const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('../ops-app/node_modules/typescript');
const context={exports:{},Intl,Date};vm.runInNewContext(ts.transpile(fs.readFileSync('supabase/functions/_shared/widget-production.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),context);
const plan=context.exports.widgetDrains;
const drain=(id,date,time,product='classic')=>({id,date,time,product,kg:3,label:'Drain '+product});
const now=new Date('2026-10-26T12:00:00Z'); // 14:00 Jerusalem
test('all ready drains surface together, including exact due minute; future drain waits',()=>{
 const r=plan([drain('later','2026-10-26','15:00'),drain('due','2026-10-26','14:00:00','colombia'),drain('overdue','2026-10-25','17:00')],now);
 assert.equal(r.title,'Ready to drain');assert.deepEqual(Array.from(r.buttons,b=>b.args.job_id),['overdue','due']);assert.equal(r.buttons[1].sub,'Today 14:00');
});
test('next scheduled drain remains accessible; empty or fake drain creates no empty section',()=>{
 assert.equal(plan([drain('later','2026-10-26','15:00')],now).title,'Next drain');assert.equal(plan([],now),null);
 assert.equal(plan([{...drain('fake','2026-10-26','13:00'),label:'Stock correction'}],now),null);
});
test('phone config has no clock-in section and defaults attribution to owner',()=>{
 const source=fs.readFileSync('supabase/functions/_shared/hub-actions.ts','utf8');const start=source.indexOf('async function widgetConfig'),end=source.indexOf('// ── Stock pop-up',start);const config=source.slice(start,end);
 assert.doesNotMatch(config,/shiftButtons|title:"Workers"|production_clock_in|production_clock_out/);assert.match(config,/label:"Performed by",default:"owner"/);
});

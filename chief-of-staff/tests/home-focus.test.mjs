import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const b=await build({entryPoints:['shared/home-focus.ts'],bundle:true,write:false,format:'esm',platform:'node'});const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const at=new Date('2026-11-03T10:00:00Z');const task=(id,extra={})=>({id,title:id,status:'open',kind:'task',priority:2,due_at:null,created_at:'2026-10-01T10:00:00Z',updated_at:'2026-10-01T10:00:00Z',...extra});
test('only older undated nonurgent work moves aside; deadlines, importance and recent activity stay protected',()=>{
 assert.equal(m.olderNonUrgent(task('old'),at),true);assert.equal(m.olderNonUrgent(task('due',{due_at:'2026-10-02T10:00:00Z'}),at),false);assert.equal(m.olderNonUrgent(task('important',{priority:1}),at),false);assert.equal(m.olderNonUrgent(task('recent',{updated_at:'2026-11-02T10:00:00Z'}),at),false);
});
test('current explicit work survives aging; deadlines rank before the ordinary block list',()=>{
 const rows=[task('old'),task('scheduled'),task('deadline',{due_at:'2026-11-03T08:00:00Z'}),task('important',{priority:1})];const r=m.focusCandidates(rows,new Set(['scheduled']),at);assert.deepEqual(r.map(i=>i.id),['deadline','important','scheduled']);assert.equal(rows.length,4);
});
test('home inventory stays complete without duplicating Now or completed tasks',()=>{
 const rows=[task('now'),task('old'),task('later',{updated_at:at.toISOString()}),task('done',{status:'done'}),task('old')];const r=m.partitionHomeInventory(rows,new Set(['now']),at);assert.deepEqual(r.older.map(i=>i.id),['old']);assert.deepEqual(r.other.map(i=>i.id),['later']);assert.equal(rows[1].status,'open');
});
test('updates use the current Jerusalem calendar day across midnight, not a rolling 24-hour window',()=>{
 const midnight=new Date('2026-11-03T22:15:00Z');assert.equal(m.currentHomeUpdate('2026-11-03T21:59:00Z','Asia/Jerusalem',midnight),false);assert.equal(m.currentHomeUpdate('2026-11-03T22:01:00Z','Asia/Jerusalem',midnight),true);assert.equal(m.currentHomeUpdate('invalid','Asia/Jerusalem',midnight),false);
});

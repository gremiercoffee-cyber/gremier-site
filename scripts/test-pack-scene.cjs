const test = require('node:test');
const assert = require('node:assert/strict');
const {reconcile,geometry} = require('../storefront-pack-layout.js');
test('empty carrier has six empty slots', () => assert.deepEqual(reconcile([], {}), Array(6).fill(null)));
test('adds to next free slot and preserves other bottles after removal', () => {
  const full = reconcile([], {original:3, vanilla:3});
  assert.deepEqual(full, ['original','original','original','vanilla','vanilla','vanilla']);
  const removed = reconcile(full, {original:2, vanilla:3});
  assert.deepEqual(removed, ['original','original',null,'vanilla','vanilla','vanilla']);
  assert.deepEqual(reconcile(removed, {original:2,vanilla:3,classic:1}), ['original','original','classic','vanilla','vanilla','vanilla']);
});
test('five Classic plus one Caramel, removal and swap stay stable', () => {
  const slots = reconcile([], {classic:5,caramel:1});
  assert.deepEqual(reconcile(slots, {classic:4,caramel:1,vanilla:1}), ['classic','classic','classic','classic','vanilla','caramel']);
});
test('never more than six; invalid counts are empty', () => {
  assert.equal(reconcile([], {a:20,b:8}).filter(Boolean).length,6);
  assert.deepEqual(reconcile([], {a:-1,b:NaN,c:0}), Array(6).fill(null));
});
test('bottle bases land within their tray compartments, with correct depth', () => {
  for (const pool of ['minis','bottles']) for(let col=0;col<3;col++) {
    const back=geometry(col,pool), front=geometry(col+3,pool);
    const bounds=[[15,38.3],[38.3,61.7],[61.7,85]][col];
    for(const g of [back,front]) {
      assert.ok(g.left+g.width/2>bounds[0]&&g.left+g.width/2<bounds[1]);
      assert.ok(g.bottom+g.height<=100,'bottle stays inside scene');
    }
    assert.ok(back.bottom>=18&&back.bottom<=22,'back floor');
    assert.ok(front.bottom>=10&&front.bottom<=12,'front floor');
    assert.ok(back.z<front.z,'front row occludes back row');
  }
});

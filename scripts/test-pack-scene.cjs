const test = require('node:test');
const assert = require('node:assert/strict');
const {reconcile} = require('../storefront-pack-layout.js');
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

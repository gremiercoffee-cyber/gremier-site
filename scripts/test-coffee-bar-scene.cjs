const test = require('node:test');
const assert = require('node:assert/strict');
const { layout } = require('../storefront-bar-layout.js');
const full = guests => ({ guests, classic: Math.ceil(guests / 25), mix: {}, dispensers: 1, milkLiters: Math.floor(guests / 10), parveLiters: 0, syrups: 2 });
const of = (scene, kind) => scene.items.filter(item => item.kind === kind);

test('25 to 50 guests adds an actual can and three milk cartons', () => {
  const small = layout(full(25)), large = layout(full(50));
  assert.equal(of(small, 'coffee').length, 1);
  assert.equal(of(large, 'coffee').length, 2);
  assert.equal(of(small, 'milk').length, 2);
  assert.equal(of(large, 'milk').length, 5);
  for (const kind of ['cups', 'straws']) {
    assert.ok(of(large, kind)[0].h > of(small, kind)[0].h);
    assert.equal(of(large, kind).reduce((n, item) => n + item.units, 0), 50);
  }
});

test('a flavour upgrade swaps one can and preserves the other physical slot', () => {
  const before = of(layout(full(50)), 'coffee');
  const after = of(layout({ ...full(50), classic: 1, mix: { house: 1 } }), 'coffee');
  assert.deepEqual(after.map(item => item.id), before.map(item => item.id));
  assert.deepEqual(after.map(item => item.variant), ['classic', 'house']);
});

test('mixed coffees, four dispensers, and both types of milk all appear separately', () => {
  const scene = layout({ ...full(125), classic: 2, mix: { house: 1, colomb: 1, decaf: 1 }, dispensers: 4, parveLiters: 6 });
  assert.equal(of(scene, 'coffee').length, 5);
  assert.equal(of(scene, 'disp').length, 4);
  assert.equal(of(scene, 'milk').filter(item => item.variant === 'dairy').length, 6);
  assert.equal(of(scene, 'milk').filter(item => item.variant === 'parve').length, 6);
  for (const kind of ['cups', 'straws']) {
    assert.equal(of(scene, kind).reduce((n, item) => n + item.units, 0), 125);
    assert.equal(of(scene, kind).length, 3);
  }
});

test('coffee-only package excludes unselected add-ons', () => {
  const scene = layout({ guests: 50, classic: 2, mix: {}, dispensers: 0, milkLiters: 0, syrups: 0 });
  assert.deepEqual([...new Set(scene.items.map(item => item.kind))], ['coffee', 'sugar', 'cups', 'straws']);
  const added = layout({ guests: 50, classic: 2, mix: {}, dispensers: 1, milkLiters: 0, syrups: 1 });
  assert.equal(of(added, 'disp').length, 1);
  assert.equal(of(added, 'caramel').length, 1);
  assert.equal(of(added, 'vanilla').length, 0);
});

test('explicit vanilla-only selection shows vanilla without caramel in the scene', () => {
  const scene = layout({ guests: 50, classic: 2, dispensers: 0, milkLiters: 0, syrupFlavours: ['vanilla'] });
  assert.equal(of(scene, 'vanilla').length, 1);
  assert.equal(of(scene, 'caramel').length, 0);
  assert.equal(of(scene, 'sugar').length, 1);
  assert.equal(of(scene, 'coffee').length, 2);
});

test('all supported packages fit their canvas and remain on the table', () => {
  for (const guests of [25, 50, 75, 100, 125]) for (const dispensers of [1, 2, 3, 4]) {
    const scene = layout({ ...full(guests), dispensers });
    assert.equal(new Set(scene.items.map(item => item.id)).size, scene.items.length);
    for (const item of scene.items) {
      assert.ok(item.x >= 0 && item.x + item.w <= scene.width);
      assert.ok(item.bottom >= 0 && item.bottom <= 10);
      assert.ok(item.h + item.bottom <= scene.height);
    }
  }
});

test('the bar is centered on the table at every size, with even space on both sides', () => {
  for (const plan of [{ guests: 75, classic: 3, mix: {}, dispensers: 0, milkLiters: 0, syrups: 0 }, full(25), full(125)]) {
    const scene = layout(plan);
    const left = Math.min(...scene.items.map(item => item.x)), right = Math.max(...scene.items.map(item => item.x + item.w));
    assert.ok(Math.abs(left - (scene.width - right)) < 1, 'left ' + left + ' right ' + (scene.width - right));
  }
});

test('an extra jerry can stands with the bar own jugs', () => {
  const plan = { guests: 75, classic: 3, mix: {}, dispensers: 1, milkLiters: 7, syrups: 2 };
  const withExtra = layout({ ...plan, extraCoffee: ['colomb'] });
  assert.equal(of(withExtra, 'coffee').length, 4);
  assert.equal(of(withExtra, 'coffee').at(-1).variant, 'colomb');
  assert.deepEqual(of(withExtra, 'coffee').slice(0, 3).map(i => i.id), of(layout(plan), 'coffee').map(i => i.id));
});

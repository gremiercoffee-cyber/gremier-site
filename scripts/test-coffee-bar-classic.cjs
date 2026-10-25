const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture() {
  const product = { name_en: 'Premium', variations: [{ type: 'choice', name: 'Guests', options: [{ label: '50', price: 599 }] }], addons: [
    { name: 'House Blend', per_jug: true, price: 49 },
    { name: 'Colombian', per_jug: true, price: 49 },
    { name: 'Decaf', per_jug: true, price: 49 },
    { name: 'Parve milk', per_liter: true, price: 7 },
    { name: 'Extra dispenser', max: 3, price: 49 }
  ] };
  const basic = { name_en: 'Basic Coffee Bar', category: 'coffeebars', variations: [{ type: 'choice', name: 'Guests', options: [{ label: '50', price: 449 }] }], addons: [
    { name: 'Extra dispenser', price: 49 },
    { name: 'Syrup (caramel or vanilla)', price: 59, max: 2, legacy_syrup: true },
    { name: 'Caramel syrup', price: 59, bar_syrup: 'caramel' },
    { name: 'Vanilla syrup', price: 59, bar_syrup: 'vanilla' }
  ] };
  const context = { window: {}, document: { readyState: 'loading', addEventListener() {} }, addEventListener() {}, products: [product, basic], getProductAddons: p => p.addons, isCoffeeBarProduct: p => p.category === 'coffeebars', lang: 'en' };
  const source = fs.readFileSync(require.resolve('../storefront-planner.js'), 'utf8')
    .replace("  if (document.readyState === 'loading')", '  window.testApi={state,suggestion,swapClassic};\n  if (document.readyState === \'loading\')');
  vm.runInNewContext(source, context);
  return context.window.testApi;
}

test('restore Classic from an all-upgraded mix without changing jug count', () => {
  const { state, suggestion, swapClassic } = fixture();
  state.mix.house = 1; state.mix.colomb = 1;
  assert.equal(suggestion().classic, 0);
  assert.equal(suggestion().total, 746);
  swapClassic('house', 'restore');
  const mixed = suggestion();
  assert.equal(mixed.classic, 1);
  assert.equal(mixed.mix.colomb, 1);
  assert.equal(mixed.mix.house, undefined);
  assert.equal(mixed.total, 697);
  assert.equal(mixed.jugs, 2);
  swapClassic('colomb', 'restore');
  const classic = suggestion();
  assert.equal(classic.classic, 2);
  assert.equal(classic.total, 599);
  assert.equal(classic.dispensers, 1);
  assert.equal(classic.qty.length, 0);
});

test('Classic decrement upgrades only the chosen flavour and cannot exceed the package', () => {
  const { suggestion, swapClassic } = fixture();
  swapClassic('decaf', 'upgrade');
  assert.equal(suggestion().classic, 1);
  assert.equal(suggestion().mix.decaf, 1);
  swapClassic('house', 'upgrade');
  swapClassic('colomb', 'upgrade');
  const full = suggestion();
  assert.equal(full.classic, 0);
  assert.equal(full.mix.colomb, undefined);
  assert.equal(Object.values(full.mix).reduce((a, b) => a + b, 0), 2);
});

test('restoring an empty or unavailable flavour changes nothing', () => {
  const { suggestion, swapClassic } = fixture();
  swapClassic('house', 'restore');
  swapClassic('missing', 'upgrade');
  assert.equal(suggestion().classic, 2);
  assert.equal(suggestion().total, 599);
});

test('Basic vanilla-only selection charges and hands off the named vanilla add-on', () => {
  const { state, suggestion } = fixture();
  state.full = false;
  state.syrups.vanilla = true;
  const plan = suggestion();
  assert.equal(plan.total, 508);
  assert.equal(plan.syrups, 1);
  assert.equal(plan.syrupFlavours.join(','), 'vanilla');
  assert.equal(plan.checks.join(','), '3');
  assert.equal(plan.qty.length, 0);
  assert.equal(plan.dispensers, 0);
  assert.equal(plan.tier.guests, 50);
});

test('Basic named syrups and optional dispenser retain their individual prices', () => {
  const { state, suggestion } = fixture();
  state.full = false;
  state.syrups.vanilla = true;
  state.syrups.caramel = true;
  state.dispenser = true;
  const plan = suggestion();
  assert.equal(plan.total, 616);
  assert.equal(plan.syrupFlavours.join(','), 'caramel,vanilla');
  assert.equal(plan.checks.join(','), '0,2,3');
  assert.equal(plan.dispensers, 1);
  state.syrups.vanilla = false;
  state.syrups.caramel = false;
  state.dispenser = false;
  assert.equal(suggestion().total, 449);
});

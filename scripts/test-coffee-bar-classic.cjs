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
    { name: 'Extra dispenser', max: 3, price: 49 },
    {name:'Caramel syrup',bar_syrup:'caramel',price:59,max:6},
    {name:'Vanilla syrup',bar_syrup:'vanilla',price:59,max:6},
    {name:'Sugar syrup',bar_syrup:'sugar',price:59,max:6}
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

test('premium extras preserve included syrup, quantities and catalogue pricing',()=>{
  const {state,suggestion}=fixture();state.syrups.vanilla=2;state.syrups.sugar=1;
  const plan=suggestion();assert.equal(plan.total,776);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.syrupCounts)),{caramel:1,vanilla:3,sugar:2});
  assert.deepEqual(Array.from(plan.qty,q=>Array.from(q)),[[6,2],[7,1]]);
});
test('syrup counts clamp to the limit and switching guest size retains extras',()=>{
  const {state,suggestion}=fixture();state.syrups.sugar=100;state.syrups.caramel=-1;
  const plan=suggestion();assert.equal(plan.syrupCounts.sugar,7);assert.equal(plan.syrupCounts.caramel,1);assert.equal(plan.total,953);
});

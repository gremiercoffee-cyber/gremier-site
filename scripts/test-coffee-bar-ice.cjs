const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteCoffeeBarIce, recommendedIceBags, buildCoffeeBarConfiguration, describeCoffeeBar, coffeeBarSchedulePrefill } = require('../coffee-bar-order.js');
const { layout } = require('../storefront-bar-layout.js');

test('ice restarts the insulated-bag price after every three bags', () => {
  for (const [bags, insulatedBags, price] of [[0, 0, 0], [1, 1, 59], [2, 1, 79], [3, 1, 99], [4, 2, 158], [5, 2, 178], [6, 2, 198], [7, 3, 257]]) {
    assert.deepEqual(quoteCoffeeBarIce(bags), { bags, insulatedBags, price });
  }
  for (const invalid of [-1, 1.5, '3', Infinity, 100]) {
    assert.throws(() => quoteCoffeeBarIce(invalid), /Invalid coffee bar ice quantity/);
  }
  assert.deepEqual([25, 50, 75, 100, 125].map(recommendedIceBags), [1, 2, 2, 3, 3]);
});

test('only coffee bars with a valid guest tier record and price ice', () => {
  const bar = {
    id: '9361ff6e-4227-44cc-a23a-428a002f1f4c',
    variations: [{ type: 'choice', name: 'Guests', options: [{ label: '50', price: 599 }] }],
  };
  const selection = { selected_variations: { Guests: { label: '50' } } };
  assert.equal(buildCoffeeBarConfiguration(bar, selection).ice, undefined);
  assert.equal(buildCoffeeBarConfiguration({ ...bar, id: 'bottle' }, { ...selection, ice_bags: 4 }), null);
  assert.equal(buildCoffeeBarConfiguration(bar, { ice_bags: 4 }), null);
  const config = buildCoffeeBarConfiguration(bar, { ...selection, ice_bags: 4, ice: { price: 1 } });
  assert.deepEqual(config.ice, { bags: 4, insulatedBags: 2, price: 158 });
  assert.match(describeCoffeeBar(config), /4 ice bags in 2 insulated bags/);
  const job = coffeeBarSchedulePrefill({ items: [{ qty: 2, coffee_bar_configuration: config }] });
  assert.deepEqual(job.coffeeBarConfiguration.bars.map(bar => bar.ice), [config.ice, config.ice]);
});

test('the scene shows one insulated bag per set with the right counts', () => {
  const plan = { guests: 50, classic: 2 };
  const ice = bags => layout({ ...plan, iceBags: bags }).items.filter(item => item.kind === 'ice');
  assert.deepEqual(ice(0), []);
  assert.deepEqual(ice(2).map(item => item.units), [2]);
  assert.deepEqual(ice(4).map(item => item.units), [3, 1]);
});

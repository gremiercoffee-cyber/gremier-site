const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise both the editable source and the exact generated code shipped to browsers.
for (const file of ['admin-src/react-1.jsx', 'admin-react-1.js']) {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('function generateWAMessage2(');
  const end = source.indexOf('function buildStoreWaLink2(', start);
  const window = { __OPS_PRODUCTS__: {
    'catalog-unfiltered': { label: 'Unfiltered Liter Bottle', category: 'liter' },
    'future-product': { label: 'New Seasonal Product', category: 'new-category' },
  }};
  const ctx = { window };
  vm.runInNewContext(source.slice(start, end), ctx);
  const message = quantities => ctx.generateWAMessage2('Test Store', { quantities });

  test(`${file}: new products, jerry cans and dispensers appear with a complete total`, () => {
    const text = message({ classic_liter: 12, 'catalog-unfiltered': 6,
      'future-product': 3, jerry_can: 2, dispenser: 1 });
    for (const line of ['Classic Liter: 12', 'Unfiltered Liter Bottle: 6',
      'New Seasonal Product: 3', 'Jerry Can: 2', 'Dispenser: 1', 'סה"כ: 24']) {
      assert.ok(text.includes(line), `Missing ${line} in ${text}`);
    }
  });

  test(`${file}: simple quantity boxes include Unfiltered, including Unfiltered-only deliveries`, () => {
    assert.match(message({ _agg_unfiltered: 7 }), /Unfiltered Liter Bottle: 7/);
    const text = message({ _agg_large: 4, _agg_small: 3, _agg_dairy_free: 2,
      _agg_unfiltered: 7, _agg_syrup: 1 });
    assert.match(text, /סה"כ: 17/);
    assert.match(text, /בקבוק גדול: 4/);
    assert.match(text, /ללא חלב: 2/);
  });

  test(`${file}: unknown saved products are retained when catalog metadata is missing`, () => {
    const text = message({ 'retired-product-id': '5', unfiltered_liter: 2 });
    assert.match(text, /retired-product-id: 5/);
    assert.match(text, /Unfiltered Liter Bottle: 2/);
    assert.match(text, /סה"כ: 7/);
  });

  test(`${file}: zero, negative and invalid counts do not pollute totals`, () => {
    const text = message({ classic_liter: '4', dispenser: 0, bad: 'NaN', negative: -1 });
    assert.match(text, /סה"כ: 4/);
    assert.doesNotMatch(text, /dispenser|bad|negative|NaN/);
    assert.match(message(undefined), /סה"כ: 0/);
  });
}

test('deliveries consisting only of products outside the billing categories still create a notification job', async () => {
  const html = fs.readFileSync('admin.html', 'utf8');
  const start = html.indexOf('async function saveDelivery()');
  const end = html.indexOf('async function deleteDelivery()', start);
  const nodes = {
    editDeliveryId: { value: '' }, ldStore: { value: 'store-1' },
    ldDate: { value: '2026-10-19' }, ldNotes: { value: '' },
  };
  const calls = [];
  const ctx = {
    document: { getElementById: id => nodes[id] },
    allStores: [{ id: 'store-1', name: 'Test Store', phone: '0501234567' }],
    ldQuantities: { jerry_can: 2, dispenser: 1 },
    LD_PRODUCTS: { jerry_can: { label: 'Jerry Can' }, dispenser: { label: 'Dispenser' } },
    ldGetAggregated: () => ({ large: 0, small: 0, dairyFree: 0, unfiltered: 0, syrup: 0 }),
    sb: { from: () => ({ insert: async data => { calls.push({ table: 'store_deliveries', data }); return {}; } }) },
    opsFetch: async (table, options) => { calls.push({ table, data: JSON.parse(options.body) }); },
    batchIncrementInventory2: async () => {}, window: {},
    showToast: () => {}, closeLogDeliveryModal: () => {}, loadStoreDeliveries: async () => {}, console,
  };
  vm.runInNewContext(html.slice(start, end), ctx);
  await ctx.saveDelivery();
  const job = calls.find(c => c.table === 'jobs')?.data;
  assert.ok(job, 'Expected a schedule job for the WhatsApp notification');
  assert.equal(job.planned_total, 3);
  assert.equal(job.quantities.jerry_can, 2);
  assert.equal(job.quantities.dispenser, 1);
  assert.equal(job.wa_needs_send, true);
});

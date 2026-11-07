const { test } = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('../storefront-discovery.js');

function render(count, hebrew = false) {
  const grid = { classList: { add() {} }, innerHTML: '', querySelectorAll: () => [] };
  const products = Array.from({ length: count }, (_, index) => ({ id: index, category: 'bottles' }));
  discovery.renderShop(grid, products, product => product.category,
    product => '<article data-test-product="' + product.id + '"></article>', hebrew);
  return grid.innerHTML;
}

test('every shelf with more than four products has explicit previous and next controls', () => {
  for (const count of [5, 6, 9]) {
    const html = render(count);
    assert.equal((html.match(/data-shelf-prev/g) || []).length, 1);
    assert.equal((html.match(/data-shelf-next/g) || []).length, 1);
    assert.equal((html.match(/data-test-product=/g) || []).length, count);
    assert.equal((html.match(/class="shelf-page product-grid"/g) || []).length, Math.ceil(count / 4));
  }
});

test('small shelves do not show redundant navigation and Hebrew shelves retain RTL navigation', () => {
  assert.doesNotMatch(render(4), /data-shelf-next/);
  const html = render(6, true);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /data-shelf-next/);
});

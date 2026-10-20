(function (root) {
  const fields = ['large', 'small', 'dairyFree', 'unfiltered', 'syrup'];
  function count(value) {
    const n = Number(value || 0);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error('Enter whole, non-negative bottle counts.');
    return n;
  }
  function bucket(id, products) {
    if (id.startsWith('_agg_')) return null;
    if (id === 'unfiltered_liter' || /unfilter|אנפילטר/i.test(products[id]?.label || '')) return 'unfiltered';
    return ({ liter: 'large', mini: 'small', dairy_free: 'dairyFree', syrup: 'syrup' })[products[id]?.category] || null;
  }
  function totals(quantities, products) {
    const result = Object.fromEntries(fields.map(k => [k, 0]));
    for (const [id, value] of Object.entries(quantities || {})) {
      const key = ({ _agg_large: 'large', _agg_small: 'small', _agg_dairy_free: 'dairyFree', _agg_unfiltered: 'unfiltered', _agg_syrup: 'syrup' })[id] || bucket(id, products);
      if (key) result[key] += count(value);
    }
    return result;
  }
  function matches(counts, quantities, products) {
    const actual = totals(quantities, products);
    return fields.every(k => count(counts[k]) === actual[k]);
  }
  function defaults(counts, products, previous = {}) {
    const result = {};
    // Preserve non-bottle products when editing; they have no top-level count box.
    for (const [id, qty] of Object.entries(previous)) {
      if (!id.startsWith('_agg_') && !bucket(id, products) && count(qty)) result[id] = count(qty);
    }
    const preferred = { large: 'classic_liter', unfiltered: 'unfiltered_liter' };
    for (const key of fields) {
      const n = count(counts[key]);
      const ids = Object.keys(products).filter(id => bucket(id, products) === key);
      if (preferred[key] && ids.includes(preferred[key])) ids.splice(0, ids.length, preferred[key]);
      if (!ids.length) {
        if (n) result['_agg_' + ({ dairyFree: 'dairy_free', small: 'small' }[key] || key)] = n;
        continue;
      }
      ids.forEach((id, i) => {
        const qty = Math.floor(n / ids.length) + (i < n % ids.length ? 1 : 0);
        if (qty) result[id] = qty;
      });
    }
    return result;
  }
  const api = { fields, count, bucket, totals, matches, defaults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GremierDelivery = api;
})(typeof window === 'undefined' ? globalThis : window);

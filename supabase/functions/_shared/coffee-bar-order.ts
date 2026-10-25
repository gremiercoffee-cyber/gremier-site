// @ts-nocheck
// Plain JavaScript syntax on purpose: build-coffee-bar-order.cjs also publishes
// this exact model to the storefront/admin. Saved configurations are per bar.
const FULL_BAR_ID = '9361ff6e-4227-44cc-a23a-428a002f1f4c';
const BASIC_BAR_ID = 'c211cedd-ef93-4dba-9a6e-b2edb1add6e0';
const positive = n => Math.max(0, Math.round(Number(n) || 0));
const variations = p => Array.isArray(p?.variations) ? p.variations : [];
const addons = p => variations(p).find(v => v.type === 'addons')?.items || [];

export function resolveCoffeeBarGuests(product, item) {
  const options = variations(product).filter(v => v.type === 'guest_count' || (v.type === 'choice' && /guest|people|אורח/i.test(v.name || ''))).flatMap(v => v.options || []);
  const selected = Object.values(item.selected_variations || {}).map(v => typeof v === 'object' ? v?.label : v);
  const price = item.selected_guest_price;
  const picked = options.find(o => price != null && Number(o.price) === Number(price))
    || options.find(o => selected.includes(String(o.label || o)));
  if (picked) return positive(picked.guests || parseInt(picked.label || picked, 10)) || null;
  return null;
}

export function buildCoffeeBarConfiguration(product, item) {
  const settings = variations(product).find(v => v.type === 'coffee_bar_config');
  const packageType = settings?.package || (product.id === FULL_BAR_ID ? 'full' : product.id === BASIC_BAR_ID ? 'coffee' : null);
  const guests = resolveCoffeeBarGuests(product, item);
  if (!packageType || !guests) return null;
  const full = packageType === 'full';
  let remaining = Math.ceil(guests / 25), dispensers = full ? 1 : 0;
  const coffee = [], milk = [], syrups = [];
  const includedSyrups = settings?.syrups || (full ? ['caramel', 'vanilla', 'sugar'] : ['sugar']);
  const syrupNames = { caramel: 'Caramel syrup', vanilla: 'Vanilla syrup', sugar: 'Sugar syrup' };
  includedSyrups.forEach(key => syrups.push({ key, name: syrupNames[key] || key, bottles: 1 }));
  let parveLiters = 0;
  const milkTotal = full ? Math.floor(guests / 10) : 0;
  const seen = new Set();
  for (const selected of item.selected_addons || []) {
    const allowed = addons(product).find(a => a.name === selected.name);
    if (!allowed || seen.has(allowed.name)) continue;
    seen.add(allowed.name);
    if (allowed.per_jug) {
      const jugs = Math.min(remaining, selected.qty == null ? 1 : positive(selected.qty));
      remaining -= jugs;
      const key = allowed.coffee_type || (/house/i.test(allowed.name) ? 'houseBlend' : /colomb/i.test(allowed.name) ? 'colombia' : /decaf/i.test(allowed.name) ? 'decaf' : allowed.name);
      if (jugs) coffee.push({ key, name: allowed.name, jugs, liters: jugs * 5 });
    } else if (allowed.per_liter) {
      const liters = Math.min(Math.floor(guests / 10), positive(selected.liters));
      if (!liters) continue;
      parveLiters += liters;
      const key = allowed.milk_type || 'parve';
      const name = allowed.milk_label || (key === 'parve' ? 'Parve milk (type not specified)' : allowed.name);
      milk.push({ key, name, liters });
    } else if (/dispenser/i.test(allowed.name)) {
      dispensers += Number(allowed.max) > 1 ? Math.min(positive(allowed.max), positive(selected.qty)) : 1;
    } else if (/syrup/i.test(allowed.name)) {
      const bottles = Number(allowed.max) > 1 ? Math.min(positive(allowed.max), positive(selected.qty)) : 1;
      if (!bottles) continue;
      const key = allowed.bar_syrup || (/^Caramel syrup$/i.test(allowed.name) ? 'caramel' : /^Vanilla syrup$/i.test(allowed.name) ? 'vanilla' : 'unspecified');
      const existing = syrups.find(s => s.key === key);
      if (existing) existing.bottles += bottles;
      else syrups.push({ key, name: key === 'unspecified' ? 'Syrup (flavour not recorded)' : syrupNames[key] || allowed.name, bottles });
    }
  }
  if (parveLiters > milkTotal) throw new Error('Selected milk exceeds the coffee bar milk allowance');
  if (remaining) coffee.unshift({ key: 'classic', name: 'Classic', jugs: remaining, liters: remaining * 5 });
  if (milkTotal > parveLiters) milk.unshift({ key: 'dairy', name: 'Dairy milk', liters: milkTotal - parveLiters });
  return { version: 1, package: packageType, guests, coffee, milk, dispensers, syrups, cups: guests, straws: guests };
}

export function describeCoffeeBar(configuration) {
  const c = configuration;
  if (!c || c.version !== 1) return '';
  return [
    `${c.guests} guests`,
    ...(c.coffee || []).map(x => `${x.jugs}× ${x.name} 5L`),
    ...(c.milk || []).map(x => `${x.liters}L ${x.name}`),
    `${c.dispensers} dispenser${c.dispensers === 1 ? '' : 's'}`,
    ...(c.syrups || []).map(x => `${x.bottles}× ${x.name}`),
    `${c.cups} cups`, `${c.straws} straws`
  ].join(' · ');
}

export function coffeeBarSchedulePrefill(order, products = []) {
  const configs = [];
  for (const item of order.items || []) {
    let config = item.coffee_bar_configuration;
    if (!config) {
      const product = products.find(p => String(p.id) === String(item.product_id || item.base_product_id));
      if (product) config = buildCoffeeBarConfiguration(product, item);
    }
    if (!config) continue;
    for (let n = 0; n < Math.max(1, positive(item.qty)); n++) configs.push(config);
  }
  if (!configs.length) return null;
  const jerryCans = [], cbSyrups = {};
  let people = 0, dispensers = 0;
  for (const c of configs) {
    people += c.guests; dispensers += c.dispensers;
    (c.coffee || []).forEach(x => { for (let n = 0; n < x.jugs; n++) jerryCans.push(x.key); });
    (c.syrups || []).forEach(x => { cbSyrups[x.key + '_syrup'] = (cbSyrups[x.key + '_syrup'] || 0) + x.bottles; });
  }
  return { subType: 'coffeebar', people, dispensers, jerryCans, cbSyrups,
    websiteOrderId: order.order_id || order.id, customerPhone: order.customer_phone || '',
    coffeeBarConfiguration: { version: 1, bars: configs },
    cbName: order.customer_name || '', cbAddress: order.delivery_address || '' };
}

export function describeCoffeeBarJob(value) {
  return (value?.bars || []).map(describeCoffeeBar).join('\n');
}

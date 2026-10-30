/* Product instances cut from the shared photograph, all grounded on the counter. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoffeeBarScene = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const BASE = 352, TAIL = 45;
  const regions = {
    coffee: { x: 0, y: 116, w: 173.2 },
    disp: { x: 173.2, y: 35, w: 158.8 },
    caramel: { x: 332, y: 154, w: 75.6 },
    vanilla: { x: 407.6, y: 154, w: 75.44 },
    sugar: { x: 483.04, y: 154, w: 74.56 },
    milk: { x: 557.6, y: 143, w: 82 },
    cups: { x: 639.6, y: 169, w: 69.6 },
    lids: {x:0,y:287,w:110},
    straws: { x: 709.2, y: 160, w: 90.8 }
  };
  const count = value => Math.max(0, Math.floor(Number(value) || 0));
  function layout(plan) {
    const items = [];
    let cursor = 16;
    function group(kind, specs, step, columns = specs.length) {
      if (!specs.length) return;
      const region = regions[kind];
      let width = 0;
      specs.forEach((spec, i) => {
        const row = Math.floor(i / columns), col = i % columns;
        const sx = spec.sx || 1, sy = spec.sy || 1;
        const x = col * step + row * 12;
        const item = { id: kind + '-' + i, kind, variant: spec.variant || kind,
          units: spec.units || 1, sx, sy, x: cursor + x, bottom: row * 10,
          w: region.w * sx, h: (BASE - region.y) * sy,
          z: 30 - row * 10 - col, region };
        items.push(item);
        width = Math.max(width, x + item.w);
      });
      cursor += width + 18;
    }
    const coffees = [];
    for (const [variant, n] of [['classic', plan.classic], ['house', plan.mix?.house], ['colomb', plan.mix?.colomb], ['decaf', plan.mix?.decaf]]) {
      for (let i = 0; i < count(n); i++) coffees.push({ variant });
    }
    for (const variant of Array.isArray(plan.extraCoffee) ? plan.extraCoffee : []) coffees.push({ variant });   // extra jerry cans, full price
    group('coffee', coffees, 96);
    group('disp', Array.from({ length: count(plan.dispensers) }, () => ({})), 98);
    for (const kind of ['caramel', 'vanilla', 'sugar']) {
      if(plan.syrupCounts){group(kind,Array.from({length:count(plan.syrupCounts[kind])},()=>({})),55);continue;}
      if (kind === 'sugar' || (Array.isArray(plan.syrupFlavours) ? plan.syrupFlavours.includes(kind) : count(plan.syrups) >= (kind === 'caramel' ? 1 : 2))) group(kind, [{}], 0);
    }
    const milkCount = count(plan.milkLiters), parve = Math.min(milkCount, count(plan.parveLiters));
    let milkSpecs=[];
    if(plan.milkMix && typeof plan.milkMix==='object'){
      for(const [variant,n] of Object.entries(plan.milkMix)){const take=Math.min(count(n),milkCount-milkSpecs.length);for(let i=0;i<take;i++)milkSpecs.push({variant});}
      milkSpecs=[...Array.from({length:milkCount-milkSpecs.length},()=>({variant:'dairy'})),...milkSpecs];
    }else milkSpecs=Array.from({length:milkCount},(_,i)=>({variant:i<milkCount-parve?'dairy':(plan.milkType||'parve')}));
    group('milk', milkSpecs, 78, milkCount > 6 ? Math.ceil(milkCount / 2) : milkCount);
    const guests = Math.max(1, count(plan.guests));
    const bundles = Array.from({ length: Math.ceil(guests / 50) }, (_, i) => Math.min(50, guests - i * 50));
    group('cups', bundles.map(units => ({ units, sx: .95 + units / 50 * .1, sy: .55 + units / 50 * .9 })), 48);
    group('lids',Array.from({length:Math.ceil(count(plan.lids)/25)},()=>({units:25})),58);
    group('straws', bundles.map(units => ({ units, sx: .88 + units / 50 * .24, sy: .84 + units / 50 * .32 })), 65);
    // Centered on the table: a small bar sits in the middle and new things appear on both sides;
    // the canvas only widens (and the view zooms out) once the bar needs more than its width.
    const left = Math.min(...items.map(item => item.x)), right = Math.max(...items.map(item => item.x + item.w));
    const width = Math.max(800, Math.ceil(right - left + 32));
    const shift = (width - (right - left)) / 2 - left;
    items.forEach(item => { item.x += shift; });
    return { width, height: BASE, tail: TAIL, items };
  }
  return { layout, regions, base: BASE, tail: TAIL };
});

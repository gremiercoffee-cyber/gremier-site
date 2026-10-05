// GENERATED from admin-src/react-1.jsx by scripts/build-admin-react.js — do not edit.
const {
  useState: useState2,
  useEffect: useEffect2,
  useCallback: useCallback2,
  useRef: useRef2
} = React;

// ── helpers ────────────────────────────────────────────────
function todayISO2() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function tomorrowISO2() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDate2(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IL', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}
function formatTime2(t) {
  if (!t) return '';
  return t.slice(0, 5);
}
function isJobOverdue2(job) {
  if (job.done) return false;
  const today = todayISO2();
  if (job.date < today) return true;
  if (job.date === today && job.time) {
    const [h, m] = job.time.split(':').map(Number);
    const now = new Date();
    return now.getHours() > h || now.getHours() === h && now.getMinutes() >= m;
  }
  return false;
}
function monthDates2(year, month) {
  const days = [],
    d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}
function rowToJob2(r) {
  return {
    id: r.id,
    type: r.type,
    date: r.date,
    time: r.time,
    done: r.done,
    brewStarted: r.brew_started,
    actualQty: r.actual_qty,
    product: r.product,
    kg: r.kg,
    liters: r.liters,
    label: r.label,
    deliveryType: r.delivery_type,
    storeName: r.store_name,
    privateName: r.private_name,
    privateAddress: r.private_address,
    people: r.people,
    plannedTotal: r.planned_total,
    quantities: r.quantities || {},
    needsConfirmation: r.needs_confirmation,
    jerryCans: r.jerry_cans || [],
    qty: r.qty,
    cbName: r.cb_name,
    cbAddress: r.cb_address,
    dispensers: r.dispensers,
    waNeedsSend: r.wa_needs_send,
    cbSyrups: r.cb_syrups || {},
    billed: r.billed,
    paid: r.paid || false,
    websiteOrderId: r.website_order_id || null,
    customerPhone: r.customer_phone || null,
    waSentAt: r.wa_sent_at || null,
    sourceBrewId: r.source_brew_id || null
  };
}
function jobToRow2(job) {
  return {
    id: job.id,
    type: job.type,
    date: job.date,
    time: job.time || null,
    done: job.done || false,
    actual_qty: job.actualQty || null,
    brew_started: job.brewStarted === true,
    product: job.product || null,
    kg: job.kg || null,
    liters: job.liters || null,
    label: job.label || null,
    delivery_type: job.deliveryType || null,
    store_name: job.storeName || null,
    private_name: job.privateName || null,
    private_address: job.privateAddress || null,
    people: job.people || null,
    planned_total: job.plannedTotal || null,
    quantities: job.quantities || null,
    created_at: job.createdAt || new Date().toISOString(),
    needs_confirmation: job.needsConfirmation || false,
    jerry_cans: job.jerryCans || null,
    qty: job.qty || null,
    cb_name: job.cbName || null,
    cb_address: job.cbAddress || null,
    dispensers: job.dispensers || null,
    wa_needs_send: job.waNeedsSend || false,
    cb_syrups: job.cbSyrups || null,
    billed: job.billed || false,
    paid: job.paid || false,
    website_order_id: job.websiteOrderId || null,
    customer_phone: job.customerPhone || null,
    wa_sent_at: job.waSentAt || null,
    source_brew_id: job.sourceBrewId || job.source_brew_id || null
  };
}

// ── store helpers (from table, not hardcoded) ──────────────
function whatsAppPhone2(raw) {
  if (!raw || !String(raw).trim()) return null;
  let s = String(raw).trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) {
    const d = s.slice(1).replace(/\D/g, '');
    return d.length >= 7 && d.length <= 15 ? d : null;
  }
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length === 10) return '972' + digits.slice(1);
  if (digits.length === 9 && digits.startsWith('5')) return '972' + digits;
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}
function getStoreWaPhone2(storeName, stores) {
  const store = stores.find(s => s.name === storeName);
  if (!store?.phone) return null;
  return whatsAppPhone2(store.phone) || String(store.phone).replace(/\D/g, '') || null;
}
// snap a loosely-heard store name (from voice) onto the EXACT name in the stores table,
// so the form dropdown pre-selects it AND the store_deliveries sync can match it — both need an exact ===
function resolveStoreName2(spoken, stores) {
  if (!spoken || !Array.isArray(stores) || !stores.length) return spoken;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, '');
  const target = norm(spoken);
  if (!target) return spoken;
  let hit = stores.find(s => norm(s.name) === target); // exact (normalized)
  if (!hit) hit = stores.find(s => norm(s.name).includes(target) || target.includes(norm(s.name))); // contains either way
  return hit ? hit.name : spoken; // fall back to spoken so the user can still pick manually
}
function isStoreWaDelivery2(job, stores) {
  if (!job || job.type !== 'delivery' || !job.storeName) return false;
  if (job.deliveryType === 'private' || job.deliveryType === 'coffeebar') return false;
  return !!getStoreWaPhone2(job.storeName, stores);
}
const STORE_WA_LOOKBACK_DAYS = 45;
// exposed on window: other <script type="text/babel"> blocks can't see this block's consts
window.STORE_WA_LOOKBACK_DAYS = STORE_WA_LOOKBACK_DAYS;
function jobWaDrawerEligible2(job, stores) {
  if (!isStoreWaDelivery2(job, stores) || !job.done || job.waSentAt) return false;
  const d = String(job.date || '').slice(0, 10);
  if (!d) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STORE_WA_LOOKBACK_DAYS);
  return d >= cutoff.toISOString().slice(0, 10);
}
function generateWAMessage2(storeName, job) {
  const dateStr = new Date().toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const q = job.quantities || {};
  let large, mini, dairyFree, syrup;
  if (q._agg_large !== undefined || q._agg_small !== undefined || q._agg_dairy_free !== undefined || q._agg_syrup !== undefined) {
    // Logged via the simple number boxes — no per-product breakdown, use the aggregate counts.
    large = q._agg_large || 0;
    mini = q._agg_small || 0;
    dairyFree = q._agg_dairy_free || 0;
    syrup = q._agg_syrup || 0;
  } else {
    const PRODUCTS2 = window.__OPS_PRODUCTS__ || {};
    large = Object.entries(q).filter(([p]) => PRODUCTS2[p]?.category === 'liter').reduce((s, [, qty]) => s + (qty || 0), 0);
    mini = Object.entries(q).filter(([p]) => PRODUCTS2[p]?.category === 'mini').reduce((s, [, qty]) => s + (qty || 0), 0);
    dairyFree = Object.entries(q).filter(([p]) => PRODUCTS2[p]?.category === 'dairy_free').reduce((s, [, qty]) => s + (qty || 0), 0);
    syrup = Object.entries(q).filter(([p]) => PRODUCTS2[p]?.category === 'syrup').reduce((s, [, qty]) => s + (qty || 0), 0);
  }
  const total = large + mini + dairyFree + syrup;
  const lines = [`תעודת משלוח - גרמיר קפה`, `תאריך: ${dateStr}`, `לכבוד: ${storeName}`, `----------------------------`];
  if (large > 0) lines.push(`בקבוק גדול: ${large} יחידות`);
  if (mini > 0) lines.push(`בקבוק קטן: ${mini} יחידות`);
  if (dairyFree > 0) lines.push(`ללא חלב: ${dairyFree} יחידות`);
  if (syrup > 0) lines.push(`סירופ: ${syrup} יחידות`);
  lines.push(`----------------------------`, `סה"כ: ${total} יחידות`, `תודה! גרמיר קפה`);
  return lines.join('\n');
}
function buildStoreWaLink2(job, stores) {
  if (!isStoreWaDelivery2(job, stores)) return null;
  const phone = getStoreWaPhone2(job.storeName, stores);
  if (!phone) return null;
  const msg = generateWAMessage2(job.storeName, job);
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

// expose PRODUCTS to WA message builder
window.__OPS_PRODUCTS__ = {
  classic_liter: {
    category: 'liter'
  },
  sweetened_classic: {
    category: 'liter'
  },
  house_blend: {
    category: 'liter'
  },
  colombia_liter: {
    category: 'liter'
  },
  decaf_liter: {
    category: 'liter'
  },
  classic_mini: {
    category: 'mini'
  },
  house_blend_mini: {
    category: 'mini'
  },
  vanilla_mini: {
    category: 'mini'
  },
  original_mini: {
    category: 'mini'
  },
  caramel_mini: {
    category: 'mini'
  },
  jerry_can: {
    category: 'jerry'
  },
  jerry_can_houseblend: {
    category: 'jerry'
  },
  jerry_can_colombia: {
    category: 'jerry'
  },
  jerry_can_decaf: {
    category: 'jerry'
  },
  vanilla_syrup: {
    category: 'syrup'
  },
  caramel_syrup: {
    category: 'syrup'
  },
  sugar_syrup: {
    category: 'syrup'
  },
  dispenser: {
    category: 'dispenser'
  }
};

// ── Supabase job ops ───────────────────────────────────────
async function loadAllJobs2() {
  const rows = await opsFetch('jobs?select=*&order=date.asc');
  return (rows || []).map(rowToJob2);
}
async function loadPendingWebDeliveries2() {
  const rows = await opsFetch('pending_website_deliveries?status=eq.pending_schedule&select=*&order=created_at.asc');
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const ids = [...new Set(rows.map(r => r.order_id).filter(Boolean))];
  if (!ids.length) return [];
  const orders = await opsFetch(`orders?id=in.(${ids.join(',')})&select=id,payment_status,items,delivery_info`);
  const orderMap = {};
  (orders || []).forEach(o => {
    orderMap[o.id] = o;
  });
  return rows.map(r => {
    const o = orderMap[r.order_id] || {};
    return {
      ...r,
      payment_status: o.payment_status || null,
      items: o.items || r.items || [],
      delivery_info: o.delivery_info || r.delivery_info || null
    };
  }).filter(r => r.payment_status === 'paid');
}
function websiteOrderDisplayLabel2(order) {
  const name = String(order?.customer_name || '').trim();
  if (name) return name;
  const addr = String(order?.delivery_address || '').trim();
  if (addr) return addr;
  if (order?.order_number != null) return `Order #${order.order_number}`;
  return 'Delivery';
}

// Convert website/pay-link order items into the inventory product keys used by the Schedule picker.
// Pay-link items may carry catalog product IDs, display names, or already-normalized stock keys;
// the Schedule form only understands stock keys like classic_liter / caramel_mini / jerry_can.
async function buildWebsiteOrderSchedulePrefill2(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const stockKeys = new Set(Object.keys(window.__OPS_PRODUCTS__ || {}));
  // Stable website catalog IDs for the core products. These provide a reliable
  // fallback even when an order was saved without a descriptive product name.
  const knownProductIds = {
    '5553dae1-d35d-4d02-b3a1-3633e9ca6bfc': 'classic_liter',
    'd14c3808-0f14-439d-b978-69bf6e35e9b4': 'house_blend',
    'd59ad233-5090-40bc-b984-ed326ca8460d': 'colombia_liter',
    '1c28055f-79b8-4d99-b7f2-38c270b47af7': 'caramel_mini'
  };
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, ' ').trim();
  const compact = value => norm(value).replace(/\s+/g, '');
  function directStockKey(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (stockKeys.has(raw)) return raw;
    const rawLower = raw.toLowerCase();
    for (const key of stockKeys) {
      if (key.toLowerCase() === rawLower) return key;
    }
    return '';
  }
  function packMultiplier(text, pid) {
    const t = norm(text);
    if (!pid || !pid.includes('mini')) return 1;
    const m = t.match(/(?:^|\s)(\d{1,2})\s*(?:pack|pk|x|×|מארז)(?:\s|$)/i) || t.match(/(?:pack|מארז)\s*(?:of\s*)?(\d{1,2})/i);
    const n = m ? Number(m[1]) : 1;
    return Number.isFinite(n) && n > 1 && n <= 24 ? n : 1;
  }
  function resolveByText(text) {
    const t = norm(text);
    const c = compact(text);
    if (!t) return '';

    // exact/near exact product-key text, e.g. "classic_liter" saved as a name
    const direct = directStockKey(String(text || '').replace(/\s+/g, '_')) || directStockKey(c);
    if (direct) return direct;
    const isMini = /mini|מיני|cremier|קרמייר|קרמיירים/.test(t);
    const isJerry = /jerry|ג׳רי|ג'רי|5l|5 l|5 liter|5 litre|5 ליטר|bulk/.test(t);
    const isSyrup = /syrup|סירופ/.test(t);
    if (isSyrup) {
      if (/caramel|קרמל/.test(t)) return 'caramel_syrup';
      if (/vanilla|וניל/.test(t)) return 'vanilla_syrup';
      if (/sugar|simple|סוכר/.test(t)) return 'sugar_syrup';
    }
    if (isMini) {
      if (/caramel|קרמל/.test(t)) return 'caramel_mini';
      if (/vanilla|וניל/.test(t)) return 'vanilla_mini';
      if (/house|blend|האוס|בלנד/.test(t)) return 'house_blend_mini';
      if (/classic|dark|original|קלאס|קלאסי|מקורי/.test(t)) return 'original_mini';
      return 'original_mini';
    }
    if (isJerry) {
      if (/house|blend|האוס|בלנד/.test(t)) return 'jerry_can_houseblend';
      if (/colombia|sidamo|ethiopia|light|קולומב|סידמו|אתיופי/.test(t)) return 'jerry_can_colombia';
      if (/decaf|נטול/.test(t)) return 'jerry_can_decaf';
      return 'jerry_can';
    }
    if (/sweet|sweetened|מתוק|ממותק/.test(t)) return 'sweetened_classic';
    if (/house|blend|האוס|בלנד/.test(t)) return 'house_blend';
    if (/colombia|sidamo|ethiopia|light|קולומב|סידמו|אתיופי/.test(t)) return 'colombia_liter';
    if (/decaf|נטול/.test(t)) return 'decaf_liter';
    if (/classic|dark|original|קלאס|קלאסי|מקורי|כהה/.test(t)) return 'classic_liter';
    // Catalog category is included in the text above. Fall back to Classic for
    // unflavoured bottle names such as "Cold Brew Bottle".
    if (/bottles?|liter|litre|1\s*l|1l|בקבוק|ליטר/.test(t)) return 'classic_liter';
    return '';
  }
  const catalogById = {};
  const catalogIds = [...new Set(items.map(i => String(i?.product_id || i?.id || '').trim()).filter(Boolean))].filter(id => !directStockKey(id));
  if (catalogIds.length && typeof window.opsFetch === 'function') {
    try {
      const rows = await window.opsFetch(`products?id=in.(${catalogIds.join(',')})&select=id,name_en,name_he,category,is_coffee_bar,variations`);
      (rows || []).forEach(p => {
        // Normalize the catalog row so its ops settings work whether they are
        // stored in the variation or already exposed as top-level fields.
        const normalized = typeof normalizeProduct === 'function' ? normalizeProduct(p) : p;
        catalogById[String(p.id)] = {
          ...normalized,
          _ops_stock_key: String(normalized?.stock_key || '').trim(),
          _ops_pack_size: Number(normalized?.ops_pack_size) || 1,
          _ops_exclude: !!normalized?.ops_exclude
        };
      });
    } catch (err) {
      console.warn('Could not map website order products for schedule prefill:', err);
    }
  }
  const quantities = {};
  const unresolved = [];
  items.forEach(item => {
    const rawId = String(item?.product_id || item?.id || '').trim();
    const catalog = catalogById[rawId];

    // If the product has an explicit stock_key set (e.g. 'original_mini' for a 4-pack), use it
    // directly and skip name-matching entirely — it's the most reliable mapping.
    const catalogStockKey = catalog?._ops_stock_key ? directStockKey(catalog._ops_stock_key) || catalog._ops_stock_key : '';
    const catalogPackSize = catalog?._ops_pack_size || 1;

    // If the catalog product is marked as a bundle/exclude AND has no stock_key mapping,
    // skip it entirely — it's something like a gift set with no single inventory equivalent.
    if (catalog?._ops_exclude && !catalogStockKey) return;
    const text = [rawId, item?.product_key, item?.stock_key, item?.name_en, item?.name_he, item?.name, item?.title, catalog?.name_en, catalog?.name_he, catalog?.category].filter(Boolean).join(' ');

    // Priority: catalog stock_key > item-level keys > name resolution
    const pid = catalogStockKey || directStockKey(knownProductIds[rawId]) || directStockKey(item?.product_key) || directStockKey(item?.stock_key) || directStockKey(rawId) || resolveByText(text);
    const qty = Number(item?.qty ?? item?.quantity ?? 1) || 1;
    // Pack size from catalog ops_settings takes priority over text-pattern detection
    const packMult = catalogPackSize > 1 ? catalogPackSize : packMultiplier(text, pid);
    if (pid) {
      quantities[pid] = (quantities[pid] || 0) + qty * packMult;
    } else {
      unresolved.push(item?.name_en || item?.name || rawId || 'item');
    }
  });
  if (unresolved.length) {
    console.warn('Website order schedule prefill could not map some items:', unresolved, order);
  }
  const requestedDate = String(order?.delivery_info?.delivery_date || '').slice(0, 10);
  const requestedTime = String(order?.delivery_info?.event_time || '').slice(0, 5);
  const isEventDelivery = String(order?.delivery_info?.delivery_type || '') === 'event';
  return {
    subType: 'private',
    privateName: websiteOrderDisplayLabel2(order),
    privateAddress: order?.delivery_address || '',
    customerPhone: order?.customer_phone || '',
    websiteOrderId: order?.order_id || order?.id || null,
    quantities,
    unresolvedItems: unresolved,
    ...(requestedDate ? {
      date: requestedDate
    } : {}),
    ...(requestedTime ? {
      time: requestedTime
    } : {}),
    ...(isEventDelivery ? {
      label: `Event delivery${requestedDate ? ' — ' + requestedDate : ''}${requestedTime ? ' @ ' + requestedTime : ''}`
    } : {})
  };
}
async function patchJob2(id, patch) {
  await opsFetch(`jobs?id=eq.${id}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify(patch)
  });
}
async function deleteJobFromDB2(id) {
  await opsFetch(`jobs?id=eq.${id}`, {
    method: 'DELETE',
    prefer: 'return=minimal'
  });
}
async function createDrain2(brewJob) {
  // guard against double-creation only for *this* brew job (retries/double-taps),
  // not against other concurrent brews of the same product
  const existing = await opsFetch(`jobs?type=eq.drain&source_brew_id=eq.${brewJob.id}&select=id`);
  if (existing?.length) return;
  const drainHours = brewJob.product === 'classic' ? 22 : 18;
  const drainTime = new Date(Date.now() + drainHours * 60 * 60 * 1000);
  const drainDate = `${drainTime.getFullYear()}-${String(drainTime.getMonth() + 1).padStart(2, '0')}-${String(drainTime.getDate()).padStart(2, '0')}`;
  const drainTimeStr = `${String(drainTime.getHours()).padStart(2, '0')}:${String(drainTime.getMinutes()).padStart(2, '0')}`;
  await opsFetch('jobs', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      id: `drain_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: 'drain',
      product: brewJob.product,
      kg: brewJob.kg,
      date: drainDate,
      time: drainTimeStr,
      done: false,
      needs_confirmation: false,
      source_brew_id: brewJob.id,
      label: `Drain ${brewJob.product} (${drainHours}h brew)`,
      created_at: new Date().toISOString()
    })
  });
}

// store delivery sync (ops checkoff → admin store_deliveries table)
async function syncStoreDeliveryToAdmin(job, qtys) {
  const PRODUCTS2 = window.__OPS_PRODUCTS__;
  const large = Object.entries(qtys || {}).filter(([p]) => PRODUCTS2[p]?.category === 'liter').reduce((s, [, q]) => s + (q || 0), 0);
  const mini = Object.entries(qtys || {}).filter(([p]) => PRODUCTS2[p]?.category === 'mini').reduce((s, [, q]) => s + (q || 0), 0);
  const syrup = Object.entries(qtys || {}).filter(([p]) => PRODUCTS2[p]?.category === 'syrup').reduce((s, [, q]) => s + (q || 0), 0);
  // search ALL stores, not just active ones — a store deactivated after a delivery was scheduled
  // shouldn't silently break that delivery's billing sync. Match fuzzily (same normalization the
  // voice logger uses) instead of requiring an exact name match, since an exact-only match just
  // silently drops anything with slightly different casing/spacing rather than erroring.
  const stores = await opsFetch('stores?select=id,name');
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]/g, '');
  const target = norm(job.storeName);
  let store = (stores || []).find(s => norm(s.name) === target);
  if (!store) store = (stores || []).find(s => norm(s.name).includes(target) || target.includes(norm(s.name)));
  if (!store) throw new Error(`Store delivery not logged — no store matches "${job.storeName}". Add it manually in the Store Deliveries tab.`);
  await opsFetch('store_deliveries', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      store_id: store.id,
      store_name: job.storeName,
      qty_large: large,
      qty_small: mini,
      qty_syrup: syrup,
      quantities: Object.keys(qtys).length ? qtys : null,
      delivery_date: job.date,
      notes: null,
      updated_at: new Date().toISOString()
    })
  });
}

// inventory helpers (reuse opsFetch from phase 1)
async function incrementInventory2(product, delta) {
  const enc = encodeURIComponent(product);
  const rows = await opsFetch(`inventory?product=eq.${enc}&select=qty`);
  const newQty = Math.max(0, (rows?.[0]?.qty || 0) + delta);
  if (rows?.length) await opsFetch(`inventory?product=eq.${enc}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({
      qty: newQty
    })
  });else await opsFetch('inventory', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      product,
      qty: newQty
    })
  });
  window.notifyGremierStockChanged?.();
}
async function incrementConcentrate2(type, delta) {
  const rows = await opsFetch(`concentrate?type=eq.${type}&select=liters`);
  if (!rows?.length) return;
  const beforeLiters = rows[0].liters || 0;
  const newLiters = Math.max(0, parseFloat((beforeLiters + delta).toFixed(1)));
  console.warn('[Gremier stock] Concentrate changed', {
    type,
    delta,
    before: beforeLiters,
    after: newLiters,
    at: new Date().toISOString()
  });
  await opsFetch(`concentrate?type=eq.${type}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({
      liters: newLiters
    })
  });
  window.notifyGremierStockChanged?.();
}
async function incrementLabeledStock2(product, delta) {
  const enc = encodeURIComponent(product);
  const rows = await opsFetch(`labeled_stock?product=eq.${enc}&select=qty`);
  const newQty = Math.max(0, (rows?.[0]?.qty || 0) + delta);
  if (rows?.length) await opsFetch(`labeled_stock?product=eq.${enc}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: JSON.stringify({
      qty: newQty
    })
  });else await opsFetch('labeled_stock', {
    method: 'POST',
    prefer: 'return=minimal',
    body: JSON.stringify({
      product,
      qty: newQty
    })
  });
  window.notifyGremierStockChanged?.();
}
/** Batch-decrement/increment many inventory rows in one read + parallel writes. deltas: {product: delta} */
async function batchIncrementInventory2(deltas) {
  const ids = Object.keys(deltas).filter(pid => deltas[pid]);
  if (!ids.length) return;
  const rows = await opsFetch(`inventory?product=in.(${ids.map(encodeURIComponent).join(',')})&select=product,qty`);
  const current = {};
  (rows || []).forEach(r => {
    current[r.product] = r.qty || 0;
  });
  await Promise.all(ids.map(pid => {
    const newQty = Math.max(0, (current[pid] || 0) + deltas[pid]);
    if (current[pid] !== undefined) {
      // row exists — patch it
      return opsFetch(`inventory?product=eq.${encodeURIComponent(pid)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: JSON.stringify({
          qty: newQty
        })
      });
    } else {
      // row missing — insert it so the deduction isn't silently lost
      return opsFetch('inventory', {
        method: 'POST',
        prefer: 'return=minimal',
        body: JSON.stringify({
          product: pid,
          qty: newQty
        })
      });
    }
  }));
  window.notifyGremierStockChanged?.();
}
function isSuspiciousDrainJob2(job) {
  if (!job || job.type !== 'drain') return false;
  const label = String(job.label || '').toLowerCase();
  // A real drain means a brew finished and concentrate is being added.
  // Stock corrections often say things like "remove 2 Colombia liter from stock";
  // those must never be treated as a drain because kg=2 would add 12.7L concentrate.
  return /\b(remove|deduct|subtract|take away|takeaway|adjust|fix|correction|stock)\b/.test(label) || /\b(bottle|bottles|liter|liters|mini|minis|jerry|can|cans)\b/.test(label) && !/^\s*drain\b/.test(label);
}
function isRealDrainJob2(job) {
  if (!job || job.type !== 'drain') return false;
  if (isSuspiciousDrainJob2(job)) return false;
  const productOk = ['classic', 'houseBlend', 'colombia', 'decaf'].includes(job.product);
  const kgOk = [1, 1.5, 2, 3].includes(Number(job.kg));
  const label = String(job.label || '').toLowerCase().trim();
  const labelLooksLikeDrain = /^drain\b/.test(label);
  // Auto drains created from brews carry source_brew_id. Manually scheduled drains are allowed
  // only when they are explicitly labeled as Drain, never as a stock removal/correction.
  return productOk && kgOk && (!!job.sourceBrewId || !!job.source_brew_id || labelLooksLikeDrain);
}
async function applyJobSideEffects2(job, confirmedQtys, stores) {
  const kgToL = {
    3: 19,
    2: 12.7,
    1.5: 9.5,
    1: 6.4
  };
  const MINI_P = ['vanilla_mini', 'original_mini', 'caramel_mini'];
  const JERRY_P = ['jerry_can', 'jerry_can_houseblend', 'jerry_can_colombia', 'jerry_can_decaf'];
  const JERRY_MAP = {
    classic: 'jerry_can',
    houseBlend: 'jerry_can_houseblend',
    colombia: 'jerry_can_colombia',
    decaf: 'jerry_can_decaf'
  };
  const CONC_TYPES = {
    classic: {
      ratio: 0.44
    },
    houseBlend: {
      ratio: 0.50
    },
    colombia: {
      ratio: 0.50
    },
    decaf: {
      ratio: 0.50
    }
  };
  const PRODS = window.__OPS_PRODUCTS__;
  if (job.type === 'brew') {
    const beanRows = await opsFetch(`beans?type=eq.${job.product}&select=kg`);
    const currentKg = beanRows?.[0]?.kg || 0;
    const newKg = parseFloat(Math.max(0, currentKg - (job.kg || 3)).toFixed(1));
    await opsFetch(`beans?type=eq.${job.product}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({
        kg: newKg
      })
    });
    window.notifyGremierStockChanged?.();
    await createDrain2(job);
  }
  if (job.type === 'drain') {
    if (!isRealDrainJob2(job)) {
      console.warn('[Gremier safety] Blocked suspicious drain side effect', job);
      return;
    }
    await incrementConcentrate2(job.product, kgToL[Number(job.kg)] || 19);
    if (job.sourceBrewId || job.source_brew_id) {
      await patchJob2(job.sourceBrewId || job.source_brew_id, {
        done: true
      });
    } else {
      const brews = await opsFetch(`jobs?type=eq.brew&product=eq.${job.product}&brew_started=eq.true&done=eq.false&select=id`);
      if (brews?.length) await patchJob2(brews[0].id, {
        done: true
      });
    }
    // Notify all React roots (ScheduleTab, GlobalPills, StockTab) to re-fetch so the
    // linked brew job's done=true is reflected in the UI without a manual page reload.
    window.dispatchEvent(new CustomEvent('gremier:jobs-changed'));
  }
  if (job.type === 'bottling') {
    const concType = window.__OPS_PRODUCTS_FULL__?.[job.product]?.concentrate;
    if (concType) {
      const liters = job.actualQty != null ? job.actualQty : job.liters || 0;
      const ratio = MINI_P.includes(job.product) ? 0.29 : CONC_TYPES[concType]?.ratio || 0.44;
      await incrementConcentrate2(concType, -(liters * ratio));
      const units = MINI_P.includes(job.product) ? Math.round(liters * 4) : JERRY_P.includes(job.product) ? Math.round(liters / 5) : Math.round(liters);
      await incrementInventory2(job.product, units);
    }
    if (job.labeledUsed) {
      for (const [pid, qty] of Object.entries(job.labeledUsed)) {
        if (qty > 0) await incrementLabeledStock2(pid, -qty);
      }
    }
  }
  if (job.type === 'labeling') {
    const LABELED = ['classic_liter', 'sweetened_classic', 'house_blend', 'colombia_liter', 'vanilla_mini', 'original_mini', 'caramel_mini', 'classic_mini', 'house_blend_mini'];
    if (LABELED.includes(job.product)) await incrementLabeledStock2(job.product, job.qty || 0);
  }
  if (job.type === 'delivery') {
    const qtys = confirmedQtys || job.quantities || {};
    const deltas = {};
    Object.entries(qtys).forEach(([pid, qty]) => {
      if (qty > 0) deltas[pid] = (deltas[pid] || 0) - qty;
    });
    if (job.deliveryType === 'coffeebar') {
      if (job.dispensers) deltas.dispenser = (deltas.dispenser || 0) - job.dispensers;
      Object.entries(job.cbSyrups || {}).forEach(([pid, qty]) => {
        if (qty > 0) deltas[pid] = (deltas[pid] || 0) - qty;
      });
      const jd = {};
      (job.jerryCans || []).forEach(ct => {
        const pid = JERRY_MAP[ct] || 'jerry_can';
        jd[pid] = (jd[pid] || 0) + 1;
      });
      Object.entries(jd).forEach(([pid, qty]) => {
        deltas[pid] = (deltas[pid] || 0) - qty;
      });
    }
    // run inventory write, store_deliveries sync, and WA flag patch concurrently — they touch different tables
    await Promise.all([batchIncrementInventory2(deltas), job.deliveryType === 'store' && job.storeName ? syncStoreDeliveryToAdmin(job, qtys) : Promise.resolve(), isStoreWaDelivery2(job, stores) ? patchJob2(job.id, {
      wa_needs_send: true,
      wa_sent_at: null
    }) : Promise.resolve()]);
  }
}
async function reverseJobSideEffects2(job, stores) {
  const kgToL = {
    3: 19,
    2: 12.7,
    1.5: 9.5,
    1: 6.4
  };
  const MINI_P = ['vanilla_mini', 'original_mini', 'caramel_mini'];
  const JERRY_P = ['jerry_can', 'jerry_can_houseblend', 'jerry_can_colombia', 'jerry_can_decaf'];
  const JERRY_MAP = {
    classic: 'jerry_can',
    houseBlend: 'jerry_can_houseblend',
    colombia: 'jerry_can_colombia',
    decaf: 'jerry_can_decaf'
  };
  const CONC_TYPES = {
    classic: {
      ratio: 0.44
    },
    houseBlend: {
      ratio: 0.50
    },
    colombia: {
      ratio: 0.50
    },
    decaf: {
      ratio: 0.50
    }
  };

  // BREW — beans were deducted at brew-start, restore them
  if (job.type === 'brew' && job.brewStarted) {
    const beanRows = await opsFetch(`beans?type=eq.${job.product}&select=kg`);
    const newKg = parseFloat(((beanRows?.[0]?.kg || 0) + (job.kg || 3)).toFixed(1));
    await opsFetch(`beans?type=eq.${job.product}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({
        kg: newKg
      })
    });
    window.notifyGremierStockChanged?.();
    // remove the auto-created pending drain tied to this specific brew (not any same-product drain)
    const drains = await opsFetch(`jobs?type=eq.drain&source_brew_id=eq.${job.id}&done=eq.false&select=id`);
    if (drains?.length) await deleteJobFromDB2(drains[0].id);
  }

  // DRAIN — concentrate was added, remove it. Only reverse real drains; stock corrections
  // that were mistakenly saved as drain jobs should never touch concentrate.
  if (job.type === 'drain' && job.done) {
    if (!isRealDrainJob2(job)) {
      console.warn('[Gremier safety] Blocked suspicious drain reversal', job);
    } else {
      await incrementConcentrate2(job.product, -(kgToL[Number(job.kg)] || 19));
    }
  }

  // BOTTLING — concentrate was consumed, inventory was added, labeled bottles were used
  if (job.type === 'bottling' && job.done) {
    const concType = window.__OPS_PRODUCTS_FULL__?.[job.product]?.concentrate;
    if (concType) {
      const liters = job.actualQty != null ? job.actualQty : job.liters || 0;
      const ratio = MINI_P.includes(job.product) ? 0.29 : CONC_TYPES[concType]?.ratio || 0.44;
      await incrementConcentrate2(concType, +(liters * ratio)); // give concentrate back
      const units = MINI_P.includes(job.product) ? Math.round(liters * 4) : JERRY_P.includes(job.product) ? Math.round(liters / 5) : Math.round(liters);
      await incrementInventory2(job.product, -units); // remove the bottles that were produced
    }
    if (job.labeledUsed) {
      for (const [pid, qty] of Object.entries(job.labeledUsed)) {
        if (qty > 0) await incrementLabeledStock2(pid, +qty); // give labels back
      }
    }
  }

  // LABELING — labeled stock was added, remove it
  if (job.type === 'labeling' && job.done) {
    const LABELED = ['classic_liter', 'sweetened_classic', 'house_blend', 'colombia_liter', 'vanilla_mini', 'original_mini', 'caramel_mini', 'classic_mini', 'house_blend_mini'];
    if (LABELED.includes(job.product)) {
      await incrementLabeledStock2(job.product, -(job.qty || 0));
    }
  }

  // DELIVERY — inventory was deducted, restore it
  if (job.type === 'delivery' && job.done) {
    const deltas = {};
    Object.entries(job.quantities || {}).forEach(([pid, qty]) => {
      if (qty > 0) deltas[pid] = (deltas[pid] || 0) + qty;
    });
    if (job.deliveryType === 'coffeebar') {
      if (job.dispensers) deltas.dispenser = (deltas.dispenser || 0) + job.dispensers;
      Object.entries(job.cbSyrups || {}).forEach(([pid, qty]) => {
        if (qty > 0) deltas[pid] = (deltas[pid] || 0) + qty;
      });
      const jd = {};
      (job.jerryCans || []).forEach(ct => {
        const pid = JERRY_MAP[ct] || 'jerry_can';
        jd[pid] = (jd[pid] || 0) + 1;
      });
      Object.entries(jd).forEach(([pid, qty]) => {
        deltas[pid] = (deltas[pid] || 0) + qty;
      });
    }
    await batchIncrementInventory2(deltas);
  }
}
// expose full products for bottling concentrate lookup
window.__OPS_PRODUCTS_FULL__ = {
  classic_liter: {
    concentrate: 'classic'
  },
  sweetened_classic: {
    concentrate: 'classic'
  },
  house_blend: {
    concentrate: 'houseBlend'
  },
  colombia_liter: {
    concentrate: 'colombia'
  },
  decaf_liter: {
    concentrate: 'decaf'
  },
  classic_mini: {
    concentrate: 'classic'
  },
  house_blend_mini: {
    concentrate: 'houseBlend'
  },
  vanilla_mini: {
    concentrate: 'classic'
  },
  original_mini: {
    concentrate: 'classic'
  },
  caramel_mini: {
    concentrate: 'classic'
  },
  jerry_can: {
    concentrate: 'classic'
  },
  jerry_can_houseblend: {
    concentrate: 'houseBlend'
  },
  jerry_can_colombia: {
    concentrate: 'colombia'
  },
  jerry_can_decaf: {
    concentrate: 'decaf'
  }
};

// ── Product thumbnail images (Cloudinary, sourced from Products tab) ──────
// Bottle/jerry-can/syrup keys map directly to a product photo.
// Concentrate-type keys (classic/houseBlend/colombia/decaf) reuse the matching jerry-can photo per request.
const PRODUCT_IMAGES = {
  classic_liter: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780872197/gremier_products/tdwwgxlgfeuayejcw9xx.png',
  sweetened_classic: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780872252/gremier_products/aammabvw2fkatlg0nhgk.jpg',
  house_blend: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780872206/gremier_products/wzvelx8f0t8vadobgkki.jpg',
  colombia_liter: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780872214/gremier_products/gm5cyhiuvtgziywrlumy.jpg',
  decaf_liter: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780874062/gremier_products/jaflaz532cv4ergzrxyn.png',
  vanilla_mini: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780872123/gremier_products/gtsbkdo4vsbvladwxjcv.jpg',
  original_mini: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1781218301/gremier_products/do2nx4r7b5bdt2yi4wv2.jpg',
  caramel_mini: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780871990/gremier_products/ztfnvpiv9jmiicthqtjh.jpg',
  jerry_can: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780875936/gremier_products/rhe8sj9ex7vogfpqo5y0.png',
  jerry_can_houseblend: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1781437758/gremier_products/fwcoo28ybkfnoc7ypa6h.jpg',
  jerry_can_colombia: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780875948/gremier_products/etnr4i3i3slcdzshn2nm.jpg',
  vanilla_syrup: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1781507981/gremier_products/nzm2c9mee7oyzg5qutwv.png',
  caramel_syrup: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1781507965/gremier_products/bt6pk2hek5khsctvkxne.png',
  // concentrate-type keys → matching jerry can photo (no decaf 5L exists, reuse classic jerry shape)
  classic: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780875936/gremier_products/rhe8sj9ex7vogfpqo5y0.png',
  houseBlend: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1781437758/gremier_products/fwcoo28ybkfnoc7ypa6h.jpg',
  colombia: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780875948/gremier_products/etnr4i3i3slcdzshn2nm.jpg',
  decaf: 'https://res.cloudinary.com/dqhfv5grg/image/upload/v1780874062/gremier_products/jaflaz532cv4ergzrxyn.png'
};
// fallbacks for keys with no real photo (classic_mini / house_blend_mini / jerry_can_decaf / dispenser / sugar_syrup)
const PRODUCT_IMG_FALLBACK_BOTTLE = PRODUCT_IMAGES.classic_liter;
const PRODUCT_IMG_FALLBACK_JERRY = PRODUCT_IMAGES.jerry_can;
const PRODUCT_IMG_FALLBACK_SYRUP = PRODUCT_IMAGES.vanilla_syrup;
function getProductImage(pid) {
  if (window.__OPS_PRODUCT_IMAGES__?.[pid]) return window.__OPS_PRODUCT_IMAGES__[pid];
  if (window.__OPS_DYNAMIC_PRODUCT_IMAGES__?.[pid]) return window.__OPS_DYNAMIC_PRODUCT_IMAGES__[pid];
  if (PRODUCT_IMAGES[pid]) return PRODUCT_IMAGES[pid];
  if (!pid) return PRODUCT_IMG_FALLBACK_BOTTLE;
  if (pid.includes('jerry')) return PRODUCT_IMG_FALLBACK_JERRY;
  if (pid.includes('syrup')) return PRODUCT_IMG_FALLBACK_SYRUP;
  return PRODUCT_IMG_FALLBACK_BOTTLE;
}
function ProductThumb({
  pid,
  size
}) {
  const s = size || 28;
  return /*#__PURE__*/React.createElement("img", {
    src: getProductImage(pid),
    alt: "",
    style: {
      width: s,
      height: s,
      borderRadius: 6,
      objectFit: 'cover',
      flexShrink: 0,
      background: '#fafafa',
      border: '1px solid #e0e0e0'
    }
  });
}
window.getProductImage = getProductImage; // exposed for the plain-JS Log Delivery modal

// ── styles ─────────────────────────────────────────────────
const TS = {
  screen: {
    background: '#ffffff',
    minHeight: '100%',
    fontFamily: "'DM Sans',sans-serif",
    color: '#121212',
    paddingBottom: 120
  },
  card: {
    background: '#ffffff',
    border: '1px solid #cccccc',
    borderRadius: 6,
    padding: '14px 16px',
    margin: '10px 12px'
  },
  hdr: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#121212',
    marginBottom: 10
  },
  jobRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 0',
    borderBottom: '1px solid #e0e0e0',
    cursor: 'pointer'
  },
  checkbox: color => ({
    width: 22,
    height: 22,
    borderRadius: 5,
    border: `1.5px solid ${color}`,
    background: 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
    marginTop: 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    color
  }),
  label: color => ({
    fontSize: 13,
    fontWeight: 600,
    color,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }),
  meta: {
    fontSize: 11,
    color: '#6a6a6a',
    marginTop: 2
  },
  pill: (bg, color) => ({
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: 'uppercase',
    padding: '2px 7px',
    borderRadius: 10,
    background: bg,
    color,
    display: 'inline-block',
    marginLeft: 6
  }),
  calGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7,1fr)',
    gap: 2,
    padding: '0 4px'
  },
  calHdr: {
    fontSize: 9,
    color: '#6a6a6a',
    textAlign: 'center',
    padding: '4px 0',
    letterSpacing: 1
  },
  calCell: {
    borderRadius: 4,
    padding: '4px 2px',
    textAlign: 'center',
    minHeight: 34,
    cursor: 'pointer'
  },
  btn: (bg, color) => ({
    background: bg,
    color,
    border: 'none',
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    flex: 1
  }),
  modal: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
    padding: 16
  },
  modalBox: {
    background: '#ffffff',
    border: '1px solid #cccccc',
    borderRadius: 12,
    padding: 22,
    width: '100%',
    maxWidth: 440
  },
  modalTitle: {
    fontFamily: "'DM Sans',sans-serif",
    fontWeight: 700,
    fontSize: '1.2rem',
    color: '#121212',
    marginBottom: 14
  },
  inp: {
    width: '100%',
    background: '#fafafa',
    border: '1px solid #cccccc',
    borderRadius: 6,
    padding: '10px 12px',
    color: '#121212',
    fontSize: 15,
    boxSizing: 'border-box'
  },
  qRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '7px 0',
    borderBottom: '1px solid #e0e0e0'
  },
  qBtn: {
    width: 28,
    height: 28,
    borderRadius: 5,
    background: '#eeeeee',
    border: '1px solid #cccccc',
    color: '#121212',
    fontSize: 16,
    cursor: 'pointer'
  },
  qInp: {
    width: 54,
    background: '#fafafa',
    border: '1px solid #cccccc',
    borderRadius: 5,
    padding: '5px',
    color: '#121212',
    fontSize: 14,
    textAlign: 'center'
  },
  drawerBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.4)',
    zIndex: 200
  },
  drawer: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#fafafa',
    border: '1px solid #cccccc',
    borderRadius: '16px 16px 0 0',
    padding: '18px 16px 40px',
    maxHeight: '72vh',
    overflowY: 'auto',
    zIndex: 201
  },
  drawerTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 14
  },
  waBtn: {
    display: 'block',
    background: '#25D366',
    color: '#fff',
    textAlign: 'center',
    padding: '11px',
    borderRadius: 8,
    textDecoration: 'none',
    fontWeight: 700,
    fontSize: 14
  }
};
function jobColor2(job) {
  if (job.type === 'drain') return '#7d55ab';
  if (job.type === 'brew') return '#3f7fc4';
  if (job.type === 'bottling') return '#b8860b';
  if (job.type === 'labeling') return '#8a7060';
  if (job.deliveryType === 'store') return '#1a1a1a';
  return '#2e8b57';
}
function jobLabel2(job) {
  if (job.type === 'delivery') {
    if (job.deliveryType === 'store') return job.storeName || 'Store';
    if (job.deliveryType === 'coffeebar') return `${job.cbName || job.privateName || 'Coffee Bar'} — Coffee Bar`;
    return job.privateName || 'Private';
  }
  return job.label || job.type;
}

// ── CheckoffModal ──────────────────────────────────────────
function CheckoffModal2({
  job,
  onConfirm,
  onCancel
}) {
  const LABELED = ['classic_liter', 'sweetened_classic', 'house_blend', 'colombia_liter', 'vanilla_mini', 'original_mini', 'caramel_mini', 'classic_mini', 'house_blend_mini'];
  const MINI_P = ['vanilla_mini', 'original_mini', 'caramel_mini'];
  const JERRY_P = ['jerry_can', 'jerry_can_houseblend', 'jerry_can_colombia', 'jerry_can_decaf'];
  const PRODS = window.__OPS_PRODUCTS_FULL__;
  const planned = job.liters || job.plannedTotal || 0;
  const [actual, setActual] = useState2(planned);
  const [confirmedQtys, setConfirmedQtys] = useState2(Object.fromEntries(Object.entries(job.quantities || {}).map(([pid, qty]) => [pid, qty])));
  const [allCorrect, setAllCorrect] = useState2(null);
  const [askLabeled, setAskLabeled] = useState2(false);
  const [labeledUsed, setLabeledUsed] = useState2({});
  const [cbPeople, setCbPeople] = useState2(job.people || 25);
  const [cbDispensers, setCbDispensers] = useState2(job.dispensers || 0);
  const [cbSyrups, setCbSyrups] = useState2(job.cbSyrups || {
    vanilla_syrup: 0,
    caramel_syrup: 0,
    sugar_syrup: 0
  });
  const PROD_LABELS = {
    classic_liter: 'Classic',
    sweetened_classic: 'Sweetened Classic',
    house_blend: 'House Blend',
    colombia_liter: 'Colombia',
    decaf_liter: 'Decaf',
    classic_mini: 'Classic Mini',
    house_blend_mini: 'House Blend Mini',
    vanilla_mini: 'Vanilla Mini',
    original_mini: 'Original Mini',
    caramel_mini: 'Caramel Mini',
    jerry_can: 'Jerry Can Classic',
    jerry_can_houseblend: 'Jerry Can House Blend',
    jerry_can_colombia: 'Jerry Can Colombia',
    jerry_can_decaf: 'Jerry Can Decaf',
    vanilla_syrup: 'Vanilla Syrup',
    caramel_syrup: 'Caramel Syrup',
    sugar_syrup: 'Sugar Syrup',
    dispenser: 'Dispenser'
  };
  Object.entries(window.__OPS_DYNAMIC_PRODUCTS__ || {}).forEach(([pid, p]) => {
    PROD_LABELS[pid] = p.label || pid;
  });
  function getBottledUnits(liters) {
    if (MINI_P.includes(job.product)) return Math.round(liters * 4);
    if (JERRY_P.includes(job.product)) return Math.round(liters / 5);
    return Math.round(liters);
  }

  // delivery — ask if correct
  if (job.type === 'delivery' && allCorrect === null) {
    const itemList = job.deliveryType === 'coffeebar' ? `Coffee Bar — ${job.people} people, ${(job.jerryCans || []).length} jerry cans` : Object.entries(job.quantities || {}).filter(([, q]) => q > 0).map(([pid, qty]) => `${qty}× ${PROD_LABELS[pid] || pid}`).join(', ');
    return /*#__PURE__*/React.createElement("div", {
      style: TS.modal,
      onClick: onCancel
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalBox,
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalTitle
    }, "Confirm Delivery"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: '#333333',
        fontSize: 14,
        marginBottom: 16,
        lineHeight: 1.6
      }
    }, "Did you deliver exactly:", /*#__PURE__*/React.createElement("br", null), /*#__PURE__*/React.createElement("strong", {
      style: {
        color: '#121212'
      }
    }, itemList || 'nothing listed'), "?"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        marginTop: 14
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#eeeeee', '#121212'),
      onClick: () => setAllCorrect(false)
    }, "No, change it"), /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#1a1a1a', '#ffffff'),
      onClick: () => onConfirm(job, planned, null)
    }, "Yes \u2713")), /*#__PURE__*/React.createElement("button", {
      style: {
        ...TS.btn('#fafafa', '#6a6a6a'),
        marginTop: 8,
        border: '1px solid #cccccc'
      },
      onClick: onCancel
    }, "Cancel")));
  }

  // delivery — adjust quantities
  if (job.type === 'delivery' && allCorrect === false) {
    if (job.deliveryType === 'coffeebar') {
      return /*#__PURE__*/React.createElement("div", {
        style: TS.modal,
        onClick: onCancel
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          ...TS.modalBox,
          maxHeight: '80vh',
          overflowY: 'auto'
        },
        onClick: e => e.stopPropagation()
      }, /*#__PURE__*/React.createElement("div", {
        style: TS.modalTitle
      }, "What did you deliver?"), /*#__PURE__*/React.createElement("div", {
        style: TS.qRow
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#333333'
        }
      }, "Jerry Cans"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement("button", {
        style: TS.qBtn,
        onClick: () => setCbPeople(p => Math.max(25, p - 25))
      }, "\u2212"), /*#__PURE__*/React.createElement("span", {
        style: {
          minWidth: 30,
          textAlign: 'center'
        }
      }, Math.floor(cbPeople / 25)), /*#__PURE__*/React.createElement("button", {
        style: TS.qBtn,
        onClick: () => setCbPeople(p => p + 25)
      }, "+"))), /*#__PURE__*/React.createElement("div", {
        style: TS.qRow
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#333333'
        }
      }, "Dispensers"), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement("button", {
        style: TS.qBtn,
        onClick: () => setCbDispensers(p => Math.max(0, p - 1))
      }, "\u2212"), /*#__PURE__*/React.createElement("span", {
        style: {
          minWidth: 30,
          textAlign: 'center'
        }
      }, cbDispensers), /*#__PURE__*/React.createElement("button", {
        style: TS.qBtn,
        onClick: () => setCbDispensers(p => p + 1)
      }, "+"))), ['vanilla_syrup', 'caramel_syrup', 'sugar_syrup'].map(pid => /*#__PURE__*/React.createElement("div", {
        key: pid,
        style: TS.qRow
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          color: '#333333',
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(ProductThumb, {
        pid: pid,
        size: 22
      }), PROD_LABELS[pid]), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement("button", {
        style: TS.qBtn,
        onClick: () => setCbSyrups(s => ({
          ...s,
          [pid]: Math.max(0, (s[pid] || 0) - 1)
        }))
      }, "\u2212"), /*#__PURE__*/React.createElement("span", {
        style: {
          minWidth: 30,
          textAlign: 'center'
        }
      }, cbSyrups[pid] || 0), /*#__PURE__*/React.createElement("button", {
        style: TS.qBtn,
        onClick: () => setCbSyrups(s => ({
          ...s,
          [pid]: (s[pid] || 0) + 1
        }))
      }, "+")))), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: 10,
          marginTop: 14
        }
      }, /*#__PURE__*/React.createElement("button", {
        style: TS.btn('#eeeeee', '#121212'),
        onClick: onCancel
      }, "Cancel"), /*#__PURE__*/React.createElement("button", {
        style: TS.btn('#1a1a1a', '#ffffff'),
        onClick: () => onConfirm({
          ...job,
          people: cbPeople,
          dispensers: cbDispensers,
          cbSyrups,
          jerryCans: Array(Math.floor(cbPeople / 25)).fill('classic')
        }, cbPeople, null)
      }, "Confirm \u2713"))));
    }
    return /*#__PURE__*/React.createElement("div", {
      style: TS.modal,
      onClick: onCancel
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        ...TS.modalBox,
        maxHeight: '80vh',
        overflowY: 'auto'
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalTitle
    }, "What did you deliver?"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: '#6a6a6a',
        fontSize: 12,
        marginBottom: 10,
        lineHeight: 1.5
      }
    }, "Adjust anything below \u2014 this isn't limited to what was originally planned."), [['liter', 'Liter Bottles'], ['mini', 'Mini Bottles'], ['jerry', 'Jerry Cans'], ['syrup', 'Syrups']].map(([cat, catLabel]) => {
      const items = Object.entries(PRODUCTS).filter(([, p]) => p.category === cat);
      if (!items.length) return null;
      return /*#__PURE__*/React.createElement("div", {
        key: cat,
        style: {
          marginBottom: 10
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 700,
          color: '#7a7a7a',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          margin: '8px 0 4px'
        }
      }, catLabel), items.map(([pid, p]) => {
        const qty = confirmedQtys[pid] ?? (job.quantities || {})[pid] ?? 0;
        return /*#__PURE__*/React.createElement("div", {
          key: pid,
          style: TS.qRow
        }, /*#__PURE__*/React.createElement("span", {
          style: {
            color: '#333333',
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }
        }, /*#__PURE__*/React.createElement(ProductThumb, {
          pid: pid,
          size: 26
        }), p.label), /*#__PURE__*/React.createElement("div", {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }
        }, /*#__PURE__*/React.createElement("button", {
          style: TS.qBtn,
          onClick: () => setConfirmedQtys(q => ({
            ...q,
            [pid]: Math.max(0, qty - 1)
          }))
        }, "\u2212"), /*#__PURE__*/React.createElement("input", {
          style: TS.qInp,
          type: "number",
          value: qty,
          onChange: e => setConfirmedQtys(q => ({
            ...q,
            [pid]: Number(e.target.value) || 0
          }))
        }), /*#__PURE__*/React.createElement("button", {
          style: TS.qBtn,
          onClick: () => setConfirmedQtys(q => ({
            ...q,
            [pid]: qty + 1
          }))
        }, "+")));
      }));
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        marginTop: 14
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#eeeeee', '#121212'),
      onClick: onCancel
    }, "Cancel"), /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#1a1a1a', '#ffffff'),
      onClick: () => {
        const total = Object.values(confirmedQtys).reduce((s, v) => s + (v || 0), 0);
        onConfirm(job, total, confirmedQtys);
      }
    }, "Confirm \u2713"))));
  }

  // drain — this changes concentrate by a full brew amount, so require an explicit confirmation.
  if (job.type === 'drain') {
    if (!isRealDrainJob2(job)) {
      return /*#__PURE__*/React.createElement("div", {
        style: TS.modal,
        onClick: onCancel
      }, /*#__PURE__*/React.createElement("div", {
        style: TS.modalBox,
        onClick: e => e.stopPropagation()
      }, /*#__PURE__*/React.createElement("div", {
        style: TS.modalTitle
      }, "Blocked Unsafe Drain"), /*#__PURE__*/React.createElement("div", {
        style: {
          background: '#fdf1ec',
          border: '1px solid #d5544a',
          borderRadius: 6,
          padding: '10px 12px',
          marginBottom: 14,
          color: '#b3372c',
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.5
        }
      }, "This task looks like a stock correction, not a real drain. It will not change concentrate."), /*#__PURE__*/React.createElement("div", {
        style: {
          color: '#333333',
          fontSize: 14,
          marginBottom: 16,
          lineHeight: 1.6
        }
      }, "Use the Stock tab to add/remove bottles. Only tasks explicitly labeled \u201CDrain \u2026\u201D from a brew should add concentrate."), /*#__PURE__*/React.createElement("button", {
        style: TS.btn('#eeeeee', '#121212'),
        onClick: onCancel
      }, "Close")));
    }
    const drainLiters = {
      3: 19,
      2: 12.7,
      1.5: 9.5,
      1: 6.4
    }[Number(job.kg)] || 19;
    const concLabels = {
      classic: 'Classic',
      houseBlend: 'House Blend',
      colombia: 'Colombia',
      decaf: 'Decaf'
    };
    return /*#__PURE__*/React.createElement("div", {
      style: TS.modal,
      onClick: onCancel
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalBox,
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalTitle
    }, "Confirm Drain"), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fdf1ec',
        border: '1px solid #d5544a',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 14,
        color: '#b3372c',
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.5
      }
    }, "This will add ", drainLiters, "L of ", concLabels[job.product] || job.product, " concentrate."), /*#__PURE__*/React.createElement("div", {
      style: {
        color: '#333333',
        fontSize: 14,
        marginBottom: 16,
        lineHeight: 1.6
      }
    }, "Only confirm if you actually drained this brew. If you are only fixing bottle stock, cancel and use the Stock tab."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        marginTop: 14
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#eeeeee', '#121212'),
      onClick: onCancel
    }, "Cancel"), /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#b8860b', '#ffffff'),
      onClick: () => onConfirm(job, drainLiters, null)
    }, "Yes, add concentrate \u2713"))));
  }

  // bottling
  if (job.type === 'bottling' && !askLabeled) {
    return /*#__PURE__*/React.createElement("div", {
      style: TS.modal
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalBox
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        ...TS.modalTitle,
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(ProductThumb, {
      pid: job.product,
      size: 32
    }), "Confirm Bottling"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: '#333333',
        fontSize: 14,
        marginBottom: 12
      }
    }, "Planned: ", planned, "L. How much did you actually make?"), /*#__PURE__*/React.createElement("input", {
      style: {
        ...TS.inp,
        fontSize: 22,
        textAlign: 'center',
        marginBottom: 8
      },
      type: "number",
      value: actual,
      onChange: e => setActual(Number(e.target.value))
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        marginTop: 14
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#eeeeee', '#121212'),
      onClick: onCancel
    }, "Cancel"), /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#1a1a1a', '#ffffff'),
      onClick: () => {
        if (window.gremierLabelsEnabled() && LABELED.includes(job.product)) {
          setLabeledUsed({
            [job.product]: getBottledUnits(actual)
          });
          setAskLabeled(true);
        } else onConfirm(job, actual, null);
      }
    }, "Next \u2192"))));
  }
  if (job.type === 'bottling' && askLabeled) {
    return /*#__PURE__*/React.createElement("div", {
      style: TS.modal
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalBox
    }, /*#__PURE__*/React.createElement("div", {
      style: TS.modalTitle
    }, "Labeled Bottles Used?"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: '#333333',
        fontSize: 14,
        marginBottom: 12
      }
    }, "How many labeled ", PROD_LABELS[job.product] || job.product, " bottles did you use?"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: TS.qBtn,
      onClick: () => setLabeledUsed(p => ({
        ...p,
        [job.product]: Math.max(0, (p[job.product] || 0) - 1)
      }))
    }, "\u2212"), /*#__PURE__*/React.createElement("input", {
      style: {
        ...TS.inp,
        fontSize: 22,
        textAlign: 'center'
      },
      type: "number",
      value: labeledUsed[job.product] || 0,
      onChange: e => setLabeledUsed(p => ({
        ...p,
        [job.product]: Number(e.target.value) || 0
      }))
    }), /*#__PURE__*/React.createElement("button", {
      style: TS.qBtn,
      onClick: () => setLabeledUsed(p => ({
        ...p,
        [job.product]: (p[job.product] || 0) + 1
      }))
    }, "+")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#eeeeee', '#121212'),
      onClick: () => setAskLabeled(false)
    }, "\u2190 Back"), /*#__PURE__*/React.createElement("button", {
      style: TS.btn('#1a1a1a', '#ffffff'),
      onClick: () => onConfirm({
        ...job,
        labeledUsed
      }, actual, null)
    }, "Confirm \u2713"))));
  }

  // generic
  return /*#__PURE__*/React.createElement("div", {
    style: TS.modal
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.modalBox
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.modalTitle
  }, "Confirm Check-off"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#333333',
      fontSize: 14,
      marginBottom: 12
    }
  }, "Planned: ", planned, ". Actual?"), /*#__PURE__*/React.createElement("input", {
    style: {
      ...TS.inp,
      fontSize: 22,
      textAlign: 'center',
      marginBottom: 8
    },
    type: "number",
    value: actual,
    onChange: e => setActual(Number(e.target.value))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: TS.btn('#eeeeee', '#121212'),
    onClick: onCancel
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    style: TS.btn('#1a1a1a', '#ffffff'),
    onClick: () => onConfirm(job, actual, null)
  }, "Confirm \u2713"))));
}

// ── Reschedule modal (production jobs: brew/bottling/labeling/drain) ──────
function RescheduleModal2({
  job,
  onSave,
  onCancel
}) {
  const [date, setDate] = useState2(job.date || todayISO2());
  const [time, setTime] = useState2(job.time || '');
  const label = jobLabel2(job);
  return /*#__PURE__*/React.createElement("div", {
    style: TS.modal,
    onClick: onCancel
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.modalBox,
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.modalTitle,
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, job.product && /*#__PURE__*/React.createElement(ProductThumb, {
    pid: job.product,
    size: 30
  }), "Reschedule"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#333333',
      fontSize: 14,
      marginBottom: 16
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: '#6a6a6a',
      marginBottom: 6,
      display: 'block'
    }
  }, "Date"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    type: "date",
    value: date,
    onChange: e => setDate(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: '#6a6a6a',
      marginBottom: 6,
      display: 'block'
    }
  }, "Time (optional)"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    type: "time",
    value: time,
    onChange: e => setTime(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: TS.btn('#eeeeee', '#121212'),
    onClick: onCancel
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    style: TS.btn('#1a1a1a', '#ffffff'),
    onClick: () => onSave(job, date, time)
  }, "Save \u2713"))));
}

// ── Job row components ─────────────────────────────────────
function JobRowComp({
  job,
  onCheckoff,
  onTap,
  showDelete,
  onDelete
}) {
  const color = jobColor2(job);
  const label = jobLabel2(job);
  const overdue = isJobOverdue2(job);
  // Keep the main schedule list clean: product breakdowns are available when opening/checking off the task.
  const deliveryItems = [];
  const showItemThumbs = false;
  const singleThumbPid = job.type === 'brew' || job.type === 'bottling' ? job.product : null;
  const detail = job.type === 'brew' ? `${job.kg}kg` : job.type === 'bottling' ? `${job.liters}L` : '';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.jobRow
    },
    onClick: () => onTap && onTap(job)
  }, onCheckoff && /*#__PURE__*/React.createElement("button", {
    style: TS.checkbox(overdue ? '#d5544a' : color),
    onClick: e => {
      e.stopPropagation();
      onCheckoff(job);
    }
  }, job.brewStarted && job.type === 'brew' ? '·' : ''), singleThumbPid && /*#__PURE__*/React.createElement(ProductThumb, {
    pid: singleThumbPid,
    size: 26
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.label(overdue ? '#d5544a' : color)
  }, label), deliveryItems.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 3,
      marginBottom: 2
    }
  }, deliveryItems.map(([pid, qty]) => /*#__PURE__*/React.createElement("div", {
    key: pid,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      background: '#fafafa',
      border: '1px solid #e0e0e0',
      borderRadius: 5,
      padding: showItemThumbs ? '2px 6px 2px 2px' : '2px 6px'
    }
  }, showItemThumbs && /*#__PURE__*/React.createElement(ProductThumb, {
    pid: pid,
    size: 18
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: '#6a6a6a'
    }
  }, qty, "\xD7 ", pid.replace(/_/g, ' '))))), detail && /*#__PURE__*/React.createElement("div", {
    style: TS.meta
  }, detail), /*#__PURE__*/React.createElement("div", {
    style: TS.meta
  }, formatDate2(job.date), job.time ? ` · ${formatTime2(job.time)}` : ''), (job.privateAddress || job.cbAddress) && /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.meta,
      color: '#3f7fc4'
    }
  }, "\uD83D\uDCCD ", job.privateAddress || job.cbAddress)), showDelete && /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#d5544a',
      fontSize: 16,
      cursor: 'pointer',
      padding: '2px 4px'
    },
    onClick: e => {
      e.stopPropagation();
      onDelete && onDelete(job);
    }
  }, "\uD83D\uDDD1"));
}

// ── Calendar ───────────────────────────────────────────────
function MiniCalendar2({
  year,
  month,
  jobs,
  today,
  onDayTap
}) {
  const days = monthDates2(year, month);
  const first = days[0].getDay();
  const cells = [...Array(first).fill(null), ...days];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: TS.calGrid
  }, ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => /*#__PURE__*/React.createElement("div", {
    key: d,
    style: TS.calHdr
  }, d)), cells.map((d, i) => {
    if (!d) return /*#__PURE__*/React.createElement("div", {
      key: 'e' + i
    });
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dj = jobs.filter(j => j.date === iso && !j.done && !j.brewStarted);
    const isT = iso === today;
    return /*#__PURE__*/React.createElement("div", {
      key: iso,
      style: {
        ...TS.calCell,
        background: isT ? 'rgba(0,0,0,.07)' : 'transparent'
      },
      onClick: () => onDayTap(iso)
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: isT ? '#121212' : '#6a6a6a'
      }
    }, parseInt(iso.split('-')[2], 10)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'center',
        gap: 2,
        marginTop: 2
      }
    }, dj.some(j => j.type === 'delivery') && /*#__PURE__*/React.createElement("div", {
      style: {
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: '#1a1a1a'
      }
    }), dj.some(j => j.type !== 'delivery') && /*#__PURE__*/React.createElement("div", {
      style: {
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: '#3f7fc4'
      }
    })));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      fontSize: 10,
      color: '#6a6a6a',
      padding: '8px 4px',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: '#1a1a1a',
      marginRight: 4
    }
  }), "Delivery"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: '#3f7fc4',
      marginRight: 4
    }
  }), "Production")));
}

// ── DayPopup ───────────────────────────────────────────────
function DayPopup2({
  date,
  jobs,
  onClose,
  onCheckoff
}) {
  const dayJobs = jobs.filter(j => j.date === date && !j.done && !j.brewStarted);
  return /*#__PURE__*/React.createElement("div", {
    style: TS.modal,
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.modalBox,
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.modalTitle
  }, formatDate2(date)), dayJobs.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#6a6a6a',
      fontSize: 14,
      padding: '12px 0'
    }
  }, "Nothing scheduled") : dayJobs.map(j => /*#__PURE__*/React.createElement(JobRowComp, {
    key: j.id,
    job: j,
    onCheckoff: onCheckoff,
    onTap: () => {}
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      ...TS.btn('#eeeeee', '#121212'),
      marginTop: 14
    },
    onClick: onClose
  }, "Close")));
}

// ── WA Drawer ──────────────────────────────────────────────
function WaDrawer2({
  jobs,
  stores,
  onMarkSent,
  onClose
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: TS.drawerBackdrop,
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    style: TS.drawer
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...TS.drawerTitle,
      color: '#25D366'
    }
  }, "\uD83D\uDCAC WhatsApp Notes"), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#6a6a6a',
      fontSize: 18,
      cursor: 'pointer'
    },
    onClick: onClose
  }, "\u2715")), jobs.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#6a6a6a',
      fontSize: 13
    }
  }, "All sent!"), jobs.map(job => {
    const waLink = buildStoreWaLink2(job, stores);
    return /*#__PURE__*/React.createElement("div", {
      key: job.id,
      style: {
        padding: '12px 0',
        borderBottom: '1px solid #e0e0e0'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        color: '#121212',
        marginBottom: 6
      }
    }, job.storeName), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#6a6a6a',
        marginBottom: 10
      }
    }, formatDate2(job.date)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8
      }
    }, waLink && /*#__PURE__*/React.createElement("a", {
      href: waLink,
      target: "_blank",
      rel: "noreferrer",
      style: {
        ...TS.waBtn,
        flex: 1
      }
    }, "\uD83D\uDCAC Send"), /*#__PURE__*/React.createElement("button", {
      style: {
        ...TS.btn('#eeeeee', '#121212'),
        flex: 1
      },
      onClick: () => onMarkSent(job.id)
    }, "\u2713 Sent")));
  })));
}

// ── Billing Drawer ─────────────────────────────────────────
function BillingDrawer2({
  jobs,
  onMarkBilled,
  onMarkPaid,
  onClose
}) {
  const PROD_LABELS = {
    classic_liter: 'Classic',
    sweetened_classic: 'Sweetened Classic',
    house_blend: 'House Blend',
    colombia_liter: 'Colombia',
    decaf_liter: 'Decaf',
    classic_mini: 'Classic Mini',
    house_blend_mini: 'House Blend Mini',
    vanilla_mini: 'Vanilla Mini',
    original_mini: 'Original Mini',
    caramel_mini: 'Caramel Mini',
    jerry_can: 'Jerry Can',
    vanilla_syrup: 'Vanilla Syrup',
    caramel_syrup: 'Caramel Syrup',
    sugar_syrup: 'Sugar Syrup'
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: TS.drawerBackdrop,
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    style: TS.drawer
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...TS.drawerTitle,
      color: '#b8860b'
    }
  }, "\uD83D\uDCB0 Billing"), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#6a6a6a',
      fontSize: 18,
      cursor: 'pointer'
    },
    onClick: onClose
  }, "\u2715")), jobs.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#6a6a6a',
      fontSize: 13
    }
  }, "All billed!"), jobs.map(job => {
    const name = job.deliveryType === 'coffeebar' ? `Coffee Bar${job.cbName ? ' — ' + job.cbName : ''}` : job.privateName || 'Private Delivery';
    const detail = Object.entries(job.quantities || {}).filter(([, q]) => q > 0).map(([pid, qty]) => `${qty} ${PROD_LABELS[pid] || pid}`).join(', ');
    return /*#__PURE__*/React.createElement("div", {
      key: job.id,
      style: {
        padding: '12px 0',
        borderBottom: '1px solid #e0e0e0'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        color: '#121212',
        marginBottom: 4
      }
    }, name), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#6a6a6a',
        marginBottom: 4
      }
    }, formatDate2(job.date)), detail && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#6a6a6a',
        marginBottom: 8
      }
    }, detail), !job.billed && /*#__PURE__*/React.createElement("button", {
      style: {
        ...TS.btn('#b8860b', '#fff'),
        width: '100%'
      },
      onClick: () => onMarkBilled(job.id)
    }, "\u2713 Mark Billed"), job.billed && !job.paid && /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#e9f6ee',
        border: '1px solid #2e8b57',
        borderRadius: 6,
        padding: 10,
        marginTop: 4
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: '#2e8b57',
        marginBottom: 6
      }
    }, "\u2713 Billed \u2014 awaiting payment"), /*#__PURE__*/React.createElement("button", {
      style: {
        ...TS.btn('#1a1a1a', '#fff'),
        width: '100%'
      },
      onClick: () => onMarkPaid(job.id)
    }, "\uD83D\uDCB3 Mark Paid")));
  })));
}

// ── Website Queue Drawer ───────────────────────────────────
function WebsiteQueueDrawer2({
  orders,
  onClose,
  onSchedule,
  onDismiss
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: TS.drawerBackdrop,
    onClick: onClose
  }), /*#__PURE__*/React.createElement("div", {
    style: TS.drawer
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...TS.drawerTitle,
      color: '#3f7fc4'
    }
  }, "\uD83D\uDCE6 Website Orders"), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#6a6a6a',
      fontSize: 18,
      cursor: 'pointer'
    },
    onClick: onClose
  }, "\u2715")), orders.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#6a6a6a',
      fontSize: 13
    }
  }, "Nothing to schedule!"), orders.map(o => {
    const label = websiteOrderDisplayLabel2(o);
    const items = (o.items || []).map(i => `${i.name_en || 'Item'} ×${i.qty || 1}`).join(', ');
    const unpaid = o.payment_status && o.payment_status !== 'paid';
    return /*#__PURE__*/React.createElement("div", {
      key: o.id,
      style: {
        padding: '12px 0',
        borderBottom: '1px solid #e0e0e0'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        color: '#121212',
        marginBottom: 4
      }
    }, label, unpaid && /*#__PURE__*/React.createElement("span", {
      style: TS.pill('rgba(224,160,48,.15)', '#b8860b')
    }, "Awaiting payment")), o.delivery_address && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#3f7fc4',
        marginBottom: 4
      }
    }, "\uD83D\uDCCD ", o.delivery_address), (() => {
      const di = o.delivery_info || {};
      const t = String(di.delivery_type || 'regular');
      const label = t === 'event' ? 'Event' : t === 'expedited' ? di.priority_type === 'specific_date' ? 'Expedited — specific date' : 'Expedited (next day)' : 'Regular (2 days)';
      const when = di.delivery_date ? ` · ${di.delivery_date}${di.event_time ? ' ' + di.event_time : ''}` : '';
      return /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: '#6a6a6a',
          marginBottom: 4
        }
      }, "\uD83D\uDE9A ", label, when);
    })(), o.notes && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#b8860b',
        marginBottom: 4
      }
    }, "\u26A0 ", o.notes), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: '#6a6a6a',
        marginBottom: 10
      }
    }, items), /*#__PURE__*/React.createElement("button", {
      style: {
        ...TS.btn('#1a1a1a', '#fff'),
        width: '100%',
        marginBottom: 6
      },
      onClick: () => onSchedule(o)
    }, "Schedule \u2192"), /*#__PURE__*/React.createElement("button", {
      style: {
        ...TS.btn('#eeeeee', '#d5544a'),
        width: '100%',
        border: '1px solid #cccccc'
      },
      onClick: () => onDismiss(o)
    }, "Remove"));
  })));
}

// ── SCHEDULE TAB ROOT ──────────────────────────────────────
// Module-scope so React keeps the same component identity across ScheduleForm
// re-renders. When this was declared inside ScheduleForm, every keystroke made a
// "new" component type, so React unmounted/remounted every row — losing input
// focus and resetting the modal's scroll position to the top.
function QtyRows({
  FP,
  cat,
  title,
  values,
  setValues
}) {
  const items = Object.entries(FP).filter(([, p]) => p.category === cat);
  if (!items.length) return null;
  const bump = (pid, delta) => setValues(q => ({
    ...q,
    [pid]: Math.max(0, (Number(q[pid]) || 0) + delta)
  }));
  // Keep the raw text the user is typing so intermediate states (e.g. clearing the field,
  // or typing "10" one digit at a time) don't get clamped/reset mid-keystroke.
  const setOne = (pid, val) => {
    const digits = val.replace(/[^0-9]/g, '');
    setValues(q => ({
      ...q,
      [pid]: digits === '' ? '' : Math.max(0, parseInt(digits, 10))
    }));
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9,
      color: '#6a6a6a',
      letterSpacing: 1,
      textTransform: 'uppercase',
      fontWeight: 700,
      marginTop: 8,
      marginBottom: 4,
      borderBottom: '1px solid #e0e0e0',
      paddingBottom: 3
    }
  }, title), items.map(([pid, p]) => /*#__PURE__*/React.createElement("div", {
    key: pid,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 0',
      borderBottom: '1px solid #e0e0e0'
    }
  }, /*#__PURE__*/React.createElement(ProductThumb, {
    pid: pid,
    size: 26
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      color: '#333333'
    }
  }, p.label), /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: TS.qBtn,
    onClick: () => bump(pid, -1)
  }, "\u2212"), /*#__PURE__*/React.createElement("input", {
    style: TS.qInp,
    type: "text",
    inputMode: "numeric",
    pattern: "[0-9]*",
    value: values[pid] === '' ? '' : values[pid] || 0,
    onChange: e => setOne(pid, e.target.value),
    onBlur: () => {
      if (values[pid] === '') setValues(q => ({
        ...q,
        [pid]: 0
      }));
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: TS.qBtn,
    onClick: () => bump(pid, 1)
  }, "+"))));
}

// Module-scope for the same component-identity reason as QtyRows above.
function DaySection({
  label,
  dayJobs,
  overdue,
  onCheckoff,
  onTap,
  onDelete
}) {
  const deliveries = dayJobs.filter(j => j.type === 'delivery');
  const production = dayJobs.filter(j => j.type !== 'delivery');
  if (!overdue && deliveries.length === 0 && production.length === 0) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        ...TS.card,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: '#121212'
      }
    }, label), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: '#6a6a6a',
        fontStyle: 'italic'
      }
    }, "\u2014 nothing scheduled"));
  }
  const showDel = deliveries.length > 0;
  const showProd = production.length > 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.card,
      border: overdue ? '1px solid #d5544a' : undefined,
      background: overdue ? '#fdecea' : undefined
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.hdr,
      color: overdue ? '#d5544a' : '#121212'
    }
  }, overdue ? '⚠ Overdue' : label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, showDel && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: '#121212',
      background: '#eeeeee',
      borderRadius: 5,
      padding: '5px 8px',
      textAlign: 'center',
      marginBottom: 8,
      letterSpacing: 1
    }
  }, "DELIVERIES"), deliveries.map(j => /*#__PURE__*/React.createElement(JobRowComp, {
    key: j.id,
    job: j,
    onCheckoff: onCheckoff,
    onTap: onTap,
    showDelete: true,
    onDelete: onDelete
  }))), showDel && showProd && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      background: '#eeeeee',
      flexShrink: 0
    }
  }), showProd && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: '#fff',
      background: '#3a5a7a',
      borderRadius: 5,
      padding: '5px 8px',
      textAlign: 'center',
      marginBottom: 8,
      letterSpacing: 1
    }
  }, "PRODUCTION"), production.map(j => /*#__PURE__*/React.createElement(JobRowComp, {
    key: j.id,
    job: j,
    onCheckoff: onCheckoff,
    onTap: onTap,
    showDelete: true,
    onDelete: onDelete
  })))));
}
function ScheduleForm({
  mode,
  stores,
  onClose,
  onSubmit,
  prefill
}) {
  const logNow = mode === 'lognow';
  const FP = {
    classic_liter: {
      label: 'Classic',
      category: 'liter'
    },
    sweetened_classic: {
      label: 'Sweetened Classic',
      category: 'liter'
    },
    house_blend: {
      label: 'House Blend',
      category: 'liter'
    },
    colombia_liter: {
      label: 'Colombia',
      category: 'liter'
    },
    decaf_liter: {
      label: 'Decaf',
      category: 'liter'
    },
    classic_mini: {
      label: 'Classic Mini',
      category: 'mini'
    },
    house_blend_mini: {
      label: 'House Blend Mini',
      category: 'mini'
    },
    vanilla_mini: {
      label: 'Vanilla Mini',
      category: 'mini'
    },
    original_mini: {
      label: 'Original Mini',
      category: 'mini'
    },
    caramel_mini: {
      label: 'Caramel Mini',
      category: 'mini'
    },
    jerry_can: {
      label: 'Jerry Can Classic',
      category: 'jerry'
    },
    jerry_can_houseblend: {
      label: 'Jerry Can House Blend',
      category: 'jerry'
    },
    jerry_can_colombia: {
      label: 'Jerry Can Colombia',
      category: 'jerry'
    },
    jerry_can_decaf: {
      label: 'Jerry Can Decaf',
      category: 'jerry'
    },
    vanilla_syrup: {
      label: 'Vanilla Syrup',
      category: 'syrup'
    },
    caramel_syrup: {
      label: 'Caramel Syrup',
      category: 'syrup'
    },
    sugar_syrup: {
      label: 'Sugar Syrup',
      category: 'syrup'
    }
  };
  Object.assign(FP, window.__OPS_DYNAMIC_PRODUCTS__ || {});
  const CONC = {
    classic: 'Classic (Dark Roast)',
    houseBlend: 'House Blend',
    colombia: 'Colombia (Light Roast)',
    decaf: 'Decaf'
  };
  const DEFAULT_CASE = {
    classic_liter: 6,
    sweetened_classic: 2,
    house_blend: 2,
    colombia_liter: 2
  };
  // same flavor-specific quick-fill shortcuts as the Store Deliveries tab's Log Delivery form
  const FLAVOR_CASES = {
    classic_liter: {
      label: 'Classic Case',
      qty: 12
    },
    sweetened_classic: {
      label: 'Sweetened Classic Case',
      qty: 12
    },
    house_blend: {
      label: 'House Blend Case',
      qty: 12
    },
    colombia_liter: {
      label: 'Colombia Case',
      qty: 12
    },
    decaf_liter: {
      label: 'Decaf Case',
      qty: 12
    }
  };
  const bottleProducts = Object.entries(FP).filter(([, p]) => p.category !== 'syrup' && p.category !== 'dispenser');
  const labelProducts = Object.entries(FP).filter(([, p]) => ['liter', 'mini', 'jerry'].includes(p.category));
  const [jobType, setJobType] = useState2('delivery');
  const [subType, setSubType] = useState2(prefill?.subType || 'store');
  const [prodType, setProdType] = useState2('brew');
  const [date, setDate] = useState2(prefill?.date || todayISO2());
  const [time, setTime] = useState2(prefill?.time || '');
  const [storeName, setStoreName] = useState2(prefill?.storeName || '');
  const [privateName, setPrivateName] = useState2(prefill?.privateName || '');
  const [privateAddress, setPrivateAddress] = useState2(prefill?.privateAddress || '');
  const [quantities, setQuantities] = useState2(prefill?.quantities || {});
  const [people, setPeople] = useState2(prefill?.people ?? 25);
  const [cbName, setCbName] = useState2(prefill?.cbName || '');
  const [cbAddress, setCbAddress] = useState2(prefill?.cbAddress || '');
  const [dispensers, setDispensers] = useState2(prefill?.dispensers ?? 1);
  // a brand-new job (no prefill at all) defaults all three syrups to checked/qty 1, same as before.
  // Editing an existing job instead mirrors exactly what was saved — a syrup absent from the saved
  // map means it was deliberately left unchecked, not "forgotten", so it should stay unchecked here too.
  const cbSyrupInit = (() => {
    const saved = prefill?.cbSyrups;
    const isEditing = saved !== undefined && saved !== null;
    const checked = {},
      qty = {};
    ['vanilla_syrup', 'caramel_syrup', 'sugar_syrup'].forEach(pid => {
      if (isEditing) {
        const has = Object.prototype.hasOwnProperty.call(saved, pid);
        checked[pid] = has && (saved[pid] || 0) > 0;
        qty[pid] = has ? saved[pid] || 0 : 1;
      } else {
        checked[pid] = true;
        qty[pid] = 1;
      }
    });
    return {
      checked,
      qty
    };
  })();
  const [cbSyrups, setCbSyrups] = useState2(cbSyrupInit.checked);
  const [cbSyrupQty, setCbSyrupQty] = useState2(cbSyrupInit.qty);
  const [cbExtras, setCbExtras] = useState2(prefill?.cbExtras || {});
  const [showCbExtras, setShowCbExtras] = useState2(Object.values(prefill?.cbExtras || {}).some(v => v > 0));
  const [brewConc, setBrewConc] = useState2('classic');
  const [kg, setKg] = useState2(3);
  const [bottleQuantities, setBottleQuantities] = useState2(prefill?.quantities || {});
  const [labelQuantities, setLabelQuantities] = useState2({});
  function changeQty(pid, delta) {
    setQuantities(q => ({
      ...q,
      [pid]: Math.max(0, (q[pid] || 0) + delta)
    }));
  }
  function setQty(pid, val) {
    setQuantities(q => ({
      ...q,
      [pid]: Math.max(0, parseInt(val) || 0)
    }));
  }
  function fillFlavorCase(pid) {
    const c = FLAVOR_CASES[pid];
    if (!c) return;
    setQuantities(q => ({
      ...q,
      [pid]: (q[pid] || 0) + c.qty
    }));
  }
  function build() {
    const base = {
      date: logNow ? todayISO2() : date || todayISO2(),
      time: logNow ? time || new Date().toTimeString().slice(0, 5) : time
    };
    if (jobType === 'delivery') {
      if (subType === 'coffeebar') {
        const canCount = Math.floor(people / 25);
        const finalSyrups = {};
        Object.entries(cbSyrups).forEach(([pid, checked]) => {
          if (checked) finalSyrups[pid] = cbSyrupQty[pid] || 0;
        });
        const cbExtrasClean = Object.fromEntries(Object.entries(cbExtras).filter(([, v]) => Number(v) > 0));
        return {
          ...base,
          type: 'delivery',
          deliveryType: 'coffeebar',
          people,
          jerryCans: Array(canCount).fill('classic'),
          cbName,
          cbAddress,
          dispensers,
          cbSyrups: finalSyrups,
          quantities: Object.keys(cbExtrasClean).length ? cbExtrasClean : undefined,
          label: `Coffee Bar${cbName ? ' — ' + cbName : ''} (${people}p)`
        };
      }
      const total = Object.values(quantities).reduce((s, v) => s + (v || 0), 0);
      return {
        ...base,
        type: 'delivery',
        deliveryType: subType,
        storeName: subType === 'store' ? storeName : undefined,
        privateName: subType === 'private' ? privateName : undefined,
        privateAddress: subType === 'private' ? privateAddress : undefined,
        customerPhone: prefill?.customerPhone || undefined,
        websiteOrderId: prefill?.websiteOrderId || undefined,
        quantities,
        plannedTotal: total,
        label: subType === 'store' ? storeName || 'Store' : privateName || 'Private'
      };
    }
    if (prodType === 'brew') return {
      ...base,
      type: 'brew',
      product: brewConc,
      kg,
      label: `Brew ${CONC[brewConc]} (${kg}kg)`
    };
    if (prodType === 'label') {
      const entries = Object.entries(labelQuantities).filter(([, qty]) => Number(qty) > 0);
      if (!entries.length) {
        alert('Pick at least one label quantity.');
        return null;
      }
      return entries.map(([pid, qty]) => ({
        ...base,
        type: 'labeling',
        product: pid,
        qty: Number(qty),
        label: `Label ${Number(qty)} ${FP[pid]?.label || ''}`
      }));
    }
    const entries = Object.entries(bottleQuantities).filter(([, qty]) => Number(qty) > 0);
    if (!entries.length) {
      alert('Pick at least one bottling quantity.');
      return null;
    }
    return entries.map(([pid, qty]) => {
      const units = Number(qty) || 0;
      const cat = FP[pid]?.category;
      const actualLiters = cat === 'mini' ? units / 4 : cat === 'jerry' ? units * 5 : units;
      return {
        ...base,
        type: 'bottling',
        product: pid,
        liters: actualLiters,
        qty: cat === 'jerry' ? units : undefined,
        label: `Bottle ${units}× ${FP[pid]?.label || ''}`
      };
    });
  }

  // Monochrome segmented control (matches the Stock tab model) — `color` kept for call-site compatibility, intentionally unused.
  const tog = (active, color) => ({
    flex: 1,
    padding: '8px 4px',
    background: active ? '#1a1a1a' : 'transparent',
    color: active ? '#ffffff' : '#6a6a6a',
    border: 'none',
    borderRadius: 9,
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    fontFamily: "'DM Sans',sans-serif",
    transition: 'all .2s',
    whiteSpace: 'nowrap'
  });
  const togRow = {
    display: 'flex',
    gap: 4,
    background: '#ffffff',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    padding: 3
  };
  const lbl = {
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#6a6a6a',
    marginBottom: 6,
    display: 'block'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: TS.modal,
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.modalBox,
      maxHeight: '88vh',
      overflowY: 'auto'
    },
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.modalTitle
  }, logNow ? '✓ Log Now' : '📅 Schedule'), /*#__PURE__*/React.createElement("div", {
    style: {
      ...togRow,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: tog(jobType === 'delivery'),
    onClick: () => setJobType('delivery')
  }, "Delivery"), /*#__PURE__*/React.createElement("button", {
    style: tog(jobType === 'production', '#3f7fc4'),
    onClick: () => setJobType('production')
  }, "Production")), jobType === 'delivery' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      ...togRow,
      marginBottom: 12
    }
  }, ['store', 'private', 'coffeebar'].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    style: tog(subType === t),
    onClick: () => setSubType(t)
  }, t === 'coffeebar' ? 'Coffee Bar' : t[0].toUpperCase() + t.slice(1)))), subType === 'store' && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Store"), /*#__PURE__*/React.createElement("select", {
    style: TS.inp,
    value: storeName,
    onChange: e => setStoreName(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "Select store\u2026"), stores.map(s => /*#__PURE__*/React.createElement("option", {
    key: s.name,
    value: s.name
  }, s.name)))), subType === 'private' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Recipient"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    value: privateName,
    onChange: e => setPrivateName(e.target.value),
    placeholder: "Name"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Address"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    value: privateAddress,
    onChange: e => setPrivateAddress(e.target.value),
    placeholder: "Delivery address"
  }))), subType !== 'coffeebar' && /*#__PURE__*/React.createElement(React.Fragment, null, subType === 'store' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      ...TS.btn('#eeeeee', '#121212'),
      flex: '0 1 auto',
      border: '1px solid #cccccc'
    },
    onClick: () => setQuantities({
      ...DEFAULT_CASE
    })
  }, "\u26A1 Default Case"), Object.entries(FLAVOR_CASES).map(([pid, c]) => /*#__PURE__*/React.createElement("button", {
    key: pid,
    style: {
      ...TS.btn('#eeeeee', '#121212'),
      flex: '0 1 auto',
      border: '1px solid #cccccc'
    },
    onClick: () => fillFlavorCase(pid)
  }, "\u26A1 ", c.label))), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "liter",
    title: "Liter Bottles",
    values: quantities,
    setValues: setQuantities
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "mini",
    title: "Mini Bottles",
    values: quantities,
    setValues: setQuantities
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "jerry",
    title: "Jerry Cans",
    values: quantities,
    setValues: setQuantities
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "syrup",
    title: "Syrups",
    values: quantities,
    setValues: setQuantities
  })), subType === 'coffeebar' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "People"), /*#__PURE__*/React.createElement("select", {
    style: TS.inp,
    value: people,
    onChange: e => setPeople(Number(e.target.value))
  }, [25, 50, 75, 100, 125, 150].map(n => /*#__PURE__*/React.createElement("option", {
    key: n,
    value: n
  }, n, " people (", Math.floor(n / 25), " cans)")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Client (optional)"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    value: cbName,
    onChange: e => setCbName(e.target.value),
    placeholder: "Event / who for"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Address (optional)"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    value: cbAddress,
    onChange: e => setCbAddress(e.target.value),
    placeholder: "Event address"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Dispensers"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    type: "number",
    value: dispensers,
    onChange: e => setDispensers(Number(e.target.value) || 0)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Syrups Included")), [['vanilla_syrup', 'Vanilla Syrup'], ['caramel_syrup', 'Caramel Syrup'], ['sugar_syrup', 'Sugar Syrup']].map(([pid, label]) => /*#__PURE__*/React.createElement("div", {
    key: pid,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '7px 0',
      borderBottom: '1px solid #e0e0e0'
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: cbSyrups[pid],
    onChange: e => setCbSyrups(s => ({
      ...s,
      [pid]: e.target.checked
    })),
    style: {
      width: 18,
      height: 18,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13,
      color: cbSyrups[pid] ? '#333333' : '#999999'
    }
  }, label), cbSyrups[pid] && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: TS.qBtn,
    onClick: () => setCbSyrupQty(q => ({
      ...q,
      [pid]: Math.max(0, (q[pid] || 0) - 1)
    }))
  }, "\u2212"), /*#__PURE__*/React.createElement("input", {
    style: TS.qInp,
    type: "number",
    value: cbSyrupQty[pid] || 0,
    onChange: e => setCbSyrupQty(q => ({
      ...q,
      [pid]: Number(e.target.value) || 0
    }))
  }), /*#__PURE__*/React.createElement("button", {
    style: TS.qBtn,
    onClick: () => setCbSyrupQty(q => ({
      ...q,
      [pid]: (q[pid] || 0) + 1
    }))
  }, "+")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, !showCbExtras && /*#__PURE__*/React.createElement("button", {
    style: {
      width: '100%',
      background: '#ffffff',
      border: '1px dashed #cccccc',
      borderRadius: 8,
      padding: '10px',
      fontSize: 13,
      color: '#6a6a6a',
      cursor: 'pointer',
      fontFamily: "'DM Sans',sans-serif"
    },
    onClick: () => setShowCbExtras(true)
  }, "+ More Items"), showCbExtras && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Extra Items"), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#6a6a6a',
      fontSize: 12,
      cursor: 'pointer',
      fontFamily: "'DM Sans',sans-serif"
    },
    onClick: () => {
      setShowCbExtras(false);
      setCbExtras({});
    }
  }, "\u2715 Remove")), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "liter",
    title: "Liter Bottles",
    values: cbExtras,
    setValues: setCbExtras
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "mini",
    title: "Mini Bottles",
    values: cbExtras,
    setValues: setCbExtras
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "jerry",
    title: "Jerry Cans",
    values: cbExtras,
    setValues: setCbExtras
  }))))), jobType === 'production' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      ...togRow,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: tog(prodType === 'brew', '#3f7fc4'),
    onClick: () => setProdType('brew')
  }, "Brew"), /*#__PURE__*/React.createElement("button", {
    style: tog(prodType === 'bottle', '#b8860b'),
    onClick: () => setProdType('bottle')
  }, "Bottle"), (window.gremierLabelsEnabled() || prefill?.type === 'labeling') && /*#__PURE__*/React.createElement("button", {
    style: tog(prodType === 'label', '#8a7060'),
    onClick: () => setProdType('label')
  }, "Label")), prodType === 'brew' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Concentrate"), /*#__PURE__*/React.createElement("select", {
    style: TS.inp,
    value: brewConc,
    onChange: e => setBrewConc(e.target.value)
  }, Object.entries(CONC).map(([k, v]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, v)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Kilos"), /*#__PURE__*/React.createElement("select", {
    style: TS.inp,
    value: kg,
    onChange: e => setKg(Number(e.target.value))
  }, /*#__PURE__*/React.createElement("option", {
    value: 3
  }, "3kg \u2192 ~19L"), /*#__PURE__*/React.createElement("option", {
    value: 2
  }, "2kg \u2192 ~12.7L"), /*#__PURE__*/React.createElement("option", {
    value: 1.5
  }, "1.5kg \u2192 ~9.5L"), /*#__PURE__*/React.createElement("option", {
    value: 1
  }, "1kg \u2192 ~6.4L")))), prodType === 'bottle' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#6a6a6a',
      fontSize: 12,
      marginBottom: 10,
      lineHeight: 1.5
    }
  }, "Pick finished units. Minis automatically convert to liters for concentrate usage; jerry cans count as 5L each."), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "liter",
    title: "Liter Bottles",
    values: bottleQuantities,
    setValues: setBottleQuantities
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "mini",
    title: "Mini Bottles",
    values: bottleQuantities,
    setValues: setBottleQuantities
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "jerry",
    title: "Jerry Cans",
    values: bottleQuantities,
    setValues: setBottleQuantities
  })), prodType === 'label' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#6a6a6a',
      fontSize: 12,
      marginBottom: 10,
      lineHeight: 1.5
    }
  }, "Pick how many labels/bottles to add for each product."), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "liter",
    title: "Liter Bottle Labels",
    values: labelQuantities,
    setValues: setLabelQuantities
  }), /*#__PURE__*/React.createElement(QtyRows, {
    FP: FP,
    cat: "mini",
    title: "Mini Bottle Labels",
    values: labelQuantities,
    setValues: setLabelQuantities
  }))), !logNow && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Date"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    type: "date",
    value: date,
    onChange: e => setDate(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: lbl
  }, "Time (optional)"), /*#__PURE__*/React.createElement("input", {
    style: TS.inp,
    type: "time",
    value: time,
    onChange: e => setTime(e.target.value)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: TS.btn('#eeeeee', '#121212'),
    onClick: onClose
  }, "Cancel"), /*#__PURE__*/React.createElement("button", {
    style: TS.btn('#1a1a1a', '#ffffff'),
    onClick: () => onSubmit(build())
  }, logNow ? '✓ Log as Done' : 'Save to Schedule'))));
}
const SCHEDULE_CACHE_KEY = 'gremier_schedule_cache_v1';
function scheduleSignature(p) {
  if (!p) return '';
  const norm = arr => JSON.stringify((arr || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id))));
  return norm(p.jobs) + '~' + norm(p.stores) + '~' + norm(p.pendingWeb);
}
function ScheduleTab() {
  const schedCacheRef = useRef2();
  if (schedCacheRef.current === undefined) schedCacheRef.current = window.gremierCacheGet(SCHEDULE_CACHE_KEY);
  const schedCache = schedCacheRef.current;
  const lastSchedSigRef = useRef2(schedCache ? scheduleSignature(schedCache) : null);
  const [jobs, setJobs] = useState2(schedCache?.jobs || []);
  const [stores, setStores] = useState2(schedCache?.stores || []);
  const [pendingWeb, setPendingWeb] = useState2(schedCache?.pendingWeb || []);
  const [loading, setLoading] = useState2(!schedCache);
  const [checkoffJob, setCheckoffJob] = useState2(null);
  const [fulfillOrderId, setFulfillOrderId] = useState2(null);
  const [calDay, setCalDay] = useState2(null);
  const [monthView, setMonthView] = useState2({
    year: new Date().getFullYear(),
    month: new Date().getMonth()
  });
  const [waOpen, setWaOpen] = useState2(false);
  const [billingOpen, setBillingOpen] = useState2(false);
  const [webQueueOpen, setWebQueueOpen] = useState2(false);
  const [showCompleted, setShowCompleted] = useState2(false);
  const [calOpen, setCalOpen] = useState2(() => {
    try {
      return localStorage.getItem('gremier_collapse_schedcal') === '0';
    } catch (_) {
      return false;
    }
  });
  const toggleCal = () => setCalOpen(o => {
    const n = !o;
    try {
      localStorage.setItem('gremier_collapse_schedcal', n ? '0' : '1');
    } catch (_) {}
    return n;
  });
  const [showAllDates, setShowAllDates] = useState2(false);
  const [showForm, setShowForm] = useState2(false);
  const [formMode, setFormMode] = useState2('lognow');
  const [formPrefill, setFormPrefill] = useState2(null);
  const [editingJobId, setEditingJobId] = useState2(null);
  const [rescheduleJob, setRescheduleJob] = useState2(null);
  const checkoffInProgress = useRef2(new Set());
  const today = todayISO2();
  const tomorrow = tomorrowISO2();
  async function reload() {
    if (!window.__opsScheduleSetupDone) {
      await window.gremierMergeDynamicOpsProducts?.(window.__OPS_PRODUCTS__, window.__OPS_PRODUCTS_FULL__, window.__OPS_PRODUCT_IMAGES__);
      await window.gremierEnsureDynamicOpsStockRows?.();
      window.__opsScheduleSetupDone = true;
    }
    const [allJobs, storeRows, webRows] = await Promise.all([loadAllJobs2(), opsFetch('stores?select=*&is_active=eq.true&order=sort_order'), loadPendingWebDeliveries2()]);
    const next = {
      jobs: allJobs || [],
      stores: storeRows || [],
      pendingWeb: webRows || []
    };
    const sig = scheduleSignature(next);
    if (sig !== lastSchedSigRef.current) {
      lastSchedSigRef.current = sig;
      setJobs(next.jobs);
      setStores(next.stores);
      setPendingWeb(next.pendingWeb);
      window.gremierCacheSet(SCHEDULE_CACHE_KEY, next);
    }
    setLoading(false);
  }
  useEffect2(() => {
    reload();
    // listen for a prefill handed off from the global website-queue pill (tapped from another tab),
    // since this component mounts once and stays mounted — a plain mount check would miss later handoffs
    function onPrefillHandoff(e) {
      setFormPrefill(e.detail);
      setFormMode('schedule');
      setShowForm(true);
    }
    // the voice logger lives in a separate React root; when it saves a job it fires this
    // event so the calendar/task lists re-fetch instead of staying stale until a page reload
    function onJobsChanged() {
      reload();
    }
    // A notification action ("Mark delivered") asks the schedule to open the
    // confirm-quantities checkoff for one job, so stock still gets confirmed.
    async function onOpenJobCheckoff(e) {
      const jobId = e.detail && e.detail.jobId;
      if (!jobId) {
        window.showTab && window.showTab('schedule');
        return;
      }
      window.showTab && window.showTab('schedule');
      try {
        const rows = await window.opsFetch(`jobs?id=eq.${encodeURIComponent(jobId)}&select=*`);
        const row = rows && rows[0];
        if (!row) return;
        if (row.done) {
          window.showToast && window.showToast('That job is already done');
          return;
        }
        setCheckoffJob(rowToJob2(row));
      } catch (err) {
        console.warn('open-job checkoff failed:', err);
      }
    }
    function onCatalogChanged() {
      window.__opsScheduleSetupDone = false;
      reload();
    }
    window.addEventListener('gremier:schedule-prefill', onPrefillHandoff);
    window.addEventListener('gremier:jobs-changed', onJobsChanged);
    window.addEventListener('gremier:open-job-checkoff', onOpenJobCheckoff);
    window.addEventListener('gremier:catalog-products-changed', onCatalogChanged);
    return () => {
      window.removeEventListener('gremier:schedule-prefill', onPrefillHandoff);
      window.removeEventListener('gremier:jobs-changed', onJobsChanged);
      window.removeEventListener('gremier:open-job-checkoff', onOpenJobCheckoff);
      window.removeEventListener('gremier:catalog-products-changed', onCatalogChanged);
    };
  }, []);

  // derived
  const overdueJobs = jobs.filter(j => !j.done && !j.brewStarted && isJobOverdue2(j)).sort((a, b) => a.date.localeCompare(b.date));
  const todayJobs = jobs.filter(j => j.date === today && !j.done && !j.brewStarted);
  const tomorrowJobs = jobs.filter(j => j.date === tomorrow && !j.done && !j.brewStarted);
  const brewingJobs = jobs.filter(j => j.brewStarted && !j.done);
  const upcomingJobs = jobs.filter(j => !j.done && !j.brewStarted && j.date > tomorrow).sort((a, b) => a.date.localeCompare(b.date));
  const waPending = jobs.filter(j => jobWaDrawerEligible2(j, stores));
  // Website orders are paid at checkout — never bill them (websiteOrderId marks them; paid can be toggled manually so it's not the filter).
  const unbilled = jobs.filter(j => j.type === 'delivery' && (j.deliveryType === 'private' || j.deliveryType === 'coffeebar') && j.done && !j.paid && !j.websiteOrderId);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = localDateStr(weekStart);
  const completedThisWeek = jobs.filter(j => j.done && j.date >= weekStartISO && j.type !== 'brew').sort((a, b) => b.date.localeCompare(a.date));

  // group upcoming by date
  const grouped = {};
  upcomingJobs.forEach(j => {
    if (!grouped[j.date]) grouped[j.date] = [];
    grouped[j.date].push(j);
  });
  async function handleCheckoff(job) {
    if (checkoffInProgress.current.has(job.id)) return;
    checkoffInProgress.current.add(job.id);
    try {
      if (job.type === 'brew') {
        if (job.brewStarted) return;
        setJobs(prev => prev.map(j => j.id === job.id ? {
          ...j,
          brewStarted: true
        } : j));
        await patchJob2(job.id, {
          brew_started: true
        });
        await applyJobSideEffects2(job, null, stores);
        await reload();
      } else if (job.type === 'drain') {
        // Drains add a full brew amount of concentrate (for example 12.7L for a 2kg brew),
        // so do not complete them from a single checkbox tap. Open the confirmation modal.
        setCheckoffJob(job);
      } else {
        setCheckoffJob(job);
      }
    } finally {
      setTimeout(() => checkoffInProgress.current.delete(job.id), 2000);
    }
  }
  async function confirmCheckoff(job, actual, confirmedQtys) {
    setCheckoffJob(null);
    const finalJob = {
      ...job,
      done: true,
      actualQty: actual,
      needsConfirmation: false,
      waSentAt: null,
      waNeedsSend: isStoreWaDelivery2({
        ...job,
        done: true
      }, stores) ? true : job.waNeedsSend,
      ...(confirmedQtys ? {
        quantities: confirmedQtys
      } : {})
    };
    setJobs(prev => prev.map(j => j.id === job.id ? finalJob : j));
    const patch = {
      done: true,
      actual_qty: actual,
      wa_sent_at: null
    };
    if (isStoreWaDelivery2(finalJob, stores)) patch.wa_needs_send = true;
    // if quantities were adjusted at checkoff, that MUST be saved to the job row too — otherwise the
    // database keeps the original planned quantities forever, and a later delete reverses that stale
    // plan instead of whatever was actually decremented here, drifting inventory out of sync
    if (confirmedQtys) patch.quantities = confirmedQtys;
    // patch the job row and run inventory/store/WA side effects in the background —
    // UI is already updated optimistically above, no need to block on a full reload
    patchJob2(job.id, patch).catch(err => console.error('checkoff patch failed:', err));
    applyJobSideEffects2(finalJob, confirmedQtys, stores).catch(err => {
      console.error('checkoff side effects failed:', err);
      showToast(`⚠ ${err.message || 'Something failed saving this delivery — check Store Deliveries and inventory.'}`, 7000);
    });
    // If this delivery is linked to a website order, offer to mark it as fulfilled.
    if (job.websiteOrderId) {
      setFulfillOrderId(job.websiteOrderId);
    }
  }
  async function handleDelete(job) {
    if (!window.confirm('Delete this job?')) return;
    // A pending drain belongs to a brew that is still "brewing". Deleting only the drain left
    // that brew stuck in Brewing Now forever (and its beans used) — offer to cancel it too.
    const brewId = job.type === 'drain' && !job.done ? job.sourceBrewId || job.source_brew_id : null;
    const brew = brewId ? jobs.find(j => j.id === brewId && j.type === 'brew' && j.brewStarted && !j.done) : null;
    const cancelBrewToo = !!brew && window.confirm(`This drain is for a ${brew.product} ${brew.kg}kg brew that hasn't been drained.

Cancel that brew too and put ${brew.kg} kg of beans back in stock?

OK = cancel the brew too · Cancel = only delete the drain`);
    setJobs(prev => prev.filter(j => j.id !== job.id && !(cancelBrewToo && j.id === brew.id)));
    await reverseJobSideEffects2(job, stores);
    await deleteJobFromDB2(job.id);
    if (cancelBrewToo) {
      await reverseJobSideEffects2(brew, stores); // returns the beans
      await deleteJobFromDB2(brew.id);
    }
    await reload();
  }
  async function cancelBrew(brew) {
    if (!window.confirm(`Cancel this ${brew.product} ${brew.kg}kg brew?

Puts ${brew.kg} kg of beans back in stock and removes its drain.`)) return;
    setJobs(prev => prev.filter(j => j.id !== brew.id && (j.sourceBrewId || j.source_brew_id) !== brew.id));
    await reverseJobSideEffects2(brew, stores); // returns beans + deletes the pending drain
    await deleteJobFromDB2(brew.id);
    await reload();
    showToast('Brew cancelled — beans returned');
  }
  async function markWaSent(jobId) {
    const sentAt = new Date().toISOString();
    setJobs(prev => prev.map(j => j.id === jobId ? {
      ...j,
      waNeedsSend: false,
      waSentAt: sentAt
    } : j));
    await patchJob2(jobId, {
      wa_needs_send: false,
      wa_sent_at: sentAt
    });
  }
  async function markBilled(jobId) {
    setJobs(prev => prev.map(j => j.id === jobId ? {
      ...j,
      billed: true
    } : j));
    await patchJob2(jobId, {
      billed: true
    });
  }
  async function markPaid(jobId) {
    setJobs(prev => prev.map(j => j.id === jobId ? {
      ...j,
      paid: true
    } : j));
    await patchJob2(jobId, {
      paid: true
    });
  }
  async function dismissWebOrder(order) {
    if (!window.confirm(`Remove "${websiteOrderDisplayLabel2(order)}" from queue?`)) return;
    await opsFetch(`pending_website_deliveries?id=eq.${order.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: JSON.stringify({
        status: 'dismissed'
      })
    });
    await reload();
  }
  async function addJobFromForm(job, mode) {
    if (!job) return;
    const incomingJobs = Array.isArray(job) ? job : [job];
    if (!incomingJobs.length) return;
    if (editingJobId) {
      const existing = jobs.find(j => j.id === editingJobId);
      const updatedJob = {
        ...existing,
        ...incomingJobs[0]
      };
      // Changing the store means the WhatsApp message is now for a different shop —
      // re-arm it (even if the old one was already marked sent) so the pill returns.
      const storeChanged = String(existing?.storeName || '') !== String(updatedJob.storeName || '');
      if (storeChanged && isStoreWaDelivery2(updatedJob, stores)) {
        updatedJob.waSentAt = null;
        updatedJob.waNeedsSend = true;
      }
      await patchJob2(editingJobId, jobToRow2(updatedJob));
      if (storeChanged && isStoreWaDelivery2(updatedJob, stores)) {
        window.showToast && window.showToast('Store changed — WhatsApp message ready to send again');
      }
      setEditingJobId(null);
      setShowForm(false);
      setFormPrefill(null);
      await reload();
      return;
    }
    const LABELED_FOR_AUTO_USE = ['classic_liter', 'sweetened_classic', 'house_blend', 'colombia_liter', 'vanilla_mini', 'original_mini', 'caramel_mini', 'classic_mini', 'house_blend_mini'];
    function bottledUnitsFromJob(j) {
      const cat = (window.__OPS_PRODUCTS__ || {})[j.product]?.category;
      if (cat === 'mini') return Math.round((j.liters || 0) * 4);
      if (cat === 'jerry') return j.qty || Math.round((j.liters || 0) / 5);
      return Math.round(j.liters || 0);
    }
    const created = incomingJobs.map((j, idx) => ({
      ...j,
      id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`,
      brewStarted: false,
      done: false,
      createdAt: new Date().toISOString()
    }));
    if (mode === 'lognow' && created.every(j => j.type === 'bottling' || j.type === 'labeling')) {
      const completed = created.map(j => {
        const doneJob = {
          ...j,
          done: true,
          actualQty: j.type === 'bottling' ? j.liters || 0 : j.qty || 0,
          needsConfirmation: false
        };
        if (window.gremierLabelsEnabled() && j.type === 'bottling' && LABELED_FOR_AUTO_USE.includes(j.product)) {
          doneJob.labeledUsed = {
            [j.product]: bottledUnitsFromJob(j)
          };
        }
        return doneJob;
      });
      await window.opsFetch('jobs', {
        method: 'POST',
        prefer: 'return=minimal',
        body: JSON.stringify(completed.map(jobToRow2))
      });
      for (const doneJob of completed) await applyJobSideEffects2(doneJob, null, stores);
      setShowForm(false);
      setFormPrefill(null);
      await reload();
      showToast(`${completed.length} production task${completed.length === 1 ? '' : 's'} logged ✓`);
      return;
    }
    try {
      await window.opsFetch('jobs', {
        method: 'POST',
        prefer: 'return=minimal',
        body: JSON.stringify(created.map(jobToRow2))
      });
    } catch (err) {
      console.error('addJobFromForm: DB insert failed', err);
      showToast(`⚠ Could not save job: ${err.message || 'Unknown error'}`);
      return;
    }
    setShowForm(false);
    setFormPrefill(null);
    await reload();
    if (mode === 'lognow' && created.length === 1) await handleCheckoff(created[0]);
  }
  function openEditJob(job) {
    if (job.type !== 'delivery') {
      setRescheduleJob(job);
      return;
    }
    setFormPrefill({
      subType: job.deliveryType || 'store',
      storeName: job.storeName || '',
      privateName: job.privateName || '',
      privateAddress: job.privateAddress || '',
      quantities: job.quantities || {},
      date: job.date,
      time: job.time,
      // coffee bar fields — these were missing entirely, so editing a coffee bar delivery
      // silently reset the client name, people count, dispensers, and syrups to defaults
      people: job.people || 25,
      cbName: job.cbName || '',
      cbAddress: job.cbAddress || '',
      dispensers: job.dispensers ?? 1,
      cbSyrups: job.cbSyrups || {},
      // extra items added via '+ More Items' on coffeebar jobs
      cbExtras: job.quantities || {}
    });
    setEditingJobId(job.id);
    setFormMode('schedule');
    setShowForm(true);
  }
  async function saveReschedule(job, newDate, newTime) {
    setJobs(prev => prev.map(j => j.id === job.id ? {
      ...j,
      date: newDate,
      time: newTime
    } : j));
    setRescheduleJob(null);
    await patchJob2(job.id, {
      date: newDate,
      time: newTime || null
    });
    await reload();
  }
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.screen,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      color: '#6a6a6a'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 20,
      height: 20,
      border: '2px solid #cccccc',
      borderTopColor: '#1a1a1a',
      borderRadius: '50%',
      animation: 'spin .7s linear infinite'
    }
  }), "Loading schedule\u2026");
  return /*#__PURE__*/React.createElement("div", {
    style: TS.screen
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '16px 12px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans',sans-serif",
      fontSize: '1.5rem',
      color: '#121212',
      marginBottom: 14
    }
  }, "Schedule"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setFormMode('lognow');
      setShowForm(true);
    },
    style: {
      flex: 1,
      background: '#1a1a1a',
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '12px',
      fontSize: 14,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "\u2713 Log Now"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setFormMode('schedule');
      setShowForm(true);
    },
    style: {
      flex: 1,
      background: '#ffffff',
      color: '#333333',
      border: '1px solid #e0e0e0',
      borderRadius: 8,
      padding: '12px',
      fontSize: 14,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "+ Schedule"))), brewingJobs.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.card,
      border: '1px solid #3f7fc4',
      background: '#eaf2fb',
      margin: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.hdr,
      color: '#3f7fc4'
    }
  }, "\uD83E\uDDEA Brewing Now"), brewingJobs.map(j => /*#__PURE__*/React.createElement("div", {
    key: j.id,
    style: {
      fontSize: 13,
      color: '#3f7fc4',
      fontWeight: 600,
      padding: '4px 0'
    }
  }, "\u2615 ", j.product, " \u2014 ", j.kg, "kg \u2014 tap drain job when ready", /*#__PURE__*/React.createElement("button", {
    onClick: () => cancelBrew(j),
    title: "Cancel this brew",
    style: {
      marginLeft: 8,
      background: 'none',
      border: '1px solid #3f7fc4',
      color: '#3f7fc4',
      borderRadius: 6,
      padding: '1px 7px',
      fontSize: 11,
      cursor: 'pointer'
    }
  }, "\u2715 cancel")))), overdueJobs.length > 0 && /*#__PURE__*/React.createElement(DaySection, {
    label: "Overdue",
    dayJobs: overdueJobs,
    overdue: true,
    onCheckoff: handleCheckoff,
    onTap: openEditJob,
    onDelete: handleDelete
  }), /*#__PURE__*/React.createElement(DaySection, {
    label: "Today",
    dayJobs: todayJobs,
    onCheckoff: handleCheckoff,
    onTap: openEditJob,
    onDelete: handleDelete
  }), /*#__PURE__*/React.createElement(DaySection, {
    label: "Tomorrow",
    dayJobs: tomorrowJobs,
    onCheckoff: handleCheckoff,
    onTap: openEditJob,
    onDelete: handleDelete
  }), (showAllDates ? Object.keys(grouped).sort() : Object.keys(grouped).sort().slice(0, 3)).map(date => /*#__PURE__*/React.createElement("div", {
    key: date,
    style: TS.card
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.hdr
  }, formatDate2(date)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: '#121212',
      background: '#eeeeee',
      borderRadius: 5,
      padding: '5px 8px',
      textAlign: 'center',
      marginBottom: 8,
      letterSpacing: 1
    }
  }, "DELIVERIES"), grouped[date].filter(j => j.type === 'delivery').length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: '#6a6a6a',
      fontStyle: 'italic'
    }
  }, "None") : grouped[date].filter(j => j.type === 'delivery').map(j => /*#__PURE__*/React.createElement(JobRowComp, {
    key: j.id,
    job: j,
    onCheckoff: handleCheckoff,
    onTap: openEditJob,
    showDelete: true,
    onDelete: handleDelete
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      background: '#eeeeee',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: '#fff',
      background: '#3a5a7a',
      borderRadius: 5,
      padding: '5px 8px',
      textAlign: 'center',
      marginBottom: 8,
      letterSpacing: 1
    }
  }, "PRODUCTION"), grouped[date].filter(j => j.type !== 'delivery').length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: '#6a6a6a',
      fontStyle: 'italic'
    }
  }, "None") : grouped[date].filter(j => j.type !== 'delivery').map(j => /*#__PURE__*/React.createElement(JobRowComp, {
    key: j.id,
    job: j,
    onCheckoff: handleCheckoff,
    onTap: openEditJob,
    showDelete: true,
    onDelete: handleDelete
  })))))), !showAllDates && Object.keys(grouped).length > 3 && /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'block',
      width: 'calc(100% - 24px)',
      margin: '0 12px 10px',
      padding: '9px 0',
      background: '#f4f4f4',
      border: '1px solid #dddddd',
      borderRadius: 6,
      color: '#333333',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer'
    },
    onClick: () => setShowAllDates(true)
  }, "Show ", Object.keys(grouped).length - 3, " more dates \u25BE"), /*#__PURE__*/React.createElement("div", {
    style: {
      ...TS.card,
      margin: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      cursor: 'pointer',
      userSelect: 'none',
      marginBottom: calOpen ? 10 : 0
    },
    onClick: toggleCal
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: '#121212'
    }
  }, "\uD83D\uDCC5 Month view"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: '#6a6a6a'
    }
  }, calOpen ? '▾' : '▸')), calOpen && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#121212',
      fontSize: 20,
      cursor: 'pointer'
    },
    onClick: () => setMonthView(mv => {
      const d = new Date(mv.year, mv.month - 1);
      return {
        year: d.getFullYear(),
        month: d.getMonth()
      };
    })
  }, "\u2039"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "'DM Sans',sans-serif",
      fontSize: '1rem',
      color: '#121212'
    }
  }, new Date(monthView.year, monthView.month).toLocaleDateString('en', {
    month: 'long',
    year: 'numeric'
  })), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#121212',
      fontSize: 20,
      cursor: 'pointer'
    },
    onClick: () => setMonthView(mv => {
      const d = new Date(mv.year, mv.month + 1);
      return {
        year: d.getFullYear(),
        month: d.getMonth()
      };
    })
  }, "\u203A")), /*#__PURE__*/React.createElement(MiniCalendar2, {
    year: monthView.year,
    month: monthView.month,
    jobs: jobs,
    today: today,
    onDayTap: setCalDay
  }))), completedThisWeek.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: TS.card
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: showCompleted ? 10 : 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: TS.hdr
  }, "\u2713 Completed This Week (", completedThisWeek.length, ")"), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#1a1a1a',
      fontSize: 13,
      cursor: 'pointer',
      fontWeight: 600
    },
    onClick: () => setShowCompleted(v => !v)
  }, showCompleted ? 'Hide' : 'Show')), showCompleted && completedThisWeek.map(j => /*#__PURE__*/React.createElement("div", {
    key: j.id,
    style: {
      ...TS.jobRow,
      opacity: 0.65
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 20,
      height: 20,
      borderRadius: 4,
      background: '#2e8b57',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff',
      fontSize: 10
    }
  }, "\u2713")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: '#333333',
      fontWeight: 500
    }
  }, jobLabel2(j)), /*#__PURE__*/React.createElement("div", {
    style: TS.meta
  }, formatDate2(j.date))), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'none',
      border: 'none',
      color: '#d5544a',
      fontSize: 16,
      cursor: 'pointer'
    },
    onClick: () => handleDelete(j)
  }, "\uD83D\uDDD1")))), waOpen && /*#__PURE__*/React.createElement(WaDrawer2, {
    jobs: waPending,
    stores: stores,
    onMarkSent: async id => {
      await markWaSent(id);
      setWaOpen(false);
    },
    onClose: () => setWaOpen(false)
  }), billingOpen && /*#__PURE__*/React.createElement(BillingDrawer2, {
    jobs: unbilled,
    onMarkBilled: async id => {
      await markBilled(id);
    },
    onMarkPaid: async id => {
      await markPaid(id);
    },
    onClose: () => setBillingOpen(false)
  }), webQueueOpen && /*#__PURE__*/React.createElement(WebsiteQueueDrawer2, {
    orders: pendingWeb,
    onClose: () => setWebQueueOpen(false),
    onSchedule: async o => {
      setWebQueueOpen(false);
      const prefill = await buildWebsiteOrderSchedulePrefill2(o);
      if (!Object.keys(prefill.quantities || {}).length && prefill.unresolvedItems?.length) {
        showToast('Could not preload products — check console for unmapped item names', 7000);
      }
      setFormPrefill(prefill);
      setFormMode('schedule');
      setShowForm(true);
    },
    onDismiss: dismissWebOrder
  }), checkoffJob && /*#__PURE__*/React.createElement(CheckoffModal2, {
    job: checkoffJob,
    onConfirm: confirmCheckoff,
    onCancel: () => setCheckoffJob(null)
  }), fulfillOrderId && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,.4)',
      zIndex: 200,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 20px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '24px 20px',
      maxWidth: 360,
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '1rem',
      fontWeight: 700,
      color: 'var(--cream)',
      marginBottom: 8
    }
  }, "Mark order as fulfilled?"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: '.82rem',
      color: 'var(--text2)',
      marginBottom: 20,
      lineHeight: 1.5
    }
  }, "This will send the customer a fulfilment confirmation email. You can skip if the email was already sent or isn't needed."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      flex: 1
    },
    className: "btn btn-outline",
    onClick: () => setFulfillOrderId(null)
  }, "Skip"), /*#__PURE__*/React.createElement("button", {
    style: {
      flex: 1
    },
    className: "btn btn-primary",
    onClick: async () => {
      const oid = fulfillOrderId;
      setFulfillOrderId(null);
      await (window.markOrderFulfilled || markOrderFulfilled)(oid, false, false);
    }
  }, "Yes, mark fulfilled")))), showForm && /*#__PURE__*/React.createElement(ScheduleForm, {
    mode: formMode,
    stores: stores,
    prefill: formPrefill,
    onClose: () => {
      setShowForm(false);
      setFormPrefill(null);
      setEditingJobId(null);
    },
    onSubmit: job => addJobFromForm(job, formMode)
  }), "      ", calDay && /*#__PURE__*/React.createElement(DayPopup2, {
    date: calDay,
    jobs: jobs,
    onClose: () => setCalDay(null),
    onCheckoff: handleCheckoff
  }), rescheduleJob && /*#__PURE__*/React.createElement(RescheduleModal2, {
    job: rescheduleJob,
    onSave: saveReschedule,
    onCancel: () => setRescheduleJob(null)
  }));
}
const schedRoot = document.getElementById('ops-schedule-root');
if (schedRoot) ReactDOM.createRoot(schedRoot).render( /*#__PURE__*/React.createElement(ScheduleTab, null));

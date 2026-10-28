const { useState, useEffect, useCallback, useRef, useMemo } = React;

// reuse the single shared, already-authenticated client (set up during sign-in) instead of
// creating a second independent auth session that never receives a login
const OPS_SB = window.MAIN_SB || window.supabase.createClient(
  'https://ayuzmwpmhncxrugsyxmw.supabase.co',
  'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn'
);
  window.opsFetch = async function opsFetch(path, options = {}) {
  const { data: { session } } = await OPS_SB.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`https://ayuzmwpmhncxrugsyxmw.supabase.co/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': 'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn',
      'Authorization': token ? `Bearer ${token}` : '',
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body?.message || body?.hint || body?.error || `Request failed (${res.status})`;
    throw new Error(`opsFetch ${path}: ${msg}`);
  }
  return body;
};

// ── constants ──────────────────────────────────────────────
const CONCENTRATE_TYPES = {
  classic:    { label: 'Classic (Dark Roast)',   ratio: 0.43 },
  unfiltered: { label: 'Unfiltered',              ratio: 0.40 },
  houseBlend: { label: 'House Blend',             ratio: 0.50 },
  colombia:   { label: 'Colombia (Light Roast)',  ratio: 0.50 },
  decaf:      { label: 'Decaf',                   ratio: 0.50 },
};
const PRODUCTS = {
  classic_liter:        { label: 'Classic',               category: 'liter',     concentrate: 'classic',    litersPerUnit: 1    },
  sweetened_classic:    { label: 'Sweetened Classic',     category: 'liter',     concentrate: 'classic',    litersPerUnit: 1    },
  house_blend:          { label: 'House Blend',           category: 'liter',     concentrate: 'houseBlend', litersPerUnit: 1    },
  colombia_liter:       { label: 'Colombia',              category: 'liter',     concentrate: 'colombia',   litersPerUnit: 1    },
  decaf_liter:          { label: 'Decaf',                 category: 'liter',     concentrate: 'decaf',      litersPerUnit: 1    },
  classic_mini:         { label: 'Classic Mini',          category: 'mini',      concentrate: 'classic',    litersPerUnit: 0.25 },
  house_blend_mini:     { label: 'House Blend Mini',      category: 'mini',      concentrate: 'houseBlend', litersPerUnit: 0.25 },
  vanilla_mini:         { label: 'Vanilla Mini',          category: 'mini',      concentrate: 'classic',    litersPerUnit: 0.25 },
  original_mini:        { label: 'Original Mini',         category: 'mini',      concentrate: 'classic',    litersPerUnit: 0.25 },
  caramel_mini:         { label: 'Caramel Mini',          category: 'mini',      concentrate: 'classic',    litersPerUnit: 0.25 },
  dairy_free_mini:      { label: 'Dairy Free Mini',       category: 'dairy_free', concentrate: null,         litersPerUnit: 0    },
  jerry_can:            { label: 'Jerry Can Classic',     category: 'jerry',     concentrate: 'classic',    litersPerUnit: 5    },
  jerry_can_houseblend: { label: 'Jerry Can House Blend', category: 'jerry',     concentrate: 'houseBlend', litersPerUnit: 5    },
  jerry_can_colombia:   { label: 'Jerry Can Colombia',    category: 'jerry',     concentrate: 'colombia',   litersPerUnit: 5    },
  jerry_can_decaf:      { label: 'Jerry Can Decaf',       category: 'jerry',     concentrate: 'decaf',      litersPerUnit: 5    }, jerry_can_unfiltered:      { label: 'Jerry Can Unfiltered',       category: 'jerry',     concentrate: 'unfiltered',      litersPerUnit: 5    },
  vanilla_syrup:        { label: 'Vanilla Syrup',         category: 'syrup',     concentrate: null,         litersPerUnit: 0    },
  caramel_syrup:        { label: 'Caramel Syrup',         category: 'syrup',     concentrate: null,         litersPerUnit: 0    },
  sugar_syrup:          { label: 'Sugar Syrup',           category: 'syrup',     concentrate: null,         litersPerUnit: 0    },
  dispenser:            { label: 'Dispenser',             category: 'dispenser', concentrate: null,         litersPerUnit: 0    },
};
Object.assign(PRODUCTS, window.__OPS_DYNAMIC_PRODUCTS_FULL__ || {});
const BEAN_TYPES = {
  classic:    { label: 'Classic (Dark Roast)',   warnKg: 9 },
  houseBlend: { label: 'House Blend',             warnKg: 3 },
  colombia:   { label: 'Colombia (Light Roast)',  warnKg: 3 },
  decaf:      { label: 'Decaf',                   warnKg: 1 },
};
const LABELED_PRODUCTS = ['classic_liter','sweetened_classic','house_blend','colombia_liter','vanilla_mini','original_mini','caramel_mini','classic_mini','house_blend_mini'];
const LABELED_WARN = { classic_liter:30, sweetened_classic:25, house_blend:20, colombia_liter:20, vanilla_mini:80, original_mini:80, caramel_mini:100, classic_mini:null, house_blend_mini:null };
const MINI_PRODUCTS = ['vanilla_mini','original_mini','caramel_mini'];
function getProductRatio(pid, concType) {
  const base = MINI_PRODUCTS.includes(pid) ? 0.29 : (CONCENTRATE_TYPES[concType]?.ratio || 0.43);
  return window.gremierConcentrateRatio?.(pid, base) ?? base;
}

// ── Supabase helpers ───────────────────────────────────────
async function loadStockData() {
  const [inventory, concentrate, beans, labeledStock] = await Promise.all([
    opsFetch('inventory?select=*'),
    opsFetch('concentrate?select=*'),
    opsFetch('beans?select=*'),
    opsFetch('labeled_stock?select=*'),
  ]);
  const inventoryMap = {}; (inventory||[]).forEach(r => { inventoryMap[r.product] = r.qty; });
  const concentrateMap = {}; (concentrate||[]).forEach(r => { concentrateMap[r.type] = r.liters; });
  const beansMap = {}; (beans||[]).forEach(r => { beansMap[r.type] = { kg: r.kg, ordered: r.ordered||false, orderedKg: r.ordered_kg||0 }; });
  const labeledMap = {}; (labeledStock||[]).forEach(r => { labeledMap[r.product] = r.qty; });
  return { inventory: inventoryMap, concentrate: concentrateMap, beans: beansMap, labeledStock: labeledMap };
}
async function loadUpcomingJobs() {
  const today = localDateStr(new Date());
  const rows = await opsFetch(`jobs?select=*&done=eq.false&date=gte.${today}&order=date.asc`);
  return rows || [];
}
async function patchInventory(product, qty) {
  const enc = encodeURIComponent(product);
  const existing = await opsFetch(`inventory?product=eq.${enc}&select=product`);
  if (existing?.length) {
    await opsFetch(`inventory?product=eq.${enc}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ qty }) });
  } else {
    await opsFetch('inventory', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ product, qty }) });
  }
  window.notifyGremierStockChanged?.();
}
async function patchConcentrate(type, liters) {
  await opsFetch(`concentrate?type=eq.${type}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ liters }) });
  window.notifyGremierStockChanged?.();
}
async function patchBeans(type, kg) {
  await opsFetch(`beans?type=eq.${type}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ kg }) });
  window.notifyGremierStockChanged?.();
}
async function patchBeanOrdered(type, ordered, orderedKg) {
  await opsFetch(`beans?type=eq.${type}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ ordered, ordered_kg: orderedKg }) });
  window.notifyGremierStockChanged?.();
}
async function patchLabeledStock(product, qty) {
  const enc = encodeURIComponent(product);
  const existing = await opsFetch(`labeled_stock?product=eq.${enc}&select=product`);
  if (existing?.length) {
    await opsFetch(`labeled_stock?product=eq.${enc}`, { method: 'PATCH', prefer: 'return=minimal', body: JSON.stringify({ qty }) });
  } else {
    await opsFetch('labeled_stock', { method: 'POST', prefer: 'return=minimal', body: JSON.stringify({ product, qty }) });
  }
  window.notifyGremierStockChanged?.();
}

// ── Need-to-make calculation ───────────────────────────────
function concentrateNeeded(jobs, inventory, concentrate) {
  const n = { classic:0, unfiltered:0, houseBlend:0, colombia:0, decaf:0 };
  const remStock = { ...inventory };
  const remConc  = { ...concentrate };
  const JERRY_MAP = { classic:'jerry_can',unfiltered:'jerry_can_unfiltered', houseBlend:'jerry_can_houseblend', colombia:'jerry_can_colombia', decaf:'jerry_can_decaf' };
  const kgToL = { 3:19, 2:12.7, 1.5:9.5, 1:6.4 };
  [...jobs].filter(j=>!j.done).sort((a,b)=>a.date.localeCompare(b.date)).forEach(j => {
    if (j.type === 'bottling' && PRODUCTS[j.product]?.concentrate) {
      const ct = PRODUCTS[j.product].concentrate;
      const ratio = getProductRatio(j.product, ct);
      const need = (j.liters||0)*ratio;
      n[ct] += Math.max(0, need - (remConc[ct]||0));
      remConc[ct] = Math.max(0, (remConc[ct]||0) - need);
    }
    if (j.type === 'delivery') {
      Object.entries(j.quantities||{}).forEach(([pid,qty]) => {
        if (!PRODUCTS[pid]?.concentrate || !qty) return;
        const ct = PRODUCTS[pid].concentrate;
        const ratio = getProductRatio(pid, ct);
        const inStock = remStock[pid]||0;
        const gap = Math.max(0, qty - inStock);
        remStock[pid] = Math.max(0, inStock - qty);
        n[ct] += PRODUCTS[pid].litersPerUnit * gap * ratio;
      });
      if (j.delivery_type === 'coffeebar') {
        const canCount = Math.floor((j.people||0)/25);
        const cans = j.jerry_cans || Array(canCount).fill('classic');
        cans.forEach(ct => {
          if (!CONCENTRATE_TYPES[ct]) return;
          const pid = JERRY_MAP[ct]||'jerry_can';
          const inStock = remStock[pid]||0;
          if (inStock > 0) { remStock[pid] = Math.max(0, inStock-1); return; }
          const ratio = CONCENTRATE_TYPES[ct].ratio;
          const need = 5*ratio;
          n[ct] += Math.max(0, need - (remConc[ct]||0));
          remConc[ct] = Math.max(0, (remConc[ct]||0) - need);
        });
      }
    }
  });
  return n;
}
function bottleNeeds(jobs, inventory) {
  const needs = {};
  const rem = { ...inventory };
  [...jobs].filter(j=>!j.done&&j.type==='delivery').forEach(j => {
    Object.entries(j.quantities||{}).forEach(([pid,qty]) => {
      if (!qty) return;
      needs[pid] = (needs[pid]||0) + qty;
    });
    if (j.delivery_type === 'coffeebar') {
      const canCount = Math.floor((j.people||0)/25);
      const cans = j.jerry_cans||Array(canCount).fill('classic');
      const JERRY_MAP = { classic:'jerry_can',unfiltered:'jerry_can_unfiltered', houseBlend:'jerry_can_houseblend', colombia:'jerry_can_colombia', decaf:'jerry_can_decaf' };
      cans.forEach(ct => { const pid = JERRY_MAP[ct]||'jerry_can'; needs[pid]=(needs[pid]||0)+1; });
    }
  });
  return Object.entries(needs).map(([pid,totalNeeded]) => ({
    pid, totalNeeded, inStock: rem[pid]||0, gap: totalNeeded-(rem[pid]||0),
  })).filter(x=>x.totalNeeded>0);
}

// ── Shared UI components ───────────────────────────────────
const SS = {
  screen: { background:'var(--bg, #f3f4f6)', minHeight:'100%', fontFamily:"'DM Sans',sans-serif", color:'#121212', paddingBottom:80 },
  card: { background:'#ffffff', border:'1px solid #d9dde3', borderRadius:14, boxShadow:'var(--surface-shadow)', padding:'16px 18px', margin:'12px 0' },
  hdr: { fontSize:11, fontWeight:700, letterSpacing:2, textTransform:'uppercase', color:'#121212', background:'#eeeeee', borderRadius:6, padding:'8px 12px', marginBottom:14 },
  row: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 0', borderBottom:'1px solid #e0e0e0' },
  lbl: { fontSize:13, color:'#333333' },
  val: { fontSize:15, fontWeight:600, color:'#121212' },
  btn: { width:28, height:28, borderRadius:5, background:'#eeeeee', border:'1px solid #cccccc', color:'#121212', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  inp: { width:64, background:'#fafafa', border:'1px solid #cccccc', borderRadius:5, padding:'4px 6px', color:'#121212', fontSize:14, textAlign:'center' },
  toggleRow: { display:'flex', gap:4, background:'#ffffff', border:'1px solid #e0e0e0', borderRadius:12, padding:3, marginBottom:18, flexWrap:'wrap' },
  toggleBtn: (active) => ({ flex:'1 1 auto', padding:'8px 5px', background:active?'#1a1a1a':'transparent', color:active?'#ffffff':'#6a6a6a', border:'none', borderRadius:9, fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:active?700:500, cursor:'pointer', transition:'all .2s', whiteSpace:'nowrap' }),
  needBadge: (ok) => ({ fontSize:12, fontWeight:700, color:ok?'#2e8b57':'#d5544a', whiteSpace:'nowrap' }),
};

function NumRow({ label, value, onCommit, step=1, allowFraction=false, unit='items', suffix, warn, pid }) {
  const [draft,setDraft]=useState(String(value??'')),[status,setStatus]=useState('');
  const editing=useRef(false),current=useRef(value??0),queue=useRef(Promise.resolve()),revision=useRef(0),cancel=useRef(false),pending=useRef(0),latest=useRef(String(value??''));
  useEffect(()=>{if(!editing.current&&!pending.current){current.current=value??0;latest.current=String(value??'');setDraft(latest.current);}},[value]);
  function commit(raw){
    const v=window.GremierStockNumbers.parse(raw,allowFraction?0.001:step);
    editing.current=false;
    if(v===null){setDraft(String(value??0));setStatus('Enter a valid '+(step===1?'whole number':'amount'));return;}
    latest.current=String(v);setDraft(latest.current);if(v===Number(current.current))return;
    current.current=v;const rev=++revision.current;pending.current++;setStatus('Saving…');
    queue.current=queue.current.catch(()=>{}).then(()=>onCommit(v)).then(()=>{if(rev===revision.current)setStatus('Saved');}).catch(()=>{if(rev===revision.current){setStatus('Not saved — try again');current.current=NaN;}}).finally(()=>{pending.current--;});
  }
  function bump(direction){const base=window.GremierStockNumbers.parse(latest.current,allowFraction?0.001:step);commit(window.GremierStockNumbers.bump(base??(Number(value)||0),step,direction));}
  return <div style={{...SS.row,gap:10}}>
    {pid&&<img src={window.getProductImage(pid)} alt="" style={{width:26,height:26,borderRadius:6,objectFit:'cover',flexShrink:0}}/>}
    <span style={{...SS.lbl,flex:1,color:warn?'#d5544a':'#333'}}>{label}{suffix&&<small style={{display:'block'}}>{suffix}</small>}</span>
    <div><div style={{display:'flex',alignItems:'center',gap:6}}>
      <button style={SS.btn} aria-label={'Decrease '+label+' by '+step+' '+unit} onMouseDown={e=>e.preventDefault()} onClick={()=>bump(-1)}>−</button>
      <input style={SS.inp} type="text" inputMode={step===1&&!allowFraction?'numeric':'decimal'} aria-label={label+' ('+unit+')'} value={draft}
        onFocus={e=>{editing.current=true;e.target.select();}}
        onChange={e=>{latest.current=e.target.value.replace(/^0+(?=\d)/,'');setDraft(latest.current);setStatus('');}}
        onBlur={()=>{if(cancel.current){cancel.current=false;return;}commit(draft);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){cancel.current=true;latest.current=String(value??'');setDraft(latest.current);editing.current=false;e.currentTarget.blur();}}}/>
      <button style={SS.btn} aria-label={'Increase '+label+' by '+step+' '+unit} onMouseDown={e=>e.preventDefault()} onClick={()=>bump(1)}>+</button>
    </div><small aria-live="polite" style={{display:'block',textAlign:'center',fontSize:10,color:status.startsWith('Not')?'#b33':'#777'}}>{status||('±'+step+' '+unit)}</small></div>
  </div>;
}

// ── CONCENTRATE sub-screen ─────────────────────────────────
function ConcentrateScreen({ concentrate, setConcentrate, jobs, inventory }) {
  const needed = concentrateNeeded(jobs, inventory, concentrate);
  const inProgress = {};
  jobs.filter(j=>j.brew_started&&!j.done).forEach(j => {
    const kgToL = {3:19,2:12.7,1.5:9.5,1:6.4};
    const liters = kgToL[j.kg]||19;
    inProgress[j.product] = (inProgress[j.product]||0)+liters;
  });
  async function save(k, val) {
    const v = Math.max(0, parseFloat(val)||0);
    await patchConcentrate(k, v);
    setConcentrate(p=>({...p,[k]:v}));
  }
  return (
    <div>
      <div style={SS.card}>
        <div style={SS.hdr}>Concentrate (Liters)</div>
        {Object.entries(CONCENTRATE_TYPES).map(([k,ct]) => (
          <NumRow key={k}
            pid={k}
            label={ct.label}
            value={concentrate[k]??''}
            step={0.5} unit="L" onCommit={v=>save(k,v)}
          />
        ))}
      </div>
      <details style={SS.card}>
        <summary style={{...SS.hdr,cursor:'pointer'}}>Production needs</summary>
        {Object.entries(CONCENTRATE_TYPES).map(([k,ct]) => {
          const n = needed[k]||0;
          const brewing = inProgress[k]||0;
          const have = concentrate[k]||0;
          const eff = Math.max(0, n - brewing - have);
          if (n===0 && brewing===0) return null;
          return (
            <div key={k} style={SS.row}>
              <img src={window.getProductImage(k)} alt="" style={{width:24,height:24,borderRadius:5,objectFit:'cover',flexShrink:0,background:'#fafafa',border:'1px solid #e0e0e0',marginRight:8}}/>
              <span style={SS.lbl}>{ct.label}</span>
              {brewing>0&&<span style={{fontSize:11,color:'#3f7fc4'}}>🧪 {brewing.toFixed(1)}L brewing</span>}
              <span style={SS.needBadge(eff===0)}>{eff===0?'✓ Covered':`Brew ${eff.toFixed(1)}L more`}</span>
            </div>
          );
        }).filter(Boolean)}
        {Object.values(needed).every(v=>v===0)&&<div style={{color:'#6a6a6a',fontSize:13}}>All needs covered</div>}
      </details>
    </div>
  );
}

// ── BOTTLED COFFEE sub-screen ──────────────────────────────
function BottledScreen({ inventory, setInventory, concentrate, setConcentrate, filterCats }) {
  async function save(pid,qty){await patchInventory(pid,qty);setInventory(p=>({...p,[pid]:qty}));}

  const allGroups = [
    { label:'Liter Bottles', cats:['liter'] },
    { label:'Mini Bottles',  cats:['mini']  },
    { label:'Jerry Cans',    cats:['jerry'] },
    { label:'Syrups & Dispensers', cats:['syrup','dispenser'] },
  ];
  // When filterCats is provided (split tabs), only show that category group.
  // When omitted (e.g. old callers), show everything.
  const groups = filterCats
    ? allGroups.filter(g => g.cats.some(c => filterCats.includes(c)))
    : allGroups;
  return (
    <div>
      {groups.map(({label,cats}) => {
        const cats_active = filterCats ? cats.filter(c => filterCats.includes(c)) : cats;
        const items = Object.entries(PRODUCTS).filter(([,p])=>cats_active.includes(p.category));
        if (!items.length) return null;
        return (
          <div key={label} style={SS.card}>
            <div style={SS.hdr}>{label}</div>
            {items.map(([pid,p]) => (
              <NumRow key={pid}
                pid={pid}
                label={p.label}
                value={inventory[pid]??0}
                unit={p.category==='jerry'?'cans':p.category==='dispenser'?'dispensers':'bottles'} onCommit={v=>save(pid,v)}
              />
            ))}
          </div>
        );
      })}

    </div>
  );
}

// ── LABELS sub-screen ──────────────────────────────────────
function LabelsScreen({ labeledStock, setLabeledStock }) {
  async function save(pid, val) {
    const v = Math.max(0, parseInt(val)||0);
    await patchLabeledStock(pid, v);
    setLabeledStock(p=>({...p,[pid]:v}));
  }
  const groups = [
    { label:'Liter Bottles', pids:Object.keys(PRODUCTS).filter(pid => PRODUCTS[pid]?.category === 'liter') },
    { label:'Mini Bottles',  pids:Object.keys(PRODUCTS).filter(pid => PRODUCTS[pid]?.category === 'mini') },
  ];
  return (
    <div>
      {groups.map(({label,pids}) => (
        <div key={label} style={SS.card}>
          <div style={SS.hdr}>{label}</div>
          {pids.map(pid => {
            const warn = LABELED_WARN[pid];
            const qty = labeledStock[pid]||0;
            const isLow = warn!==null && qty<warn;
            return (
              <NumRow key={pid}
                pid={pid}
                label={PRODUCTS[pid]?.label}
                value={qty}
                warn={isLow}
                suffix={isLow?'● Low':null}
                unit="labels" onCommit={v=>save(pid,v)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── MAKE sub-screen ────────────────────────────────────────
function MakeScreen({ jobs, inventory, concentrate }) {
  const today = localDateStr(new Date());
  const tomorrow = localDateStr(new Date(Date.now()+86400000));
  const upcoming = jobs.filter(j=>!j.done);
  const urgent = jobs.filter(j=>!j.done&&(j.date===today||j.date===tomorrow));
  const concNeeds = concentrateNeeded(upcoming, inventory, concentrate);
  const urgentConcNeeds = concentrateNeeded(urgent, inventory, concentrate);
  const allBottles = bottleNeeds(upcoming, inventory);
  const urgentBottles = bottleNeeds(urgent, inventory);
  const bottleShortfalls = allBottles.filter(g=>g.gap>0&&PRODUCTS[g.pid]?.category!=='jerry');
  const jerryShortfalls  = allBottles.filter(g=>g.gap>0&&PRODUCTS[g.pid]?.category==='jerry');
  const bottleCovered    = allBottles.filter(g=>g.gap<=0);
  const concShortfalls   = Object.entries(CONCENTRATE_TYPES).map(([k,ct]) => {
    const gap = concNeeds[k]||0; const have = concentrate[k]||0;
    return { k, label:ct.label, needed:gap+have, have, gap, effectiveGap:Math.max(0,gap-have) };
  }).filter(x=>x.effectiveGap>0);
  const urgBottles = urgentBottles.filter(g=>g.gap>0);
  const urgConc    = Object.entries(urgentConcNeeds).filter(([,v])=>v>0).map(([k,gap])=>({
    k, label:CONCENTRATE_TYPES[k]?.label, gap, have:concentrate[k]||0,
    effectiveGap:Math.max(0,gap-(concentrate[k]||0)),
  })).filter(x=>x.effectiveGap>0);
  const RHDR = { ...SS.hdr, background:'#d5544a', color:'#fff' };
  const GHDR = { ...SS.hdr, background:'#2e8b57', color:'#fff' };
  return (
    <div>
      {(urgBottles.length>0||urgConc.length>0)&&(
        <div style={{...SS.card,border:'1px solid #d5544a',background:'#fdecea'}}>
          <div style={RHDR}>🔥 Needed Today or Tomorrow</div>
          {urgBottles.map(({pid,totalNeeded,inStock,gap})=>(
            <div key={pid} style={SS.row}>
              <img src={window.getProductImage(pid)} alt="" style={{width:24,height:24,borderRadius:5,objectFit:'cover',flexShrink:0,background:'#fafafa',border:'1px solid #e0e0e0',marginRight:8}}/>
              <span style={SS.lbl}>{PRODUCTS[pid]?.label}</span>
              <span style={{fontSize:11,color:'#6a6a6a'}}>Need {totalNeeded} · Have {inStock}</span>
              <span style={SS.needBadge(false)}>Make {gap} more</span>
            </div>
          ))}
          {urgConc.map(({k,label,gap,have,effectiveGap})=>(
            <div key={k} style={SS.row}>
              <img src={window.getProductImage(k)} alt="" style={{width:24,height:24,borderRadius:5,objectFit:'cover',flexShrink:0,background:'#fafafa',border:'1px solid #e0e0e0',marginRight:8}}/>
              <span style={SS.lbl}>{label}</span>
              <span style={{fontSize:11,color:'#6a6a6a'}}>Need {(gap+have).toFixed(1)}L · Have {have.toFixed(1)}L</span>
              <span style={SS.needBadge(false)}>Brew {effectiveGap.toFixed(1)}L</span>
            </div>
          ))}
        </div>
      )}
      {bottleShortfalls.length>0&&(
        <div style={SS.card}>
          <div style={RHDR}>⚠ Bottles to Produce</div>
          {bottleShortfalls.map(({pid,totalNeeded,inStock,gap})=>(
            <div key={pid} style={SS.row}>
              <img src={window.getProductImage(pid)} alt="" style={{width:24,height:24,borderRadius:5,objectFit:'cover',flexShrink:0,background:'#fafafa',border:'1px solid #e0e0e0',marginRight:8}}/>
              <span style={SS.lbl}>{PRODUCTS[pid]?.label}</span>
              <span style={{fontSize:11,color:'#6a6a6a'}}>Need {totalNeeded} · Have {inStock}</span>
              <span style={SS.needBadge(false)}>Make {gap}</span>
            </div>
          ))}
        </div>
      )}
      {jerryShortfalls.length>0&&(
        <div style={SS.card}>
          <div style={RHDR}>⚠ Jerry Cans to Make</div>
          {jerryShortfalls.map(({pid,totalNeeded,inStock,gap})=>(
            <div key={pid} style={SS.row}>
              <img src={window.getProductImage(pid)} alt="" style={{width:24,height:24,borderRadius:5,objectFit:'cover',flexShrink:0,background:'#fafafa',border:'1px solid #e0e0e0',marginRight:8}}/>
              <span style={SS.lbl}>{PRODUCTS[pid]?.label}</span>
              <span style={{fontSize:11,color:'#6a6a6a'}}>Need {totalNeeded} · Have {inStock}</span>
              <span style={SS.needBadge(false)}>Make {gap}</span>
            </div>
          ))}
        </div>
      )}
      {concShortfalls.length>0&&(
        <div style={SS.card}>
          <div style={RHDR}>⚠ Concentrate to Brew</div>
          {concShortfalls.map(({k,label,needed,have,effectiveGap})=>(
            <div key={k} style={SS.row}>
              <img src={window.getProductImage(k)} alt="" style={{width:24,height:24,borderRadius:5,objectFit:'cover',flexShrink:0,background:'#fafafa',border:'1px solid #e0e0e0',marginRight:8}}/>
              <span style={SS.lbl}>{label}</span>
              <span style={{fontSize:11,color:'#6a6a6a'}}>Need {needed.toFixed(1)}L · Have {have.toFixed(1)}L</span>
              <span style={SS.needBadge(false)}>Brew {effectiveGap.toFixed(1)}L</span>
            </div>
          ))}
        </div>
      )}
      {bottleCovered.length>0&&(
        <div style={SS.card}>
          <div style={GHDR}>✓ Covered by Stock</div>
          {bottleCovered.map(({pid,totalNeeded,inStock})=>(
            <div key={pid} style={SS.row}>
              <img src={window.getProductImage(pid)} alt="" style={{width:24,height:24,borderRadius:5,objectFit:'cover',flexShrink:0,background:'#fafafa',border:'1px solid #e0e0e0',marginRight:8}}/>
              <span style={SS.lbl}>{PRODUCTS[pid]?.label}</span>
              <span style={SS.needBadge(true)}>✓ {inStock} in stock (need {totalNeeded})</span>
            </div>
          ))}
        </div>
      )}
      {bottleShortfalls.length===0&&jerryShortfalls.length===0&&concShortfalls.length===0&&urgBottles.length===0&&urgConc.length===0&&(
        <div style={{...SS.card,textAlign:'center',color:'#6a6a6a',fontSize:14}}>All production needs covered ✓</div>
      )}
    </div>
  );
}

// ── BEANS sub-section (inside Concentrate) ─────────────────
function BeansSection({ beans, setBeans }) {
  async function saveKg(type, kg) {
    const v = Math.max(0, parseFloat(kg)||0);
    await patchBeans(type, v);
    setBeans(p=>({...p,[type]:{...(p[type]||{}),kg:v}}));
  }
  async function markOrdered(type, orderedKg) {
    const v = parseFloat(orderedKg)||0;
    if (v<=0) return;
    setBeans(p=>({...p,[type]:{...(p[type]||{}),ordered:true,orderedKg:v}}));
    await patchBeanOrdered(type, true, v);
  }
  async function markDelivered(type) {
    const current = beans[type]||{};
    const newKg = parseFloat(((current.kg||0)+(current.orderedKg||0)).toFixed(3));
    setBeans(p=>({...p,[type]:{kg:newKg,ordered:false,orderedKg:0}}));
    await opsFetch(`beans?type=eq.${type}`,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({kg:newKg,ordered:false,ordered_kg:0})});
    window.notifyGremierStockChanged?.();
  }
  async function cancelOrder(type) {
    setBeans(p=>({...p,[type]:{...(p[type]||{}),ordered:false,orderedKg:0}}));
    await patchBeanOrdered(type, false, 0);
  }
  return (
    <div style={SS.card}>
      <div style={SS.hdr}>Coffee Beans (kg)</div>
      {Object.entries(BEAN_TYPES).map(([k,bt]) => {
        const d = beans[k]||{};
        const isLow = d.kg<=bt.warnKg && !d.ordered;
        const [orderKg, setOrderKg] = [useRef(''), null];
        return (
          <div key={k} style={{borderBottom:'1px solid #e0e0e0',paddingBottom:10,marginBottom:10}}>
            <NumRow
              label={bt.label}
              value={d.kg??''}
              warn={isLow}
              allowFraction unit="kg" onCommit={v=>saveKg(k,v)}
            />
            {isLow&&!d.ordered&&(
              <BeanOrderRow beanKey={k} onOrder={markOrdered}/>
            )}
            {d.ordered&&(
              <div style={{background:'#e9f6ee',border:'1px solid #2e8b57',borderRadius:6,padding:'10px 12px',marginTop:6,display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:'#2e8b57'}}>✓ Ordered — {d.orderedKg}kg incoming</div>
                  <div style={{fontSize:11,color:'#6a6a6a',marginTop:3}}>Tap Delivered when stock arrives</div>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button style={{background:'#1a1a1a',color:'#fff',border:'none',borderRadius:6,padding:'7px 10px',fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={()=>markDelivered(k)}>📦 Delivered</button>
                  <button style={{background:'#eeeeee',color:'#6a6a6a',border:'none',borderRadius:6,padding:'7px 10px',fontSize:12,cursor:'pointer'}} onClick={()=>cancelOrder(k)}>✕</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
function BeanOrderRow({ beanKey, onOrder }) {
  const [kg, setKg] = useState('');
  return (
    <div style={{display:'flex',gap:8,marginTop:6}}>
      <input type="number" placeholder="kg ordered" style={{...SS.inp,flex:1,width:'auto'}} value={kg} onChange={e=>setKg(e.target.value)}/>
      <button style={{background:'#1a1a1a',color:'#ffffff',border:'none',borderRadius:6,padding:'7px 12px',fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={async()=>{const v=parseFloat(kg)||0;if(v<=0)return;await onOrder(beanKey,v);setKg('');}}>✓ Ordered</button>
    </div>
  );
}

// ── ROOT STOCK TAB ─────────────────────────────────────────
const STOCK_CACHE_KEY = 'gremier_stock_cache_v1';
function readStockCache() {
  try { const raw = localStorage.getItem(STOCK_CACHE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function writeStockCache(payload) {
  try { localStorage.setItem(STOCK_CACHE_KEY, JSON.stringify(payload)); } catch {}
}
// Order-independent signature so re-fetches that return the same data in a
// different row order don't count as a "change" and don't trigger a repaint.
function stockSignature(p) {
  if (!p) return '';
  const sortKeys = (o) => (o && typeof o === 'object' && !Array.isArray(o))
    ? Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {})
    : o;
  const beans = {};
  Object.keys(p.beans || {}).sort().forEach(k => {
    const b = p.beans[k] || {};
    beans[k] = { kg: b.kg || 0, ordered: !!b.ordered, orderedKg: b.orderedKg || 0 };
  });
  const jobs = (p.jobs || []).map(j => [j.id, j.done, j.date, j.type].join('|')).sort();
  return JSON.stringify({
    inventory: sortKeys(p.inventory),
    concentrate: sortKeys(p.concentrate),
    beans,
    labeledStock: sortKeys(p.labeledStock),
    jobs,
  });
}

function BeansCollapse({ beans, setBeans }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('gremier_collapse_stockbeans') === '0'; } catch (_) { return false; } });
  const toggle = () => setOpen(o => { const n = !o; try { localStorage.setItem('gremier_collapse_stockbeans', n ? '0' : '1'); } catch (_) {} return n; });
  return (
    <div>
      <div onClick={toggle} style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none',padding:'12px 4px'}}>
        <span style={{fontSize:14,fontWeight:700,color:'#121212'}}>🫘 Beans</span>
        <span style={{fontSize:12,color:'#6a6a6a'}}>{open ? '▾' : '▸'}</span>
      </div>
      {open && <BeansSection beans={beans} setBeans={setBeans}/>}
    </div>
  );
}

function StockTab() {
  const cachedInit = useMemo(() => readStockCache(), []);
  const lastSigRef = useRef(cachedInit ? stockSignature(cachedInit) : null);
  const [tab, setTab] = useState('concentrate');
  const [loading, setLoading] = useState(!cachedInit);
  const [inventory, setInventory] = useState(() => cachedInit?.inventory || {});
  const [concentrate, setConcentrate] = useState(() => cachedInit?.concentrate || {classic:0,unfiltered:0,houseBlend:0,colombia:0,decaf:0});
  const [beans, setBeans] = useState(() => cachedInit?.beans || {classic:{kg:0,ordered:false,orderedKg:0},houseBlend:{kg:0,ordered:false,orderedKg:0},colombia:{kg:0,ordered:false,orderedKg:0},decaf:{kg:0,ordered:false,orderedKg:0}});
  const [labeledStock, setLabeledStock] = useState(() => cachedInit?.labeledStock || {});
  const [jobs, setJobs] = useState(() => cachedInit?.jobs || []);
  // Labels kill switch: mirror the localStorage flag in state so toggling re-renders this root.
  const [labelsOn, setLabelsOnState] = useState(() => window.gremierLabelsEnabled());
  const setLabelsOn = (on) => { window.gremierSetLabelsEnabled(on); setLabelsOnState(on); };

  const reloadStock = useCallback(async ({ silent = false, setup = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      // Catalog merge + inventory-row creation only need to happen once per
      // session (or when the catalog changes) — not on every focus/visibility reload.
      if (setup || !window.__opsStockSetupDone) {
        await window.gremierMergeDynamicOpsProducts?.(PRODUCTS, window.__OPS_PRODUCTS_FULL__, window.__OPS_PRODUCT_IMAGES__, LABELED_PRODUCTS, LABELED_WARN);
        await window.gremierEnsureDynamicOpsStockRows?.();
        window.__opsStockSetupDone = true;
      }
      const [stock, j] = await Promise.all([loadStockData(), loadUpcomingJobs()]);
      const next = {
        inventory: stock.inventory,
        concentrate: stock.concentrate,
        beans: stock.beans,
        labeledStock: stock.labeledStock,
        jobs: j,
      };
      // Only repaint + rewrite cache if the data actually changed.
      const sig = stockSignature(next);
      if (sig !== lastSigRef.current) {
        lastSigRef.current = sig;
        setInventory(next.inventory);
        setConcentrate(next.concentrate);
        setBeans(next.beans);
        setLabeledStock(next.labeledStock);
        setJobs(next.jobs);
        writeStockCache(next);
      }
    } catch (err) {
      console.error('Stock reload failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // If we have cached data, show it instantly and revalidate silently in the
    // background; only fall back to a blocking spinner when there's no cache.
    reloadStock({ silent: !!cachedInit });
  }, [reloadStock, cachedInit]);

  useEffect(() => {
    let inFlight = false;
    let queued = false;

    const runReload = async (opts = { silent: true }) => {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        await reloadStock(opts);
      } finally {
        inFlight = false;
        if (queued) {
          queued = false;
          runReload({ silent: true });
        }
      }
    };

    const onStockChanged = () => runReload({ silent: true });
    const onCatalogChanged = () => { window.__opsStockSetupDone = false; runReload({ silent: true, setup: true }); };
    const onFocusOrVisible = () => {
      const stockTab = document.getElementById('tab-stock');
      if (!document.hidden && stockTab && stockTab.style.display !== 'none') runReload({ silent: true });
    };

    window.__gremierReloadStock = runReload;
    window.addEventListener('gremier:stock-changed', onStockChanged);
    window.addEventListener('gremier:catalog-products-changed', onCatalogChanged);
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      window.removeEventListener('gremier:stock-changed', onStockChanged);
      window.removeEventListener('gremier:catalog-products-changed', onCatalogChanged);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
      if (window.__gremierReloadStock === runReload) delete window.__gremierReloadStock;
    };
  }, [reloadStock]);

  const TABS = [
    { id:'concentrate', label:'Concentrate' },
    { id:'liters',      label:'Liters' },
    { id:'minis',       label:'Minis' },
    { id:'jerries',     label:'Jerries' },
    { id:'syrups',      label:'Syrups' },
    { id:'labels',      label:'Labels' },
  ];

  if (loading) return <div style={{...SS.screen,display:'flex',alignItems:'center',justifyContent:'center',gap:10,color:'#6a6a6a'}}><div style={{width:20,height:20,border:'2px solid #cccccc',borderTopColor:'#1a1a1a',borderRadius:'50%',animation:'spin .7s linear infinite'}}/>Loading stock…</div>;

  return (
    <div style={SS.screen}>
      <div style={{padding:'16px 16px 0'}}>
        <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:'1.5rem',color:'#121212',marginBottom:14}}>Stock</div>
        <div style={SS.toggleRow}>
          {TABS.filter(t=>['concentrate','liters','minis'].includes(t.id)).map(t=>(
            <button key={t.id} style={SS.toggleBtn(tab===t.id)} onClick={()=>setTab(t.id)}>{t.label}</button>
          ))}
          <button className="app-more-button" aria-label="More stock sections and settings" aria-expanded="false" onClick={e=>window.adminShowActions(e,[
            ...TABS.filter(t=>!['concentrate','liters','minis'].includes(t.id)).map(t=>({label:(tab===t.id?'✓ ':'')+t.label,run:()=>setTab(t.id)})),
            {label:labelsOn?'Turn off label tracking':'Enable label tracking',run:()=>setLabelsOn(!labelsOn)}
          ])}>⋯</button>
        </div>
        {!['concentrate','liters','minis'].includes(tab)&&<div style={{fontSize:14,fontWeight:600,color:'#303946',padding:'0 0 12px'}}>{TABS.find(t=>t.id===tab)?.label}</div>}
      </div>
      <div style={{padding:'0 16px'}}>
        {tab==='concentrate'&&<><ConcentrateScreen concentrate={concentrate} setConcentrate={setConcentrate} jobs={jobs} inventory={inventory}/><BeansCollapse beans={beans} setBeans={setBeans}/></>}
        {tab==='liters'&&<BottledScreen inventory={inventory} setInventory={setInventory} concentrate={concentrate} setConcentrate={setConcentrate} filterCats={['liter']}/>}
        {tab==='minis'&&<BottledScreen inventory={inventory} setInventory={setInventory} concentrate={concentrate} setConcentrate={setConcentrate} filterCats={['mini']}/>}
        {tab==='jerries'&&<BottledScreen inventory={inventory} setInventory={setInventory} concentrate={concentrate} setConcentrate={setConcentrate} filterCats={['jerry']}/>}
        {tab==='syrups'&&<BottledScreen inventory={inventory} setInventory={setInventory} concentrate={concentrate} setConcentrate={setConcentrate} filterCats={['syrup','dispenser']}/>}
        {tab==='labels'&&(labelsOn
          ? <>
              <LabelsScreen labeledStock={labeledStock} setLabeledStock={setLabeledStock}/>
            </>
          : <div style={{...SS.card,textAlign:'center',padding:'36px 20px'}}>
              <div style={{fontSize:30,marginBottom:10}}>🏷️</div>
              <div style={{fontSize:15,fontWeight:600,color:'#121212',marginBottom:6}}>Label tracking is off</div>
              <div style={{fontSize:13,color:'#58616d',lineHeight:1.5,marginBottom:16}}>Enable counts and low-label alerts.</div>
              <button style={{background:'#1a1a1a',color:'#fff',border:'none',borderRadius:10,padding:'10px 22px',fontSize:13,fontWeight:600,cursor:'pointer'}} onClick={()=>setLabelsOn(true)}>Enable</button>
            </div>)}
      </div>
    </div>
  );
}

const stockRoot = document.getElementById('ops-stock-root');
if (stockRoot) ReactDOM.createRoot(stockRoot).render(<StockTab />);

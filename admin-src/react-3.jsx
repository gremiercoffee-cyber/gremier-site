const { useState: useState3, useEffect: useEffect3, useRef: useRef3 } = React;

const OPS_AI_URL = 'https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/ops-ai';

// Exposed on window so plain scripts (e.g. the dashboard briefing) can reach it —
// Babel-compiled scripts run in their own function scope, not global.
window.opsAI2 = opsAI2;
async function opsAI2(action, payload, isFormData = false) {
  const { data: { session } } = await (window.MAIN_SB || window.ADMIN_SB).auth.getSession();
  const headers = { 'apikey': 'sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn' };
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${OPS_AI_URL}?action=${action}`, {
    method: 'POST', headers,
    body: isFormData ? payload : JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}


// ── Voice logger hardening helpers ─────────────────────────
// These helpers make the voice logger do the same real work as the buttons/forms:
// save the job, immediately apply stock side effects for "log now", and refresh the other roots.
const VOICE_PRODUCT_META3 = {
  classic_liter:{label:'Classic Liter',category:'liter',aliases:['classic liter','classic bottle','dark roast liter','dark roast bottle','classic']},
  sweetened_classic:{label:'Sweetened Classic Liter',category:'liter',aliases:['sweetened classic','sweet classic','sweetened bottle','sweetened liter']},
  house_blend:{label:'House Blend Liter',category:'liter',aliases:['house blend','houseblend','medium roast','medium roast liter']},
  colombia_liter:{label:'Colombia Liter',category:'liter',aliases:['colombia','colombia liter','light roast','light roast liter']},
  decaf_liter:{label:'Decaf Liter',category:'liter',aliases:['decaf','decaf liter','decaf bottle']},
  classic_mini:{label:'Classic Mini',category:'mini',aliases:['classic mini','classic minis','dark mini','dark minis']},
  house_blend_mini:{label:'House Blend Mini',category:'mini',aliases:['house blend mini','house blend minis','houseblend mini','medium mini','medium minis']},
  vanilla_mini:{label:'Vanilla Mini',category:'mini',aliases:['vanilla mini','vanilla minis']},
  original_mini:{label:'Original Mini',category:'mini',aliases:['original mini','original minis']},
  caramel_mini:{label:'Caramel Mini',category:'mini',aliases:['caramel mini','caramel minis','caramel cremier','caramel creamer']},
  jerry_can:{label:'Classic Jerry Can',category:'jerry',aliases:['jerry can','classic jerry','classic jerry can','classic 5 liter','classic 5l']},
  jerry_can_houseblend:{label:'House Blend Jerry Can',category:'jerry',aliases:['house blend jerry','house blend jerry can','houseblend jerry','medium jerry']},
  jerry_can_colombia:{label:'Colombia Jerry Can',category:'jerry',aliases:['colombia jerry','colombia jerry can','light roast jerry']},
  jerry_can_decaf:{label:'Decaf Jerry Can',category:'jerry',aliases:['decaf jerry','decaf jerry can']},
  vanilla_syrup:{label:'Vanilla Syrup',category:'syrup',aliases:['vanilla syrup']},
  caramel_syrup:{label:'Caramel Syrup',category:'syrup',aliases:['caramel syrup']},
  sugar_syrup:{label:'Sugar Syrup',category:'syrup',aliases:['sugar syrup','simple syrup']},
  dispenser:{label:'Dispenser',category:'dispenser',aliases:['dispenser','dispensers']},
};
window.__OPS_VOICE_PRODUCT_META__ = VOICE_PRODUCT_META3;

function normVoice3(s) {
  return String(s||'').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9\u0590-\u05ff]+/g,' ').trim();
}
function normVoiceCompact3(s) {
  return normVoice3(s).replace(/\s+/g,'');
}
function resolveVoiceProductKey3(value, preferredCategory) {
  if (!value) return value;
  const raw = String(value).trim();
  if (VOICE_PRODUCT_META3[raw]) return raw;
  const target = normVoiceCompact3(raw);
  if (!target) return raw;
  const entries = Object.entries(VOICE_PRODUCT_META3)
    .filter(([,m]) => !preferredCategory || m.category === preferredCategory);
  const scoreEntry = ([key,meta]) => {
    const names = [key.replace(/_/g,' '), meta.label, ...(meta.aliases||[])];
    let best = 0;
    for (const name of names) {
      const n = normVoiceCompact3(name);
      if (!n) continue;
      if (n === target) best = Math.max(best, 100);
      else if (n.includes(target) || target.includes(n)) best = Math.max(best, 70 + Math.min(n.length,target.length));
    }
    return best;
  };
  let best = null;
  for (const entry of entries) {
    const score = scoreEntry(entry);
    if (!best || score > best.score) best = { key: entry[0], score };
  }
  return best && best.score >= 70 ? best.key : raw;
}
function voiceProductCategory3(pid) {
  return VOICE_PRODUCT_META3[pid]?.category || window.__OPS_PRODUCTS__?.[pid]?.category || '';
}
function resolveVoiceConcentrate3(value) {
  const raw = String(value || '').trim();
  if (['classic','houseBlend','colombia','decaf'].includes(raw)) return raw;
  const t = normVoiceCompact3(raw);
  if (!t) return 'classic';
  const aliases = {
    classic:['classic','darkroast','dark','regular'],
    houseBlend:['houseblend','house','mediumroast','medium'],
    colombia:['colombia','lightroast','light'],
    decaf:['decaf','decaffeinated'],
  };
  for (const [key,vals] of Object.entries(aliases)) {
    if (vals.some(v => v === t || v.includes(t) || t.includes(v))) return key;
  }
  return raw || 'classic';
}
function voiceBottleLiters3(product, qty, liters) {
  const cat = voiceProductCategory3(product);
  const q = Number(qty || 0);
  const l = Number(liters || 0);
  if (q > 0) {
    if (cat === 'mini') return q / 4;
    if (cat === 'jerry') return q * 5;
    return q;
  }
  return l > 0 ? l : 0;
}
function voiceBottledUnitsFromJob3(job) {
  const cat = voiceProductCategory3(job.product);
  if (cat === 'mini') return Math.round((job.liters || 0) * 4);
  if (cat === 'jerry') return job.qty || Math.round((job.liters || 0) / 5);
  return Math.round(job.liters || job.qty || 0);
}
function voiceProductPrompt3() {
  return Object.entries(VOICE_PRODUCT_META3).map(([key,meta]) => `${key} = ${meta.label} (${meta.category})`).join('\n');
}
function normalizeVoiceJob3(rawJob, intent, idx, fallbackDate, stores) {
  const job = { ...(rawJob || {}) };
  const type = String(job.type || '').toLowerCase().trim();
  const typeMap = { bottle:'bottling', bottles:'bottling', bottled:'bottling', bottling:'bottling', label:'labeling', labels:'labeling', labeled:'labeling', labeling:'labeling', brew:'brew', brewing:'brew', drain:'drain', delivery:'delivery' };
  job.type = typeMap[type] || type;

  const isLog = intent === 'log';
  job.date = job.date || fallbackDate;
  // Keep a spoken time ("delivered at 2:30") — previously dropped, so logs
  // always landed at the current moment instead of when the work happened.
  const rawTime = String(job.time || '').trim();
  const tm = rawTime.match(/^(\d{1,2}):(\d{2})/);
  job.time = tm ? String(Math.min(23, Number(tm[1]))).padStart(2, '0') + ':' + tm[2] : null;
  job.id = `${Date.now()}_${idx}_${Math.random().toString(36).slice(2)}`;
  job.createdAt = new Date().toISOString();
  job.brewStarted = false;

  if (job.type === 'delivery') {
    job.deliveryType = job.deliveryType || job.subType || (job.storeName ? 'store' : 'private');
    if (job.deliveryType === 'store' && job.storeName) job.storeName = resolveStoreName2(job.storeName, stores);
    const fixedQtys = {};
    Object.entries(job.quantities || {}).forEach(([pid,qty]) => {
      const key = resolveVoiceProductKey3(pid);
      const n = Math.max(0, Number(qty) || 0);
      if (key && n > 0) fixedQtys[key] = (fixedQtys[key] || 0) + n;
    });
    job.quantities = fixedQtys;
    job.plannedTotal = Object.values(fixedQtys).reduce((s,v)=>s+(Number(v)||0),0);
    job.label = job.label || (job.deliveryType === 'store' ? (job.storeName || 'Store delivery') : (job.privateName || job.cbName || 'Private delivery'));
    job.done = isLog ? true : false;
  }

  if (job.type === 'bottling') {
    job.product = resolveVoiceProductKey3(job.product || job.product_key || job.item, ['mini','jerry','liter'].includes(job.category) ? job.category : null);
    const qty = Number(job.qty ?? job.units ?? job.count ?? 0);
    job.qty = qty > 0 ? qty : job.qty;
    job.liters = voiceBottleLiters3(job.product, qty, job.liters);
    job.done = isLog ? true : false;
    if (isLog) job.actualQty = job.liters || 0;
    const units = voiceBottledUnitsFromJob3(job);
    job.label = job.label || `Bottle ${units || job.liters || ''}× ${VOICE_PRODUCT_META3[job.product]?.label || job.product || ''}`.trim();
    const labelEligible = ['classic_liter','sweetened_classic','house_blend','colombia_liter','vanilla_mini','original_mini','caramel_mini','classic_mini','house_blend_mini'];
    if (isLog && window.gremierLabelsEnabled() && labelEligible.includes(job.product)) job.labeledUsed = { [job.product]: units };
  }

  if (job.type === 'labeling') {
    job.product = resolveVoiceProductKey3(job.product || job.product_key || job.item);
    job.qty = Math.max(0, Number(job.qty ?? job.units ?? job.count ?? 0));
    job.done = isLog ? true : false;
    if (isLog) job.actualQty = job.qty || 0;
    job.label = job.label || `Label ${job.qty || ''}× ${VOICE_PRODUCT_META3[job.product]?.label || job.product || ''}`.trim();
  }

  if (job.type === 'brew') {
    job.product = resolveVoiceConcentrate3(job.product || job.concentrate || 'classic');
    job.kg = Number(job.kg || 3);
    job.brewStarted = isLog ? true : false;
    job.done = false;
    job.label = job.label || `Brew ${job.product} (${job.kg}kg)`;
  }

  if (job.type === 'drain') {
    job.product = resolveVoiceConcentrate3(job.product || job.concentrate || 'classic');
    job.kg = Number(job.kg || 3);
    job.done = isLog ? true : false;
    job.label = job.label || `Drain ${job.product}`;
    if (isSuspiciousDrainJob2(job)) job._unsafeDrain = true;
  }

  return job;
}
function validateVoiceJob3(job) {
  if (!job || !job.type) return 'No job type found.';
  if (job.type === 'delivery') {
    if (job.deliveryType === 'store' && !job.storeName) return 'Store delivery is missing the store name.';
    if (job.deliveryType !== 'coffeebar' && !Object.keys(job.quantities || {}).length) return 'Delivery is missing product quantities.';
  }
  if ((job.type === 'bottling' || job.type === 'labeling') && !VOICE_PRODUCT_META3[job.product]) return `I could not match the product "${job.product || ''}" to a real stock item.`;
  if (job.type === 'bottling' && !(Number(job.liters) > 0)) return 'Bottling is missing the amount.';
  if (job.type === 'labeling' && !(Number(job.qty) > 0)) return 'Labeling is missing the quantity.';
  if ((job.type === 'brew' || job.type === 'drain') && !job.product) return 'Production is missing the concentrate type.';
  if (job.type === 'drain' && (job._unsafeDrain || isSuspiciousDrainJob2(job))) return 'That sounds like a bottle stock correction, not a real drain. Use the Stock tab; I will not save it as a drain.';
  if (job.type === 'drain' && job.done) return 'Drain changes concentrate by a full brew amount. Please check off the Drain task from the Schedule tab so it shows the liters before changing stock.';
  return null;
}
async function saveVoiceJobAndEffects3(job, intent, stores) {
  await window.opsFetch('jobs', { method:'POST', prefer:'return=minimal', body:JSON.stringify(jobToRow2(job)) });
  if (intent === 'log') {
    await applyJobSideEffects2(job, job.type === 'delivery' ? job.quantities : null, stores);
    window.notifyGremierStockChanged?.();
  }
}

// ── Global floating pills (WhatsApp/Billing/Web Queue) — visible on every screen ──
const GLOBAL_PILL_DRAWER_STYLE = { position:'fixed', bottom:0, left:0, right:0, background:'#fafafa', border:'1px solid #cccccc', borderRadius:'16px 16px 0 0', padding:'18px 16px 40px', maxHeight:'72vh', overflowY:'auto', zIndex:301 };
const GLOBAL_PILL_BACKDROP_STYLE = { position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:300 };
function globalPillBtn(bg) { return { background:bg, color:'#fff', border:'none', borderRadius:8, padding:'10px 14px', fontSize:13, fontWeight:600, cursor:'pointer' }; }

function GlobalWaDrawer({ jobs, stores, sentJobs = [], onMarkSent, onUndoSent, onClose }) {
  const [showSent, setShowSent] = useState3(false);
  return (
    <>
      <div style={GLOBAL_PILL_BACKDROP_STYLE} onClick={onClose}/>
      <div style={GLOBAL_PILL_DRAWER_STYLE}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <span style={{fontSize:15,fontWeight:700,color:'#25D366'}}>💬 WhatsApp Notes</span>
          <button style={{background:'none',border:'none',color:'#6a6a6a',fontSize:18,cursor:'pointer'}} onClick={onClose}>✕</button>
        </div>
        {jobs.length===0&&<div style={{color:'#6a6a6a',fontSize:13}}>All sent!</div>}
        {jobs.map(job=>{
          const waLink = buildStoreWaLink2(job, stores);
          return (
            <div key={job.id} style={{padding:'12px 0',borderBottom:'1px solid #e0e0e0'}}>
              <div style={{fontWeight:600,color:'#121212',marginBottom:6}}>{job.storeName}</div>
              <div style={{fontSize:11,color:'#6a6a6a',marginBottom:10}}>{formatDate2(job.date)}</div>
              <div style={{display:'flex',gap:8}}>
                {waLink&&<a href={waLink} target="_blank" rel="noreferrer" style={{...globalPillBtn('#25D366'),flex:1,textAlign:'center',textDecoration:'none'}}>💬 Send</a>}
                <button style={{...globalPillBtn('#eeeeee'),flex:1}} onClick={()=>onMarkSent(job.id)}>✓ Sent</button>
              </div>
            </div>
          );
        })}

        {sentJobs.length>0&&(
          <div style={{marginTop:14,borderTop:'1px solid #e0e0e0',paddingTop:10}}>
            <button type="button" onClick={()=>setShowSent(v=>!v)}
              style={{background:'none',border:'none',color:'#6a6a6a',fontSize:12,cursor:'pointer',padding:0,display:'flex',alignItems:'center',gap:6}}>
              <span style={{display:'inline-block',transform:showSent?'none':'rotate(-90deg)',transition:'transform .15s'}}>▾</span>
              Recently sent ({sentJobs.length})
            </button>
            {showSent&&sentJobs.map(job=>(
              <div key={job.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid #e0e0e0'}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,color:'#121212',fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{job.storeName}</div>
                  <div style={{fontSize:11,color:'#6a6a6a'}}>{formatDate2(job.date)}</div>
                </div>
                <button style={{...globalPillBtn('#eeeeee'),flexShrink:0}} onClick={()=>onUndoSent(job.id)}>↩ Undo</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function GlobalBillingDrawer({ jobs, onMarkBilled, onMarkPaid, onClose }) {
  const PROD_LABELS = {classic_liter:'Classic',sweetened_classic:'Sweetened Classic',house_blend:'House Blend',colombia_liter:'Colombia',decaf_liter:'Decaf',classic_mini:'Classic Mini',house_blend_mini:'House Blend Mini',vanilla_mini:'Vanilla Mini',original_mini:'Original Mini',caramel_mini:'Caramel Mini',jerry_can:'Jerry Can',vanilla_syrup:'Vanilla Syrup',caramel_syrup:'Caramel Syrup',sugar_syrup:'Sugar Syrup'};
  return (
    <>
      <div style={GLOBAL_PILL_BACKDROP_STYLE} onClick={onClose}/>
      <div style={GLOBAL_PILL_DRAWER_STYLE}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <span style={{fontSize:15,fontWeight:700,color:'#b8860b'}}>💰 Billing</span>
          <button style={{background:'none',border:'none',color:'#6a6a6a',fontSize:18,cursor:'pointer'}} onClick={onClose}>✕</button>
        </div>
        {jobs.length===0&&<div style={{color:'#6a6a6a',fontSize:13}}>All billed!</div>}
        {jobs.map(job=>{
          const name = job.deliveryType==='coffeebar'?`Coffee Bar${job.cbName?' — '+job.cbName:''}`:job.privateName||'Private Delivery';
          const detail = Object.entries(job.quantities||{}).filter(([,q])=>q>0).map(([pid,qty])=>`${qty} ${PROD_LABELS[pid]||pid}`).join(', ');
          return (
            <div key={job.id} style={{padding:'12px 0',borderBottom:'1px solid #e0e0e0'}}>
              <div style={{fontWeight:600,color:'#121212',marginBottom:4}}>{name}</div>
              <div style={{fontSize:11,color:'#6a6a6a',marginBottom:4}}>{formatDate2(job.date)}</div>
              {detail&&<div style={{fontSize:11,color:'#6a6a6a',marginBottom:8}}>{detail}</div>}
              {!job.billed&&<button style={{...globalPillBtn('#b8860b'),width:'100%'}} onClick={()=>onMarkBilled(job.id)}>✓ Mark Billed</button>}
              {job.billed&&!job.paid&&(
                <div style={{background:'#e9f6ee',border:'1px solid #2e8b57',borderRadius:6,padding:10,marginTop:4}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#2e8b57',marginBottom:6}}>✓ Billed — awaiting payment</div>
                  <button style={{...globalPillBtn('#1a1a1a'),width:'100%'}} onClick={()=>onMarkPaid(job.id)}>💳 Mark Paid</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function GlobalWebQueueDrawer({ orders, onClose, onSchedule, onDismiss }) {
  return (
    <>
      <div style={GLOBAL_PILL_BACKDROP_STYLE} onClick={onClose}/>
      <div style={GLOBAL_PILL_DRAWER_STYLE}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <span style={{fontSize:15,fontWeight:700,color:'#3f7fc4'}}>📦 Website Orders</span>
          <button style={{background:'none',border:'none',color:'#6a6a6a',fontSize:18,cursor:'pointer'}} onClick={onClose}>✕</button>
        </div>
        {orders.length===0&&<div style={{color:'#6a6a6a',fontSize:13}}>Nothing to schedule!</div>}
        {orders.map(o=>{
          const label = websiteOrderDisplayLabel2(o);
          const items = (o.items||[]).map(i=>`${i.name_en||'Item'} ×${i.qty||1}`).join(', ');
          const unpaid = o.payment_status&&o.payment_status!=='paid';
          return (
            <div key={o.id} style={{padding:'12px 0',borderBottom:'1px solid #e0e0e0'}}>
              <div style={{fontWeight:600,color:'#121212',marginBottom:4}}>{label}{unpaid&&<span style={{fontSize:9,fontWeight:700,letterSpacing:1,textTransform:'uppercase',padding:'2px 7px',borderRadius:10,background:'rgba(224,160,48,.15)',color:'#b8860b',display:'inline-block',marginLeft:6}}>Awaiting payment</span>}</div>
              {o.delivery_address&&<div style={{fontSize:11,color:'#3f7fc4',marginBottom:4}}>📍 {o.delivery_address}</div>}
              {(() => {
                const di = o.delivery_info || {};
                const t = String(di.delivery_type||'regular');
                const label = t==='event' ? 'Event' : t==='expedited' ? (di.priority_type==='specific_date'?'Expedited — specific date':'Expedited (next day)') : 'Regular (2 days)';
                const when = di.delivery_date ? ` · ${di.delivery_date}${di.event_time?' '+di.event_time:''}` : '';
                return <div style={{fontSize:11,color:'#6a6a6a',marginBottom:4}}>🚚 {label}{when}</div>;
              })()}
              {o.notes&&<div style={{fontSize:11,color:'#b8860b',marginBottom:4}}>⚠ {o.notes}</div>}
              <div style={{fontSize:11,color:'#6a6a6a',marginBottom:10}}>{items}</div>
              <button style={{...globalPillBtn('#1a1a1a'),width:'100%',marginBottom:6}} onClick={()=>onSchedule(o)}>Schedule →</button>
              <button style={{...globalPillBtn('#eeeeee'),width:'100%',border:'1px solid #cccccc',color:'#d5544a'}} onClick={()=>onDismiss(o)}>Remove</button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function GlobalPillsFloat() {
  const [jobs, setJobs] = useState3([]);
  const [stores, setStores] = useState3([]);
  const [pendingWeb, setPendingWeb] = useState3([]);
  const [waOpen, setWaOpen] = useState3(false);
  const [billingOpen, setBillingOpen] = useState3(false);
  const [webQueueOpen, setWebQueueOpen] = useState3(false);

  async function reload() {
    await window.gremierMergeDynamicOpsProducts?.(window.__OPS_PRODUCTS__, window.__OPS_PRODUCTS_FULL__, window.__OPS_PRODUCT_IMAGES__);
    await window.gremierEnsureDynamicOpsStockRows?.();
    const [allJobs, storeRows, webRows] = await Promise.all([
      loadAllJobs2(),
      window.opsFetch('stores?select=*&is_active=eq.true&order=sort_order'),
      loadPendingWebDeliveries2(),
    ]);
    setJobs(allJobs||[]);
    setStores(storeRows||[]);
    setPendingWeb(webRows||[]);
  }
  useEffect3(()=>{
    const safeReload = () => { reload().catch(err => console.warn('[Gremier] global pills reload failed (will retry):', err?.message || err)); };
    safeReload();
    const interval = setInterval(safeReload, 60000); // refresh every minute so pills stay current across long sessions
    function onJobsChanged() { safeReload(); }
    window.addEventListener('gremier:jobs-changed', onJobsChanged);
    return () => { clearInterval(interval); window.removeEventListener('gremier:jobs-changed', onJobsChanged); };
  },[]);

  const waPending = jobs.filter(j=>jobWaDrawerEligible2(j,stores));
  // Website orders are paid at checkout — never bill them (websiteOrderId marks them; paid can be toggled manually so it's not the filter).
  const unbilled = jobs.filter(j=>j.type==='delivery'&&(j.deliveryType==='private'||j.deliveryType==='coffeebar')&&j.done&&!j.paid&&!j.websiteOrderId);

  // Store deliveries already marked sent — kept available so an accidental
  // "✓ Sent" tap (or a store change) can be undone instead of lost forever.
  const waRecentlySent = jobs
    .filter(j=>isStoreWaDelivery2(j,stores)&&j.done&&j.waSentAt)
    .filter(j=>{
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-(window.STORE_WA_LOOKBACK_DAYS||45));
      return String(j.date||'').slice(0,10) >= cutoff.toISOString().slice(0,10);
    })
    .sort((a,b)=>String(b.waSentAt||'').localeCompare(String(a.waSentAt||'')))
    .slice(0,10);

  async function undoWaSent(jobId) {
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j,waNeedsSend:true,waSentAt:null}:j));
    await window.opsFetch(`jobs?id=eq.${jobId}`,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({wa_needs_send:true,wa_sent_at:null})});
  }

  async function markWaSent(jobId) {
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j,waNeedsSend:false,waSentAt:new Date().toISOString()}:j));
    await window.opsFetch(`jobs?id=eq.${jobId}`,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({wa_needs_send:false,wa_sent_at:new Date().toISOString()})});
  }
  async function markBilled(jobId) {
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j,billed:true}:j));
    await window.opsFetch(`jobs?id=eq.${jobId}`,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({billed:true})});
  }
  async function markPaid(jobId) {
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j,paid:true}:j));
    await window.opsFetch(`jobs?id=eq.${jobId}`,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({paid:true})});
  }
  async function dismissWebOrder(order) {
    if (!window.confirm(`Remove "${websiteOrderDisplayLabel2(order)}" from queue?`)) return;
    await window.opsFetch(`pending_website_deliveries?id=eq.${order.id}`,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({status:'dismissed'})});
    await reload();
  }
  async function scheduleWebOrder(o) {
    setWebQueueOpen(false);
    const items = o.items || [];
    // a coffee bar order is any order containing a product flagged is_coffee_bar in the catalog —
    // check live rather than relying on the vanilla admin panel's allProducts cache, since that's
    // only populated once the Products tab has been opened. Pull variations too, since that's
    // where each guest tier's price lives.
    const pids = items.map(i => i.product_id).filter(Boolean);
    let isCoffeeBar = false;
    let cbProducts = [];
    if (pids.length) {
      cbProducts = await window.opsFetch(`products?id=in.(${pids.join(',')})&select=id,is_coffee_bar,variations`) || [];
      isCoffeeBar = cbProducts.some(p => p.is_coffee_bar === true);
    }

    if (isCoffeeBar) {
      // figure out the guest count from what they actually paid — every guest tier (25/50/75/100/125)
      // has its own fixed price set in the Products tab, so the price on this order's line item maps
      // straight back to a tier. Only fall back to scanning the item's name if no price match is found.
      let people = 25;
      let matched = false;
      for (const i of items) {
        const prod = cbProducts.find(p => p.id === i.product_id);
        const tiers = (prod?.variations || []).find(v => v.type === 'guest_count')?.options || [];
        if (!tiers.length) continue;
        const itemPrice = Number(i.price) || 0;
        let best = null, bestDiff = Infinity;
        tiers.forEach(t => {
          const diff = Math.abs((Number(t.price) || 0) - itemPrice);
          if (diff < bestDiff) { bestDiff = diff; best = t; }
        });
        if (best) { people = best.guests; matched = true; break; }
      }
      if (!matched) {
        for (const i of items) {
          const text = `${i.name_en||''} ${i.name_he||''}`;
          const m = text.match(/(\d+)\s*(guests?|אורחים)/i);
          if (m) { people = Math.max(25, Math.round(Number(m[1])/25)*25); break; }
        }
      }
      const prefill = {
        subType: 'coffeebar',
        cbName: websiteOrderDisplayLabel2(o),
        cbAddress: o.delivery_address || '',
        people,
      };
      window.showTab('schedule');
      window.dispatchEvent(new CustomEvent('gremier:schedule-prefill', { detail: prefill }));
      return;
    }

    const prefill = await buildWebsiteOrderSchedulePrefill2(o);
    if (!Object.keys(prefill.quantities || {}).length && prefill.unresolvedItems?.length) {
      console.warn('Schedule opened without mapped product quantities:', prefill.unresolvedItems);
    }
    // ScheduleTab only renders its form while mounted on the Schedule tab itself —
    // switch there and hand off the prefill via an event so it opens pre-populated
    window.showTab('schedule');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('gremier:schedule-prefill', { detail: prefill }));
    }, 0);
  }

  const anyDrawerOpen = waOpen || billingOpen || webQueueOpen;
  return (
    <>
      {!anyDrawerOpen&&waPending.length>0&&(
        <button style={{position:'fixed',bottom:170,right:16,background:'#25D366',color:'#fff',border:'none',borderRadius:20,padding:'8px 13px',fontSize:12,fontWeight:600,cursor:'pointer',zIndex:60,boxShadow:'0 2px 12px rgba(0,0,0,.4)'}} onClick={()=>setWaOpen(true)}>💬 {waPending.length}</button>
      )}
      {!anyDrawerOpen&&unbilled.length>0&&(
        <button style={{position:'fixed',bottom:210,right:16,background:'#b8860b',color:'#fff',border:'none',borderRadius:20,padding:'8px 13px',fontSize:12,fontWeight:600,cursor:'pointer',zIndex:60,boxShadow:'0 2px 12px rgba(0,0,0,.4)'}} onClick={()=>setBillingOpen(true)}>💰 {unbilled.length}</button>
      )}
      {!anyDrawerOpen&&pendingWeb.length>0&&(
        <button style={{position:'fixed',bottom:250,right:16,background:'#3f7fc4',color:'#fff',border:'none',borderRadius:20,padding:'8px 13px',fontSize:12,fontWeight:600,cursor:'pointer',zIndex:60,boxShadow:'0 2px 12px rgba(0,0,0,.4)'}} onClick={()=>setWebQueueOpen(true)}>📦 {pendingWeb.length}</button>
      )}
      {waOpen&&<GlobalWaDrawer jobs={waPending} stores={stores} sentJobs={waRecentlySent} onMarkSent={async(id)=>{await markWaSent(id);setWaOpen(false);}} onUndoSent={undoWaSent} onClose={()=>setWaOpen(false)}/>}
      {billingOpen&&<GlobalBillingDrawer jobs={unbilled} onMarkBilled={markBilled} onMarkPaid={markPaid} onClose={()=>setBillingOpen(false)}/>}
      {webQueueOpen&&<GlobalWebQueueDrawer orders={pendingWeb} onClose={()=>setWebQueueOpen(false)} onSchedule={scheduleWebOrder} onDismiss={dismissWebOrder}/>}
    </>
  );
}

function VoiceLoggerFloat() {
  const [isOpen, setIsOpen] = useState3(false);
  const [phase, setPhase] = useState3('idle');
  const [messages, setMessages] = useState3([]);
  const [pendingOption, setPendingOption] = useState3(null);
  const [errorMsg, setErrorMsg] = useState3('');
  const [stores, setStores] = useState3([]);
  const mediaRecorderRef = useRef3(null);
  const audioChunksRef = useRef3([]);
  const messagesEndRef = useRef3(null);

  useEffect3(() => {
    window.opsFetch('stores?select=name,phone&is_active=eq.true').then(rows => setStores(rows||[]));
  }, []);

  useEffect3(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingOption]);

  function openChat() {
    setIsOpen(true); setMessages([]); setPendingOption(null); setErrorMsg('');
    setTimeout(() => startListening(), 100);
  }
  function closeChat() {
    stopListening(); setIsOpen(false); setPhase('idle');
    setMessages([]); setPendingOption(null); setErrorMsg('');
  }
  function stopListening() { try { mediaRecorderRef.current?.stop(); } catch(e){} }

  function handleMicTap() {
    if (pendingOption) return;
    if (phase==='listening') stopListening();
    else if (phase==='idle'||phase==='done') { setErrorMsg(''); setPendingOption(null); startListening(); }
  }

  async function startListening() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPhase('listening');
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data.size>0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t=>t.stop());
        if (!audioChunksRef.current.length) { setPhase('idle'); return; }
        setPhase('thinking');
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await transcribeAndProcess(audioBlob, mimeType);
      };
      recorder.onerror = () => { setPhase('idle'); setErrorMsg('Mic error. Try again.'); };
      recorder.start();
    } catch(e) { setPhase('idle'); setErrorMsg('Mic access denied.'); }
  }

  async function transcribeAndProcess(audioBlob, mimeType) {
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const formData = new FormData();
      formData.append('file', audioBlob, `recording.${ext}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');
      const storeNames = stores.map(s=>s.name).join(', ');
      const prodNames = Object.values(window.__OPS_PRODUCTS__||{}).map(p=>p.label||'').filter(Boolean).join(', ');
      formData.append('prompt', `Gremier Coffee cold brew operations. Stores: ${storeNames}. Products: ${prodNames}. Terms: classic, house blend, colombia, decaf, concentrate, brew, drain, bottle, label, jerry can, delivery, schedule, paid, billed, kilo, liter.`);
      const data = await opsAI2('transcribe', formData, true);
      const text = data.text?.trim();
      if (!text) { setPhase('idle'); setErrorMsg("Couldn't hear anything."); return; }
      setMessages(prev=>[...prev,{role:'user',text}]);
      await parseIntent2(text);
    } catch(err) { setPhase('idle'); setErrorMsg('Transcription error: '+err.message); }
  }

  async function parseIntent2(text) {
    const today = todayISO2();
    const tomorrow = tomorrowISO2();
    const productCatalog = voiceProductPrompt3();
    // Live schedule context — lets the assistant complete/reschedule existing jobs.
    let openJobsBlock = 'Could not load open jobs.';
    try {
      const rows = await window.opsFetch('jobs?done=eq.false&select=id,type,delivery_type,store_name,private_name,cb_name,label,date,time&order=date.asc&limit=50');
      openJobsBlock = (rows||[]).map(r=>{
        const who = r.store_name || r.private_name || r.cb_name || '';
        return `- id:"${r.id}" | ${r.type}${r.delivery_type?'/'+r.delivery_type:''} | ${who} | ${r.date}${r.time?' '+String(r.time).slice(0,5):''}${r.label?' | '+r.label:''}`;
      }).join('\n') || 'No open jobs.';
    } catch(e) { console.warn('voice: open jobs fetch failed', e); }
    const systemPrompt = `You are the voice assistant for Gremier Coffee, a cold brew company in Jerusalem.
TODAY: ${today} TOMORROW: ${tomorrow}
STORES: ${stores.map(s=>s.name).join(', ')}
PRODUCT CATALOG — use these exact product keys:
${productCatalog}

CURRENT OPEN (NOT-DONE) JOBS ON THE SCHEDULE:
${openJobsBlock}

WHAT YOU CAN DO (capabilities):
- Log work that already happened (deliveries, brews, bottling, labeling, drains) — applies stock changes.
- Schedule future jobs of the same types.
- Mark an EXISTING open job from the list above as completed.
- Reschedule an EXISTING open job to a new date/time.
- Answer questions about the schedule, stock, and planning using the open-jobs list above.

PICK ONE INTENT:
1. log — something already happened that is NOT one of the open jobs above. done=true, date=today.
2. schedule — planning a NEW job for later. done=false.
3. ask — question about stock or planning. Answer conversationally.
4. clarify — key info missing. Ask one short question with choices.
5. unknown — cannot tell what they mean.
6. complete — the user says an EXISTING open job (match it in the list above) is done/finished/delivered. Return its exact id.
7. reschedule — the user wants to MOVE an existing open job to a different date/time. Return its exact id plus the new date (and time if said).
If what the user reports matches an open job, PREFER complete/reschedule over log — do not create duplicates.

JOB SHAPES:
- delivery store: { type:"delivery", deliveryType:"store", storeName, quantities:{product_key:qty}, done, date, time }
- delivery private: { type:"delivery", deliveryType:"private", privateName, privateAddress, quantities, done, date }
- brew: { type:"brew", product:"classic"|"houseBlend"|"colombia"|"decaf", kg:1|1.5|2|3, done, date }
- bottling: { type:"bottling", product:product_key, qty:number, liters:number, done, date }
  For bottling, if the user says a number of bottles/minis/jerry cans, put that number in qty. Also compute liters: liter qty = qty liters; mini qty = qty/4 liters; jerry qty = qty*5 liters.
${window.gremierLabelsEnabled()?'- labeling: { type:"labeling", product:product_key, qty:number, done, date }':'Labeling is currently disabled — do not create labeling jobs; use clarify if the user asks about labeling.'}
- drain: { type:"drain", product:"classic"|"houseBlend"|"colombia"|"decaf", kg:number, done, date }

IMPORTANT SAFETY RULES:
- "Drain" means finished brewing concentrate and will add a full brew amount of concentrate.
- If the user says remove/take away/deduct/fix/adjust stock, bottles, minis, liters, or jerry cans, DO NOT use type "drain". Return clarify/unknown and tell them to use the Stock tab.
- Never use kg to mean number of bottles or liters removed from stock.

RESPONSE — return ONLY JSON:
log/schedule (ONE job): { "intent":"log"|"schedule", "reply":"short confirmation", "option":{ "label":"...", "job":{...} } }
log/schedule (TWO OR MORE jobs — e.g. "schedule two deliveries"): { "intent":"log"|"schedule", "reply":"short confirmation", "options":[ {"label":"...","job":{...}}, {"label":"...","job":{...}} ] }
ask: { "intent":"ask", "reply":"your answer" }
clarify: { "intent":"clarify", "reply":"one short question", "choices":["A","B"] }
unknown: { "intent":"unknown", "reply":"I didn't catch that. Try again?" }
complete: { "intent":"complete", "reply":"short confirmation of which job", "job_id":"exact-id-from-open-jobs-list" }
reschedule: { "intent":"reschedule", "reply":"short confirmation", "job_id":"exact-id-from-open-jobs-list", "date":"YYYY-MM-DD", "time":"HH:MM" or null }

EVERY job MUST include a "date" (YYYY-MM-DD). If the user gives no date, use TODAY for log and TOMORROW for schedule.
EVERY job may also include "time" (24h "HH:MM"). If the user states a time — including for something already done ("I delivered to Rova at 2:30", "bottled 20 classics this morning at 9") — you MUST set "time" to that time. Convert spoken forms: "2:30pm"->"14:30", "quarter past 9"->"09:15", "noon"->"12:00", "this morning"->omit unless a clock time is given. Omit "time" entirely when no clock time was spoken.
For log intent, the app will immediately apply stock changes after the user confirms, so do not invent vague products. Use exact product keys only.
For "storeName", copy the EXACT name from the STORES list above, verbatim — do not rephrase or transliterate it. If the spoken store doesn't clearly match one in the list, use the clarify intent and offer the closest names as choices.
If the user describes more than one job, you MUST return them all in the "options" array — never collapse them into one.

Keep replies short — 1-2 sentences.`;

    try {
      const history = messages.filter(m=>m.text&&m.text!=='⋯').map(m=>({role:m.role==='user'?'user':'assistant',content:m.text}));
      const data = await opsAI2('parse_intent', {
        model:'gpt-5.6-luna', max_completion_tokens:4000,
        response_format:{type:'json_object'},
        messages:[{role:'system',content:systemPrompt},...history,{role:'user',content:text}],
      });
      const raw = data.choices?.[0]?.message?.content||data.content?.[0]?.text||'';
      let obj;
      try { obj = JSON.parse(raw.replace(/```json|```/g,'').trim()); }
      catch { setMessages(prev=>[...prev,{role:'assistant',text:'Sorry, trouble understanding. Try again.'}]); setPhase('idle'); return; }
      const reply = obj.reply||'Done.';
      const choices = obj.choices||null;
      // accept either a single {option} or a multi {options:[...]} — both normalize to one array
      const items = Array.isArray(obj.options)
        ? obj.options.filter(o=>o&&o.job)
        : (obj.option&&obj.option.job ? [obj.option] : []);
      if (obj.intent==='ask'||obj.intent==='unknown'||obj.intent==='clarify') {
        setMessages(prev=>[...prev,{role:'assistant',text:reply,choices}]);
        setPhase('done');
      } else if ((obj.intent==='complete'||obj.intent==='reschedule')&&obj.job_id) {
        setMessages(prev=>[...prev,{role:'assistant',text:reply,intent:obj.intent,choices}]);
        setPendingOption({action:obj,intent:obj.intent});
        setPhase('done');
      } else if (items.length) {
        setMessages(prev=>[...prev,{role:'assistant',text:reply,intent:obj.intent,choices}]);
        setPendingOption({items,intent:obj.intent});
        setPhase('done');
      } else {
        setMessages(prev=>[...prev,{role:'assistant',text:reply,choices}]);
        setPhase('done');
      }
    } catch(err) {
      setMessages(prev=>[...prev,{role:'assistant',text:'API error. Try again.'}]);
      setPhase('idle');
    }
  }

  async function confirmOption() {
    if (!pendingOption) return;
    const { items, intent, action } = pendingOption;
    setPendingOption(null);
    setPhase('thinking');

    // Existing-job actions: mark complete (with stock side effects) or move date/time.
    if (action && action.job_id) {
      try {
        const rows = await window.opsFetch(`jobs?id=eq.${encodeURIComponent(action.job_id)}&select=*`);
        const row = rows && rows[0];
        if (!row) throw new Error('Job not found');
        if (intent==='complete') {
          const job = rowToJob2(row);
          await patchJob2(row.id, { done:true });
          await applyJobSideEffects2(job, job.type==='delivery' ? job.quantities : null, stores);
          window.notifyGremierStockChanged?.();
          setMessages(prev=>[...prev,{role:'assistant',text:'✓ Marked complete.'}]);
        } else {
          await patchJob2(row.id, { date:action.date||row.date, time:action.time||row.time||null });
          setMessages(prev=>[...prev,{role:'assistant',text:'✓ Rescheduled.'}]);
        }
        window.dispatchEvent(new CustomEvent('gremier:jobs-changed'));
      } catch(err) {
        console.error('Voice job action failed:', err);
        setMessages(prev=>[...prev,{role:'assistant',text:'Could not update that job: '+(err.message||'error')}]);
      }
      setPhase('done');
      return;
    }
    const list = (items||[]).filter(it=>it&&it.job);
    if (!list.length) { setPhase('idle'); return; }

    // schedules default to tomorrow, logs to today. Log intent now applies inventory/concentrate/label side effects immediately.
    const fallbackDate = intent==='schedule' ? tomorrowISO2() : todayISO2();
    let saved = 0;
    const errors = [];

    for (let i=0;i<list.length;i++) {
      const it = list[i];
      const newJob = normalizeVoiceJob3({ ...it.job, label: it.label || it.job.label }, intent, i, fallbackDate, stores);
      const validation = validateVoiceJob3(newJob);
      if (validation) {
        errors.push(validation);
        continue;
      }
      try {
        await saveVoiceJobAndEffects3(newJob, intent, stores);
        saved++;
      } catch(err) {
        console.error('Voice logger save/effects failed:', err, newJob);
        errors.push(err.message || 'Save failed');
      }
    }

    if (saved>0) {
      // Scheduler, global pills, and Stock live in separate React roots — tell all of them to re-fetch.
      window.dispatchEvent(new CustomEvent('gremier:jobs-changed'));
      window.notifyGremierStockChanged?.();
      setMessages(prev=>[...prev,{role:'assistant',text:intent==='log'
        ? (saved>1?`✓ Logged ${saved} jobs and updated stock.`:'✓ Logged and updated stock.')
        : (saved>1?`✓ Scheduled ${saved} jobs.`:'✓ Scheduled.') }]);
    }
    if (errors.length) {
      setMessages(prev=>[...prev,{role:'assistant',text:`⚠ ${errors.join(' ')}`}]);
    }
    setPhase('done');
  }

  function cancelOption() {
    setPendingOption(null);
    setMessages(prev=>[...prev,{role:'assistant',text:'Cancelled.'}]);
    setPhase('idle');
  }

  const intentColor = i => i==='log'?'#2e8b57':i==='schedule'?'#3f7fc4':'#1a1a1a';
  const intentLabel = i => i==='log'?'Log Now':i==='schedule'?'Schedule':'Confirm';

  const AMBER = '#b8860b';

  return (
    <>
      <style>{`
        @keyframes micPulse { 0%,100%{box-shadow:0 0 0 0px rgba(224,160,48,.5),0 4px 16px rgba(0,0,0,.4);} 50%{box-shadow:0 0 0 12px rgba(224,160,48,.15),0 4px 16px rgba(0,0,0,.4);} }
        @keyframes micThink { 0%,100%{box-shadow:0 0 0 0px rgba(106,168,232,.5);} 50%{box-shadow:0 0 0 10px rgba(106,168,232,.15);} }
        @keyframes slideUp2 { from{transform:translateY(100%);opacity:0;} to{transform:translateY(0);opacity:1;} }
        @keyframes fadeInMsg { from{opacity:0;transform:translateY(4px);} to{opacity:1;transform:translateY(0);} }
        .vl-msg { animation: fadeInMsg .18s ease; }
      `}</style>

      {/* backdrop */}
      {isOpen&&<div onClick={closeChat} style={{position:'fixed',inset:0,zIndex:298,background:'rgba(0,0,0,.4)'}}/>}

      {/* floating button */}
      {!isOpen&&(
<button onClick={openChat} style={{
          position:'fixed', bottom:115, right:16,
          width:46, height:46, borderRadius:'50%',
          background:AMBER, color:'#ffffff',
          border:'none', fontSize:20, cursor:'pointer', zIndex:50,
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 4px 16px rgba(0,0,0,.5)',
        }}>🎙</button>
      )}

      {/* chat panel */}
      {isOpen&&(
        <div onClick={e=>e.stopPropagation()} style={{
          position:'fixed', bottom:0, left:0, right:0, zIndex:299,
          background:'#fafafa', borderRadius:'18px 18px 0 0',
          boxShadow:'0 -4px 30px rgba(0,0,0,.4)',
          animation:'slideUp2 .22s ease',
          display:'flex', flexDirection:'column', maxHeight:'72vh',
          border:'1px solid #cccccc', borderBottom:'none',
        }}>
          {/* header */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 18px 10px',borderBottom:'1px solid #e0e0e0',flexShrink:0}}>
            <div style={{fontSize:13,fontWeight:700,color:AMBER,letterSpacing:.5}}>☕ Gremier Assistant</div>
            <button onClick={closeChat} style={{background:'none',border:'none',color:'#6a6a6a',fontSize:20,cursor:'pointer'}}>✕</button>
          </div>

          {/* messages */}
          <div style={{flex:1,overflowY:'auto',padding:'12px 16px',display:'flex',flexDirection:'column',gap:10}}>
            {messages.map((msg,i)=>(
              <div key={i} className="vl-msg" style={{display:'flex',flexDirection:'column',alignItems:msg.role==='user'?'flex-end':'flex-start'}}>
                <div style={{
                  padding:'9px 13px',
                  borderRadius:msg.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px',
                  background:msg.role==='user'?AMBER:'#eeeeee',
                  color:msg.role==='user'?'#ffffff':'#121212',
                  fontSize:14, lineHeight:1.5, maxWidth:'90%',
                }}>{msg.text}</div>
                {msg.choices&&i===messages.length-1&&(
                  <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:8}}>
                    {msg.choices.map((choice,ci)=>(
                      <button key={ci} onClick={()=>{
                        setMessages(prev=>[...prev,{role:'user',text:choice}]);
                        setPhase('thinking');
                        parseIntent2(choice);
                      }} style={{background:'#eeeeee',border:'1px solid #cccccc',borderRadius:20,padding:'8px 16px',fontSize:13,fontWeight:600,cursor:'pointer',color:'#121212'}}>
                        {choice}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {phase==='thinking'&&(
              <div className="vl-msg" style={{display:'flex',alignItems:'flex-start'}}>
                <div style={{background:'#eeeeee',borderRadius:'16px 16px 16px 4px',padding:'10px 14px',fontSize:18,color:'#6a6a6a'}}>⋯</div>
              </div>
            )}
            <div ref={messagesEndRef}/>
          </div>

          {/* error */}
          {errorMsg&&<div style={{padding:'4px 16px',fontSize:12,color:'#d5544a',textAlign:'center',flexShrink:0}}>{errorMsg}</div>}

          {/* bottom bar */}
          <div style={{padding:'10px 12px 28px',flexShrink:0,borderTop:'1px solid #e0e0e0',background:'#fafafa'}}>
            {pendingOption?(
              <div>
                <div style={{fontSize:12,fontWeight:700,color:intentColor(pendingOption.intent),marginBottom:6}}>{intentLabel(pendingOption.intent)}: {(pendingOption.items||[]).map(it=>it.label||(it.job&&it.job.type)||'job').join(', ')}</div>
                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button onClick={cancelOption} style={{flex:1,background:'#eeeeee',border:'1px solid #cccccc',borderRadius:8,padding:'12px',fontSize:14,fontWeight:600,cursor:'pointer',color:'#6a6a6a'}}>Cancel</button>
                  <button onClick={confirmOption} style={{flex:2,background:'#1a1a1a',border:'none',borderRadius:8,padding:'12px',fontSize:14,fontWeight:700,cursor:'pointer',color:'#ffffff'}}>{intentLabel(pendingOption.intent)} ✓</button>
                </div>
              </div>
            ):(
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <input
                  type="text"
                  placeholder="Or type a message…"
                  style={{flex:1,background:'#eeeeee',border:'1px solid #cccccc',borderRadius:20,padding:'10px 14px',color:'#121212',fontSize:14,outline:'none'}}
                  onKeyDown={e=>{if(e.key==='Enter'&&e.target.value.trim()){const t=e.target.value.trim();e.target.value='';setMessages(prev=>[...prev,{role:'user',text:t}]);setPhase('thinking');parseIntent2(t);}}}
                />
                <button onClick={handleMicTap} style={{
                  width:46,height:46,borderRadius:'50%',flexShrink:0,
                  background:phase==='listening'?'#d5544a':phase==='thinking'?'#3f7fc4':AMBER,
                  color:'#ffffff',border:'none',fontSize:20,cursor:'pointer',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  animation:phase==='listening'?'micPulse 1s infinite':phase==='thinking'?'micThink 1s infinite':'none',
                  boxShadow:'0 2px 10px rgba(0,0,0,.4)',
                }}>
                  {phase==='thinking'?'⋯':phase==='listening'?'■':'🎙'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const vlRoot = document.getElementById('ops-voicelogger-root');
if (vlRoot) ReactDOM.createRoot(vlRoot).render(<VoiceLoggerFloat/>);

const gpRoot = document.getElementById('ops-globalpills-root');
if (gpRoot) ReactDOM.createRoot(gpRoot).render(<GlobalPillsFloat/>);

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import logoImg from "./assets/logo.png";
const DELIVERY_SHEET_URL = "https://script.google.com/macros/s/AKfycbwZYrVdny2xcegxz4vZTaiB1-Z_2oPSj_egPLYNMfDTm1ZKnXkcwKdDW8myxciagECSzg/exec";
const SUPABASE_URL = "https://ayuzmwpmhncxrugsyxmw.supabase.co";
const SUPABASE_KEY = "sb_publishable_UDYvyCRXZl3Ci9zIRKJhVQ_XdYKcUdn";
const ADMIN_EMAILS = ["gremiercoffee@gmail.com", "yonigrey@gmail.com"];
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY || "";
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
async function writeDeliveryToSheet(storeName, large, mini, syrup) {
  try {
    const phone = STORES.find(s => s.name === storeName)?.phone || "";
    const params = new URLSearchParams({ storeName, phone, large, mini, syrup });
    await fetch(DELIVERY_SHEET_URL + "?" + params.toString(), {
      method: "GET", mode: "no-cors",
    });
  } catch(e) { console.error("Delivery sheet write failed:", e); }
}
async function sbFetch(path, options = {}) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": options.prefer || "return=representation",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) { const err = await res.text(); throw new Error(err); }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch(err) { console.error("Supabase error:", err); throw err; }
}
function jobToRow(job) {
  return {
    id: job.id, type: job.type, date: job.date, time: job.time || null,
    done: job.done || false, actual_qty: job.actualQty || null,
    brew_started: job.brewStarted === true ? true : false, product: job.product || null,
    kg: job.kg || null, liters: job.liters || null, label: job.label || null,
    delivery_type: job.deliveryType || null, store_name: job.storeName || null,
    private_name: job.privateName || null, private_address: job.privateAddress || null,
    people: job.people || null, planned_total: job.plannedTotal || null,
    quantities: job.quantities || null, created_at: job.createdAt || new Date().toISOString(),
    needs_confirmation: job.needsConfirmation || false, jerry_cans: job.jerryCans || null,
    qty: job.qty || null, cb_name: job.cbName || null, cb_address: job.cbAddress || null,
    dispensers: job.dispensers || null, wa_needs_send: job.waNeedsSend || false,
    cb_syrups: job.cbSyrups || null, billed: job.billed || false, paid: job.paid || false,
  };
}
function rowToJob(r) {
  return {
    id: r.id, type: r.type, date: r.date, time: r.time, done: r.done,
    brewStarted: r.brew_started, actualQty: r.actual_qty, product: r.product,
    kg: r.kg, liters: r.liters, label: r.label, deliveryType: r.delivery_type,
    storeName: r.store_name, privateName: r.private_name, privateAddress: r.private_address,
    people: r.people, plannedTotal: r.planned_total, quantities: r.quantities || {},
    needsConfirmation: r.needs_confirmation, jerryCans: r.jerry_cans || [],
    qty: r.qty, cbName: r.cb_name, cbAddress: r.cb_address, dispensers: r.dispensers,
    waNeedsSend: r.wa_needs_send, cbSyrups: r.cb_syrups || {}, billed: r.billed, paid: r.paid || false,
  };
}
async function sbLoadAll() {
  const [jobs, inventory, concentrate, beans, labeledStock] = await Promise.all([
    sbFetch("jobs?select=*&order=date.asc"),
    sbFetch("inventory?select=*"),
    sbFetch("concentrate?select=*"),
    sbFetch("beans?select=*"),
    sbFetch("labeled_stock?select=*"),
  ]);
  const inventoryMap = {}; inventory.forEach(r => { inventoryMap[r.product] = r.qty; });
  const concentrateMap = {}; concentrate.forEach(r => { concentrateMap[r.type] = r.liters; });
  const beansMap = {}; beans.forEach(r => { beansMap[r.type] = { kg: r.kg, ordered: r.ordered || false, orderedKg: r.ordered_kg || 0 }; });
  const labeledMap = {}; labeledStock.forEach(r => { labeledMap[r.product] = r.qty; });
  return { jobs: jobs.map(rowToJob), inventory: inventoryMap, concentrate: concentrateMap, beans: beansMap, labeledStock: labeledMap };
}
async function sbIncrementInventory(product, delta) {
  const rows = await sbFetch(`inventory?product=eq.${product}&select=qty`);
  if (!rows?.length) return;
  const newQty = Math.max(0, (rows[0].qty || 0) + delta);
  await sbFetch(`inventory?product=eq.${product}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ qty: newQty }) });
}
async function sbIncrementLabeledStock(product, delta) {
  const rows = await sbFetch(`labeled_stock?product=eq.${product}&select=qty`);
  if (!rows?.length) return;
  const newQty = Math.max(0, (rows[0].qty || 0) + delta);
  await sbFetch(`labeled_stock?product=eq.${product}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ qty: newQty }) });
}
async function sbIncrementConcentrate(type, delta) {
  const rows = await sbFetch(`concentrate?type=eq.${type}&select=liters`);
  if (!rows?.length) return;
  const newLiters = Math.max(0, parseFloat(((rows[0].liters || 0) + delta).toFixed(1)));
  await sbFetch(`concentrate?type=eq.${type}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ liters: newLiters }) });
}
async function sbCreateDrain(brewJob) {
  const existing = await sbFetch(`jobs?type=eq.drain&product=eq.${brewJob.product}&done=eq.false&select=id`);
  if (existing?.length) return;
  const drainHours = brewJob.product === "classic" ? 22 : 18;
  const drainTime = new Date(Date.now() + drainHours * 60 * 60 * 1000);
  const drainDate = `${drainTime.getFullYear()}-${String(drainTime.getMonth()+1).padStart(2,"0")}-${String(drainTime.getDate()).padStart(2,"0")}`;
  const drainTimeStr = `${String(drainTime.getHours()).padStart(2,"0")}:${String(drainTime.getMinutes()).padStart(2,"0")}`;
  await sbFetch("jobs", { method: "POST", prefer: "return=minimal", body: JSON.stringify({
    id: `drain_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    type: "drain", product: brewJob.product, kg: brewJob.kg, date: drainDate, time: drainTimeStr,
    done: false, needs_confirmation: false,
    label: `Drain ${brewJob.product} (${drainHours}h brew)`, created_at: new Date().toISOString(),
  })});
}
const CONCENTRATE_TYPES = {
  classic:    { label: "Classic (Dark Roast)",  color: "#101010", ratio: 0.44 },
  houseBlend: { label: "House Blend",            color: "#101010", ratio: 0.50 },
  colombia:   { label: "Colombia (Light Roast)", color: "#6B8E23", ratio: 0.50 },
  decaf:      { label: "Decaf",                  color: "#5C4033", ratio: 0.50 },
};
const PRODUCTS = {
  classic_liter:        { label: "Classic",              category: "liter", concentrate: "classic",    litersPerUnit: 1    },
  sweetened_classic:    { label: "Sweetened Classic",    category: "liter", concentrate: "classic",    litersPerUnit: 1    },
  house_blend:          { label: "House Blend",          category: "liter", concentrate: "houseBlend", litersPerUnit: 1    },
  colombia_liter:       { label: "Colombia",             category: "liter", concentrate: "colombia",   litersPerUnit: 1    },
  decaf_liter:          { label: "Decaf",                category: "liter", concentrate: "decaf",      litersPerUnit: 1    },
  classic_mini:         { label: "Classic Mini",         category: "mini",  concentrate: "classic",    litersPerUnit: 0.25 },
  house_blend_mini:     { label: "House Blend Mini",     category: "mini",  concentrate: "houseBlend", litersPerUnit: 0.25 },
  vanilla_mini:         { label: "Vanilla Mini",         category: "mini",  concentrate: "classic",    litersPerUnit: 0.25 },
  original_mini:        { label: "Original Mini",        category: "mini",  concentrate: "classic",    litersPerUnit: 0.25 },
  caramel_mini:         { label: "Caramel Mini",         category: "mini",  concentrate: "classic",    litersPerUnit: 0.25 },
  jerry_can:            { label: "Jerry Can Classic",    category: "jerry", concentrate: "classic",    litersPerUnit: 5    },
  jerry_can_houseblend: { label: "Jerry Can House Blend",category: "jerry", concentrate: "houseBlend", litersPerUnit: 5    },
  jerry_can_colombia:   { label: "Jerry Can Colombia",   category: "jerry", concentrate: "colombia",   litersPerUnit: 5    },
  jerry_can_decaf:      { label: "Jerry Can Decaf",      category: "jerry", concentrate: "decaf",      litersPerUnit: 5    },
  vanilla_syrup:        { label: "Vanilla Syrup",        category: "syrup", concentrate: null,         litersPerUnit: 0    },
  caramel_syrup:        { label: "Caramel Syrup",        category: "syrup", concentrate: null,         litersPerUnit: 0    },
  sugar_syrup:          { label: "Sugar Syrup",          category: "syrup", concentrate: null,         litersPerUnit: 0    },
  dispenser:            { label: "Dispenser",            category: "dispenser", concentrate: null,      litersPerUnit: 0    },
};
const STORES = [
  { name: "Good Store",          phone: "972586876066" },
  { name: "Arzei Market",        phone: "972547726223" },
  { name: "Yossi's",             phone: null           },
  { name: "French Hill",         phone: "972506818906" },
  { name: "Rova Market",         phone: "972544520080" },
  { name: "Nemirovs",            phone: "972527601939" },
  { name: "Mini Machaneyu",      phone: "972525685107" },
  { name: "Shevach Fruit Store", phone: "972555516184" },
  { name: "Birkat Sanhedria",    phone: "972524623409" },
];
const LOW_STOCK = { liter: { warn: 12, critical: 6 }, mini: { warn: 20, critical: 10 }, jerry: { warn: 3, critical: 1 } };
const CASES = {
  default:           { label: "Default Case",        qtys: { classic_liter: 6, sweetened_classic: 2, house_blend: 2, colombia_liter: 2 } },
  classic:           { label: "Case of Classic",     qtys: { classic_liter: 12 } },
  sweetened_classic: { label: "Case of Sweetened",   qtys: { sweetened_classic: 12 } },
  house_blend:       { label: "Case of House Blend", qtys: { house_blend: 12 } },
  colombia:          { label: "Case of Colombia",    qtys: { colombia_liter: 12 } },
  decaf:             { label: "Case of Decaf",       qtys: { decaf_liter: 12 } },
};
const NO_ALERT_PRODUCTS = ["decaf_liter", "jerry_can_decaf", "classic_mini", "house_blend_mini"];
const BEAN_TYPES = {
  classic:    { label: "Classic (Dark Roast)",  warnKg: 9  },
  houseBlend: { label: "House Blend",            warnKg: 3  },
  colombia:   { label: "Colombia (Light Roast)", warnKg: 3  },
  decaf:      { label: "Decaf",                  warnKg: 1  },
};
const LOW_CONC = { warn: 10, critical: 5 };
const LABELED_PRODUCTS = ["classic_liter", "sweetened_classic", "house_blend", "colombia_liter", "vanilla_mini", "original_mini", "caramel_mini", "classic_mini", "house_blend_mini"];
const LABELED_WARN = { classic_liter: 30, sweetened_classic: 25, house_blend: 20, colombia_liter: 20, vanilla_mini: 80, original_mini: 80, caramel_mini: 100, classic_mini: null, house_blend_mini: null };
const MINI_PRODUCTS = ["vanilla_mini", "original_mini", "caramel_mini"];
function getProductRatio(pid, concType) {
  return MINI_PRODUCTS.includes(pid) ? 0.29 : CONCENTRATE_TYPES[concType]?.ratio || 0.44;
}
const WEBSITE_NAME_TO_OPS = [
  [/sweetened.*classic|classic.*sweet/i, "sweetened_classic"],
  [/house blend mini/i, "house_blend_mini"],
  [/classic mini/i, "classic_mini"],
  [/vanilla mini/i, "vanilla_mini"],
  [/original mini/i, "original_mini"],
  [/caramel mini/i, "caramel_mini"],
  [/jerry.*house|house.*jerry/i, "jerry_can_houseblend"],
  [/jerry.*colombia|colombia.*jerry/i, "jerry_can_colombia"],
  [/jerry.*decaf|decaf.*jerry/i, "jerry_can_decaf"],
  [/jerry/i, "jerry_can"],
  [/house blend/i, "house_blend"],
  [/colombia/i, "colombia_liter"],
  [/decaf/i, "decaf_liter"],
  [/vanilla syrup/i, "vanilla_syrup"],
  [/caramel syrup/i, "caramel_syrup"],
  [/sugar syrup/i, "sugar_syrup"],
  [/classic/i, "classic_liter"],
];
function mapWebsiteItemToOpsProduct(item) {
  if (item?.product_id && PRODUCTS[item.product_id]) return item.product_id;
  const name = String(item?.name_en || item?.name_he || "").toLowerCase();
  for (const [re, pid] of WEBSITE_NAME_TO_OPS) {
    if (re.test(name)) return pid;
  }
  return null;
}
function websiteItemsToQuantities(items) {
  const qty = {};
  (items || []).forEach((item) => {
    const pid = mapWebsiteItemToOpsProduct(item);
    if (!pid) return;
    qty[pid] = (qty[pid] || 0) + (Number(item.qty) || 1);
  });
  return qty;
}
async function sbLoadPendingWebDeliveries() {
  const rows = await sbFetch("pending_website_deliveries?status=eq.pending_schedule&select=*&order=created_at.asc");
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const ids = [...new Set(rows.map(r => r.order_id).filter(Boolean))];
  if (!ids.length) return rows;
  const orders = await sbFetch(`orders?id=in.(${ids.join(",")})&select=id,payment_status`);
  const payMap = {};
  (orders || []).forEach(o => { payMap[o.id] = o.payment_status; });
  return rows.map(r => ({ ...r, payment_status: payMap[r.order_id] || null }));
}
const JERRY_PRODUCTS = ["jerry_can", "jerry_can_houseblend", "jerry_can_colombia", "jerry_can_decaf"];
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function tomorrowISO() {
  const d = new Date(); d.setDate(d.getDate()+1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function isJobOverdue(job) {
  if (job.done) return false;
  const today = todayISO();
  if (job.date < today) return true;
  if (job.date === today && job.time) {
    const parts = String(job.time).split(":");
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!isNaN(h) && !isNaN(m)) {
      const now = new Date();
      return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
    }
  }
  return false;
}
function formatDate(iso) {
  if (!iso || iso === "undefined" || iso === "Invalid Date") return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IL", { weekday: "short", month: "short", day: "numeric" });
}
function formatTime(t) {
  if (!t) return "";
  if (typeof t === "string" && t.includes("T")) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      return `${d.getUTCHours().toString().padStart(2,"0")}:${d.getUTCMinutes().toString().padStart(2,"0")}`;
    }
  }
  return t;
}
function monthDates(year, month) {
  const days = [], d = new Date(year, month, 1);
  while (d.getMonth() === month) { days.push(new Date(d)); d.setDate(d.getDate()+1); }
  return days;
}
function concentrateNeeded(jobs, inventory, concentrate) {
  const n = { classic: 0, houseBlend: 0, colombia: 0, decaf: 0 };
  const remainingStock = { ...inventory };
  const remainingConc  = { ...concentrate };
  const sorted = [...jobs].filter(j => !j.done).sort((a,b) => a.date.localeCompare(b.date));
  sorted.forEach(j => {
    if (j.type === "bottling" && PRODUCTS[j.product]?.concentrate) {
      const concType = PRODUCTS[j.product].concentrate;
      const ratio = getProductRatio(j.product, concType);
      const concRequired = (j.liters||0)*ratio;
      const concAvailable = remainingConc[concType]||0;
      n[concType] += Math.max(0, concRequired-concAvailable);
      remainingConc[concType] = Math.max(0, concAvailable-concRequired);
    }
    if (j.type === "delivery") {
      Object.entries(j.quantities||{}).forEach(([pid,qty]) => {
        if (!PRODUCTS[pid]?.concentrate||!qty) return;
        const concType = PRODUCTS[pid].concentrate;
        const ratio = getProductRatio(pid, concType);
        const inStock = remainingStock[pid]||0;
        const stockGap = Math.max(0, qty-inStock);
        remainingStock[pid] = Math.max(0, inStock-qty);
        n[concType] += PRODUCTS[pid].litersPerUnit*stockGap*ratio;
      });
      if (j.deliveryType === "coffeebar") {
        const canCount = Math.floor((j.people||0)/25);
        const cans = j.jerryCans||Array(canCount).fill("classic");
        const jerryMap = { classic:"jerry_can", houseBlend:"jerry_can_houseblend", colombia:"jerry_can_colombia", decaf:"jerry_can_decaf" };
        cans.forEach(concType => {
          if (!CONCENTRATE_TYPES[concType]) return;
          const pid = jerryMap[concType]||"jerry_can";
          const inStock = remainingStock[pid]||0;
          if (inStock>0) { remainingStock[pid]=Math.max(0,inStock-1); return; }
          const ratio = CONCENTRATE_TYPES[concType].ratio;
          const concAvailable = remainingConc[concType]||0;
          const concRequired = 5*ratio;
          n[concType] = (n[concType]||0)+Math.max(0,concRequired-concAvailable);
          remainingConc[concType] = Math.max(0, concAvailable-concRequired);
        });
      }
    }
  });
  return n;
}
function generateWAMessage(store, job) {
  const dateStr = new Date().toLocaleDateString("he-IL",{day:"2-digit",month:"2-digit",year:"numeric"});
  const large = Object.entries(job.quantities||{}).filter(([p])=>PRODUCTS[p]?.category==="liter").reduce((s,[,q])=>s+(q||0),0);
  const mini  = Object.entries(job.quantities||{}).filter(([p])=>PRODUCTS[p]?.category==="mini" ).reduce((s,[,q])=>s+(q||0),0);
  const syrup = Object.entries(job.quantities||{}).filter(([p])=>PRODUCTS[p]?.category==="syrup").reduce((s,[,q])=>s+(q||0),0);
  const total = large+mini+syrup;
  const lines = [`תעודת משלוח - גרמיר קפה`,`תאריך: ${dateStr}`,`לכבוד: ${store.name}`,`----------------------------`];
  if (large>0) lines.push(`בקבוק גדול: ${large} יחידות`);
  if (mini>0)  lines.push(`בקבוק קטן: ${mini} יחידות`);
  if (syrup>0) lines.push(`סירופ: ${syrup} יחידות`);
  lines.push(`----------------------------`,`סה"כ: ${total} יחידות`,`תודה! גרמיר קפה`);
  return lines.join("\n");
}
async function fetchSmartAlerts(jobs, inventory, concentrate, beans, labeledStock) {
  const today = todayISO();
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeeksAgoISO = `${fourWeeksAgo.getFullYear()}-${String(fourWeeksAgo.getMonth()+1).padStart(2,"0")}-${String(fourWeeksAgo.getDate()).padStart(2,"0")}`;
  const recentCompleted = jobs.filter(j => j.done && j.date >= fourWeeksAgoISO);
  const upcoming = jobs.filter(j => !j.done && j.date >= today);
  const snapshot = {
    today,
    inventory,
    concentrate,
    beans,
    labeledStock,
    upcomingJobs: upcoming,
    recentHistory: recentCompleted,
  };
  try {
    const { default: Anthropic } = await import("https://esm.sh/@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, dangerouslyAllowBrowser: true });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: `You are the operations assistant for Gremier Coffee, a small cold brew coffee company.
You will receive a snapshot of the business state including current inventory, concentrate levels, bean stock, upcoming scheduled jobs, and recent completed job history.
Your job is to return 1-3 alerts for the owner about what needs attention TODAY.
Rules:
- Max 12 words per alert. Be blunt. No sentences, just the point.
- Good example: "Classic low — bottle today before Thursday delivery."
- Bad example: "Today's deliveries require 6 house_blend but you only have 6 in stock (0 labeled)..."
- The "inventory" stock count IS the ready stock. Do NOT treat labeled stock as a separate requirement — labeled bottles are just pre-labeled inventory, not additional stock needed.
- Consider: stock vs upcoming deliveries, brewing lead time (22h classic, 18h others), bean levels.
- Priority 1: anything urgent for TODAY — stock gaps, timing issues, things that need action now.
- Priority 2: if nothing urgent today, look ahead at the next 3-5 days and flag anything worth planning for.
- If truly nothing to flag, return an empty array.
Be specific and practical. Connect the dots — don't just say "stock is low", say WHY it matters and WHAT to do.
Consider: upcoming deliveries vs current stock, brewing lead time (22h for classic, 18h for others), bean levels, labeling needs, trends in recent history.
If everything looks fine, return an empty array.
Respond ONLY with a JSON array like:
[
  { "level": "critical" | "warning" | "info", "msg": "short actionable alert" }
]
No explanation, no markdown.`,
      messages: [{ role: "user", content: JSON.stringify(snapshot) }],
    });
    const raw = message.content?.[0]?.text || "[]";
    const clean = raw.replace(/```json|```/g, "").trim();
    const alerts = JSON.parse(clean);
    localStorage.setItem("gremier_alert_date", today);
    localStorage.setItem("gremier_alert_cache", JSON.stringify(alerts));
    return alerts;
  } catch (err) {
    console.error("Smart alert error:", err);
    return [];
  }
}
// ─── TEXT INPUT FOR CHAT ──────────────────────────────────────────────────
function TextInput({ onSend, disabled, onFocus, inputRef }) {
  const [value, setValue] = React.useState("");
  function submit() {
    const t = value.trim();
    if (!t || disabled) return;
    setValue("");
    onSend(t);
  }
  return (
    <div style={{ display:"flex", flex:1, alignItems:"center", background:"#F2F2F2", borderRadius:22, padding:"0 6px 0 14px", gap:4 }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        onFocus={() => onFocus?.()}
        placeholder="Type a message..."
        inputMode="text"
        enterKeyHint="send"
        autoComplete="off"
        style={{ flex:1, background:"none", border:"none", outline:"none", fontSize:16, color:"#1A1A1A", padding:"10px 0" }}
      />
      <button onClick={submit} disabled={disabled || !value.trim()} style={{
        width:32, height:32, borderRadius:"50%", background: value.trim() && !disabled ? "#101010" : "#D0D0D0",
        border:"none", color:"#fff", fontSize:16, cursor: value.trim() && !disabled ? "pointer" : "default",
        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, transition:"background 0.15s",
      }}>↑</button>
    </div>
  );
}
const PENDING_FIELD = {
  width:"100%", padding:"10px 12px", fontSize:16, color:"#1A1A1A",
  background:"#FAFAFA", border:"1.5px solid #D0D0D0", borderRadius:10,
  outline:"none", boxSizing:"border-box", WebkitAppearance:"none",
};
function PendingField({ label, value, onChange, onActivate, placeholder, inputMode = "text" }) {
  return (
    <label style={{ display:"block", marginTop:8 }}>
      <span style={{ fontSize:11, fontWeight:600, color:"#666", textTransform:"uppercase", letterSpacing:"0.04em" }}>{label}</span>
      <input
        type="text"
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        onFocus={onActivate}
        onClick={onActivate}
        placeholder={placeholder}
        inputMode={inputMode}
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        style={PENDING_FIELD}
      />
    </label>
  );
}
// ─── VOICE LOGGER COMPONENT ───────────────────────────────────────────────
function VoiceLogger({ onAddJob, jobs, beans, inventory, concentrate, labeledStock, onMarkPaid, onMarkBilled, onCheckoff, onConfirmCheckoff, onDeliverBeans }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [phase, setPhase] = React.useState("idle"); // idle | listening | thinking | done
  const [messages, setMessages] = React.useState([]); // [{role:"user"|"assistant", text, option}]
  const [pendingOption, setPendingOption] = React.useState(null);
  const [errorMsg, setErrorMsg] = React.useState("");
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);
  const messagesEndRef = React.useRef(null);
  const chatInputRef = React.useRef(null);
  if (!onAddJob) return null;
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingOption]);
  React.useEffect(() => {
    if (!pendingOption) return;
    window.speechSynthesis?.cancel();
    stopListening();
    setPhase("done");
    chatInputRef.current?.blur();
  }, [pendingOption]);
  function activatePendingEdit() {
    window.speechSynthesis?.cancel();
    stopListening();
    setPhase("done");
    chatInputRef.current?.blur();
  }
  function patchPendingOption(fn) {
    setPendingOption(prev => (prev ? fn(prev) : prev));
  }
  function setPendingLabel(val) {
    patchPendingOption(p => ({ ...p, option: { ...p.option, label: val } }));
  }
  function setPendingJobField(field, val) {
    patchPendingOption(p => ({
      ...p,
      option: {
        ...p.option,
        job: p.option.job ? { ...p.option.job, [field]: val } : p.option.job,
      },
    }));
  }
  function setPendingPatchField(field, val) {
    patchPendingOption(p => ({
      ...p,
      option: {
        ...p.option,
        patch: { ...(p.option.patch || {}), [field]: val },
      },
    }));
  }
  function openChat() {
    setIsOpen(true);
    setMessages([]);
    setPendingOption(null);
    setErrorMsg("");
    // Start listening immediately when chat opens
    setTimeout(() => startListening(), 100);
  }
  function closeChat() {
    window.speechSynthesis?.cancel();
    stopListening();
    setIsOpen(false);
    setPhase("idle");
    setMessages([]);
    setPendingOption(null);
    setErrorMsg("");
  }
  function stopListening() {
    try { mediaRecorderRef.current?.stop(); } catch (e) {}
  }
  function handleMicTap() {
    if (pendingOption) return;
    if (phase === "listening") {
      stopListening();
    } else if (phase === "idle" || phase === "done") {
      setErrorMsg("");
      setPendingOption(null);
      startListening();
    }
  }
  async function startListening() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPhase("listening");
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (audioChunksRef.current.length === 0) { setPhase("idle"); return; }
        setPhase("thinking");
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await transcribeAndProcess(audioBlob, mimeType);
      };
      recorder.onerror = () => { setPhase("idle"); setErrorMsg("Mic error. Try again."); };
      recorder.start();
    } catch (e) {
      setPhase("idle");
      setErrorMsg("Mic access denied.");
    }
  }
  async function transcribeAndProcess(audioBlob, mimeType) {
    try {
      const ext = mimeType.includes("mp4") ? "mp4" : "webm";
      const formData = new FormData();
      formData.append("file", audioBlob, `recording.${ext}`);
      formData.append("model", "whisper-1");
      formData.append("language", "en");
      const sttPrompt = `Gremier Coffee cold brew operations. Stores: ${STORES.map(s=>s.name).join(", ")}. Products: ${Object.values(PRODUCTS).map(p=>p.label).join(", ")}. Terms: classic, house blend, colombia, decaf, concentrate, brew, drain, bottle, label, jerry can, dispenser, coffee bar, delivery, schedule, paid, billed, kilo, liter, case.`;
      formData.append("prompt", sttPrompt);
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const text = data.text?.trim();
      if (!text) { setPhase("idle"); setErrorMsg("Couldn't hear anything."); return; }
      setMessages(prev => [...prev, { role: "user", text }]);
      await parseIntent(text);
    } catch (err) {
      setPhase("idle");
      setErrorMsg("Transcription error: " + err.message);
    }
  }
  async function parseIntent(text) {
    const today = todayISO();
    const tomorrow = tomorrowISO();
    const pendingJobs = jobs.filter(j => !j.done).slice(0, 40).map(j => ({
      id: j.id, type: j.type, date: j.date, time: j.time, storeName: j.storeName,
      privateName: j.privateName, privateAddress: j.privateAddress, cbName: j.cbName,
      cbAddress: j.cbAddress, deliveryType: j.deliveryType, quantities: j.quantities,
      people: j.people, product: j.product, kg: j.kg, liters: j.liters,
      label: j.label, billed: j.billed, paid: j.paid, brewStarted: j.brewStarted,
    }));
    const unpaidJobs = jobs.filter(j => j.done && (j.deliveryType === "private" || j.deliveryType === "coffeebar") && !j.paid).slice(0, 20).map(j => ({
      id: j.id, type: j.type, date: j.date, privateName: j.privateName,
      cbName: j.cbName, deliveryType: j.deliveryType, billed: j.billed, label: j.label,
    }));
    const systemPrompt = `You are the voice assistant for Gremier Coffee, a small cold brew coffee company in Jerusalem.
You are in an ONGOING CONVERSATION with the owner. The messages before this are real context — ALWAYS use them. If you previously asked a question and the owner is now answering (e.g. "just happened", "house blend", "yes", "Good Store"), COMBINE their answer with what they originally said and produce the final action. NEVER discard the original request or start over.
The owner speaks naturally — no special prefixes. Figure out what they want and do it.
TODAY: ${today}  TOMORROW: ${tomorrow}

CURRENT STATE:
Inventory (bottles ready): ${JSON.stringify(inventory||{})}
Concentrate (liters): ${JSON.stringify(concentrate||{})}
Beans (kg): ${JSON.stringify(Object.fromEntries(Object.entries(beans||{}).map(([k,v])=>[k,v.kg])))}
Labeled stock: ${JSON.stringify(labeledStock||{})}
PRODUCTS (key="label"): ${Object.entries(PRODUCTS).map(([k,v])=>`"${k}"="${v.label}"`).join(", ")}
STORES: ${STORES.map(s=>s.name).join(", ")}
CONCENTRATE TYPES: classic, houseBlend, colombia, decaf
PENDING JOBS (not yet done): ${JSON.stringify(pendingJobs)}
UNPAID DELIVERED JOBS: ${JSON.stringify(unpaidJobs)}
ORDERED BEANS (awaiting delivery): ${JSON.stringify(Object.entries(beans||{}).filter(([,v])=>v.ordered).map(([k,v])=>({type:k,orderedKg:v.orderedKg})))}

PICK EXACTLY ONE INTENT:
1. log — something ALREADY happened (delivered, brewed, bottled, labeled, received stock). Set done=true, date=today unless another date is stated.
2. schedule — planning something for LATER. Set done=false; use the stated date, or ask if none given.
3. mark — change the status of an existing job from PENDING/UNPAID lists. actions: "checkoff" (mark delivered/done), "mark_paid", "mark_billed", "brew_started", "beans_delivered".
4. edit — change the CONTENT of an existing job (address, quantities, date, time, name, people, jerryCans, dispensers, cbSyrups, kg, liters, label). Match the job from PENDING JOBS; return its jobId and a patch with ONLY the changed fields.
5. ask — a question about stock, inventory, what to make, planning, or business state. Answer directly from CURRENT STATE. Be specific and practical.
6. stock_adjust — added syrups/dispensers directly to stock. adjustments: { product_key: qty }.
7. stock_receive — received/bought products or beans. adjustments for products, beanAdjustments for beans { classic|houseBlend|colombia|decaf: kg }.
8. clarify — key info is missing OR there are multiple plausible interpretations. Ask ONE short question with choices.
9. unknown — you genuinely cannot tell what they mean.

DECIDING log vs schedule: if not clearly one, return clarify with choices ["Just happened","Schedule for later"]. Do NOT default to log/today.

JOB OBJECT SHAPES:
- delivery store: { type:"delivery", deliveryType:"store", storeName, quantities:{product_key:qty}, done, date }
- delivery private: { type:"delivery", deliveryType:"private", privateName, privateAddress, quantities, done, date }
- delivery coffeebar: { type:"delivery", deliveryType:"coffeebar", cbName, people, jerryCans:["classic",...], dispensers, cbSyrups:{}, done, date }
- brew: { type:"brew", product:"classic"|"houseBlend"|"colombia"|"decaf", kg:1|1.5|2|3, done, date }
- bottling: { type:"bottling", product:product_key, liters:number, done, date }
- labeling: { type:"labeling", product:product_key, qty:number, done, date }
- drain: { type:"drain", product:"classic"|"houseBlend"|"colombia"|"decaf", kg:number, done, date }

SHORTCUTS:
- "default case" = { classic_liter:6, sweetened_classic:2, house_blend:2, colombia_liter:2 }
- "classic case" = { classic_liter:12 }
- Auto-correct slightly wrong/misheard store and product names to the closest real one.

RESPONSE — return ONLY a JSON object (no markdown, no prose), matching one of these:
log/schedule (confident): { "intent":"log"|"schedule", "reply":"short friendly confirmation e.g. Got it — logging delivery to Good Store, 6 classic.", "option":{ "label":"...", "job":{...} } }
mark (confident single match): { "intent":"mark", "reply":"short confirmation", "option":{ "label":"...", "action":"checkoff"|"mark_paid"|"mark_billed"|"brew_started"|"beans_delivered", "jobId":"id", "beanType":"classic"|"houseBlend"|"colombia"|"decaf" } }
edit: { "intent":"edit", "reply":"short confirmation e.g. Got it — adding the address to French Hill delivery.", "option":{ "label":"...", "jobId":"id", "patch":{ ...only changed fields... } } }
ask: { "intent":"ask", "reply":"your answer, specific and practical." }
stock_adjust/stock_receive: { "intent":"stock_adjust"|"stock_receive", "reply":"short confirmation", "option":{ "label":"...", "adjustments":{}, "beanAdjustments":{} } }
clarify (incl. "which job did you mean?"): { "intent":"clarify", "reply":"one short question", "choices":["Good Store Jun 2","French Hill Jun 3"] }
unknown: { "intent":"unknown", "reply":"I didn't catch that. Could you say it again?" }

CHOICES RULE: whenever your reply is a question, a yes/no, an either/or, or there are multiple matching jobs — ALWAYS include a "choices" array of short tappable labels (e.g. ["Yes","No"], ["Classic","House Blend"], ["Just happened","Schedule for later"]). Never make the owner type when a button would do.
Keep replies short — 1-2 sentences, conversational, not robotic.`;
    try {
      const history = messages
        .filter(m => m.text && m.text !== "⋯")
        .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.text }));
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 600,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: text }],
        }),
      });
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || "";
      let obj;
      try { obj = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
      catch { setMessages(prev=>[...prev,{role:"assistant",text:"Sorry, I had trouble understanding that. Try again."}]); setPhase("idle"); return; }
      const reply = obj.reply || "Done.";
      const choices = obj.choices || null; // tappable response buttons
      if (obj.intent === "ask" || obj.intent === "unknown") {
        setMessages(prev => [...prev, { role: "assistant", text: reply, choices }]);
        setPhase("done");
      } else if (obj.intent === "clarify") {
        // Store context so the next tap/type knows what was being clarified
        setMessages(prev => [...prev, { role: "assistant", text: reply, choices }]);
        setPhase("done");
      } else if (obj.option) {
        setMessages(prev => [...prev, { role: "assistant", text: reply, option: obj.option, intent: obj.intent, choices }]);
        setPendingOption({ option: obj.option, intent: obj.intent });
        stopListening();
        setPhase("done");
        // For edit: also show confirm/cancel (handled by existing pendingOption UI)
      } else {
        setMessages(prev => [...prev, { role: "assistant", text: reply, choices }]);
        setPhase("done");
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", text: "API error. Try again." }]);
      setPhase("idle");
    }
  }
  function speakText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.35;
    u.pitch = 0.95;
    // Pick best available American English male voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = [
      "Google US English", // Chrome desktop
      "Alex",              // macOS
      "Aaron",             // macOS Monterey+
      "Nicky",             // macOS
      "Fred",              // macOS fallback
    ];
    let chosen = null;
    for (const name of preferred) {
      chosen = voices.find(v => v.name === name);
      if (chosen) break;
    }
    // Fallback: any en-US male-sounding voice
    if (!chosen) {
      chosen = voices.find(v => v.lang === "en-US" && /male/i.test(v.name));
    }
    // Fallback: any en-US voice
    if (!chosen) {
      chosen = voices.find(v => v.lang === "en-US");
    }
    if (chosen) u.voice = chosen;
    window.speechSynthesis.speak(u);
  }
  async function confirmOption() {
    if (!pendingOption) return;
    const { option, intent } = pendingOption;
    setPendingOption(null);
    setPhase("idle");
    if (intent === "mark") {
      const job = option.action !== "beans_delivered" ? jobs.find(j => j.id === option.jobId) : null;
      if (!job && option.action !== "beans_delivered") { setErrorMsg("Couldn't find that job."); return; }
      if (option.action === "mark_paid") await onMarkPaid(job.id);
      else if (option.action === "mark_billed") await onMarkBilled(job.id);
      else if (option.action === "checkoff") onCheckoff(job);
      else if (option.action === "brew_started") onCheckoff(job);
      else if (option.action === "beans_delivered" && onDeliverBeans) await onDeliverBeans(option.beanType);
      setMessages(prev => [...prev, { role: "assistant", text: "✓ Done!" }]);
      return;
    }
    if (intent === "stock_adjust") {
      await Promise.all(Object.entries(option.adjustments || {}).map(([pid, qty]) =>
        qty > 0 ? sbIncrementInventory(pid, qty) : Promise.resolve()
      ));
      setMessages(prev => [...prev, { role: "assistant", text: "✓ Stock updated." }]);
      return;
    }
    if (intent === "stock_receive") {
      await Promise.all([
        ...Object.entries(option.adjustments || {}).map(([pid, qty]) =>
          qty > 0 ? sbIncrementInventory(pid, qty) : Promise.resolve()
        ),
        ...Object.entries(option.beanAdjustments || {}).map(([type, kg]) =>
          kg > 0 ? sbFetch(`beans?type=eq.${type}`, {
            method: "PATCH", prefer: "return=minimal",
            body: JSON.stringify({ kg: parseFloat(((beans?.[type]?.kg || 0) + kg).toFixed(1)) })
          }) : Promise.resolve()
        ),
      ]);
      setMessages(prev => [...prev, { role: "assistant", text: "✓ Stock received." }]);
      return;
    }
    if (intent === "edit") {
      // Find the job and merge the patch
      const existingJob = jobs.find(j => j.id === option.jobId);
      if (!existingJob) { setErrorMsg("Couldn't find that job."); return; }
      const updatedJob = { ...existingJob, ...option.patch };
      // Rebuild label if storeName/privateName/cbName changed
      if (option.patch.storeName || option.patch.privateName || option.patch.cbName) {
        updatedJob.label = updatedJob.label; // keep existing label, updateJob handles persistence
      }
      await sbFetch(`jobs?id=eq.${option.jobId}`, {
        method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify(jobToRow(updatedJob))
      });
      setMessages(prev => [...prev, { role: "assistant", text: "✓ Updated!" }]);
      return;
    }
    // log or schedule — route through addJob
    const job = option.job;
    if (!job) return;
    const withLabel = option.label ? { ...job, label: option.label } : job;
    if (withLabel.type === "brew") {
      onAddJob({ ...withLabel, done: false, brewStarted: false });
    } else {
      onAddJob(withLabel);
    }
    setMessages(prev => [...prev, { role: "assistant", text: "✓ Saved!" }]);
  }
  function cancelOption() {
    setPendingOption(null);
    setMessages(prev => [...prev, { role: "assistant", text: "No problem, cancelled." }]);
    setPhase("idle");
  }
  const intentColor = (intent) => {
    if (intent === "log") return "#2E8B57";
    if (intent === "schedule") return "#4A90D9";
    if (intent === "mark") return "#101010";
    if (intent === "edit") return "#9B6FC8";
    if (intent === "stock_adjust" || intent === "stock_receive") return "#E8821A";
    return "#101010";
  };
  const intentLabel = (intent) => {
    if (intent === "log") return "Log Now";
    if (intent === "schedule") return "Schedule";
    if (intent === "mark") return "Update";
    if (intent === "edit") return "Save Edit";
    if (intent === "stock_adjust") return "Add Stock";
    if (intent === "stock_receive") return "Receive Stock";
    return "Confirm";
  };
  return (
    <>
      <style>{`
        @keyframes micPulse {
          0%,100% { box-shadow: 0 0 0 0px #E5393566, 0 4px 16px #00000044; transform: scale(1); }
          50% { box-shadow: 0 0 0 14px #E5393522, 0 4px 16px #00000044; transform: scale(1.08); }
        }
        @keyframes micThink {
          0%,100% { box-shadow: 0 0 0 0px #4A90D966, 0 4px 16px #00000044; }
          50% { box-shadow: 0 0 0 10px #4A90D922, 0 4px 16px #00000044; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .vc-msg { animation: fadeIn 0.18s ease; }
      `}</style>
      {/* Backdrop when chat is open */}
      {isOpen && (
        <div onClick={closeChat} style={{ position:"fixed", inset:0, zIndex:198, background:"#00000055" }}/>
      )}
      {/* Floating mic button — opens chat and starts listening immediately */}
      {!isOpen && (
        <button onClick={openChat} style={{
          position:"fixed", bottom:108, right:14,
          width:44, height:44, borderRadius:"50%", background:"#101010",
          color:"#fff", border:"none", fontSize:18, cursor:"pointer", zIndex:199,
          display:"flex", alignItems:"center", justifyContent:"center",
          boxShadow:"0 4px 16px #00000044", transition:"background 0.2s ease",
        }}>🎙</button>
      )}
      {/* Chat panel */}
      {isOpen && (
        <div onClick={e => e.stopPropagation()} style={{
          position:"fixed", bottom:0, left:0, right:0, zIndex:199,
          background:"#FFFFFF", borderRadius:"20px 20px 0 0",
          boxShadow:"0 -4px 30px #00000022",
          animation:"slideUp 0.22s ease",
          display:"flex", flexDirection:"column",
          maxHeight:"72vh",
        }}>
          {/* Header */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 18px 10px", borderBottom:"1px solid #F0F0F0", flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:700, color:"#101010", letterSpacing:0.5 }}>☕ Gremier Assistant</div>
            <button onClick={closeChat} style={{ background:"none", border:"none", color:"#AAAAAA", fontSize:20, cursor:"pointer", lineHeight:1 }}>✕</button>
          </div>
          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"12px 16px", display:"flex", flexDirection:"column", gap:10 }}>
            {messages.map((msg, i) => (
              <div key={i} className="vc-msg" style={{ display:"flex", flexDirection:"column", alignItems: msg.role==="user" ? "flex-end" : "flex-start" }}>
                <div style={{ display:"flex", alignItems:"flex-end", gap:6, maxWidth:"90%" }}>
                  <div style={{
                    padding:"9px 13px", borderRadius: msg.role==="user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: msg.role==="user" ? "#101010" : "#F2F2F2",
                    color: msg.role==="user" ? "#fff" : "#1A1A1A",
                    fontSize:14, lineHeight:1.5, flex:1,
                  }}>
                    {msg.text}
                  </div>
                  {msg.role==="assistant" && msg.text && msg.text !== "⋯" && (
                    <button onClick={()=>{
                      speakText(msg.text);
                    }} style={{ background:"none", border:"none", fontSize:16, cursor:"pointer", color:"#BBBBBB", padding:"2px 0", flexShrink:0, lineHeight:1 }} title="Read aloud">🔊</button>
                  )}
                </div>
                {/* Tappable choice buttons (clarify / yes-no / either-or) */}
                {msg.choices && i === messages.length - 1 && (
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:8 }}>
                    {msg.choices.map((choice, ci) => (
                      <button key={ci} onClick={() => {
                        setMessages(prev => [...prev, { role: "user", text: choice }]);
                        setPhase("thinking");
                        parseIntent(choice);
                      }} style={{
                        background:"#F2F2F2", border:"1.5px solid #D0D0D0", borderRadius:20,
                        padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer", color:"#101010",
                        transition:"background 0.15s",
                      }}>{choice}</button>
                    ))}
                  </div>
                )}
                {/* Pending action — edit + confirm live in the pinned bottom panel */}
                {msg.option && pendingOption && i === messages.length - 1 && (
                  <div style={{ fontSize:11, color:"#888", marginTop:6 }}>Tap a field below to edit before confirming</div>
                )}
              </div>
            ))}
            {phase === "thinking" && (
              <div className="vc-msg" style={{ display:"flex", alignItems:"flex-start" }}>
                <div style={{ background:"#F2F2F2", borderRadius:"16px 16px 16px 4px", padding:"10px 14px", fontSize:20, color:"#888" }}>⋯</div>
              </div>
            )}
            <div ref={messagesEndRef}/>
          </div>
          {/* Error */}
          {errorMsg && (
            <div style={{ padding:"6px 16px", fontSize:12, color:"#E53935", textAlign:"center", flexShrink:0 }}>{errorMsg}</div>
          )}
          {/* Bottom bar — pinned confirmation replaces chat input while pending */}
          <div style={{ padding:"10px 12px 28px", flexShrink:0, borderTop:"1px solid #F0F0F0", display:"flex", alignItems:"stretch", gap:10, background:"#fff" }}>
            {pendingOption ? (
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:700, color:intentColor(pendingOption.intent), marginBottom:2 }}>
                  {intentLabel(pendingOption.intent)}
                </div>
                <PendingField
                  label="Summary"
                  value={pendingOption.option.label}
                  onChange={setPendingLabel}
                  onActivate={activatePendingEdit}
                  placeholder="Label / summary"
                />
                {pendingOption.option.job?.type === "delivery" && pendingOption.option.job.deliveryType === "private" && (
                  <>
                    <PendingField label="Recipient" value={pendingOption.option.job.privateName} onChange={v => setPendingJobField("privateName", v)} onActivate={activatePendingEdit} placeholder="Name" />
                    <PendingField label="Address" value={pendingOption.option.job.privateAddress} onChange={v => setPendingJobField("privateAddress", v)} onActivate={activatePendingEdit} placeholder="Delivery address" />
                  </>
                )}
                {pendingOption.option.job?.type === "delivery" && pendingOption.option.job.deliveryType === "store" && (
                  <PendingField label="Store" value={pendingOption.option.job.storeName} onChange={v => setPendingJobField("storeName", v)} onActivate={activatePendingEdit} placeholder="Store name" />
                )}
                {pendingOption.option.job?.type === "delivery" && pendingOption.option.job.deliveryType === "coffeebar" && (
                  <>
                    <PendingField label="Coffee bar" value={pendingOption.option.job.cbName} onChange={v => setPendingJobField("cbName", v)} onActivate={activatePendingEdit} placeholder="Event / venue" />
                    <PendingField label="People" value={pendingOption.option.job.people != null ? String(pendingOption.option.job.people) : ""} onChange={v => setPendingJobField("people", parseInt(v, 10) || 0)} onActivate={activatePendingEdit} placeholder="Guest count" inputMode="numeric" />
                  </>
                )}
                {pendingOption.option.job?.date && (
                  <PendingField label="Date" value={pendingOption.option.job.date} onChange={v => setPendingJobField("date", v)} onActivate={activatePendingEdit} placeholder="YYYY-MM-DD" />
                )}
                {pendingOption.intent === "edit" && pendingOption.option.patch && Object.keys(pendingOption.option.patch).map(k => (
                  <PendingField
                    key={k}
                    label={k.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                    value={pendingOption.option.patch[k] != null ? String(pendingOption.option.patch[k]) : ""}
                    onChange={v => setPendingPatchField(k, v)}
                    onActivate={activatePendingEdit}
                  />
                ))}
                <div style={{ display:"flex", gap:8, marginTop:12 }}>
                  <button onClick={cancelOption} style={{
                    flex:1, background:"#F0F0F0", border:"1px solid #D0D0D0", borderRadius:10,
                    padding:"12px 10px", fontSize:14, fontWeight:600, cursor:"pointer", color:"#555"
                  }}>Cancel</button>
                  <button onClick={confirmOption} style={{
                    flex:2, background:intentColor(pendingOption.intent), border:"none", borderRadius:10,
                    padding:"12px 10px", fontSize:14, fontWeight:700, cursor:"pointer", color:"#fff"
                  }}>{intentLabel(pendingOption.intent)} ✓</button>
                </div>
              </div>
            ) : (
              <>
                <TextInput inputRef={chatInputRef} onSend={text => {
                  if (!text.trim()) return;
                  setMessages(prev => [...prev, { role:"user", text }]);
                  setPhase("thinking");
                  parseIntent(text);
                }} onFocus={() => {
                  if (phase === "listening") stopListening();
                }} disabled={phase==="thinking"} />
                <button onClick={handleMicTap} style={{
                  width:46, height:46, borderRadius:"50%", flexShrink:0, alignSelf:"center",
                  background: phase==="listening" ? "#E53935" : phase==="thinking" ? "#4A90D9" : "#101010",
                  color:"#fff", border:"none", fontSize:20, cursor:"pointer",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  animation: phase==="listening" ? "micPulse 1s infinite" : phase==="thinking" ? "micThink 1s infinite" : "none",
                  transition:"background 0.2s ease",
                  boxShadow:"0 2px 10px #00000033",
                }}>
                  {phase==="thinking" ? "⋯" : phase==="listening" ? "■" : "🎙"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
// ─── END VOICE LOGGER ──────────────────────────────────────────────────────
function GremierLogo({compact=false}) {
  if (compact) {
    return (
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <img src={logoImg} alt="Gremier Coffee" style={{width:44,height:44,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
        <div>
          <div style={{fontSize:17,fontWeight:700,color:"#101010",letterSpacing:2,textTransform:"uppercase",fontFamily:"'Georgia', serif",lineHeight:1.1}}>Gremier Coffee</div>
          <div style={{fontSize:9,color:"#888888",letterSpacing:2.5,textTransform:"uppercase",marginTop:2}}>Operations</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{textAlign:"center",padding:"10px 0 6px"}}>
      <img src={logoImg} alt="Gremier Coffee" style={{width:64,height:64,borderRadius:"50%",objectFit:"cover",marginBottom:8}}/>
      <div style={{fontSize:22,fontWeight:700,color:"#101010",letterSpacing:4,textTransform:"uppercase",fontFamily:"'Georgia', serif"}}>Gremier Coffee</div>
    </div>
  );
}
function RefreshBtn({onRefresh}) {
  const [pressed,setPressed]=React.useState(false);
  return (
    <button onClick={()=>{setPressed(true);onRefresh(false);setTimeout(()=>setPressed(false),300);}}
      style={{background:pressed?"#E8E8E8":"#FAFAFA",border:"1.5px solid #D0D0D0",borderRadius:8,fontSize:18,cursor:"pointer",color:"#101010",padding:"5px 8px",boxShadow:pressed?"none":"0 2px 6px #00000018",transform:pressed?"scale(0.94)":"scale(1)",transition:"all 0.15s ease",lineHeight:1}}
      title="Refresh">↻</button>
  );
}
function LoginScreen({onSignIn}) {
  return (
    <div style={{background:"#FFFFFF",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Georgia', serif"}}>
      <div style={{textAlign:"center",padding:"40px 24px",maxWidth:320,width:"100%"}}>
        <GremierLogo/>
        <div style={{marginTop:32,marginBottom:8,fontSize:13,color:"#555555",letterSpacing:1}}>
          Sign in to continue
        </div>
        <button
          onClick={onSignIn}
          style={{
            display:"flex",alignItems:"center",justifyContent:"center",gap:12,
            width:"100%",padding:"13px 20px",marginTop:16,
            background:"#FFFFFF",color:"#1A1A1A",
            border:"1.5px solid #D0D0D0",borderRadius:10,
            fontSize:15,fontWeight:600,cursor:"pointer",
            boxShadow:"0 2px 8px #00000014",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          Sign in with Google
        </button>
        <div style={{marginTop:20,fontSize:11,color:"#AAAAAA"}}>
          Only authorised accounts can access this app
        </div>
      </div>
    </div>
  );
}
export default function App() {
  const [screen,setScreen]=useState("dashboard");
  const [jobs,setJobs]=useState([]);
  const [inventory,setInventory]=useState({});
  const [concentrate,setConcentrate]=useState({classic:0,houseBlend:0,colombia:0,decaf:0});
  const [beans,setBeans]=useState({classic:{kg:0,ordered:false,orderedKg:0},houseBlend:{kg:0,ordered:false,orderedKg:0},colombia:{kg:0,ordered:false,orderedKg:0},decaf:{kg:0,ordered:false,orderedKg:0}});
  const [labeledStock,setLabeledStock]=useState({});
  const [smartAlerts,setSmartAlerts]=useState([]);
  const [alertDismissed,setAlertDismissed]=useState(false);
  const alertsChecked=React.useRef(false);
  const alertsShownThisSession=React.useRef(false);
  const [waOpen,setWaOpen]=useState(false);
  const [billingOpen,setBillingOpen]=useState(false);
  const [websiteScheduleOpen,setWebsiteScheduleOpen]=useState(false);
  const [pendingWebDeliveries,setPendingWebDeliveries]=useState([]);
  const [prefillWebsiteOrder,setPrefillWebsiteOrder]=useState(null);
  const pendingWebsiteRef=React.useRef(null);
  const [selectedJob,setSelectedJob]=useState(null);
  const [editingJob,setEditingJob]=useState(null);
  const [scheduleMode,setScheduleMode]=useState(null);
  const [checkoffJob,setCheckoffJob]=useState(null);
  const [calDay,setCalDay]=useState(null);
  const [monthView,setMonthView]=useState({year:new Date().getFullYear(),month:new Date().getMonth()});
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const [error,setError]=useState(null);
  // ── AUTH ──
  const [user,setUser]=useState(null);
  const [authLoading,setAuthLoading]=useState(true);
  const isAdmin = ADMIN_EMAILS.includes(user?.email);
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user??null);
      setAuthLoading(false);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user??null);
      setAuthLoading(false);
    });
    return ()=>subscription.unsubscribe();
  },[]);
  async function signInWithGoogle(){
    await supabase.auth.signInWithOAuth({
      provider:"google",
      options:{redirectTo: window.location.origin + '/ops/'},
    });
  }
  async function signOut(){
    await supabase.auth.signOut();
    setUser(null);
  }
  const loadData=useCallback(async(background=false)=>{
    if (!background) setSyncing(true);
    let data = null;
    try {
      data=await sbLoadAll();
      setJobs(data.jobs);
      setInventory(data.inventory);
      setConcentrate(data.concentrate);
      setBeans(data.beans);
      setLabeledStock(data.labeledStock||{});
      setError(null);
      try { localStorage.setItem("gremier_cache",JSON.stringify({...data,cachedAt:Date.now()})); } catch(e){}
    } catch(err) { if (!background) setError(err.message); }
    setLoading(false);
    setSyncing(false);
    if (!background&&!alertsChecked.current&&data&&!sessionStorage.getItem("alerts_dismissed")) {
      alertsChecked.current = true;
      const lastCheck = localStorage.getItem("gremier_alert_date");
      const today = todayISO();
      if (lastCheck === today) {
        const cached = localStorage.getItem("gremier_alert_cache");
        if (cached) { setSmartAlerts(JSON.parse(cached)); setAlertDismissed(false); }
      } else {
        localStorage.setItem("gremier_alert_date", today);
        localStorage.setItem("gremier_alert_cache", "[]");
        fetchSmartAlerts(data.jobs,data.inventory,data.concentrate,data.beans,data.labeledStock).then(alerts=>{
          if (alerts.length>0) {
            setSmartAlerts(alerts);
            setAlertDismissed(false);
            localStorage.setItem("gremier_alert_cache", JSON.stringify(alerts));
          }
        });
      }
    }
  },[]);
  const loadPendingWebDeliveries=useCallback(async()=>{
    if (!ADMIN_EMAILS.includes(user?.email)) return;
    try {
      const rows=await sbLoadPendingWebDeliveries();
      setPendingWebDeliveries(Array.isArray(rows)?rows:[]);
    } catch(e) { console.error("pending web deliveries:", e); }
  },[user?.email]);
  useEffect(()=>{
    if (!user) return;
    loadPendingWebDeliveries();
    const interval=setInterval(loadPendingWebDeliveries,30000);
    const channel=supabase.channel("pending-web-deliveries")
      .on("postgres_changes",{event:"*",schema:"public",table:"pending_website_deliveries"},()=>loadPendingWebDeliveries())
      .subscribe();
    return ()=>{ clearInterval(interval); supabase.removeChannel(channel); };
  },[user,loadPendingWebDeliveries]);
  useEffect(()=>{
    if (!user) return;
    try {
      const cached=localStorage.getItem("gremier_cache");
      if (cached) {
        const d=JSON.parse(cached);
        setJobs(d.jobs||[]);
        setInventory(d.inventory||{});
        setConcentrate(d.concentrate||{classic:0,houseBlend:0,colombia:0,decaf:0});
        setBeans(d.beans||{classic:{kg:0,ordered:false,orderedKg:0},houseBlend:{kg:0,ordered:false,orderedKg:0},colombia:{kg:0,ordered:false,orderedKg:0},decaf:{kg:0,ordered:false,orderedKg:0}});
        setLabeledStock(d.labeledStock||{});
        setLoading(false);
        loadData(false);
        return;
      }
    } catch(e){}
    loadData();
  },[loadData, user]);
  useEffect(()=>{ const interval=setInterval(loadData,15*60*1000); return ()=>clearInterval(interval); },[loadData]);
  const checkoffInProgress=React.useRef(new Set());
  // ─── SINGLE SOURCE OF TRUTH FOR ALL JOB SIDE EFFECTS ────────────────────
  // Called whenever a job transitions to "done" (or "brewing" for brew jobs).
  // All inventory/concentrate/bean/labeled-stock/WA/sheet updates go here.
  // confirmedQtys is only used for deliveries where the user adjusted quantities.
  async function applyJobSideEffects(job, confirmedQtys) {
    const MINI_P = ["vanilla_mini","original_mini","caramel_mini"];
    const JERRY_P = ["jerry_can","jerry_can_houseblend","jerry_can_colombia","jerry_can_decaf"];
    const kgToL = {3:19, 2:12.7, 1.5:9.5, 1:6.4};
    const jerryMap = {classic:"jerry_can",houseBlend:"jerry_can_houseblend",colombia:"jerry_can_colombia",decaf:"jerry_can_decaf"};
    if (job.type==="brew") {
      // Brew started: deduct beans from DB (read fresh to avoid stale state)
      const beanRows = await sbFetch(`beans?type=eq.${job.product}&select=kg`);
      const currentKg = beanRows?.[0]?.kg || 0;
      const newKg = parseFloat(Math.max(0, currentKg - (job.kg||3)).toFixed(1));
      await sbFetch(`beans?type=eq.${job.product}`, {method:"PATCH", prefer:"return=minimal", body:JSON.stringify({kg:newKg})});
      setBeans(p=>({...p,[job.product]:{...(p[job.product]||{}),kg:newKg}}));
      await sbCreateDrain(job);
    }
    if (job.type==="drain") {
      // Drain done: add concentrate, mark the paired brew done
      await sbIncrementConcentrate(job.product, kgToL[job.kg]||19);
      const brews = await sbFetch(`jobs?type=eq.brew&product=eq.${job.product}&brew_started=eq.true&done=eq.false&select=id`);
      if (brews?.length) {
        await sbFetch(`jobs?id=eq.${brews[0].id}`, {method:"PATCH", prefer:"return=minimal", body:JSON.stringify({done:true})});
        setJobs(prev=>prev.map(j=>j.id===brews[0].id?{...j,done:true}:j));
      }
    }
    if (job.type==="bottling") {
      const concType = PRODUCTS[job.product]?.concentrate;
      if (concType) {
        const liters = job.actualQty!=null ? job.actualQty : (job.liters||0);
        const ratio = getProductRatio(job.product, concType);
        await sbIncrementConcentrate(concType, -(liters*ratio));
        const units = MINI_P.includes(job.product) ? Math.round(liters*4)
                    : JERRY_P.includes(job.product) ? Math.round(liters/5)
                    : Math.round(liters);
        await sbIncrementInventory(job.product, units);
      }
      if (job.labeledUsed) {
        for (const [pid,qty] of Object.entries(job.labeledUsed)) {
          if (qty>0) await sbIncrementLabeledStock(pid, -qty);
        }
      }
    }
    if (job.type==="labeling" && LABELED_PRODUCTS.includes(job.product)) {
      await sbIncrementLabeledStock(job.product, job.qty||0);
    }
    if (job.type==="delivery") {
      const qtys = confirmedQtys || job.quantities || {};
      // Deduct inventory sequentially to avoid race conditions
      for (const [pid,qty] of Object.entries(qtys)) {
        if (qty>0) await sbIncrementInventory(pid, -qty);
      }
      if (job.deliveryType==="coffeebar") {
        if (job.dispensers) await sbIncrementInventory("dispenser", -job.dispensers);
        for (const [pid,qty] of Object.entries(job.cbSyrups||{})) {
          if (qty>0) await sbIncrementInventory(pid, -qty);
        }
        const jd={};
        (job.jerryCans||[]).forEach(ct=>{const pid=jerryMap[ct]||"jerry_can";jd[pid]=(jd[pid]||0)+1;});
        for (const [pid,qty] of Object.entries(jd)) {
          await sbIncrementInventory(pid, -qty);
        }
      }
      if (job.deliveryType==="store" && job.storeName) {
        const large = Object.entries(qtys).filter(([p])=>PRODUCTS[p]?.category==="liter").reduce((s,[,q])=>s+(q||0),0);
        const mini  = Object.entries(qtys).filter(([p])=>PRODUCTS[p]?.category==="mini" ).reduce((s,[,q])=>s+(q||0),0);
        const syrup = Object.entries(qtys).filter(([p])=>PRODUCTS[p]?.category==="syrup").reduce((s,[,q])=>s+(q||0),0);
        writeDeliveryToSheet(job.storeName, large, mini, syrup);
        const store = STORES.find(s=>s.name===job.storeName);
        if (store?.phone) {
          await sbFetch(`jobs?id=eq.${job.id}`, {method:"PATCH", prefer:"return=minimal", body:JSON.stringify({wa_needs_send:true})});
          setJobs(prev=>prev.map(j=>j.id===job.id?{...j,waNeedsSend:true}:j));
        }
      }
    }
  }
  // ─── HANDLE CHECKOFF (tap checkbox on existing job) ──────────────────────
  async function handleCheckoff(job) {
    if (!isAdmin) return;
    if (checkoffInProgress.current.has(job.id)) return;
    checkoffInProgress.current.add(job.id);
    try {
      if (job.type==="brew") {
        if (job.brewStarted) {
          // Already brewing — this tap means nothing, drain is the next step
          // (drain job was auto-created; user should tap the drain job)
          return;
        }
        // Start the brew: mark brewStarted, deduct beans, create drain
        setJobs(prev=>prev.map(j=>j.id===job.id?{...j,brewStarted:true}:j));
        try {
          await sbFetch(`jobs?id=eq.${job.id}`, {method:"PATCH", prefer:"return=minimal", body:JSON.stringify({brew_started:true})});
          await applyJobSideEffects(job, null);
        } catch(e) {
          console.error("Brew checkoff error:", e);
        } finally {
          loadData();
        }
      } else if (job.type==="drain") {
        // Complete the drain: add concentrate, mark brew + drain done
        setJobs(prev=>prev.map(j=>j.id===job.id?{...j,done:true}:j));
        let patchOk = false;
        try {
          await sbFetch(`jobs?id=eq.${job.id}`, {method:"PATCH", prefer:"return=minimal", body:JSON.stringify({done:true})});
          patchOk = true;
          await applyJobSideEffects(job, null);
        } catch(e) {
          console.error("Drain checkoff error:", e);
          if (!patchOk) {
            // Revert local state — DB update didn't succeed
            setJobs(prev=>prev.map(j=>j.id===job.id?{...j,done:false}:j));
          }
        } finally {
          loadData();
        }
      } else {
        // Everything else (delivery, bottling, labeling) → open confirmation modal
        setCheckoffJob(job);
      }
    } finally {
      setTimeout(()=>checkoffInProgress.current.delete(job.id), 2000);
    }
  }
  // ─── CONFIRM CHECKOFF (called from CheckoffModal) ────────────────────────
  async function confirmCheckoff(job, actual, confirmedQtys) {
    if (!isAdmin) return;
    setCheckoffJob(null);
    // Merge any confirmed quantities or actualQty back into the job object
    // so applyJobSideEffects sees the right numbers
    const finalJob = {
      ...job,
      done: true,
      actualQty: actual,
      needsConfirmation: false,
      ...(confirmedQtys ? {quantities: confirmedQtys} : {}),
    };
    setJobs(prev=>prev.map(j=>j.id===job.id?finalJob:j));
    await sbFetch(`jobs?id=eq.${job.id}`, {method:"PATCH", prefer:"return=minimal", body:JSON.stringify({done:true, actual_qty:actual})});
    await applyJobSideEffects(finalJob, confirmedQtys);
    loadData();
  }
  // ─── ADD JOB (form Log Now / Schedule, and voice logger) ─────────────────
  async function addJob(jobInput) {
    if (!isAdmin) return;
    const pendingRow=pendingWebsiteRef.current;
    const newJob = {
      ...jobInput,
      id: Date.now()+"_"+Math.random().toString(36).slice(2),
      brewStarted: false,
      done: jobInput.done || false,
    };
    if (newJob.type==="brew") {
      // Brew always saves as brewStarted=true, done=false regardless of Log/Schedule.
      // "Logging" a brew means you're starting it now — the drain is still pending.
      newJob.brewStarted = true;
      newJob.done = false;
      setJobs(prev=>[...prev, newJob]);
      setScreen("dashboard");
      await sbFetch("jobs", {method:"POST", prefer:"return=minimal", body:JSON.stringify(jobToRow(newJob))});
      await applyJobSideEffects(newJob, null);
      loadData(true);
      return;
    }
    if (newJob.done && newJob.type==="delivery") {
      // Save to DB first so confirmCheckoff can patch it, then open modal
      setJobs(prev=>[...prev, newJob]);
      setScreen("dashboard");
      await sbFetch("jobs", {method:"POST", prefer:"return=minimal", body:JSON.stringify(jobToRow(newJob))});
      // Open the confirmation modal — same flow as scheduled→checkoff
      setCheckoffJob(newJob);
      return;
    }
    if (newJob.done && newJob.type==="bottling" && LABELED_PRODUCTS.includes(newJob.product) && !newJob.labeledUsed) {
      // Save to DB first, then open labeled-stock modal
      setJobs(prev=>[...prev, newJob]);
      setScreen("dashboard");
      await sbFetch("jobs", {method:"POST", prefer:"return=minimal", body:JSON.stringify(jobToRow(newJob))});
      setCheckoffJob(newJob);
      return;
    }
    // Everything else: save, apply effects if done, reload
    setJobs(prev=>[...prev, newJob]);
    setScreen("dashboard");
    await sbFetch("jobs", {method:"POST", prefer:"return=minimal", body:JSON.stringify(jobToRow(newJob))});
    if (pendingRow && newJob.type==="delivery" && !newJob.done) {
      await sbFetch(`pending_website_deliveries?id=eq.${pendingRow.id}`, {
        method:"PATCH", prefer:"return=minimal",
        body:JSON.stringify({
          status:"scheduled",
          scheduled_date:newJob.date,
          scheduled_time:newJob.time||null,
        }),
      });
      pendingWebsiteRef.current=null;
      setPrefillWebsiteOrder(null);
      loadPendingWebDeliveries();
    }
    if (newJob.done) {
      await applyJobSideEffects(newJob, null);
    }
    loadData(true);
  }
  function openWebsiteSchedule(order) {
    pendingWebsiteRef.current=order;
    setPrefillWebsiteOrder(order);
    setWebsiteScheduleOpen(false);
    setScheduleMode("schedule");
    setScreen("schedule");
  }
  async function updateJob(updatedJob) {
    if (!isAdmin) return;
    setJobs(prev=>prev.map(j=>j.id===updatedJob.id?updatedJob:j));
    setEditingJob(null); setSelectedJob(null);
    await sbFetch(`jobs?id=eq.${updatedJob.id}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify(jobToRow(updatedJob))});
    loadData();
  }
  async function markBilled(jobId) {
    if (!isAdmin) return;
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j,billed:true}:j));
    await sbFetch(`jobs?id=eq.${jobId}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({billed:true})});
  }
  async function markPaid(jobId) {
    if (!isAdmin) return;
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j,paid:true}:j));
    await sbFetch(`jobs?id=eq.${jobId}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({paid:true})});
  }
  async function markWaSent(jobId) {
    if (!isAdmin) return;
    setJobs(prev=>prev.map(j=>j.id===jobId?{...j,waNeedsSend:false}:j));
    await sbFetch(`jobs?id=eq.${jobId}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({wa_needs_send:false})});
  }
  async function deleteJob(jobId) {
    if (!isAdmin) return;
    const job=jobs.find(j=>j.id===jobId);
    setJobs(prev=>prev.filter(j=>j.id!==jobId));
    await sbFetch(`jobs?id=eq.${jobId}`,{method:"DELETE",prefer:"return=minimal"});
    if (!job?.done) { loadData(true); return; }
    if (job.type==="delivery") {
      const qtys=job.quantities||{};
      await Promise.all(Object.entries(qtys).map(([pid,qty])=>qty>0?sbIncrementInventory(pid,qty):Promise.resolve()));
      if (job.deliveryType==="coffeebar") {
        if (job.dispensers) await sbIncrementInventory("dispenser",job.dispensers);
        await Promise.all(Object.entries(job.cbSyrups||{}).map(([pid,qty])=>qty>0?sbIncrementInventory(pid,qty):Promise.resolve()));
        const jerryMap={classic:"jerry_can",houseBlend:"jerry_can_houseblend",colombia:"jerry_can_colombia",decaf:"jerry_can_decaf"};
        await Promise.all((job.jerryCans||[]).map(ct=>sbIncrementInventory(jerryMap[ct]||"jerry_can",1)));
      }
    }
    if (job.type==="bottling") {
      const MINI_P=["vanilla_mini","original_mini","caramel_mini"];
      const JERRY_P=["jerry_can","jerry_can_houseblend","jerry_can_colombia","jerry_can_decaf"];
      const concType=PRODUCTS[job.product]?.concentrate;
      if (concType) {
        const ratio=getProductRatio(job.product,concType);
        const liters=job.actualQty!=null?job.actualQty:(job.liters||0);
        await sbIncrementConcentrate(concType,liters*ratio);
        const units=MINI_P.includes(job.product)?Math.round(liters*4):JERRY_P.includes(job.product)?Math.round(liters/5):Math.round(liters);
        await sbIncrementInventory(job.product,-units);
      }
      if (job.labeledUsed) {
        await Promise.all(Object.entries(job.labeledUsed).map(([pid,qty])=>qty>0?sbIncrementLabeledStock(pid,qty):Promise.resolve()));
      }
    }
    if (job.type==="drain") {
      const kgToL={3:19,2:12.7,1.5:9.5,1:6.4};
      await sbIncrementConcentrate(job.product,-(kgToL[job.kg]||19));
    }
    loadData(true);
  }
  async function setInventoryItem(pid,qty) {
    if (!isAdmin) return;
    setInventory(p=>({...p,[pid]:qty}));
    await sbFetch(`inventory?product=eq.${pid}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({qty})});
  }
  async function setConcentrateItem(type,liters) {
    if (!isAdmin) return;
    setConcentrate(p=>({...p,[type]:liters}));
    await sbFetch(`concentrate?type=eq.${type}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({liters})});
  }
  async function setBeansItem(type,kg) {
    if (!isAdmin) return;
    setBeans(p=>({...p,[type]:{...(p[type]||{}),kg}}));
    await sbFetch(`beans?type=eq.${type}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({kg})});
  }
  async function setLabeledStockItem(product,qty) {
    if (!isAdmin) return;
    setLabeledStock(p=>({...p,[product]:qty}));
    await sbFetch(`labeled_stock?product=eq.${product}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({qty})});
  }
  async function setBeanOrdered(type,ordered,orderedKg) {
    if (!isAdmin) return;
    setBeans(p=>({...p,[type]:{...(p[type]||{}),ordered,orderedKg}}));
    await sbFetch(`beans?type=eq.${type}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({ordered,ordered_kg:orderedKg})});
  }
  async function deliverBeans(type) {
    if (!isAdmin) return;
    const current=beans[type]||{};
    const newKg=parseFloat(((current.kg||0)+(current.orderedKg||0)).toFixed(1));
    setBeans(p=>({...p,[type]:{kg:newKg,ordered:false,orderedKg:0}}));
    await sbFetch(`beans?type=eq.${type}`,{method:"PATCH",prefer:"return=minimal",body:JSON.stringify({kg:newKg,ordered:false,ordered_kg:0})});
  }
  const today=todayISO();
  const upcomingJobs=jobs.filter(j=>j.date>=today&&!j.done).sort((a,b)=>a.date.localeCompare(b.date));
  const pendingConfirms=jobs.filter(j=>j.needsConfirmation&&!j.done);
  const needed=concentrateNeeded(upcomingJobs,inventory,concentrate);
  const unbilledJobs=jobs.filter(j=>j.type==="delivery"&&(j.deliveryType==="private"||j.deliveryType==="coffeebar")&&!j.paid);
  function goToStock(){setScreen("stock");}
  if (authLoading) return (<div style={S.app}><div style={S.container}><div style={S.loading}><GremierLogo/><div style={{color:"#333333",fontSize:12,letterSpacing:2,marginTop:20}}>Loading...</div></div></div></div>);
  if (!user) return (<LoginScreen onSignIn={signInWithGoogle}/>);
  if (loading) return (<div style={S.app}><div style={S.container}><div style={S.loading}><GremierLogo/><div style={{color:"#333333",fontSize:12,letterSpacing:2,marginTop:20}}>Loading...</div></div></div></div>);
  if (error) return (<div style={S.app}><div style={S.container}><div style={S.loading}><div style={{color:"#E53935",fontSize:14,padding:20,textAlign:"center"}}>Connection error:<br/><br/>{error}<br/><br/><button style={S.btnPrimary} onClick={loadData}>Retry</button></div></div></div></div>);
  return (
    <div style={S.app}><div style={S.container}>
      {!isAdmin&&<div style={{background:"#1F4D7A",color:"#fff",textAlign:"center",fontSize:11,padding:"5px 0",letterSpacing:1.5,textTransform:"uppercase"}}>View Only</div>}
      {syncing&&<div style={S.syncBar}>Syncing...</div>}
      {screen==="dashboard"&&<Dashboard concentrate={concentrate} needed={needed} monthView={monthView} setMonthView={setMonthView} jobs={jobs} today={today} onCheckoff={isAdmin?handleCheckoff:null} onJobTap={setSelectedJob} onSchedule={()=>{setScheduleMode("schedule");setScreen("schedule");}} onLogNow={()=>{setScheduleMode("lognow");setScreen("schedule");}} setCalDay={setCalDay} onRefresh={loadData} onSignOut={signOut} isAdmin={isAdmin}/>}
      {isAdmin&&screen==="schedule"&&<ScheduleScreen onSubmit={addJob} onBack={()=>{pendingWebsiteRef.current=null;setPrefillWebsiteOrder(null);setScreen("dashboard");}} initialMode={scheduleMode} websiteOrder={prefillWebsiteOrder} onRefresh={loadData}/>}
      {isAdmin&&editingJob&&(<div style={{position:"fixed",inset:0,background:"#00000088",zIndex:150,overflowY:"auto"}}><div style={{background:"#FFFFFF",minHeight:"100%",maxWidth:480,margin:"0 auto",position:"relative"}}><ScheduleScreen onSubmit={updateJob} onBack={()=>setEditingJob(null)} existingJob={editingJob} onRefresh={loadData}/></div></div>)}
      {screen==="tasks"&&<TasksScreen jobs={jobs} pendingConfirms={isAdmin?pendingConfirms:[]} onCheckoff={isAdmin?handleCheckoff:null} onConfirm={isAdmin?setCheckoffJob:null} onJobTap={setSelectedJob} onBack={()=>setScreen("dashboard")} onDelete={isAdmin?deleteJob:null} onRefresh={loadData} isAdmin={isAdmin}/>}
      {screen==="stock"&&<StockScreen concentrate={concentrate} setConcentrate={setConcentrateItem} inventory={inventory} setInventory={setInventoryItem} needed={needed} jobs={jobs} beans={beans} setBeans={setBeansItem} setBeanOrdered={setBeanOrdered} deliverBeans={deliverBeans} onBack={()=>setScreen("dashboard")} onRefresh={loadData} isAdmin={isAdmin}/>}
      {screen==="labels"&&<LabeledStockScreen labeledStock={labeledStock} setLabeledStock={setLabeledStockItem} onBack={()=>setScreen("dashboard")} onRefresh={loadData} isAdmin={isAdmin}/>}
      {screen==="needtomake"&&<NeedToMakeScreen jobs={jobs} inventory={inventory} concentrate={concentrate} onBack={()=>setScreen("dashboard")} onRefresh={loadData}/>}
      {selectedJob&&selectedJob.type==="delivery"&&<DeliveryDetail job={selectedJob} onClose={()=>setSelectedJob(null)} onCheckoff={isAdmin?()=>{handleCheckoff(selectedJob);setSelectedJob(null);}:null} onDelete={isAdmin?()=>{deleteJob(selectedJob.id);setSelectedJob(null);}:null} onEdit={isAdmin?()=>{setEditingJob(selectedJob);setSelectedJob(null);}:null} isAdmin={isAdmin}/>}
      {selectedJob&&selectedJob.type!=="delivery"&&<ProductionDetail job={selectedJob} onClose={()=>setSelectedJob(null)} onCheckoff={isAdmin?()=>{handleCheckoff(selectedJob);setSelectedJob(null);}:null} onDelete={isAdmin?()=>{deleteJob(selectedJob.id);setSelectedJob(null);}:null} onEdit={isAdmin?()=>{setEditingJob(selectedJob);setSelectedJob(null);}:null} isAdmin={isAdmin}/>}
      {isAdmin&&checkoffJob&&<CheckoffModal job={checkoffJob} onConfirm={confirmCheckoff} onCancel={()=>setCheckoffJob(null)}/>}
      {calDay&&<DayPopup date={calDay} jobs={jobs.filter(j=>j.date===calDay&&!j.done&&!j.brewStarted)} onClose={()=>setCalDay(null)} onJobTap={j=>{setSelectedJob(j);setCalDay(null);}} onCheckoff={isAdmin?handleCheckoff:null}/>}
      {isAdmin&&pendingConfirms.length>0&&<button style={S.confirmBadge} onClick={()=>setScreen("tasks")}>✓ {pendingConfirms.length} to confirm</button>}
      {smartAlerts.length>0&&!alertDismissed&&(
        <div style={{position:"fixed",top:60,left:12,right:12,zIndex:80,display:"flex",flexDirection:"column",gap:6}}>
          {smartAlerts.map((a,i)=>(
            <div key={i} style={{background:a.level==="critical"?"#8B1A1A":a.level==="warning"?"#101010":"#1F4D7A",color:"#fff",borderRadius:12,padding:"10px 14px",fontSize:13,lineHeight:1.5,display:"flex",alignItems:"flex-start",gap:10,boxShadow:"0 4px 16px #00000033"}}>
              <span style={{flexShrink:0}}>{a.level==="critical"?"🚨":a.level==="warning"?"⚠️":"💡"}</span>
              <span style={{flex:1}}>{a.msg}</span>
              <button onClick={()=>{setAlertDismissed(true);sessionStorage.setItem("alerts_dismissed","1");}} style={{background:"none",border:"none",color:"#ffffff88",fontSize:16,cursor:"pointer",flexShrink:0,padding:0,lineHeight:1}}>✕</button>
            </div>
          ))}
        </div>
      )}
      {isAdmin&&pendingWebDeliveries.length>0&&!websiteScheduleOpen&&!prefillWebsiteOrder&&<button style={{position:"fixed",bottom:196,left:14,background:"#4A90D9",color:"#fff",border:"none",borderRadius:20,padding:"8px 13px",fontSize:12,fontWeight:600,cursor:"pointer",zIndex:60,boxShadow:"0 2px 12px #00000040",maxWidth:"calc(100vw - 28px)"}} onClick={()=>{if(pendingWebDeliveries.length===1)openWebsiteSchedule(pendingWebDeliveries[0]);else setWebsiteScheduleOpen(true);}} title="Schedule new delivery">📦 {pendingWebDeliveries.length===1?"Schedule delivery":pendingWebDeliveries.length}</button>}
      {isAdmin&&websiteScheduleOpen&&<WebsiteScheduleDrawer orders={pendingWebDeliveries} onSchedule={openWebsiteSchedule} onClose={()=>setWebsiteScheduleOpen(false)}/>}
      {(()=>{const waPending=jobs.filter(j=>j.waNeedsSend&&j.storeName);return isAdmin&&waPending.length>0&&!waOpen?(<button style={{position:"fixed",bottom:196,right:14,background:"#25D366",color:"#fff",border:"none",borderRadius:20,padding:"8px 13px",fontSize:12,fontWeight:600,cursor:"pointer",zIndex:60,boxShadow:"0 2px 12px #00000040"}} onClick={()=>setWaOpen(true)}>💬 {waPending.length}</button>):null;})()}
      {isAdmin&&waOpen&&<WaDrawer jobs={jobs.filter(j=>j.waNeedsSend&&j.storeName)} onMarkSent={markWaSent} onClose={()=>setWaOpen(false)}/>}
      {isAdmin&&unbilledJobs.length>0&&!billingOpen&&<button style={{position:"fixed",bottom:158,right:14,background:"#C8860A",color:"#fff",border:"none",borderRadius:20,padding:"6px 9px",fontSize:13,fontWeight:700,cursor:"pointer",zIndex:60,boxShadow:"0 2px 12px #00000040"}} onClick={()=>setBillingOpen(true)}>💰 {unbilledJobs.length}</button>}
      {isAdmin&&billingOpen&&<BillingDrawer jobs={unbilledJobs} onMarkBilled={markBilled} onMarkPaid={markPaid} onClose={()=>setBillingOpen(false)}/>}
      <VoiceLogger
        onAddJob={isAdmin ? addJob : null}
        jobs={jobs}
        beans={beans}
        inventory={inventory}
        concentrate={concentrate}
        labeledStock={labeledStock}
        onMarkPaid={isAdmin ? markPaid : null}
        onMarkBilled={isAdmin ? markBilled : null}
        onCheckoff={isAdmin ? handleCheckoff : null}
        onConfirmCheckoff={isAdmin ? setCheckoffJob : null}
        onDeliverBeans={isAdmin ? deliverBeans : null}
      />
      <BottomNav screen={screen} setScreen={s=>{setScreen(s);}} pendingCount={isAdmin?pendingConfirms.length:0} labeledLowCount={Object.entries(LABELED_WARN).filter(([pid,warn])=>warn!==null&&(labeledStock[pid]||0)<warn).length}/>
    </div></div>
  );
}
function Dashboard({concentrate,needed,monthView,setMonthView,jobs,today,onCheckoff,onJobTap,onSchedule,onLogNow,setCalDay,onRefresh,onSignOut,isAdmin}) {
  return (
    <div style={S.screen}>
      <div style={S.header}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px 10px"}}>
          <GremierLogo compact={true}/>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <RefreshBtn onRefresh={onRefresh}/>
            <button onClick={onSignOut} style={{background:"#F0F0F0",border:"1.5px solid #D0D0D0",borderRadius:8,fontSize:11,cursor:"pointer",color:"#555555",padding:"5px 8px"}}>Sign out</button>
          </div>
        </div>
      </div>
      <TodayTomorrowCard jobs={jobs} today={today} onCheckoff={onCheckoff} onJobTap={onJobTap}/>
      <div style={{...S.card,margin:"10px 0",borderRadius:0,borderLeft:"none",borderRight:"none",padding:"14px 6px"}}>
        <div style={S.calNavRow}>
          <button style={S.monthBtn} onClick={()=>setMonthView(mv=>{const d=new Date(mv.year,mv.month-1);return{year:d.getFullYear(),month:d.getMonth()};})}> ‹</button>
          <div style={S.cardTitle}>{new Date(monthView.year,monthView.month).toLocaleDateString("en",{month:"long",year:"numeric"})}</div>
          <button style={S.monthBtn} onClick={()=>setMonthView(mv=>{const d=new Date(mv.year,mv.month+1);return{year:d.getFullYear(),month:d.getMonth()};})}>›</button>
        </div>
        <MiniCalendar year={monthView.year} month={monthView.month} jobs={jobs} today={today} onDayTap={setCalDay}/>
        <div style={S.legend}>
          <span><span style={{...S.dot,display:"inline-block",background:"#101010"}}/> Delivery</span>
          <span><span style={{...S.dot,display:"inline-block",background:"#4A90D9"}}/> Production</span>
        </div>
      </div>
      {isAdmin&&<div style={{padding:"0 12px",display:"flex",gap:10}}>
        <button style={{...S.btnSecondary,flex:1}} onClick={onLogNow}>✓ Log Now</button>
        <button style={{...S.btnPrimary,flex:1}} onClick={onSchedule}>+ Schedule</button>
      </div>}
      <div style={{height:110}}/>
    </div>
  );
}
function CompactJobRow({job,onCheckoff,onTap}) {
  const color=job.type==="drain"?"#9B6FC8":job.type==="brew"?"#4A90D9":job.type==="bottling"?"#E8821A":job.type==="labeling"?"#3A2A1A":job.deliveryType==="store"?"#101010":"#2E8B57";
  const label=job.type==="delivery"?job.deliveryType==="store"?(job.storeName||"Store"):job.deliveryType==="coffeebar"?(job.cbName||"Coffee Bar"):(job.privateName||"Private"):job.label||(job.type==="bottling"?`Bottle ${job.liters}L ${PRODUCTS[job.product]?.label||""}`:job.type==="brew"?`Brew ${CONCENTRATE_TYPES[job.product]?.label||""}`:job.type);
  return (
    <div style={{display:"flex",alignItems:"center",padding:"3px 0",borderBottom:"1px solid #F5F5F5",gap:6,cursor:"pointer"}} onClick={()=>onTap&&onTap(job)}>
      <div style={{width:5,height:5,borderRadius:"50%",background:color,flexShrink:0}}/>
      <div style={{flex:1,fontSize:11,fontWeight:500,color,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{label}</div>
      {job.time&&<div style={{fontSize:11,fontWeight:600,color:"#555",flexShrink:0}}>{formatTime(job.time)}</div>}
    </div>
  );
}
function SubGroup({label,color,jobs,onCheckoff,onTap,RowComponent}) {
  if (jobs.length===0) return null;
  return (
    <div style={{marginBottom:6}}>
      <div style={{fontSize:9,color,background:`${color}30`,borderRadius:5,padding:"3px 7px",display:"inline-block",letterSpacing:0.5,textTransform:"uppercase",fontWeight:700,marginBottom:4}}>{label}</div>
      {jobs.map(j=><RowComponent key={j.id} job={j} onCheckoff={onCheckoff} onTap={onTap}/>)}
    </div>
  );
}
function DeliverySubGroups({jobs,onCheckoff,onTap,RowComponent}) {
  if (jobs.length===0) return <div style={{fontSize:10,color:"#CCC",fontStyle:"italic"}}>None</div>;
  return (<>
    <SubGroup label="Stores"      color="#101010" jobs={jobs.filter(j=>j.deliveryType==="store")}     onCheckoff={onCheckoff} onTap={onTap} RowComponent={RowComponent}/>
    <SubGroup label="Private"     color="#2E8B57" jobs={jobs.filter(j=>j.deliveryType==="private")}   onCheckoff={onCheckoff} onTap={onTap} RowComponent={RowComponent}/>
    <SubGroup label="Coffee Bars" color="#2E8B57" jobs={jobs.filter(j=>j.deliveryType==="coffeebar")} onCheckoff={onCheckoff} onTap={onTap} RowComponent={RowComponent}/>
  </>);
}
function ProductionSubGroups({jobs,onCheckoff,onTap,RowComponent}) {
  if (jobs.length===0) return <div style={{fontSize:10,color:"#CCC",fontStyle:"italic"}}>None</div>;
  return (<>
    <SubGroup label="Brew"   color="#4A90D9" jobs={jobs.filter(j=>j.type==="brew")}     onCheckoff={onCheckoff} onTap={onTap} RowComponent={RowComponent}/>
    <SubGroup label="Bottle" color="#E8821A" jobs={jobs.filter(j=>j.type==="bottling")} onCheckoff={onCheckoff} onTap={onTap} RowComponent={RowComponent}/>
    <SubGroup label="Drain"  color="#9B6FC8" jobs={jobs.filter(j=>j.type==="drain")}    onCheckoff={onCheckoff} onTap={onTap} RowComponent={RowComponent}/>
    <SubGroup label="Label"  color="#3A2A1A" jobs={jobs.filter(j=>j.type==="labeling")} onCheckoff={onCheckoff} onTap={onTap} RowComponent={RowComponent}/>
  </>);
}
function TodayTomorrowCard({jobs,today,onCheckoff,onJobTap}) {
  const tomorrow=tomorrowISO();
  const overdueJobs=jobs.filter(j=>j.date<today&&!j.done&&!j.brewStarted);
  const todayJobs=jobs.filter(j=>j.date===today&&!j.done&&!j.brewStarted);
  const tomorrowJobs=jobs.filter(j=>j.date===tomorrow&&!j.done&&!j.brewStarted);
  const brewingJobs=jobs.filter(j=>j.brewStarted&&!j.done);
  function TwoColDay({dayJobs}) {
    const deliveries=dayJobs.filter(j=>j.type==="delivery");
    const production=dayJobs.filter(j=>j.type!=="delivery");
    return (
      <div style={{display:"flex",gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,color:"#FFFFFF",background:"#101010",borderRadius:6,padding:"6px 4px",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",marginBottom:8,fontWeight:700}}>Deliveries</div>
          <DeliverySubGroups jobs={deliveries} onCheckoff={onCheckoff} onTap={onJobTap} RowComponent={CompactJobRow}/>
        </div>
        <div style={{width:1,background:"#E8E8E8",flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,color:"#FFFFFF",background:"#4A90D9",borderRadius:6,padding:"6px 4px",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",marginBottom:8,fontWeight:700}}>Production</div>
          <ProductionSubGroups jobs={production} onCheckoff={onCheckoff} onTap={onJobTap} RowComponent={CompactJobRow}/>
        </div>
      </div>
    );
  }
  return (
    <div>
      {brewingJobs.length>0&&(
        <div style={{...S.card,padding:"10px 12px",borderColor:"#4A90D9",background:"#EBF3FF"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#4A90D9",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>🧪 Brewing Now</div>
          {brewingJobs.map(j=>(
            <div key={j.id} style={{display:"flex",alignItems:"center",padding:"4px 0",gap:6,fontSize:12,color:"#4A90D9",fontWeight:600}}>
              <span>☕ {CONCENTRATE_TYPES[j.product]?.label||j.product} — {j.kg}kg — drain at {j.label?.match(/\d{2}:\d{2}/)?.[0]||"?"}</span>
            </div>
          ))}
          <div style={{fontSize:10,color:"#4A90D9",marginTop:6,opacity:0.7}}>Tap the drain job when ready</div>
        </div>
      )}
      {overdueJobs.length>0&&(
        <div style={{...S.card,padding:"10px 12px",borderColor:"#E53935",background:"#FFF5F5"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#E53935",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>⚠ Overdue</div>
          <TwoColDay dayJobs={overdueJobs}/>
        </div>
      )}
      <div style={{...S.card,padding:"10px 12px"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#101010",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Today</div>
        {todayJobs.length===0?<div style={S.empty}>Nothing scheduled for today</div>:<TwoColDay dayJobs={todayJobs}/>}
      </div>
      <div style={{...S.card,padding:"10px 12px"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#101010",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>Tomorrow</div>
        {tomorrowJobs.length===0?<div style={S.empty}>Nothing scheduled for tomorrow</div>:<TwoColDay dayJobs={tomorrowJobs}/>}
      </div>
    </div>
  );
}
function MiniCalendar({year,month,jobs,today,onDayTap}) {
  const days=monthDates(year,month);
  const first=days[0].getDay();
  const cells=[...Array(first).fill(null),...days];
  return (
    <div style={S.calGrid}>
      {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} style={S.calHdr}>{d}</div>)}
      {cells.map((d,i)=>{
        if (!d) return <div key={"e"+i}/>;
        const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const dj=jobs.filter(j=>j.date===iso&&!j.done&&!j.brewStarted);
        const isT=iso===today;
        return (
          <div key={iso} style={{...S.calCell,background:isT?"#10101018":"transparent"}} onClick={()=>onDayTap(iso)}>
            <div style={{...S.calDate,color:isT?"#101010":"#555"}}>{parseInt(iso.split("-")[2],10)}</div>
            <div style={S.calDots}>
              {dj.some(j=>j.type==="delivery")&&<div style={{...S.calDot,background:"#101010"}}/>}
              {dj.some(j=>j.type==="bottling"||j.type==="brew")&&<div style={{...S.calDot,background:"#4A90D9"}}/>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function DayPopup({date,jobs,onClose,onJobTap,onCheckoff}) {
  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <div style={S.modalTitle}>{formatDate(date)}</div>
        <div style={{marginBottom:12}}>
          {jobs.length===0?<div style={{color:"#333333",fontSize:14,padding:"12px 0"}}>Nothing scheduled</div>:jobs.map(j=><JobRow key={j.id} job={j} onCheckoff={onCheckoff} onTap={v=>onJobTap(v)}/>)}
        </div>
        <button style={{...S.btnSecondary,width:"100%"}} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
function JobRow({job,onCheckoff,onTap,pending}) {
  const color=job.type==="drain"?"#9B6FC8":job.type==="brew"?"#4A90D9":job.type==="bottling"?"#E8821A":job.type==="labeling"?"#3A2A1A":job.deliveryType==="store"?"#101010":"#2E8B57";
  const label=job.type==="delivery"?job.deliveryType==="store"?(job.storeName||"Store"):job.deliveryType==="coffeebar"?(job.cbName||"Coffee Bar"):(job.privateName||"Private"):job.label||(job.type==="bottling"?`Bottle ${job.liters}L ${PRODUCTS[job.product]?.label||""}`:job.type==="brew"?`Brew ${CONCENTRATE_TYPES[job.product]?.label||""} (${job.kg}kg)`:job.type==="drain"?`Drain ${CONCENTRATE_TYPES[job.product]?.label||""}`:job.type==="labeling"?`Label ${job.qty} ${PRODUCTS[job.product]?.label||""}`:job.type);
  const hasWA=job.type==="delivery"&&job.done&&job.storeName&&STORES.find(s=>s.name===job.storeName)?.phone;
  return (
    <div style={{...S.jobRow,cursor:"pointer"}} onClick={()=>onTap&&onTap(job)}>
      {onCheckoff&&(<button style={{...S.checkbox,borderColor:color}} onClick={e=>{e.stopPropagation();onCheckoff(job);}}>{job.brewStarted&&job.type==="brew"?"·":pending?"?":""}</button>)}
      <div style={S.jobInfo}>
        <div style={{...S.jobLabel,color}}>{label}</div>
        <div style={S.jobMeta}>{formatDate(job.date)}{job.time?` · ${formatTime(job.time)}`:""}{pending?" · awaiting confirmation":""}</div>
      </div>
      {hasWA&&<div style={{fontSize:14,opacity:0.5}}>💬</div>}
      <div style={{fontSize:13,color:"#333333"}}>›</div>
    </div>
  );
}
function CoffeeBarSelector({people,setPeople,jerryCans,setJerryCans,cbName,setCbName,cbAddress,setCbAddress,dispensers,setDispensers,cbSyrups,setCbSyrups}) {
  const canCount=Math.floor(people/25);
  function updatePeople(n) {
    setPeople(n);
    const newCount=Math.floor(n/25);
    setJerryCans(prev=>{const next=[...prev];while(next.length<newCount)next.push("classic");return next.slice(0,newCount);});
  }
  function updateCan(idx,val){setJerryCans(prev=>{const next=[...prev];next[idx]=val;return next;});}
  return (
    <div>
      <div style={S.field}><div style={S.lbl}>Number of People</div>
        <select style={S.sel} value={people} onChange={e=>updatePeople(Number(e.target.value))}>
          {[25,50,75,100,125,150,175,200].map(n=><option key={n} value={n}>{n} people ({Math.floor(n/25)} jerry can{Math.floor(n/25)>1?"s":""})</option>)}
        </select>
      </div>
      <div style={S.field}><div style={S.lbl}>Client Name (optional)</div><input type="text" style={S.inp} value={cbName} onChange={e=>setCbName(e.target.value)} placeholder="Who is this for?"/></div>
      <div style={S.field}><div style={S.lbl}>Address (optional)</div><input type="text" style={S.inp} value={cbAddress} onChange={e=>setCbAddress(e.target.value)} placeholder="Event address"/></div>
      <div style={S.field}><div style={S.lbl}>Dispensers</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button style={S.editBtn} onClick={()=>setDispensers(Math.max(0,dispensers-1))}>−</button>
          <span style={{fontSize:16,fontWeight:600,minWidth:30,textAlign:"center"}}>{dispensers}</span>
          <button style={S.editBtn} onClick={()=>setDispensers(dispensers+1)}>+</button>
        </div>
      </div>
      <div style={S.field}><div style={S.lbl}>Syrups</div>
        {["vanilla_syrup","caramel_syrup","sugar_syrup"].map(pid=>(
          <div key={pid} style={{...S.qRow,gap:6}}>
            <span style={{...S.qLabel,flex:1}}>{PRODUCTS[pid]?.label}</span>
            <button style={{...S.editBtn,width:26,height:26,fontSize:16}} onClick={()=>setCbSyrups(s=>({...s,[pid]:Math.max(0,(s[pid]??1)-1)}))}>−</button>
            <input type="number" min="0" style={{...S.qInput,width:44}} value={cbSyrups[pid]??1} onChange={e=>setCbSyrups(s=>({...s,[pid]:Number(e.target.value)||0}))}/>
            <button style={{...S.editBtn,width:26,height:26,fontSize:16}} onClick={()=>setCbSyrups(s=>({...s,[pid]:(s[pid]??1)+1}))}>+</button>
          </div>
        ))}
      </div>
      <div style={{...S.lbl,marginBottom:8}}>Jerry Can Types</div>
      {Array.from({length:canCount}).map((_,i)=>(
        <div key={i} style={S.qRow}><span style={S.qLabel}>Can {i+1}</span>
          <select style={{...S.sel,width:"auto",padding:"6px 8px",fontSize:13}} value={jerryCans[i]||"classic"} onChange={e=>updateCan(i,e.target.value)}>
            {Object.entries(CONCENTRATE_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
function MiniJobRow({job,onCheckoff,onTap,onDelete}) {
  const color=job.type==="drain"?"#9B6FC8":job.type==="brew"?"#4A90D9":job.type==="bottling"?"#E8821A":job.type==="labeling"?"#3A2A1A":job.deliveryType==="store"?"#101010":"#2E8B57";
  const name=job.type==="delivery"?job.deliveryType==="store"?(job.storeName||"Store"):job.deliveryType==="coffeebar"?(job.cbName||"Coffee Bar"):(job.privateName||"Private"):job.label||job.type;
  const detail=job.type==="delivery"?Object.entries(job.quantities||{}).filter(([,q])=>q>0).map(([pid,qty])=>`${qty} ${PRODUCTS[pid]?.label||pid}`).join(", "):job.type==="brew"?`${job.kg}kg ${CONCENTRATE_TYPES[job.product]?.label||""}`:job.type==="bottling"?`${job.liters}L ${PRODUCTS[job.product]?.label||""}`:job.type==="drain"?CONCENTRATE_TYPES[job.product]?.label||"":"";
  const address=job.privateAddress||job.cbAddress||null;
  const isOverdue=isJobOverdue(job);
  const overdueActions=!!onDelete;
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:5,padding:"5px 0",borderBottom:"1px solid #F0F0F0",cursor:"pointer"}} onClick={()=>onTap&&onTap(job)}>
      {onCheckoff&&(<button style={{width:overdueActions?22:16,height:overdueActions?22:16,borderRadius:overdueActions?4:3,border:`1.5px solid ${isOverdue?"#E53935":color}`,background:isOverdue?"#FFE5E5":"transparent",cursor:"pointer",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",fontSize:overdueActions?13:10,color:isOverdue?"#E53935":color,fontWeight:overdueActions?700:400}} onClick={e=>{e.stopPropagation();onCheckoff(job);}} title="Mark complete">{overdueActions?"✓":(job.brewStarted&&job.type==="brew"?"·":"")}</button>)}
      <div style={{minWidth:0,flex:1}}>
        <div style={{fontSize:12,fontWeight:600,color:isOverdue?"#E53935":color,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</div>
        {detail?<div style={{fontSize:10,color:"#888",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{detail}</div>:null}
        {address&&<div style={{fontSize:10,color:"#4A90D9",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>📍 {address}</div>}
        {job.time?<div style={{fontSize:10,color:"#AAA"}}>{formatTime(job.time)}</div>:null}
        {isOverdue&&job.date<todayISO()?<div style={{fontSize:10,color:"#E53935",marginTop:1}}>{formatDate(job.date)}</div>:null}
      </div>
      {onDelete&&(<button style={{background:"none",border:"none",color:"#C0392B",fontSize:16,cursor:"pointer",padding:"2px 4px",flexShrink:0,marginTop:1}} onClick={e=>{e.stopPropagation();onDelete(job);}} title="Delete task">🗑</button>)}
    </div>
  );
}
function ScheduleScreen({onSubmit,onBack,existingJob,initialMode,websiteOrder,onRefresh}) {
  const isEdit=!!existingJob;
  const [mode,setMode]=useState(isEdit?"schedule":(initialMode||null));
  const [jobType,setJobType]=useState(existingJob?.type==="delivery"?"delivery":"production");
  const [subType,setSubType]=useState(existingJob?.deliveryType||"store");
  const [prodType,setProdType]=useState(existingJob?.type==="bottling"?"bottling":existingJob?.type==="labeling"?"labeling":existingJob?.type==="drain"?"drain":"brew");
  const [date,setDate]=useState(existingJob?.date||todayISO());
  const [time,setTime]=useState(existingJob?.time||"");
  const [storeName,setStore]=useState(existingJob?.storeName||"");
  const [privateName,setPrivateName]=useState(existingJob?.privateName||"");
  const [privateAddress,setPrivateAddress]=useState(existingJob?.privateAddress||"");
  const [quantities,setQty]=useState(existingJob?.quantities||{});
  const prefilledWebRef=React.useRef(null);
  useEffect(()=>{
    if (!websiteOrder || isEdit || prefilledWebRef.current===websiteOrder.id) return;
    prefilledWebRef.current=websiteOrder.id;
    setMode("schedule");
    setJobType("delivery");
    setSubType("private");
    setPrivateName(websiteOrder.customer_name||"");
    setPrivateAddress(websiteOrder.delivery_address||"");
    setQty(websiteItemsToQuantities(websiteOrder.items));
  },[websiteOrder,isEdit]);
  const [people,setPeople]=useState(existingJob?.people||25);
  const [product,setProduct]=useState(existingJob?.product||"classic_liter");
  const [liters,setLiters]=useState(existingJob?.liters||"");
  const [brewConc,setBrewConc]=useState(existingJob?.product||"classic");
  const [kg,setKg]=useState(existingJob?.kg||3);
  const [labelProduct,setLabelProduct]=useState(existingJob?.product||"classic_liter");
  const [labelQty,setLabelQty]=useState(existingJob?.qty||"");
  const [jerryCans,setJerryCans]=useState(existingJob?.jerryCans||Array(Math.floor((existingJob?.people||25)/25)).fill("classic"));
  const [cbName,setCbName]=useState(existingJob?.cbName||"");
  const [cbAddress,setCbAddress]=useState(existingJob?.cbAddress||"");
  const [dispensers,setDispensers]=useState(existingJob?.dispensers||1);
  const [cbSyrups,setCbSyrups]=useState(existingJob?.cbSyrups||{vanilla_syrup:1,caramel_syrup:1,sugar_syrup:1});
  const logNow=mode==="lognow";
  function buildJob() {
    const now=new Date();
    const base=existingJob?{...existingJob,date:date||todayISO(),time}:{date:logNow?todayISO():(date||todayISO()),time:logNow?(time||now.toTimeString().slice(0,5)):time,done:logNow};
    if (jobType==="delivery") {
      if (subType==="coffeebar") return {...base,type:"delivery",deliveryType:"coffeebar",people,jerryCans,cbName,cbAddress,dispensers,cbSyrups,label:`Coffee Bar${cbName?" — "+cbName:""} (${people}p)`};
      const total=Object.values(quantities).reduce((s,v)=>s+(v||0),0);
      return {...base,type:"delivery",deliveryType:subType,storeName:subType==="store"?storeName:undefined,privateName:subType==="private"?privateName:undefined,privateAddress:subType==="private"?privateAddress:undefined,quantities,plannedTotal:total};
    } else {
      if (prodType==="brew") return {...base,type:"brew",product:brewConc,kg,label:`Brew ${CONCENTRATE_TYPES[brewConc].label} (${kg}kg)`};
      if (prodType==="labeling") return {...base,type:"labeling",product:labelProduct,qty:Number(labelQty),label:`Label ${labelQty} ${PRODUCTS[labelProduct]?.label||""}`};
      if (prodType==="drain") return {...base,type:"drain",product:existingJob?.product,kg:existingJob?.kg,label:existingJob?.label};
      const isJerry=PRODUCTS[product]?.category==="jerry";
      const actualLiters=isJerry?Number(liters)*5:Number(liters);
      return {...base,type:"bottling",product,liters:actualLiters,qty:isJerry?Number(liters):undefined,label:isJerry?`Make ${liters} ${PRODUCTS[product]?.label}`:`Bottle ${liters}L ${PRODUCTS[product]?.label}`};
    }
  }
  const concKey=PRODUCTS[product]?.concentrate;
  const concNeeded=concKey?(Number(liters)||0)*getProductRatio(product,concKey):0;
  if (!mode) {
    return (
      <div style={S.screen}>
        <div style={S.subHdr}><button style={S.backBtn} onClick={onBack}>‹</button><div style={S.subTitle}>Add Job</div><div style={{marginLeft:"auto"}}><RefreshBtn onRefresh={onRefresh}/></div></div>
        <div style={{padding:"24px 16px",display:"flex",flexDirection:"column",gap:14}}>
          <button style={{...S.btnPrimary,width:"100%",padding:"20px 16px",fontSize:16,borderRadius:14,textAlign:"left"}} onClick={()=>setMode("lognow")}>
            <div style={{fontWeight:700}}>✓ Log Now</div>
            <div style={{fontSize:11,fontWeight:400,marginTop:4,opacity:0.85}}>Record something you just did or are doing right now</div>
          </button>
          <button style={{...S.btnSecondary,width:"100%",padding:"20px 16px",fontSize:16,borderRadius:14,textAlign:"left"}} onClick={()=>setMode("schedule")}>
            <div style={{fontWeight:700}}>📅 Schedule for Later</div>
            <div style={{fontSize:11,fontWeight:400,marginTop:4,opacity:0.75}}>Plan a future delivery or production job</div>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={S.screen}>
      <div style={S.subHdr}><button style={S.backBtn} onClick={onBack}>‹</button><div style={S.subTitle}>{isEdit?"Edit Job":logNow?"✓ Log Now":"📅 Schedule"}</div><div style={{marginLeft:"auto"}}><RefreshBtn onRefresh={onRefresh}/></div></div>
      {!isEdit&&<div style={{margin:"8px 12px 0",padding:"8px 12px",background:logNow?"#E8F8EF":"#EBF3FF",borderRadius:8,fontSize:12,color:logNow?"#2E8B57":"#4A90D9",fontWeight:600}}>{logNow?"✓ Logging as completed now":websiteOrder?`📦 Order #${websiteOrder.order_number||"—"} — schedule delivery${websiteOrder.payment_status&&websiteOrder.payment_status!=="paid"?" (payment pending)":""}`:"📅 Scheduling for later"}</div>}
      {isEdit&&existingJob?.type==="drain"?(
        <div style={S.card}>
          <div style={S.cardTitle}>Drain Job</div>
          <div style={{fontSize:13,color:"#444",marginBottom:12}}>{existingJob.label}</div>
          <div style={S.field}><div style={S.lbl}>Date</div><input type="date" style={S.inp} value={date} onChange={e=>setDate(e.target.value)}/></div>
          <div style={S.field}><div style={S.lbl}>Time (optional)</div><input type="time" style={S.inp} value={time} onChange={e=>setTime(e.target.value)}/></div>
          <button style={{...S.btnPrimary,width:"100%",marginTop:8}} onClick={()=>onSubmit(buildJob())}>Save Changes</button>
        </div>
      ):(
        <>
          <div style={S.card}>
            <div style={S.cardTitle}>Job Type</div>
            <div style={S.toggleRow}>
              <button style={{...S.tog,background:jobType==="delivery"?"#101010":"#F0F0F0",color:jobType==="delivery"?"#fff":"#1A1A1A"}} onClick={()=>setJobType("delivery")}>Delivery</button>
              <button style={{...S.tog,background:jobType==="production"?"#4A90D9":"#F0F0F0",color:jobType==="production"?"#fff":"#1A1A1A"}} onClick={()=>setJobType("production")}>Production</button>
            </div>
          </div>
          {jobType==="delivery"&&(
            <div style={S.card}>
              <div style={S.toggleRow}>
                {["store","private","coffeebar"].map(t=>(
                  <button key={t} style={{...S.togSm,background:subType===t?"#101010":"#F0F0F0",color:subType===t?"#fff":"#1A1A1A"}} onClick={()=>setSubType(t)}>
                    {t==="coffeebar"?"Coffee Bar":t.charAt(0).toUpperCase()+t.slice(1)}
                  </button>
                ))}
              </div>
              {subType==="store"&&<div style={S.field}><div style={S.lbl}>Store</div><select style={S.sel} value={storeName} onChange={e=>setStore(e.target.value)}><option value="">Select store...</option>{STORES.map(s=><option key={s.name} value={s.name}>{s.name}</option>)}</select></div>}
              {subType==="private"&&<div style={S.field}><div style={S.lbl}>Recipient Name</div><input type="text" style={S.inp} value={privateName} onChange={e=>setPrivateName(e.target.value)} placeholder="Who is this for?"/></div>}
              {subType==="private"&&<div style={S.field}><div style={S.lbl}>Address</div><input type="text" style={S.inp} value={privateAddress} onChange={e=>setPrivateAddress(e.target.value)} placeholder="Delivery address"/></div>}
              {subType!=="coffeebar"&&(
                <div>
                  {subType==="store"&&<div style={{...S.field,marginBottom:10}}><div style={S.lbl}>Quick Case</div><select style={S.sel} onChange={e=>{if(!e.target.value)return;const caseQtys=CASES[e.target.value]?.qtys||{};setQty(q=>({...q,...caseQtys}));e.target.value="";}}><option value="">Add a case...</option>{Object.entries(CASES).map(([k,c])=><option key={k} value={k}>{c.label}</option>)}</select></div>}
                  {[{label:"Liter Bottles",cat:"liter"},{label:"Mini Bottles",cat:"mini"},{label:"Jerry Cans",cat:"jerry"},{label:"Syrups",cat:"syrup"}].map(({label,cat})=>(
                    <div key={cat}>
                      <div style={{fontSize:9,color:"#101010",letterSpacing:1.5,textTransform:"uppercase",fontWeight:700,marginTop:10,marginBottom:4,borderBottom:"1px solid #E0E0E0",paddingBottom:3}}>{label}</div>
                      {Object.entries(PRODUCTS).filter(([,p])=>p.category===cat).map(([pid,p])=>(
                        <div key={pid} style={{...S.qRow,gap:6}}>
                          <span style={{...S.qLabel,flex:1}}>{p.label}</span>
                          <button style={{...S.editBtn,width:26,height:26,fontSize:16}} onClick={()=>setQty(q=>({...q,[pid]:Math.max(0,(q[pid]||0)-1)}))}>−</button>
                          <input type="number" min="0" style={{...S.qInput,width:44}} placeholder="" value={quantities[pid]||""} onChange={e=>setQty(q=>({...q,[pid]:Number(e.target.value)||0}))}/>
                          <button style={{...S.editBtn,width:26,height:26,fontSize:16}} onClick={()=>setQty(q=>({...q,[pid]:(q[pid]||0)+1}))}>+</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
{subType==="coffeebar"&&<CoffeeBarSelector people={people} setPeople={setPeople} jerryCans={jerryCans} setJerryCans={setJerryCans} cbName={cbName} setCbName={setCbName} cbAddress={cbAddress} setCbAddress={setCbAddress} dispensers={dispensers} setDispensers={setDispensers} cbSyrups={cbSyrups} setCbSyrups={setCbSyrups}/>}                                                    </div>
          )}
          {jobType==="production"&&(
            <div style={S.card}>
              <div style={S.toggleRow}>
                <button style={{...S.tog,background:prodType==="brew"?"#4A90D9":"#F0F0F0",color:prodType==="brew"?"#fff":"#1A1A1A"}} onClick={()=>setProdType("brew")}>Brew</button>
                <button style={{...S.tog,background:prodType==="bottling"?"#E8821A":"#F0F0F0",color:prodType==="bottling"?"#fff":"#1A1A1A"}} onClick={()=>setProdType("bottling")}>Bottle</button>
                <button style={{...S.tog,background:prodType==="labeling"?"#3A2A1A":"#F0F0F0",color:prodType==="labeling"?"#fff":"#1A1A1A"}} onClick={()=>setProdType("labeling")}>Label</button>
              </div>
              {prodType==="brew"&&(
                <div>
                  <div style={S.field}><div style={S.lbl}>Concentrate Type</div><select style={S.sel} value={brewConc} onChange={e=>setBrewConc(e.target.value)}>{Object.entries(CONCENTRATE_TYPES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
                  <div style={S.field}><div style={S.lbl}>Kilos of Coffee</div><select style={S.sel} value={kg} onChange={e=>setKg(Number(e.target.value))}><option value={3}>3kg → ~19L concentrate</option><option value={2}>2kg → ~12.7L concentrate</option><option value={1.5}>1.5kg → ~9.5L concentrate</option><option value={1}>1kg → ~6.4L concentrate</option></select></div>
                  {logNow&&<div style={S.hint}>Will create a drain task for tomorrow</div>}
                  {!logNow&&<div style={S.hint}>Log the brew when you start it to trigger the drain reminder</div>}
                </div>
              )}
              {prodType==="bottling"&&(
                <div>
                  <div style={S.field}><div style={S.lbl}>Product</div><select style={S.sel} value={product} onChange={e=>setProduct(e.target.value)}>{Object.entries(PRODUCTS).filter(([,p])=>p.concentrate).map(([k,p])=><option key={k} value={k}>{p.label}</option>)}</select></div>
                  <div style={S.field}>
                    <div style={S.lbl}>{PRODUCTS[product]?.category==="jerry"?"Number of Jerry Cans":"Liters to Produce"}</div>
                    <input type="number" style={S.inp} value={liters} onChange={e=>setLiters(e.target.value)} placeholder=""/>
                    {PRODUCTS[product]?.category==="jerry"&&liters>0&&<div style={S.hint}>{liters} cans × 5L = {(Number(liters)*5*(CONCENTRATE_TYPES[PRODUCTS[product]?.concentrate]?.ratio||0.44)).toFixed(1)}L of concentrate needed</div>}
                  </div>
                  {concNeeded>0&&PRODUCTS[product]?.category!=="jerry"&&<div style={S.hint}>Requires {concNeeded.toFixed(1)}L of {CONCENTRATE_TYPES[concKey]?.label}</div>}
                </div>
              )}
              {prodType==="labeling"&&(
                <div>
                  <div style={S.field}><div style={S.lbl}>Product to Label</div><select style={S.sel} value={labelProduct} onChange={e=>setLabelProduct(e.target.value)}>{Object.entries(PRODUCTS).filter(([,p])=>p.category==="liter"||p.category==="mini"||p.category==="jerry").map(([k,p])=><option key={k} value={k}>{p.label}</option>)}</select></div>
                  <div style={S.field}><div style={S.lbl}>Quantity</div><input type="number" style={S.inp} value={labelQty} onChange={e=>setLabelQty(e.target.value)} placeholder=""/></div>
                </div>
              )}
            </div>
          )}
          {!logNow&&<div style={S.card}><div style={S.field}><div style={S.lbl}>Date</div><input type="date" style={S.inp} value={date} onChange={e=>setDate(e.target.value)}/></div><div style={S.field}><div style={S.lbl}>Time (optional)</div><input type="time" style={S.inp} value={time} onChange={e=>setTime(e.target.value)}/></div></div>}
          {logNow&&<div style={S.card}><div style={S.field}><div style={S.lbl}>Time (optional — defaults to now)</div><input type="time" style={S.inp} value={time} onChange={e=>setTime(e.target.value)}/></div></div>}
          <div style={{padding:"0 12px"}}>
            <button style={{...S.btnPrimary,width:"100%",background:logNow?"#2E8B57":"#101010"}} onClick={()=>onSubmit(buildJob())}>
              {isEdit?"Save Changes":logNow?"✓ Log as Done":"Save to Schedule"}
            </button>
          </div>
        </>
      )}
      <div style={{height:110}}/>
    </div>
  );
}
function TasksScreen({jobs,pendingConfirms,onCheckoff,onConfirm,onJobTap,onBack,onDelete,onRefresh,isAdmin}) {
  // Include brewing jobs (brewStarted=true, done=false) so they're visible and drainable
  const allJobs=jobs.filter(j=>!j.needsConfirmation&&!j.done);
  const overdueJobs=allJobs.filter(isJobOverdue).sort((a,b)=>a.date.localeCompare(b.date)||String(a.time||"").localeCompare(String(b.time||"")));
  const upcomingJobs=allJobs.filter(j=>!isJobOverdue(j));
  const grouped={};
  upcomingJobs.forEach(j=>{if(!grouped[j.date])grouped[j.date]=[];grouped[j.date].push(j);});
  const weekStart=new Date();
  weekStart.setDate(weekStart.getDate()-weekStart.getDay());
  weekStart.setHours(0,0,0,0);
  const weekStartISO=`${weekStart.getFullYear()}-${String(weekStart.getMonth()+1).padStart(2,"0")}-${String(weekStart.getDate()).padStart(2,"0")}`;
  const completedThisWeek=jobs.filter(j=>j.done&&j.date>=weekStartISO&&j.type!=="brew").sort((a,b)=>b.date.localeCompare(a.date));
  const [showCompleted,setShowCompleted]=useState(false);
  const OverdueRow=(props)=><MiniJobRow {...props} onDelete={isAdmin&&onDelete?(job)=>{if(window.confirm("Delete this overdue task?"))onDelete(job.id);}:null}/>;
  return (
    <div style={S.screen}>
      <div style={S.subHdr}><button style={S.backBtn} onClick={onBack}>‹</button><div style={S.subTitle}>Tasks</div><div style={{marginLeft:"auto"}}><RefreshBtn onRefresh={onRefresh}/></div></div>
      {isAdmin&&pendingConfirms&&pendingConfirms.length>0&&(
        <div style={{...S.card,borderColor:"#4A90D9",background:"#EBF3FF"}}>
          <div style={{...S.cardTitle,color:"#4A90D9"}}>Awaiting Confirmation</div>
          <div style={{fontSize:12,color:"#4A90D9",marginBottom:10}}>Confirm the actual amounts to finish.</div>
          {pendingConfirms.map(j=>(
            <div key={j.id} style={S.confirmRow}>
              <div style={S.jobInfo}><div style={{...S.jobLabel,color:j.type==="delivery"?"#101010":"#4A90D9"}}>{j.label||j.type}</div><div style={S.jobMeta}>{formatDate(j.date)} · planned {j.liters||j.plannedTotal||0}</div></div>
              <button style={S.confirmBtn} onClick={()=>onConfirm(j)}>Confirm</button>
            </div>
          ))}
        </div>
      )}
      {overdueJobs.length>0&&(
        <div style={{...S.card,borderColor:"#E53935",background:"#FFF5F5"}}>
          <div style={{...S.cardTitle,color:"#E53935"}}>⚠ Overdue ({overdueJobs.length})</div>
          <div style={{display:"flex",gap:8}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,color:"#FFFFFF",background:"#101010",borderRadius:6,padding:"6px 4px",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",marginBottom:8,fontWeight:700}}>Deliveries</div>
              <DeliverySubGroups jobs={overdueJobs.filter(j=>j.type==="delivery")} onCheckoff={onCheckoff} onTap={onJobTap} RowComponent={OverdueRow}/>
            </div>
            <div style={{width:1,background:"#E8E8E8",flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,color:"#FFFFFF",background:"#4A90D9",borderRadius:6,padding:"6px 4px",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",marginBottom:8,fontWeight:700}}>Production</div>
              <ProductionSubGroups jobs={overdueJobs.filter(j=>j.type!=="delivery")} onCheckoff={onCheckoff} onTap={onJobTap} RowComponent={OverdueRow}/>
            </div>
          </div>
        </div>
      )}
      {Object.keys(grouped).sort().map(date=>{
        const deliveries=grouped[date].filter(j=>j.type==="delivery");
        const production=grouped[date].filter(j=>j.type!=="delivery");
        return (
          <div key={date} style={S.card}>
            <div style={S.cardTitle}>{formatDate(date)}</div>
            <div style={{display:"flex",gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:"#FFFFFF",background:"#101010",borderRadius:6,padding:"6px 4px",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",marginBottom:8,fontWeight:700}}>Deliveries</div>
                <DeliverySubGroups jobs={deliveries} onCheckoff={onCheckoff} onTap={onJobTap} RowComponent={MiniJobRow}/>
              </div>
              <div style={{width:1,background:"#E8E8E8",flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:"#FFFFFF",background:"#4A90D9",borderRadius:6,padding:"6px 4px",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",marginBottom:8,fontWeight:700}}>Production</div>
                <ProductionSubGroups jobs={production} onCheckoff={onCheckoff} onTap={onJobTap} RowComponent={MiniJobRow}/>
              </div>
            </div>
          </div>
        );
      })}
      {Object.keys(grouped).length===0&&overdueJobs.length===0&&(!pendingConfirms||pendingConfirms.length===0)&&<div style={{color:"#333333",padding:32,textAlign:"center",fontSize:13}}>No upcoming tasks</div>}
      {completedThisWeek.length>0&&(
        <div style={S.card}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:showCompleted?10:0}}>
            <div style={S.cardTitle}>✓ Completed This Week ({completedThisWeek.length})</div>
            <button style={{background:"none",border:"none",color:"#101010",fontSize:13,cursor:"pointer",fontWeight:600}} onClick={()=>setShowCompleted(v=>!v)}>{showCompleted?"Hide":"Show"}</button>
          </div>
          {showCompleted&&completedThisWeek.map(j=>(
            <div key={j.id} style={{...S.jobRow,opacity:0.7}}>
              <div style={{width:18,height:18,borderRadius:4,background:"#27AE60",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><span style={{color:"#fff",fontSize:11}}>✓</span></div>
              <div style={S.jobInfo}>
                <div style={{...S.jobLabel,color:"#444",fontSize:13}}>{j.type==="delivery"?j.storeName||j.privateName||j.cbName||(j.deliveryType==="coffeebar"?"Coffee Bar":"Private Delivery"):j.label||j.type}</div>
                <div style={{fontSize:11,color:"#888"}}>{j.type==="delivery"&&Object.entries(j.quantities||{}).filter(([,q])=>q>0).map(([pid,qty])=>`${qty} ${PRODUCTS[pid]?.label||pid}`).join(", ")}</div>
                <div style={S.jobMeta}>{formatDate(j.date)}{j.time?` · ${formatTime(j.time)}`:""}</div>
              </div>
              {isAdmin&&<button style={{background:"none",border:"none",color:"#C0392B",fontSize:18,cursor:"pointer",padding:"4px 8px"}} onClick={()=>{if(window.confirm("Delete this completed job? This will reverse its stock changes."))onDelete(j.id);}}>🗑</button>}
            </div>
          ))}
        </div>
      )}
      <div style={{height:110}}/>
    </div>
  );
}
function BeanOrderInput({beanKey, onOrder}) {
  const [orderedKg, setOrderedKg] = useState("");
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
      <input type="number" placeholder="kg ordered" style={{background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:8,padding:"6px 10px",fontSize:13,flex:1,color:"#1A1A1A",boxSizing:"border-box"}} value={orderedKg} onChange={e=>setOrderedKg(e.target.value)}/>
      <button style={{background:"#101010",color:"#fff",border:"none",borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}} onClick={async()=>{const v=parseFloat(orderedKg)||0;if(v<=0)return;await onOrder(beanKey,true,v);setOrderedKg("");}}>✓ Ordered</button>
    </div>
  );
}
function StockScreen({concentrate,setConcentrate,inventory,setInventory,needed,jobs,beans,setBeans,setBeanOrdered,deliverBeans,onBack,onRefresh,isAdmin}) {
  // All saves are immediate — no local buffer, no Save button needed.
  // Each +/- or input change calls the parent setter which writes to Supabase directly.
  const [savingKey,setSavingKey]=useState(null); // tracks which field is currently saving
  async function saveConc(k, val) {
    setSavingKey("conc_"+k);
    await setConcentrate(k, val);
    setSavingKey(null);
  }
  async function saveInv(pid, val) {
    setSavingKey("inv_"+pid);
    await setInventory(pid, val);
    setSavingKey(null);
  }
  async function saveBean(k, val) {
    setSavingKey("bean_"+k);
    await setBeans(k, val);
    setSavingKey(null);
  }
  const HDR={fontSize:14,fontWeight:700,color:"#FFFFFF",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",background:"#101010",borderRadius:8,padding:"8px",marginBottom:12,marginTop:2};
  return (
    <div style={S.screen}>
      <div style={S.subHdr}><button style={S.backBtn} onClick={onBack}>‹</button><div style={S.subTitle}>Stock & Concentrate</div><div style={{marginLeft:"auto"}}><RefreshBtn onRefresh={onRefresh}/></div></div>
      <div style={S.card}>
        <div style={{...S.cardTitle,...HDR}}>Concentrate (Liters)</div>
        {Object.entries(CONCENTRATE_TYPES).map(([k,ct])=>(
          <div key={k} style={S.editRow}>
            <span style={{...S.editLbl,color:ct.color}}>{ct.label}{savingKey==="conc_"+k&&<span style={{fontSize:10,color:"#4A90D9",marginLeft:6}}>saving…</span>}</span>
            <div style={S.editCtrl}>
              {isAdmin&&<button style={S.editBtn} onClick={()=>saveConc(k, Math.max(0,parseFloat(((concentrate[k]||0)-0.5).toFixed(1))))}>−</button>}
              <input type="number" step="0.5" style={{...S.editVal,background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:6,padding:"4px 6px",width:64,textAlign:"center",color:"#1A1A1A"}} value={concentrate[k]||""} readOnly={!isAdmin} onChange={isAdmin?e=>saveConc(k, e.target.value===""?0:parseFloat(e.target.value)||0):undefined}/>
              {isAdmin&&<button style={S.editBtn} onClick={()=>saveConc(k, parseFloat(((concentrate[k]||0)+0.5).toFixed(1)))}>+</button>}
            </div>
          </div>
        ))}
      </div>
      <div style={S.card}>
        <div style={{...S.cardTitle,...HDR}}>Upcoming Concentrate Needs</div>
        {(()=>{
          const inProgress={classic:0,houseBlend:0,colombia:0,decaf:0};
          (jobs||[]).filter(j=>j.brewStarted&&!j.done).forEach(j=>{const kgToL={3:19,2:12.7,1.5:9.5,1:6.4};const liters=kgToL[j.kg]||19;if(inProgress[j.product]!==undefined)inProgress[j.product]+=liters;});
          const allCovered=Object.entries(needed).every(([k,n])=>Math.max(0,n-(inProgress[k]||0))===0);
          return (<>
            {Object.keys(CONCENTRATE_TYPES).map(k=>{
              const n=needed[k]||0; const effectiveNeed=Math.max(0,n-(inProgress[k]||0)-(concentrate[k]||0)); const brewing=inProgress[k]||0;
              if (n===0&&brewing===0) return null;
              return (<div key={k} style={S.needRow}><div><div style={S.editLbl}>{CONCENTRATE_TYPES[k].label}</div>{brewing>0&&<div style={{fontSize:10,color:"#4A90D9"}}>🧪 {brewing.toFixed(1)}L brewing</div>}</div><span style={{color:effectiveNeed===0?"#27AE60":"#E53935",fontWeight:600}}>{effectiveNeed===0?"✓ Covered":`Need ${effectiveNeed.toFixed(1)}L more`}</span></div>);
            })}
            {allCovered&&<div style={S.empty}>All concentrate needs covered</div>}
          </>);
        })()}
      </div>
      {[{title:"Liter Bottles",cats:["liter"]},{title:"Mini Bottles",cats:["mini"]},{title:"Jerry Cans",cats:["jerry"]},{title:"Syrups",cats:["syrup"]},{title:"Dispensers",cats:["dispenser"]}].map(({title,cats})=>{
        const items=Object.entries(PRODUCTS).filter(([,p])=>cats.includes(p.category));
        if (items.length===0) return null;
        return (
          <div key={title} style={S.card}>
            <div style={{...S.cardTitle,...HDR}}>{title}</div>
            {items.map(([pid,p])=>(
              <div key={pid} style={S.editRow}>
                <span style={S.editLbl}>{p.label}{savingKey==="inv_"+pid&&<span style={{fontSize:10,color:"#4A90D9",marginLeft:6}}>saving…</span>}</span>
                <div style={S.editCtrl}>
                  {isAdmin&&<button style={S.editBtn} onClick={()=>saveInv(pid,Math.max(0,(inventory[pid]||0)-1))}>−</button>}
                  <input type="number" style={{...S.editVal,background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:6,padding:"4px 6px",width:64,textAlign:"center",color:"#1A1A1A"}} value={inventory[pid]||""} readOnly={!isAdmin} onChange={isAdmin?e=>saveInv(pid,Math.max(0,parseInt(e.target.value)||0)):undefined}/>
                  {isAdmin&&<button style={S.editBtn} onClick={()=>saveInv(pid,(inventory[pid]||0)+1)}>+</button>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      <div style={S.card}>
        <div style={{...S.cardTitle,...HDR}}>Coffee Beans (kg)</div>
        {Object.entries(BEAN_TYPES).map(([k,bt])=>{
          const beanData=beans[k]||{};
          const kg=beanData.kg??0;
          const ordered=beanData.ordered||false;
          const orderedKg=beanData.orderedKg||0;
          const isLow=kg<=bt.warnKg;
          return (
            <div key={k} style={{borderBottom:"1px solid #E8E8E8",paddingBottom:10,marginBottom:10}}>
              <div style={S.editRow}>
                <span style={{...S.editLbl,color:isLow&&!ordered?"#E53935":"#444"}}>{bt.label}{savingKey==="bean_"+k&&<span style={{fontSize:10,color:"#4A90D9",marginLeft:6}}>saving…</span>}</span>
                <div style={S.editCtrl}>
                  {isAdmin&&<button style={S.editBtn} onClick={()=>saveBean(k,Math.max(0,parseFloat(((kg)-1).toFixed(1))))}>−</button>}
                  <input type="number" step="any" style={{...S.editVal,background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:6,padding:"4px 6px",width:64,textAlign:"center",color:"#1A1A1A"}} value={kg||""} readOnly={!isAdmin} onChange={isAdmin?e=>saveBean(k,Math.max(0,parseFloat(e.target.value)||0)):undefined}/>
                  {isAdmin&&<button style={S.editBtn} onClick={()=>saveBean(k,parseFloat((kg+1).toFixed(1)))}>+</button>}
                </div>
              </div>
              {isAdmin&&isLow&&!ordered&&(
                <BeanOrderInput beanKey={k} onOrder={setBeanOrdered}/>
              )}
              {ordered&&(
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:6,background:"#F0FFF4",borderRadius:8,padding:"8px 10px"}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:"#27AE60",marginBottom:6}}>✓ Ordered — {orderedKg}kg incoming</div>
                    <div style={{fontSize:10,color:"#888",marginTop:2}}>{isAdmin?"Tap Delivered when stock arrives":"Awaiting delivery"}</div>
                  </div>
                  {isAdmin&&<div style={{display:"flex",gap:6}}>
                    <button style={{background:"#27AE60",color:"#fff",border:"none",borderRadius:8,padding:"7px 10px",fontSize:12,fontWeight:700,cursor:"pointer"}} onClick={async()=>{await deliverBeans(k);}}>📦 Delivered</button>
                    <button style={{background:"#F0F0F0",color:"#888",border:"none",borderRadius:8,padding:"7px 10px",fontSize:12,cursor:"pointer"}} onClick={async()=>{await setBeanOrdered(k,false,0);}}>✕</button>
                  </div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{height:110}}/>
    </div>
  );
}
function NeedToMakeScreen({jobs,inventory,concentrate,onBack,onRefresh}) {
  const today=todayISO();
  const tomorrow=tomorrowISO();
  const upcoming=jobs.filter(j=>!j.done&&j.date>=today);
  const urgentJobs=jobs.filter(j=>!j.done&&(j.date===today||j.date===tomorrow));
  const inProgress={classic:0,houseBlend:0,colombia:0,decaf:0};
  jobs.filter(j=>j.brewStarted&&!j.done).forEach(j=>{const kgToL={3:19,2:12.7,1.5:9.5,1:6.4};const liters=kgToL[j.kg]||19;if(inProgress[j.product]!==undefined)inProgress[j.product]+=liters;});
  const urgentBottleNeeds={};
  urgentJobs.forEach(j=>{
    if (j.type!=="delivery") return;
    Object.entries(j.quantities||{}).forEach(([pid,qty])=>{if(!qty)return;urgentBottleNeeds[pid]=(urgentBottleNeeds[pid]||0)+qty;});
    if (j.deliveryType==="coffeebar") {
      const canCount=Math.floor((j.people||0)/25);
      const cans=j.jerryCans||Array(canCount).fill("classic");
      const jerryMap={classic:"jerry_can",houseBlend:"jerry_can_houseblend",colombia:"jerry_can_colombia",decaf:"jerry_can_decaf"};
      cans.forEach(ct=>{const pid=jerryMap[ct]||"jerry_can";urgentBottleNeeds[pid]=(urgentBottleNeeds[pid]||0)+1;});
      if (j.dispensers) urgentBottleNeeds["dispenser"]=(urgentBottleNeeds["dispenser"]||0)+j.dispensers;
    }
  });
  const bottleNeeds={};
  upcoming.forEach(j=>{
    if (j.type!=="delivery") return;
    Object.entries(j.quantities||{}).forEach(([pid,qty])=>{if(!qty)return;bottleNeeds[pid]=(bottleNeeds[pid]||0)+qty;});
    if (j.deliveryType==="coffeebar") {
      const canCount=Math.floor((j.people||0)/25);
      const cans=j.jerryCans||Array(canCount).fill("classic");
      const jerryMap={classic:"jerry_can",houseBlend:"jerry_can_houseblend",colombia:"jerry_can_colombia",decaf:"jerry_can_decaf"};
      cans.forEach(ct=>{const pid=jerryMap[ct]||"jerry_can";bottleNeeds[pid]=(bottleNeeds[pid]||0)+1;});
      if (j.dispensers) bottleNeeds["dispenser"]=(bottleNeeds["dispenser"]||0)+j.dispensers;
    }
  });
  const concNeeds=concentrateNeeded(upcoming,inventory,concentrate);
  const bottleGaps=Object.entries(bottleNeeds).map(([pid,totalNeeded])=>{const inStock=inventory[pid]||0;return{pid,totalNeeded,inStock,gap:totalNeeded-inStock};}).filter(({totalNeeded})=>totalNeeded>0);
  const bottleShortfalls=bottleGaps.filter(g=>g.gap>0);
  const bottleCovered=bottleGaps.filter(g=>g.gap<=0);
  const concGaps=Object.keys(CONCENTRATE_TYPES).map(k=>{const gap=concNeeds[k]||0;const have=concentrate[k]||0;return{k,needed:gap+have,have,gap};}).filter(({gap,k})=>gap>0||(inProgress[k]||0)>0);
  const concShortfalls=concGaps.map(g=>({...g,effectiveGap:Math.max(0,g.gap-(inProgress[g.k]||0)-(concentrate[g.k]||0)),brewing:inProgress[g.k]||0})).filter(g=>g.effectiveGap>0||g.brewing>0);
  const concCovered=Object.entries(concentrate).filter(([k,v])=>v>0&&(concNeeds[k]||0)===0).map(([k,v])=>({k,have:v,needed:0}));
  const hasAnything=bottleGaps.length>0||concGaps.length>0;
  const RHDR={fontSize:13,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",color:"#FFFFFF",background:"#E53935",borderRadius:8,padding:"8px",textAlign:"center",marginBottom:12,marginTop:2};
  const GHDR={fontSize:13,fontWeight:700,letterSpacing:0.5,textTransform:"uppercase",color:"#FFFFFF",background:"#27AE60",borderRadius:8,padding:"8px",textAlign:"center",marginBottom:12,marginTop:2};
  return (
    <div style={S.screen}>
      <div style={S.subHdr}><button style={S.backBtn} onClick={onBack}>‹</button><div style={S.subTitle}>Need to Make</div><div style={{marginLeft:"auto"}}><RefreshBtn onRefresh={onRefresh}/></div></div>
      {!hasAnything&&<div style={{color:"#333333",padding:32,textAlign:"center",fontSize:13}}>No upcoming deliveries or production scheduled</div>}
      {(()=>{
        const urgentGaps=Object.entries(urgentBottleNeeds).map(([pid,totalNeeded])=>{const inStock=inventory[pid]||0;return{pid,totalNeeded,inStock,gap:totalNeeded-inStock};}).filter(g=>g.totalNeeded>0&&g.gap>0);
        const urgentConc=concentrateNeeded(urgentJobs,inventory,concentrate);
        const urgentConcShortfalls=Object.entries(urgentConc).filter(([k,gap])=>gap>0).map(([k,gap])=>({k,gap,have:concentrate[k]||0,effectiveGap:Math.max(0,gap-(inProgress[k]||0)-(concentrate[k]||0)),brewing:inProgress[k]||0})).filter(g=>g.effectiveGap>0||g.brewing>0);
        if (urgentGaps.length===0&&urgentConcShortfalls.length===0) return null;
        return (
          <div style={{...S.card,borderColor:"#E53935",background:"#FFF8F8"}}>
            <div style={{...S.cardTitle,...RHDR}}>🔥 Needed Today or Tomorrow</div>
            {[{cat:"liter",label:"Liter Bottles"},{cat:"mini",label:"Mini Bottles"},{cat:"jerry",label:"Jerry Cans"}].map(({cat,label})=>{
              const items=urgentGaps.filter(g=>PRODUCTS[g.pid]?.category===cat);
              if (items.length===0) return null;
              return (<div key={cat}><div style={{fontSize:9,color:"#E53935",letterSpacing:1.5,textTransform:"uppercase",fontWeight:700,marginTop:8,marginBottom:3,borderBottom:"1px solid #E5393522",paddingBottom:2}}>{label}</div>
                {items.map(({pid,totalNeeded,inStock,gap})=>(<div key={pid} style={S.needRow}><div><div style={{fontSize:14,fontWeight:600,color:"#1A1A1A"}}>{PRODUCTS[pid]?.label}</div><div style={{fontSize:11,color:"#333"}}>Need {totalNeeded} · Have {inStock}</div></div><div style={{color:"#E53935",fontWeight:700,fontSize:15}}>Make {gap} more</div></div>))}
              </div>);
            })}
            {urgentConcShortfalls.length>0&&(<div><div style={{fontSize:9,color:"#E53935",letterSpacing:1.5,textTransform:"uppercase",fontWeight:700,marginTop:8,marginBottom:3,borderBottom:"1px solid #E5393522",paddingBottom:2}}>Concentrate</div>
              {urgentConcShortfalls.map(({k,gap,have,effectiveGap,brewing})=>(<div key={k} style={S.needRow}><div><div style={{fontSize:14,fontWeight:600,color:"#1A1A1A"}}>{CONCENTRATE_TYPES[k]?.label}</div><div style={{fontSize:11,color:"#333"}}>Need {(gap+have).toFixed(1)}L · Have {have.toFixed(1)}L</div>{brewing>0&&<div style={{fontSize:10,color:"#4A90D9"}}>🧪 {brewing.toFixed(1)}L brewing</div>}</div><div style={{color:effectiveGap===0?"#27AE60":"#E53935",fontWeight:700,fontSize:15}}>{effectiveGap===0?"✓ Covered":`Brew ${effectiveGap.toFixed(1)}L more`}</div></div>))}
            </div>)}
          </div>
        );
      })()}
      {(bottleShortfalls.length>0||concShortfalls.length>0)&&<div style={{...S.cardTitle,fontSize:13,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",color:"#101010",borderBottom:"2px solid #10101022",paddingBottom:6,marginBottom:8,margin:"14px 12px 4px"}}>Upcoming</div>}
      {bottleShortfalls.filter(g=>PRODUCTS[g.pid]?.category!=="jerry").length>0&&(
        <div style={S.card}><div style={{...S.cardTitle,...RHDR}}>⚠ Bottles to Produce</div>
          {bottleShortfalls.filter(g=>PRODUCTS[g.pid]?.category!=="jerry").map(({pid,totalNeeded,inStock,gap})=>(<div key={pid} style={S.needRow}><div><div style={{fontSize:14,fontWeight:600,color:"#1A1A1A"}}>{PRODUCTS[pid]?.label}</div><div style={{fontSize:11,color:"#333333"}}>Need {totalNeeded} · Have {inStock} in stock</div></div><div style={{color:"#E53935",fontWeight:700,fontSize:15}}>Make {gap} more</div></div>))}
        </div>
      )}
      {bottleShortfalls.filter(g=>PRODUCTS[g.pid]?.category==="jerry").length>0&&(
        <div style={S.card}><div style={{...S.cardTitle,...RHDR}}>⚠ Jerry Cans to Make</div>
          {bottleShortfalls.filter(g=>PRODUCTS[g.pid]?.category==="jerry").map(({pid,totalNeeded,inStock,gap})=>(<div key={pid} style={S.needRow}><div><div style={{fontSize:14,fontWeight:600,color:"#1A1A1A"}}>{PRODUCTS[pid]?.label}</div><div style={{fontSize:11,color:"#333333"}}>Need {totalNeeded} · Have {inStock} in stock</div></div><div style={{color:"#E53935",fontWeight:700,fontSize:15}}>Make {gap} more</div></div>))}
        </div>
      )}
      {concShortfalls.length>0&&(
        <div style={S.card}><div style={{...S.cardTitle,...RHDR}}>⚠ Concentrate to Brew</div>
          {concShortfalls.map(({k,needed,have,effectiveGap,brewing})=>(<div key={k} style={S.needRow}><div><div style={{fontSize:14,fontWeight:600,color:"#1A1A1A"}}>{CONCENTRATE_TYPES[k]?.label}</div><div style={{fontSize:11,color:"#333333"}}>Need {needed.toFixed(1)}L · Have {have.toFixed(1)}L</div>{brewing>0&&<div style={{fontSize:10,color:"#4A90D9"}}>🧪 {brewing.toFixed(1)}L brewing</div>}</div><div style={{color:effectiveGap===0?"#27AE60":"#E53935",fontWeight:700,fontSize:15}}>{effectiveGap===0?"✓ Covered":`Brew ${effectiveGap.toFixed(1)}L more`}</div></div>))}
        </div>
      )}
      {bottleCovered.length>0&&(
        <div style={S.card}><div style={{...S.cardTitle,...GHDR}}>✓ Bottles Covered by Stock</div>
          {bottleCovered.map(({pid,totalNeeded,inStock})=>(<div key={pid} style={S.needRow}><div style={{fontSize:14,color:"#222222"}}>{PRODUCTS[pid]?.label}</div><div style={{color:"#27AE60",fontSize:13}}>✓ {inStock} in stock (need {totalNeeded})</div></div>))}
        </div>
      )}
      {concCovered.length>0&&(
        <div style={S.card}><div style={{...S.cardTitle,...GHDR}}>✓ Concentrate Covered</div>
          {concCovered.map(({k,needed,have})=>(<div key={k} style={S.needRow}><div style={{fontSize:14,color:"#222222"}}>{CONCENTRATE_TYPES[k].label}</div><div style={{color:"#27AE60",fontSize:13}}>✓ {have.toFixed(1)}L ready (need {needed.toFixed(1)}L)</div></div>))}
        </div>
      )}
      <div style={{height:110}}/>
    </div>
  );
}
function ProductionDetail({job,onClose,onCheckoff,onDelete,onEdit,isAdmin}) {
  const isBrew=job.type==="brew";
  const isBottling=job.type==="bottling";
  const title=isBrew?`Brew ${CONCENTRATE_TYPES[job.product]?.label||""}`:`Bottle ${job.liters}L ${PRODUCTS[job.product]?.label||""}`;
  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <div style={S.modalTitle}>{title}</div>
        <div style={S.modalMeta}>{formatDate(job.date)}{job.time?` · ${formatTime(job.time)}`:""}</div>
        <div style={{marginBottom:14}}>
          {isBrew&&<div style={S.qtyListRow}><span style={{color:"#222222"}}>Coffee</span><span style={{color:"#4A90D9",fontWeight:700}}>{job.kg}kg</span></div>}
          {isBottling&&<div style={S.qtyListRow}><span style={{color:"#222222"}}>Liters</span><span style={{color:"#4A90D9",fontWeight:700}}>{job.liters}L</span></div>}
          {isBrew&&<div style={S.qtyListRow}><span style={{color:"#222222"}}>Drain after</span><span style={{color:"#4A90D9",fontWeight:700}}>{job.product==="classic"?"22":"18"}h</span></div>}
        </div>
        <div style={S.modalActions}>
          <button style={S.btnSecondary} onClick={onClose}>Close</button>
          {isAdmin&&<button style={{...S.btnPrimary,background:"#4A90D9"}} onClick={onCheckoff}>{job.brewStarted?"Mark Drained ✓":"Mark Done ✓"}</button>}
        </div>
        {isAdmin&&<div style={{display:"flex",gap:8,marginTop:8}}>
          <button style={{...S.btnSecondary,flex:1}} onClick={onEdit}>✏️ Edit</button>
          <button style={{...S.btnSecondary,flex:1,color:"#C0392B",borderColor:"#C0392B44"}} onClick={()=>{if(window.confirm("Delete this job?"))onDelete();}}>🗑 Delete</button>
        </div>}
      </div>
    </div>
  );
}
function DeliveryDetail({job,onClose,onCheckoff,onDelete,onEdit,isAdmin}) {
  const store=STORES.find(s=>s.name===job.storeName);
  const msg=(store&&job.done)?generateWAMessage(store,job):"";
  const waLink=(store?.phone&&job.done)?`https://wa.me/${store.phone}?text=${encodeURIComponent(msg)}`:null;
  return (
    <div style={S.modal} onClick={onClose}>
      <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
        <div style={S.modalTitle}>{job.storeName||job.privateName||"Private Delivery"}</div>
        <div style={S.modalMeta}>{formatDate(job.date)}{job.time?` · ${formatTime(job.time)}`:""}</div>
        {job.privateName&&<div style={{fontSize:13,color:"#222222",marginBottom:4}}>👤 {job.privateName}</div>}
        {job.privateAddress&&<div style={{fontSize:13,color:"#222222",marginBottom:10}}>📍 {job.privateAddress}</div>}
        <div style={{marginBottom:14}}>
          {Object.entries(job.quantities||{}).filter(([,q])=>q>0).map(([pid,qty])=>(<div key={pid} style={S.qtyListRow}><span style={{color:"#222222"}}>{PRODUCTS[pid]?.label}</span><span style={{color:"#101010",fontWeight:700}}>{qty}</span></div>))}
          {job.deliveryType==="coffeebar"&&<div style={S.qtyListRow}><span style={{color:"#222222"}}>Coffee Bar</span><span style={{color:"#101010",fontWeight:700}}>{job.people} people · {(job.people/25)*5}L Classic</span></div>}
        </div>
        {waLink&&isAdmin&&<a href={waLink} target="_blank" rel="noreferrer" style={S.waBtn}>💬 Send WhatsApp</a>}
        <div style={S.modalActions}>
          <button style={S.btnSecondary} onClick={onClose}>Close</button>
          {isAdmin&&<button style={S.btnPrimary} onClick={onCheckoff}>Mark Delivered ✓</button>}
        </div>
        {isAdmin&&<div style={{display:"flex",gap:8,marginTop:8}}>
          <button style={{...S.btnSecondary,flex:1}} onClick={onEdit}>✏️ Edit</button>
          <button style={{...S.btnSecondary,flex:1,color:"#C0392B",borderColor:"#C0392B44"}} onClick={()=>{if(window.confirm("Delete this job?"))onDelete();}}>🗑 Delete</button>
        </div>}
      </div>
    </div>
  );
}
function CheckoffModal({job,onConfirm,onCancel}) {
  const isDelivery=job.type==="delivery";
  const planned=job.liters||job.plannedTotal||0;
  const [actual,setActual]=useState(planned);
  const [confirmedQtys,setConfirmedQtys]=useState(Object.fromEntries(Object.entries(job.quantities||{}).map(([pid,qty])=>[pid,qty])));
  const [allCorrect,setAllCorrect]=useState(null);
  const [cbPeople,setCbPeople]=useState(job.people||25);
  const [cbDispensers,setCbDispensers]=useState(job.dispensers||0);
  const [cbSyrups2,setCbSyrups2]=useState(job.cbSyrups||{vanilla_syrup:0,caramel_syrup:0,sugar_syrup:0});
  if (isDelivery&&allCorrect===null) {
    const syrupList=Object.entries(job.cbSyrups||{}).filter(([,q])=>q>0).map(([pid,qty])=>`${qty} ${PRODUCTS[pid]?.label||pid}`).join(", ");
    const itemList=job.deliveryType==="coffeebar"
      ?`Coffee Bar — ${job.people} people, ${(job.jerryCans||[]).length} jerry cans, ${job.dispensers||0} dispensers${syrupList?", "+syrupList:""}`
      :Object.entries(job.quantities||{}).filter(([,q])=>q>0).map(([pid,qty])=>`${qty}x ${PRODUCTS[pid]?.label}`).join(", ");
    return (
      <div style={S.modal} onClick={onCancel}>
        <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
          <div style={S.modalTitle}>Confirm Delivery</div>
          <div style={{color:"#222222",fontSize:14,marginBottom:16,lineHeight:1.6}}>Did you deliver exactly:<br/><strong style={{color:"#101010"}}>{itemList||"nothing listed"}</strong>?</div>
          <div style={S.modalActions}>
            <button style={S.btnSecondary} onClick={()=>setAllCorrect(false)}>No, change it</button>
            <button style={S.btnPrimary} onClick={()=>onConfirm(job,planned,null)}>Yes ✓</button>
          </div>
          <button style={{...S.btnSecondary,width:"100%",marginTop:8}} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }
  if (isDelivery&&allCorrect===false) {
    if (job.deliveryType==="coffeebar") {
      return (
        <div style={S.modal} onClick={onCancel}>
          <div style={{...S.modalBox,maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={S.modalTitle}>What did you actually deliver?</div>
            <div style={{marginBottom:16}}>
              <div style={S.qRow}><span style={S.qLabel}>Jerry Cans ({Math.floor(cbPeople/25)})</span><div style={{display:"flex",alignItems:"center",gap:8}}><button style={S.editBtn} onClick={()=>setCbPeople(p=>Math.max(25,p-25))}>−</button><span style={{minWidth:30,textAlign:"center"}}>{Math.floor(cbPeople/25)}</span><button style={S.editBtn} onClick={()=>setCbPeople(p=>p+25)}>+</button></div></div>
              <div style={S.qRow}><span style={S.qLabel}>Dispensers</span><div style={{display:"flex",alignItems:"center",gap:8}}><button style={S.editBtn} onClick={()=>setCbDispensers(p=>Math.max(0,p-1))}>−</button><span style={{minWidth:30,textAlign:"center"}}>{cbDispensers}</span><button style={S.editBtn} onClick={()=>setCbDispensers(p=>p+1)}>+</button></div></div>
              {["vanilla_syrup","caramel_syrup","sugar_syrup"].map(pid=>(
                <div key={pid} style={S.qRow}><span style={S.qLabel}>{PRODUCTS[pid]?.label}</span><div style={{display:"flex",alignItems:"center",gap:8}}><button style={S.editBtn} onClick={()=>setCbSyrups2(s=>({...s,[pid]:Math.max(0,(s[pid]||0)-1)}))}>−</button><span style={{minWidth:30,textAlign:"center"}}>{cbSyrups2[pid]||0}</span><button style={S.editBtn} onClick={()=>setCbSyrups2(s=>({...s,[pid]:(s[pid]||0)+1}))}>+</button></div></div>
              ))}
            </div>
            <div style={S.modalActions}>
              <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
              <button style={S.btnPrimary} onClick={()=>onConfirm({...job,people:cbPeople,dispensers:cbDispensers,cbSyrups:cbSyrups2,jerryCans:Array(Math.floor(cbPeople/25)).fill("classic")},cbPeople,null)}>Confirm ✓</button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div style={S.modal} onClick={onCancel}>
        <div style={S.modalBox} onClick={e=>e.stopPropagation()}>
          <div style={S.modalTitle}>What did you actually deliver?</div>
          <div style={{marginBottom:16}}>
            {Object.entries(job.quantities||{}).filter(([,q])=>q>0).map(([pid,qty])=>(
              <div key={pid} style={{...S.qRow,gap:8}}>
                <span style={{...S.qLabel,flex:1}}>{PRODUCTS[pid]?.label}</span>
                <button style={{...S.editBtn,width:28,height:28}} onClick={()=>setConfirmedQtys(q=>({...q,[pid]:Math.max(0,(q[pid]??qty)-1)}))}>−</button>
                <input type="number" min="0" style={{...S.qInput,width:48}} value={confirmedQtys[pid]??qty} onChange={e=>setConfirmedQtys(q=>({...q,[pid]:Number(e.target.value)||0}))}/>
                <button style={{...S.editBtn,width:28,height:28}} onClick={()=>setConfirmedQtys(q=>({...q,[pid]:(q[pid]??qty)+1}))}>+</button>
              </div>
            ))}
          </div>
          <div style={S.modalActions}>
            <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
            <button style={S.btnPrimary} onClick={()=>{const total=Object.values(confirmedQtys).reduce((s,v)=>s+(v||0),0);onConfirm(job,total,confirmedQtys);}}>Confirm ✓</button>
          </div>
        </div>
      </div>
    );
  }
  const isBottling=job.type==="bottling";
  const [labeledUsed,setLabeledUsed]=useState({});
  const [askLabeled,setAskLabeled]=useState(false);
  const MINI_P=["vanilla_mini","original_mini","caramel_mini","classic_mini","house_blend_mini"];
  const JERRY_P=["jerry_can","jerry_can_houseblend","jerry_can_colombia","jerry_can_decaf"];
  function getBottledUnits(liters) {
    if (MINI_P.includes(job.product)) return Math.round(liters*4);
    if (JERRY_P.includes(job.product)) return Math.round(liters/5);
    return Math.round(liters);
  }
  if (isBottling&&!askLabeled) {
    const prompt=`You planned to make ${planned}L of ${PRODUCTS[job.product]?.label}. How much did you actually make?`;
    return (
      <div style={S.modal}>
        <div style={S.modalBox}>
          <div style={S.modalTitle}>Confirm Bottling</div>
          <div style={{color:"#222222",fontSize:14,marginBottom:16,lineHeight:1.6}}>{prompt}</div>
          <input type="number" style={{...S.inp,fontSize:24,textAlign:"center",marginBottom:6}} value={actual} onChange={e=>{setActual(Number(e.target.value));}}/>
          <div style={{fontSize:11,color:"#555555",marginBottom:16,textAlign:"center"}}>Edit if different from planned</div>
          <div style={S.modalActions}>
            <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
            <button style={S.btnPrimary} onClick={()=>{
              if (LABELED_PRODUCTS.includes(job.product)) {
                setLabeledUsed({[job.product]:getBottledUnits(actual)});
                setAskLabeled(true);
              } else {
                onConfirm(job,actual,null);
              }
            }}>Next →</button>
          </div>
        </div>
      </div>
    );
  }
  if (isBottling&&askLabeled) {
    return (
      <div style={S.modal}>
        <div style={S.modalBox}>
          <div style={S.modalTitle}>Labeled Bottles Used?</div>
          <div style={{color:"#222222",fontSize:14,marginBottom:16,lineHeight:1.6}}>How many labeled <strong>{PRODUCTS[job.product]?.label}</strong> bottles did you use?</div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
            <button style={S.editBtn} onClick={()=>setLabeledUsed(p=>({...p,[job.product]:Math.max(0,(p[job.product]||0)-1)}))}>−</button>
            <input type="number" min="0" style={{...S.inp,fontSize:24,textAlign:"center"}} value={labeledUsed[job.product]||0} onChange={e=>setLabeledUsed(p=>({...p,[job.product]:Number(e.target.value)||0}))}/>
            <button style={S.editBtn} onClick={()=>setLabeledUsed(p=>({...p,[job.product]:(p[job.product]||0)+1}))}>+</button>
          </div>
          <div style={{fontSize:11,color:"#555",marginBottom:16,textAlign:"center"}}>Set to 0 if you didn't use labeled bottles</div>
          <div style={S.modalActions}>
            <button style={S.btnSecondary} onClick={()=>setAskLabeled(false)}>← Back</button>
            <button style={S.btnPrimary} onClick={()=>onConfirm({...job,labeledUsed},actual,null)}>Confirm ✓</button>
          </div>
        </div>
      </div>
    );
  }
  const prompt=`You planned to deliver ${planned} units. How many did you actually deliver?`;
  return (
    <div style={S.modal}>
      <div style={S.modalBox}>
        <div style={S.modalTitle}>Confirm Check-off</div>
        <div style={{color:"#222222",fontSize:14,marginBottom:16,lineHeight:1.6}}>{prompt}</div>
        <input type="number" style={{...S.inp,fontSize:24,textAlign:"center",marginBottom:6}} value={actual} onChange={e=>setActual(Number(e.target.value))}/>
        <div style={{fontSize:11,color:"#555555",marginBottom:16,textAlign:"center"}}>Edit if different from planned</div>
        <div style={S.modalActions}>
          <button style={S.btnSecondary} onClick={onCancel}>Cancel</button>
          <button style={S.btnPrimary} onClick={()=>onConfirm(job,actual,null)}>Confirm</button>
        </div>
      </div>
    </div>
  );
}
function WebsiteScheduleDrawer({orders,onSchedule,onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:90,display:"flex",flexDirection:"column",justifyContent:"flex-end"}} onClick={onClose}>
      <div style={{background:"#FFFFFF",borderRadius:"16px 16px 0 0",border:"1px solid #E0E0E0",maxHeight:"75vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 16px 10px",flexShrink:0,borderBottom:"1px solid #E0E0E0"}}>
          <div style={S.alertDrawerHeader}><span style={{...S.alertDrawerTitle,color:"#4A90D9"}}>📦 Schedule new delivery</span><button style={S.alertClose} onClick={onClose}>✕</button></div>
          <div style={{fontSize:12,color:"#666",marginTop:6}}>Orders waiting to be scheduled</div>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"0 16px 100px"}}>
          {orders.length===0&&<div style={{color:"#888",fontSize:13,padding:"12px 0"}}>Nothing to schedule!</div>}
          {orders.map(o=>{
            const itemsText=(o.items||[]).map(i=>`${i.name_en||i.name_he||"Item"} ×${i.qty||1}`).join(", ");
            const unpaid=o.payment_status&&o.payment_status!=="paid";
            return (
              <div key={o.id} style={{...S.alertRow,flexDirection:"column",alignItems:"flex-start",gap:6,marginTop:8}}>
                <div style={{fontWeight:600,fontSize:14,color:"#1A1A1A",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  Order #{o.order_number||"—"} — {o.customer_name||"Customer"}
                  {unpaid?<span style={{fontSize:10,fontWeight:700,color:"#C8860A",background:"#FFF8E8",border:"1px solid #E8C878",borderRadius:6,padding:"2px 7px"}}>Awaiting payment</span>:null}
                </div>
                <div style={{fontSize:11,color:"#888"}}>{itemsText}</div>
                {o.delivery_address?<div style={{fontSize:11,color:"#4A90D9"}}>📍 {o.delivery_address}</div>:<div style={{fontSize:11,color:"#888",fontStyle:"italic"}}>Address — add when scheduling</div>}
                {o.customer_phone?<div style={{fontSize:11,color:"#555"}}>{o.customer_phone}</div>:null}
                <button style={{background:"#4A90D9",color:"#fff",border:"none",borderRadius:8,padding:"9px",fontSize:13,fontWeight:600,cursor:"pointer",width:"100%",marginTop:4}} onClick={()=>onSchedule(o)}>Schedule now →</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function BillingDrawer({jobs,onMarkBilled,onMarkPaid,onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"#00000066",zIndex:90,display:"flex",flexDirection:"column",justifyContent:"flex-end"}} onClick={onClose}>
      <div style={{background:"#FFFFFF",borderRadius:"16px 16px 0 0",border:"1px solid #E0E0E0",maxHeight:"75vh",display:"flex",flexDirection:"column"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 16px 10px",flexShrink:0,borderBottom:"1px solid #E0E0E0"}}>
          <div style={S.alertDrawerHeader}><span style={{...S.alertDrawerTitle,color:"#C8860A"}}>💰 Billing</span><button style={S.alertClose} onClick={onClose}>✕</button></div>
        </div>
        <div style={{overflowY:"auto",flex:1,padding:"0 16px 100px"}}>
          {jobs.length===0&&<div style={{color:"#888",fontSize:13,padding:"12px 0"}}>All billed!</div>}
          {jobs.map(job=>{
            const name=job.deliveryType==="coffeebar"?`Coffee Bar${job.cbName?" — "+job.cbName:""}` :(job.privateName||"Private Delivery");
            const detail=Object.entries(job.quantities||{}).filter(([,q])=>q>0).map(([pid,qty])=>qty+" "+(PRODUCTS[pid]?.label||pid)).join(", ");
            return (
              <div key={job.id} style={{...S.alertRow,flexDirection:"column",alignItems:"flex-start",gap:6,marginTop:8}}>
                <div style={{fontWeight:600,fontSize:14,color:"#1A1A1A"}}>{name}</div>
                <div style={{fontSize:11,color:"#888"}}>{formatDate(job.date)}{job.time?" · "+formatTime(job.time):""}</div>
                {detail?<div style={{fontSize:11,color:"#555"}}>{detail}</div>:null}
                {(job.privateAddress||job.cbAddress)?<div style={{fontSize:11,color:"#4A90D9"}}>📍 {job.privateAddress||job.cbAddress}</div>:null}
                {!job.billed&&<button style={{background:"#C8860A",color:"#fff",border:"none",borderRadius:8,padding:"9px",fontSize:13,fontWeight:600,cursor:"pointer",width:"100%",marginTop:4}} onClick={()=>onMarkBilled(job.id)}>✓ Mark as Billed</button>}
                {job.billed&&!job.paid&&(
                  <div style={{background:"#F0FFF4",border:"1px solid #27AE60",borderRadius:8,padding:"10px",marginTop:4}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#27AE60",marginBottom:6}}>✓ Billed — awaiting payment</div>
                    <button style={{background:"#27AE60",color:"#fff",border:"none",borderRadius:8,padding:"9px",fontSize:13,fontWeight:600,cursor:"pointer",width:"100%"}} onClick={()=>onMarkPaid(job.id)}>💳 Mark as Paid</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function WaDrawer({jobs,onMarkSent,onClose}) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:90}}>
      <div style={{position:"absolute",inset:0,background:"#00000044"}} onClick={onClose}/>
      <div style={{position:"absolute",bottom:0,left:0,right:0,...S.alertDrawerInner}}>
        <div style={S.alertDrawerHeader}><span style={{...S.alertDrawerTitle,color:"#25D366"}}>💬 WhatsApp Delivery Notes</span><button style={S.alertClose} onClick={onClose}>✕</button></div>
        {jobs.length===0&&<div style={{color:"#888",fontSize:13,padding:"12px 0"}}>All sent!</div>}
        {jobs.map(job=>{
          const store=STORES.find(s=>s.name===job.storeName);
          const msg=store?generateWAMessage(store,job):"";
          const waLink=store?.phone?`https://wa.me/${store.phone}?text=${encodeURIComponent(msg)}`:null;
          return (
            <div key={job.id} style={{...S.alertRow,flexDirection:"column",alignItems:"flex-start",gap:8}}>
              <div style={{fontWeight:600,fontSize:14,color:"#1A1A1A"}}>{job.storeName}</div>
              <div style={{fontSize:11,color:"#888"}}>{formatDate(job.date)}</div>
              <div style={{display:"flex",gap:8,width:"100%"}}>
                {waLink&&<a href={waLink} target="_blank" rel="noreferrer" style={{flex:1,background:"#25D366",color:"#fff",textAlign:"center",padding:"9px",borderRadius:8,textDecoration:"none",fontWeight:700,fontSize:13}}>💬 Send WhatsApp</a>}
                <button style={{flex:1,background:"#F0F0F0",color:"#101010",border:"1px solid #10101044",borderRadius:8,padding:"9px",fontSize:13,fontWeight:600,cursor:"pointer"}} onClick={()=>onMarkSent(job.id)}>✓ Sent</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function LabeledStockScreen({labeledStock,setLabeledStock,onBack,onRefresh,isAdmin}) {
  const [savingKey,setSavingKey]=useState(null);
  async function saveLabeledItem(pid, qty) {
    setSavingKey(pid);
    await setLabeledStock(pid, qty);
    setSavingKey(null);
  }
  const HDR={fontSize:14,fontWeight:700,color:"#FFFFFF",letterSpacing:0.5,textTransform:"uppercase",textAlign:"center",background:"#101010",borderRadius:8,padding:"8px",marginBottom:12,marginTop:2};
  function StockRow({pid}) {
    const warn=LABELED_WARN[pid];
    const qty=labeledStock[pid]||0;
    const isLow=warn!==null&&qty<warn;
    return (
      <div style={S.editRow}>
        <span style={{...S.editLbl,color:isLow?"#E53935":"#222222"}}>
          {PRODUCTS[pid]?.label}
          {isLow&&<span style={{fontSize:10,color:"#E53935",marginLeft:6}}>● Low</span>}
          {savingKey===pid&&<span style={{fontSize:10,color:"#4A90D9",marginLeft:6}}>saving…</span>}
        </span>
        <div style={S.editCtrl}>
          {isAdmin&&<button style={S.editBtn} onClick={()=>saveLabeledItem(pid,Math.max(0,qty-1))}>−</button>}
          <input type="number" style={{...S.editVal,background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:6,padding:"4px 6px",width:64,textAlign:"center",color:"#1A1A1A"}} value={qty||""} readOnly={!isAdmin} onChange={isAdmin?e=>saveLabeledItem(pid,Math.max(0,parseInt(e.target.value)||0)):undefined}/>
          {isAdmin&&<button style={S.editBtn} onClick={()=>saveLabeledItem(pid,qty+1)}>+</button>}
        </div>
      </div>
    );
  }
  return (
    <div style={S.screen}>
      <div style={S.subHdr}><button style={S.backBtn} onClick={onBack}>‹</button><div style={S.subTitle}>Labeled Stock</div><div style={{marginLeft:"auto"}}><RefreshBtn onRefresh={onRefresh}/></div></div>
      <div style={S.card}>
        <div style={{...S.cardTitle,...HDR}}>Liter Bottles</div>
        {["classic_liter","sweetened_classic","house_blend","colombia_liter"].map(pid=><StockRow key={pid} pid={pid}/>)}
      </div>
      <div style={S.card}>
        <div style={{...S.cardTitle,...HDR}}>Mini Bottles</div>
        {["vanilla_mini","original_mini","caramel_mini","classic_mini","house_blend_mini"].map(pid=><StockRow key={pid} pid={pid}/>)}
      </div>
      <div style={{height:110}}/>
    </div>
  );
}
function BottomNav({screen,setScreen,pendingCount,labeledLowCount}) {
  const tabs=[{id:"dashboard",icon:"⌂",label:"Home"},{id:"tasks",icon:"✓",label:"Tasks"},{id:"stock",icon:"⚗",label:"Stock"},{id:"labels",icon:"🏷",label:"Labels"},{id:"needtomake",icon:"📋",label:"Make"}];
  return (
    <div style={S.bottomNav}>
      {tabs.map(t=>(
        <button key={t.id} style={{...S.navBtn,color:screen===t.id?"#101010":"#AAAAAA",position:"relative"}} onClick={()=>setScreen(t.id)}>
          <div style={{fontSize:20}}>{t.icon}</div>
          <div style={{fontSize:9,letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{t.label}</div>
          {t.id==="tasks"&&pendingCount>0&&<div style={S.navDot}>{pendingCount}</div>}
          {t.id==="labels"&&labeledLowCount>0&&<div style={{position:"absolute",top:8,right:"30%",width:8,height:8,borderRadius:"50%",background:"#E53935"}}/>}
        </button>
      ))}
    </div>
  );
}
const S={
  app:{background:"#FFFFFF",minHeight:"100vh",width:"100vw",fontFamily:"'Georgia', serif",color:"#1A1A1A",overflowX:"hidden"},
  container:{width:"100%",position:"relative",minHeight:"100vh",background:"#FFFFFF",overflowX:"hidden"},
  screen:{paddingBottom:80,overflowX:"hidden"},
  loading:{padding:"100px 20px",textAlign:"center"},
  syncBar:{position:"sticky",top:0,background:"#F0F0F0",color:"#101010",textAlign:"center",fontSize:10,padding:4,letterSpacing:2,textTransform:"uppercase",zIndex:200},
  header:{padding:"8px 18px 0",borderBottom:"1px solid #E0E0E0"},
  subHdr:{display:"flex",alignItems:"center",padding:"14px 16px",borderBottom:"1px solid #E0E0E0",gap:8},
  subTitle:{fontSize:16,fontWeight:600,color:"#1A1A1A"},
  backBtn:{background:"none",border:"none",color:"#101010",fontSize:26,cursor:"pointer",lineHeight:1,paddingRight:4},
  card:{margin:"10px 12px",background:"#FAFAFA",borderRadius:12,padding:"14px 12px",border:"1px solid #E0E0E0"},
  cardTitle:{fontSize:9,color:"#333333",letterSpacing:2.5,textTransform:"uppercase",marginBottom:12},
  calNavRow:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10},
  monthBtn:{background:"none",border:"none",color:"#101010",fontSize:20,cursor:"pointer",padding:"0 6px"},
  dot:{width:5,height:5,borderRadius:"50%"},
  legend:{display:"flex",gap:14,fontSize:10,color:"#333333",alignItems:"center",marginTop:8},
  calGrid:{display:"grid",gridTemplateColumns:"repeat(7, 1fr)",gap:1,width:"100%",overflowX:"hidden"},
  calHdr:{fontSize:9,color:"#444444",textAlign:"center",padding:"3px 0",letterSpacing:1},
  calCell:{borderRadius:4,padding:"4px 1px",textAlign:"center",minHeight:32,cursor:"pointer"},
  calDate:{fontSize:11},
  calDots:{display:"flex",justifyContent:"center",gap:2,marginTop:2},
  calDot:{width:4,height:4,borderRadius:"50%"},
  jobRow:{display:"flex",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #E8E8E8",gap:11},
  checkbox:{width:22,height:22,borderRadius:5,border:"1.5px solid",background:"transparent",cursor:"pointer",flexShrink:0,color:"#1A1A1A",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"},
  jobInfo:{flex:1},
  jobLabel:{fontSize:14,fontWeight:600},
  jobMeta:{fontSize:10,color:"#444444",marginTop:2},
  empty:{fontSize:12,color:"#555555",padding:"4px 0"},
  btnPrimary:{background:"#101010",color:"#FFFFFF",border:"none",borderRadius:10,padding:"13px 20px",fontSize:15,fontWeight:700,cursor:"pointer"},
  btnSecondary:{background:"#F0F0F0",color:"#101010",border:"1px solid #10101044",borderRadius:10,padding:"13px 20px",fontSize:14,fontWeight:600,cursor:"pointer"},
  toggleRow:{display:"flex",gap:7,marginBottom:14},
  tog:{flex:1,border:"none",borderRadius:8,padding:"10px",fontSize:14,fontWeight:600,cursor:"pointer"},
  togSm:{flex:1,border:"none",borderRadius:8,padding:"8px 2px",fontSize:12,fontWeight:600,cursor:"pointer"},
  field:{marginBottom:12},
  lbl:{fontSize:9,color:"#333333",letterSpacing:2,textTransform:"uppercase",marginBottom:6},
  inp:{width:"100%",background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:8,padding:"10px 12px",color:"#1A1A1A",fontSize:15,boxSizing:"border-box"},
  sel:{width:"100%",background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:8,padding:"10px 12px",color:"#1A1A1A",fontSize:15,boxSizing:"border-box"},
  qRow:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #E8E8E8"},
  qLabel:{fontSize:13,color:"#222222"},
  qInput:{width:54,background:"#FAFAFA",border:"1px solid #D0D0D0",borderRadius:6,padding:"6px 8px",color:"#1A1A1A",fontSize:14,textAlign:"center"},
  hint:{fontSize:11,color:"#101010",background:"#F5F5F5",borderRadius:6,padding:"7px 10px",marginTop:6},
  editRow:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid #E8E8E8"},
  editLbl:{fontSize:13,color:"#222222",flex:1},
  editCtrl:{display:"flex",alignItems:"center",gap:10},
  editBtn:{width:28,height:28,borderRadius:6,background:"#F0F0F0",border:"1px solid #D0D0D0",color:"#101010",fontSize:18,cursor:"pointer"},
  editVal:{fontSize:15,fontWeight:600,color:"#1A1A1A",minWidth:54,textAlign:"center"},
  needRow:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #E8E8E8"},
  modal:{position:"fixed",inset:0,background:"#00000088",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,padding:16},
  modalBox:{background:"#FFFFFF",borderRadius:16,padding:22,width:"100%",maxWidth:420,border:"1px solid #E0E0E0"},
  modalTitle:{fontSize:18,fontWeight:700,color:"#101010",marginBottom:4},
  modalMeta:{fontSize:11,color:"#333333",marginBottom:14},
  modalActions:{display:"flex",gap:10,marginTop:14},
  qtyListRow:{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #E8E8E8",fontSize:14},
  waBtn:{display:"block",background:"#25D366",color:"#fff",textAlign:"center",padding:"12px",borderRadius:10,textDecoration:"none",fontWeight:700,fontSize:15,marginBottom:10},
  alertBadge:{position:"fixed",bottom:158,right:14,color:"#fff",border:"none",borderRadius:20,padding:"6px 8px",fontSize:18,fontWeight:600,cursor:"pointer",zIndex:60,boxShadow:"0 2px 12px #00000040"},
  confirmBadge:{position:"fixed",bottom:158,right:14,background:"#1F4D7A",color:"#fff",border:"none",borderRadius:20,padding:"8px 13px",fontSize:12,fontWeight:600,cursor:"pointer",zIndex:60,boxShadow:"0 2px 12px #00000040"},
  alertDrawer:{position:"fixed",inset:0,zIndex:90,display:"flex",flexDirection:"column",justifyContent:"flex-end"},
  alertDrawerInner:{background:"#FFFFFF",borderRadius:"16px 16px 0 0",border:"1px solid #E0E0E0",borderBottom:"none",padding:"18px 16px 32px",maxHeight:"70vh",overflowY:"auto"},
  alertDrawerHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14},
  alertDrawerTitle:{fontSize:13,color:"#333333",letterSpacing:2,textTransform:"uppercase"},
  alertClose:{background:"none",border:"none",color:"#555555",fontSize:18,cursor:"pointer"},
  alertRow:{display:"flex",alignItems:"center",gap:10,padding:"11px 12px",background:"#FAFAFA",borderRadius:8,marginBottom:6,cursor:"pointer",paddingLeft:12},
  alertIcon:{fontSize:16},
  alertMsg:{flex:1,fontSize:13,color:"#111111",lineHeight:1.4},
  confirmRow:{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #E0E0E0"},
  confirmBtn:{background:"#4A90D9",color:"#fff",border:"none",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:600,cursor:"pointer"},
  bottomNav:{position:"fixed",bottom:0,left:0,width:"100%",background:"#FFFFFF",borderTop:"1px solid #E0E0E0",display:"flex",zIndex:50},
  navBtn:{flex:1,background:"none",border:"none",cursor:"pointer",padding:"12px 0 8px",display:"flex",flexDirection:"column",alignItems:"center"},
  navDot:{position:"absolute",top:8,right:"30%",background:"#4A90D9",color:"#fff",fontSize:9,fontWeight:700,borderRadius:8,padding:"1px 5px",minWidth:14,textAlign:"center"},
};

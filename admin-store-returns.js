/* File bottles a store returned. The credit comes off its next monthly bill (monthly-billing applies it). */
(function(root){
 'use strict';
 const TYPES=[['large','Large','price_large'],['small','Small','price_small'],['unfiltered','Unfiltered liter','price_unfiltered'],['dairy_free','Dairy free','price_dairy_free'],['syrup','Syrup','price_syrup']];
 const creditMinor=(store,qty)=>Math.round(TYPES.reduce((sum,[key,,price])=>sum+(Number(qty[key])||0)*(Number(store&&store[price])||0),0)*100);
 const shekels=minor=>'₪'+(Number(minor)/100).toLocaleString('en-IL',{minimumFractionDigits:2,maximumFractionDigits:2});
 const monthName=c=>new Date(c.year,c.month-1,1).toLocaleDateString('en-GB',{month:'long',year:'numeric'});
 function returnStatus(ret,credits){
  if(ret.cancelled_at)return 'Cancelled';
  const mine=credits.filter(c=>c.return_id===ret.id),used=mine.reduce((sum,c)=>sum+Number(c.amount_minor),0);
  if(!used)return 'Waiting for the next bill';
  const where=mine.map(monthName).join(', ');
  return used<Number(ret.amount_minor)?`${shekels(used)} on ${where} · ${shekels(Number(ret.amount_minor)-used)} carries over`:`On the ${where} bill`;
 }
 const api={TYPES,creditMinor,returnStatus};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;

 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());
 const field='display:block;font-size:.8rem;margin:10px 0 4px';
 const input='width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit';
 let panel;
 const close=()=>{if(panel){panel.close();panel.remove();panel=null;}};

 async function loadList(box){
  box.textContent='Loading…';
  const [returns,credits]=await Promise.all([
   sb.from('store_returns').select('*, stores(name)').order('return_date',{ascending:false}).order('created_at',{ascending:false}).limit(15),
   sb.from('store_return_credits').select('return_id,year,month,amount_minor'),
  ]);
  if(returns.error||credits.error){box.textContent='Couldn’t load returns: '+(returns.error||credits.error).message;return;}
  if(!returns.data.length){box.textContent='No returns filed yet.';return;}
  box.innerHTML=returns.data.map(r=>`<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border);font-size:.82rem"><div style="flex:1;min-width:0"><b>${esc(r.stores?.name||'Store')}</b> · ${esc(r.return_date)} · ${shekels(r.amount_minor)}<div style="opacity:.7">${esc(returnStatus(r,credits.data))}${r.reason?' · '+esc(r.reason):''}</div></div>${r.cancelled_at?'':`<button type="button" class="btn btn-outline btn-sm" data-cancel="${esc(r.id)}" data-store="${esc(r.store_id)}">Cancel</button>`}</div>`).join('');
  box.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>cancelReturn(b,box));
 }

 async function cancelReturn(button,box){
  if(!confirm('Cancel this return and remove its credit?'))return;
  button.disabled=true;
  const id=button.dataset.cancel;
  try{
   const applied=await sb.from('store_return_credits').select('year,month').eq('return_id',id);
   if(applied.error)throw applied.error;
   let months=[];
   if(applied.data.length){
    const bills=await sb.from('store_billing').select('year,month,billed_at,paid_at,tax_invoice_id').eq('store_id',button.dataset.store);
    if(bills.error)throw bills.error;
    const locked=applied.data.find(c=>bills.data.some(b=>b.year===c.year&&b.month===c.month&&(b.billed_at||b.paid_at||b.tax_invoice_id)));
    if(locked){showToast(`That credit is already on the ${monthName(locked)} bill, which was sent or paid.`);button.disabled=false;return;}
    months=applied.data.map(monthName);
    const removed=await sb.from('store_return_credits').delete().eq('return_id',id);
    if(removed.error)throw removed.error;
   }
   const done=await sb.from('store_returns').update({cancelled_at:new Date().toISOString()}).eq('id',id);
   if(done.error)throw done.error;
   showToast(months.length?`Return cancelled. Press Make statements for ${months.join(', ')} to update the bill.`:'Return cancelled.');
   loadList(box);
  }catch(e){showToast(e.message||'Could not cancel that return.');button.disabled=false;}
 }

 function open(){
  close();
  panel=document.createElement('dialog');
  panel.className='billing-share-dialog';
  const stores=allStores.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  panel.innerHTML=`<div class="billing-share-head"><h3>File a store return</h3><button class="btn btn-outline btn-sm" data-close aria-label="Close">×</button></div>
   <label style="${field}">Store<select data-store style="${input}"><option value="">Choose a store</option>${stores.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
   <label style="${field}">Date returned<input type="date" data-date value="${today()}" max="${today()}" style="${input}"></label>
   <div data-qty style="display:grid;grid-template-columns:1fr 1fr;gap:0 10px"></div>
   <label style="${field}">Credit, before VAT (₪)<input type="number" min="0" step="0.01" inputmode="decimal" data-amount style="${input}"></label>
   <label style="${field}">Reason (optional)<input type="text" maxlength="200" data-reason placeholder="Expired, damaged…" style="${input}"></label>
   <p style="font-size:.78rem;opacity:.7;margin:10px 0">Comes off this store's next bill, with VAT adjusted to match. If the credit is bigger than the bill, the rest carries over.</p>
   <button type="button" class="btn btn-primary btn-sm" data-save style="width:100%">Save return</button>
   <div data-msg role="status" style="font-size:.8rem;margin-top:8px"></div>
   <h4 style="margin:18px 0 4px;font-size:.9rem">Recent returns</h4><div data-list style="font-size:.82rem"></div>`;
  document.body.appendChild(panel);
  panel.showModal();
  const $=q=>panel.querySelector(q),amount=$('[data-amount]'),list=$('[data-list]');
  let typed=false;
  const chosen=()=>stores.find(s=>s.id===$('[data-store]').value);
  const qty=()=>Object.fromEntries(TYPES.map(([key])=>[key,Number(panel.querySelector(`[data-type="${key}"]`).value)||0]).filter(([,n])=>n>0));
  const refill=()=>{if(!typed){const minor=creditMinor(chosen(),qty());amount.value=minor?(minor/100).toFixed(2):'';}};
  const drawQty=()=>{const s=chosen(),old=panel.querySelector('[data-type]')?qty():{};$('[data-qty]').innerHTML=TYPES.map(([key,label,price])=>`<label style="${field}">${label}${s?` · ₪${Number(s[price])||0}`:''}<input type="number" min="0" step="1" inputmode="numeric" data-type="${key}" value="${old[key]||''}" style="${input}"></label>`).join('');panel.querySelectorAll('[data-type]').forEach(x=>x.oninput=refill);refill();};
  drawQty();
  $('[data-store]').onchange=drawQty;
  amount.oninput=()=>{typed=amount.value!=='';};
  $('[data-close]').onclick=close;
  $('[data-save]').onclick=async()=>{
   const s=chosen(),minor=Math.round(Number(amount.value)*100),msg=$('[data-msg]'),save=$('[data-save]');
   if(!s){msg.textContent='Choose the store.';return;}
   if(!(minor>0)){msg.textContent='Enter the bottles returned or the credit amount.';return;}
   save.disabled=true;msg.textContent='Saving…';
   const {error}=await sb.from('store_returns').insert({store_id:s.id,return_date:$('[data-date]').value||today(),quantities:qty(),amount_minor:minor,reason:$('[data-reason]').value.trim()||null,created_by:typeof adminUser!=='undefined'&&adminUser?adminUser.id:null});
   save.disabled=false;
   if(error){msg.textContent='Couldn’t save: '+error.message;return;}
   msg.textContent=`Saved. ${shekels(minor)} before VAT comes off ${s.name}'s next bill.`;
   typed=false;panel.querySelectorAll('[data-type]').forEach(x=>{x.value='';});amount.value='';$('[data-reason]').value='';
   loadList(list);
  };
  loadList(list);
 }
 root.openStoreReturn=open;
 const make=document.getElementById('billingGenBtn');
 if(make){const b=document.createElement('button');b.type='button';b.className='bh-gen';b.textContent='↩ File a return';b.title='Credit a store for returned bottles';b.onclick=open;make.before(b);}
})(typeof window!=='undefined'?window:globalThis);

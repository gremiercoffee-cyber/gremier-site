/* Coupons and referrals have separate status and reporting views. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date());
 const before=n=>new Date(Date.parse(today()+'T12:00:00Z')-n*864e5).toISOString().slice(0,10);
 const stamp=v=>v?new Date(v).toLocaleDateString('en-GB',{timeZone:'Asia/Jerusalem',day:'numeric',month:'short',year:'numeric'}):'—';
 let mode='coupons',status='active',refStatus='all',report=null,serial=0;
 const originalRender=root.renderCouponsTable,originalLoad=root.loadCoupons;
 const state=c=>c.max_uses!=null&&Number(c.uses_count||0)>=Number(c.max_uses)?'used up':c.expires_at&&Date.parse(c.expires_at)<Date.now()?'expired':c.is_active?'active':'inactive';
 const refState=r=>Number(r.paid_orders)>0?'used':r.shared_at||r.opened_at?'shared':'unshared';
 root.couponStatus=state;
 function mount(){
  const page=document.getElementById('tab-coupons');if(!page||document.getElementById('couponOrganization'))return;
  const filter=page.querySelector('.filter-bar'),card=page.querySelector('.card');card.id='regularCouponTable';
  const box=document.createElement('section');box.id='couponOrganization';
  box.innerHTML=`<div class="cr-tabs" role="tablist" aria-label="Code type"><button type="button" role="tab" data-cr-mode="coupons">Coupons</button><button type="button" role="tab" data-cr-mode="referrals">Referral codes</button></div><div id="couponStatusTabs" class="cr-tabs cr-status" aria-label="Coupon status">${[['active','Active'],['closed','Closed · used, expired or turned off'],['all','All coupons']].map(([id,name])=>`<button type="button" data-cr-status="${id}">${name}</button>`).join('')}</div><p class="cr-note" id="couponCount"></p><div id="referralReport" hidden><div class="cr-period"><label>From<input type="date" id="crFrom" value="${before(29)}"></label><label>To<input type="date" id="crTo" value="${today()}"></label><button type="button" class="btn btn-outline btn-sm" data-cr-range="7">7 days</button><button type="button" class="btn btn-outline btn-sm" data-cr-range="30">30 days</button><button type="button" class="btn btn-outline btn-sm" data-cr-range="year">This year</button><button type="button" class="btn btn-outline btn-sm" id="crRefresh">Refresh</button></div><p id="crStatus" role="status" class="cr-note"></p><div id="crMetrics" class="cr-metrics"></div><div class="cr-tabs cr-status" aria-label="Referral status">${[['all','All codes'],['unshared','Not shared'],['shared','Shared · no paid order'],['used','Used · paid order']].map(([id,name])=>`<button type="button" data-cr-ref-status="${id}">${name}</button>`).join('')}</div><p class="cr-note">Link copied/shared is a recorded action, not proof a message was delivered. An opened link also shows sharing activity. Code status below is all time; results above follow the date range.</p><div id="crCodes" class="cr-codes"></div><p class="cr-note">One reminder after 3 days, only with no recorded sharing, opens or orders. Paying customers only; opted-out customers excluded. Recent codes (last 30 days) only.</p></div>`;
  filter.before(box);box.querySelector('.cr-tabs').after(filter);document.getElementById('couponStatusFilter').style.display='none';
  document.getElementById('couponSearchInput').placeholder='Search code or customer…';
  box.addEventListener('click',e=>{
   const m=e.target.closest('[data-cr-mode]'),s=e.target.closest('[data-cr-status]'),r=e.target.closest('[data-cr-ref-status]'),period=e.target.closest('[data-cr-range]');
   if(m){mode=m.dataset.crMode;render();if(mode==='referrals')loadReport();}
   if(s){status=s.dataset.crStatus;render();}
   if(r){refStatus=r.dataset.crRefStatus;render();}
   if(period){document.getElementById('crTo').value=today();document.getElementById('crFrom').value=period.dataset.crRange==='year'?today().slice(0,4)+'-01-01':before(Number(period.dataset.crRange)-1);loadReport();}
  });
  document.getElementById('crRefresh').onclick=loadReport;document.getElementById('crFrom').onchange=document.getElementById('crTo').onchange=loadReport;
 }
 function render(){
  mount();const box=document.getElementById('couponOrganization');if(!box)return;
  box.querySelectorAll('[data-cr-mode]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.crMode===mode)));
  box.querySelectorAll('[data-cr-status]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.crStatus===status)));
  box.querySelectorAll('[data-cr-ref-status]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.crRefStatus===refStatus)));
  document.getElementById('couponStatusTabs').hidden=mode!=='coupons';document.getElementById('regularCouponTable').hidden=mode!=='coupons';document.getElementById('referralReport').hidden=mode!=='referrals';
  const query=typeof couponSearchTerm!=='undefined'?couponSearchTerm:'';
  if(mode==='coupons'){
   const saved=allCoupons,search=couponSearchTerm,oldFilter=document.getElementById('couponStatusFilter').value;
   try{
    allCoupons=saved.filter(c=>!/^REF-/i.test(c.code)&&(status==='all'||(status==='active'?state(c)==='active':state(c)!=='active'))&&(!query||[c.code,c.description].join(' ').toLowerCase().includes(query)));
    couponSearchTerm='';document.getElementById('couponStatusFilter').value='all';originalRender();
    document.getElementById('couponCount').textContent=`${allCoupons.length} ${status==='active'?'active':status==='closed'?'closed':''} coupons`;
   }finally{allCoupons=saved;couponSearchTerm=search;document.getElementById('couponStatusFilter').value=oldFilter;}
  }else{
   document.getElementById('couponCount').textContent='Give ₪20, get ₪20 · rewards follow a friend’s paid first order.';
   const list=(report?.codes||[]).filter(r=>(refStatus==='all'||refState(r)===refStatus)&&(!query||[r.code,r.email].join(' ').toLowerCase().includes(query)));
   document.getElementById('crCodes').innerHTML=list.length?list.map(r=>`<article class="cr-code"><header><div><strong>${esc(r.code)}</strong><span>${esc(r.email)}</span></div><b class="cr-badge">${r.paid_orders?'Used · '+Number(r.paid_orders)+' paid':r.shared_at?'Link copied/shared':r.opened_at?'Link opened':'Not shared yet'}</b></header><dl><div><dt>Created</dt><dd>${stamp(r.created_at)}</dd></div><div><dt>Last copied/shared</dt><dd>${stamp(r.shared_at)}</dd></div><div><dt>Last link opened</dt><dd>${stamp(r.opened_at)}</dd></div><div><dt>Last paid order</dt><dd>${stamp(r.last_paid_order)}</dd></div><div><dt>₪20 rewards issued</dt><dd>${Number(r.rewards)}</dd></div><div><dt>Reminder</dt><dd>${r.reminder_sent_at?'Sent '+stamp(r.reminder_sent_at):r.reminder_status==='failed'?'Failed · needs review':r.reminder_status==='sending'?'Processing · needs review if delayed':'Not sent'}</dd></div></dl><small>${!r.is_active?'Turned off':r.expires_at&&Date.parse(r.expires_at)<Date.now()?'Expired':'Active'} · paid-order date is the order’s creation date</small></article>`).join(''):'<div class="cr-code">'+(report?'No matching referral codes.':'Loading referral codes…')+'</div>';
  }
 }
 async function loadReport(){
  const seq=++serial;document.getElementById('crStatus').textContent='Loading referral results…';
  try{
   const r=await sb.functions.invoke('referral-tools',{body:{action:'report',from:document.getElementById('crFrom').value,to:document.getElementById('crTo').value}});
   if(seq!==serial)return;if(r.error||r.data?.error)throw Error('Could not load referral results. Please refresh.');report=r.data;
   document.getElementById('crStatus').textContent='Paid website orders placed in this period · Jerusalem time · tests, cancellations and refunds excluded';
   const percent=report.paid_orders?Math.round(report.referred_orders/report.paid_orders*1000)/10+'%':'—';
   document.getElementById('crMetrics').innerHTML=[['Orders using referrals',percent,`${report.referred_orders} of ${report.paid_orders} paid website orders`],['Referral orders',report.referred_orders,'Paid orders using a referral code'],['Codes copied/shared',report.shared_codes,'Distinct codes in this period'],['Rewards issued',report.rewarded,'₪20 gift cards in this period']].map(([label,value,note])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');render();
  }catch(e){if(seq===serial)document.getElementById('crStatus').textContent=e.message;}
 }
 root.renderCouponsTable=render;
 root.loadCoupons=async function(...args){await originalLoad.apply(this,args);if(mode==='referrals')await loadReport();};
 mount();
})(window);

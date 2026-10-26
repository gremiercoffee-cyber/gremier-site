/* Production kiosk and auditable stock changes. */
(function(root){
 let wake=null,active=false;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function awake(){if(active&&document.visibilityState==='visible')try{wake=await navigator.wakeLock?.request('screen');}catch{root.showToast?.('Keep this tablet plugged in; screen wake lock is unavailable.');}}
 root.toggleProductionKiosk=async function(){active=!active;document.body.classList.toggle('production-kiosk',active);
  document.getElementById('productionKioskExit')?.remove();
  if(active){root.showTab('production');const exit=document.createElement('button');exit.id='productionKioskExit';exit.textContent='Exit kiosk';exit.onclick=root.toggleProductionKiosk;document.body.append(exit);try{await document.documentElement.requestFullscreen?.();}catch{}await awake();}
  else{await wake?.release();wake=null;if(document.fullscreenElement)await document.exitFullscreen();}
 };
 document.addEventListener('visibilitychange',awake);
 root.loadProductionHistory=async function(){const host=document.getElementById('productionStockHistory');if(!host)return;
  const {data,error}=await root.MAIN_SB.from('production_stock_events').select('*').order('created_at',{ascending:false}).limit(20);
  const description=x=>x.kind==='labeling'?`${x.units} empty bottles labelled`:x.kind==='brew'?`${x.units}kg beans used`:x.kind==='drain'?`${Math.abs(x.concentrate_used_l)}L concentrate added`:`${x.inferred_units>0?x.inferred_units+' unlogged units accounted for':x.units+' units bottled/delivered'} · ${x.concentrate_used_l}L concentrate used`;
  host.innerHTML='<details><summary>Recent stock changes</summary>'+(error?'<p>Could not load stock history.</p>':!data.length?'<p>New production and inferred bottling will appear here.</p>':'<ul>'+data.map(x=>'<li><strong>'+esc(x.product.replaceAll('_',' '))+'</strong> · '+esc(description(x))+(x.concentrate_before!==null?' · '+esc(x.concentrate_before)+' → '+esc(x.concentrate_after)+'L':'')+'</li>').join('')+'</ul>')+'</details>';
 };
 function simplifyStats(){const host=document.getElementById('tab-reports');if(!host)return;for(const panel of host.querySelectorAll(':scope>.sales-panel')){if(panel.id==='revenueExplorer')continue;const heading=panel.querySelector('h2');if(!heading)continue;const wrapper=document.createElement('details');wrapper.className='stats-disclosure';const title=document.createElement('summary');title.textContent=heading.textContent;wrapper.append(title);panel.before(wrapper);wrapper.append(panel);}}
 const statsHost=document.getElementById('tab-reports');if(statsHost)new MutationObserver(simplifyStats).observe(statsHost,{childList:true});
 const plan=new URLSearchParams(location.search);if(plan.has('production_plan')){let attempts=0;const timer=setInterval(()=>{if(root.__gremierOpenProductionLog){clearInterval(timer);root.showTab('production');const product=plan.get('product'),qty=Number(plan.get('units'))||0;root.__gremierOpenProductionLog({mode:'schedule',prodType:plan.get('production_plan'),product,quantities:qty&&product?{[product]:qty}:undefined});}else if(++attempts>=30)clearInterval(timer);},300);}
 root.addEventListener('gremier:stock-changed',()=>{if(document.getElementById('tab-production')?.style.display!=='none')root.loadProductionHistory();});
})(window);

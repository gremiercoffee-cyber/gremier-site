/* Shared worker attribution, kiosk attendance and production ledger. */
(function(root){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let workers=[],person=null,shift=null,entries=[],offset=0,filter='',loading=false,refreshId=0;
 const names=id=>id==='owner'?'Owner':workers.find(w=>w.id===id)?.name||'Unassigned';
 const identity=x=>x.is_owner?'owner':x.worker_id||'';
 const date=x=>new Date(x).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
 async function rpc(name,args){const {data,error}=await root.MAIN_SB.rpc(name,args);if(error)throw error;return data;}
 async function read(table,columns='*'){const {data,error}=await root.MAIN_SB.from(table).select(columns);if(error)throw error;return data||[];}
 async function loadPeople(){workers=await read('workers');workers.sort((a,b)=>a.name.localeCompare(b.name));}
 function options(selected='',includeInactive=false){return '<option value="">Choose a person</option><option value="owner" '+(selected==='owner'?'selected':'')+'>Owner</option>'+workers.filter(w=>includeInactive||w.is_active||w.id===selected).map(w=>'<option value="'+esc(w.id)+'" '+(w.id===selected?'selected':'')+'>'+esc(w.name)+(w.is_active?'':' (inactive)')+'</option>').join('');}
 function modal(title,content,submit='Save'){
  const dialog=document.createElement('dialog');dialog.className='production-worker-dialog';
  dialog.innerHTML='<form method="dialog"><h2>'+esc(title)+'</h2>'+content+'<p class="worker-error" role="alert"></p><div class="worker-dialog-actions"><button type="button" data-cancel>Cancel</button><button type="submit">'+esc(submit)+'</button></div></form>';
  document.body.append(dialog);dialog.showModal();return dialog;
 }
 function errorMessage(e){return e?.message||'Could not save. Please try again.';}
 async function clock(operation,id=person,shiftId=shift?.id){
  if(!id)throw Error('Choose who is working');
  const result=await rpc('production_clock',{p_worker:id,p_operation:operation,p_id:operation==='in'?crypto.randomUUID():shiftId});
  if(operation==='in'){if(result.ended_at)throw Error('That shift has ended. Start a new shift.');person=id;shift=result;}
  else if(shift?.id===shiftId){shift=null;person=null;}
  bar();await Promise.all([ledger(true),attendance()]);root.loadWorkers?.();return result;
 }
 root.chooseProductionWorker=async function({clockIn=false}={}){
  if(document.querySelector('dialog.production-worker-dialog[open]'))return null;
  await loadPeople();
  if(document.querySelector('dialog.production-worker-dialog[open]'))return null;
  return new Promise(resolve=>{
   const d=modal('Who’s working now?','<label>Worker<select name="worker" required>'+options(person)+'</select></label><p>'+(clockIn?'Start or resume your shift. New production will be assigned to you.':'Choose who performed the work. Clock in separately to track hours.')+'</p>',clockIn?'Start / resume shift':'Use this person');
   const close=v=>{d.close();d.remove();resolve(v);};d.querySelector('[data-cancel]').onclick=()=>close(null);d.oncancel=e=>{e.preventDefault();close(null);};
   d.querySelector('form').onsubmit=async e=>{e.preventDefault();const btn=d.querySelector('[type=submit]');btn.disabled=true;try{const id=d.querySelector('select').value;if(clockIn)await clock('in',id);else{let q=root.MAIN_SB.from('production_shifts').select('*').is('ended_at',null);q=id==='owner'?q.eq('is_owner',true):q.eq('worker_id',id);const {data:open,error}=await q.maybeSingle();if(error)throw error;person=id;shift=open||null;bar();}close({worker:person,shift:shift?.id||null});}catch(err){d.querySelector('[role=alert]').textContent=errorMessage(err);btn.disabled=false;}};
  });
 };
 root.ensureProductionWorker=async function(){
  if(person)return true;
  return !!(await root.chooseProductionWorker({clockIn:document.body.classList.contains('production-kiosk')}));
 };
 root.productionRun=async function(action,args){
  if(!person){const chosen=await root.chooseProductionWorker({clockIn:document.body.classList.contains('production-kiosk')});if(!chosen)throw Error('Production was not saved — choose a worker first.');}
  // Hold the identity for this request even if another worker is selected while it is saving.
  const chosen={worker:person,shift:shift?.id||null};
  const result=await rpc('production_execute',{p_action:action,p_args:args,p_worker:chosen.worker,p_shift:chosen.shift,p_source:document.body.classList.contains('production-kiosk')?'Kiosk':'Admin'});
  ledger(true).catch(()=>{});return {data:result,error:null};
 };
 function bar(){const host=$('productionWorkerBar');if(!host)return;
  host.innerHTML='<div><strong>'+esc(person?names(person):'Who’s working?')+'</strong><small>'+(shift?'Clocked in '+esc(date(shift.started_at)):person?'Hours are not being tracked':'Choose a person before logging work')+'</small></div><button data-change>'+ (person?'Change person':'Choose person')+'</button>'+(shift?'<button data-out>Clock out</button>':person?'<button data-in>Clock in</button>':'');
  host.querySelector('[data-change]').onclick=()=>safe(()=>root.chooseProductionWorker({clockIn:document.body.classList.contains('production-kiosk')}));
  host.querySelector('[data-in]')?.addEventListener('click',()=>safe(()=>clock('in')));
  host.querySelector('[data-out]')?.addEventListener('click',()=>safe(()=>clock('out')));
 }
 async function safe(fn){try{await fn();}catch(e){root.showToast?.(errorMessage(e));}}
 async function ledger(reset=false){
  const host=$('productionWorkEntries');if(!host||!root.MAIN_SB)return;
  const generation=++refreshId;
  if(reset){offset=0;entries=[];}
  let q=root.MAIN_SB.from('production_entries').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+49);
  if(filter==='owner')q=q.eq('is_owner',true);else if(filter==='unassigned')q=q.is('worker_id',null).eq('is_owner',false);else if(filter)q=q.eq('worker_id',filter);
  const {data,error}=await q;if(generation!==refreshId)return;if(error){host.textContent='Could not load production entries. Use Refresh to retry.';return;}
  entries=entries.concat(data||[]);offset=entries.length;
  host.innerHTML='<div class="worker-section-head"><h2>Production entries</h2><button data-refresh>Refresh</button></div><select aria-label="Filter production entries by worker"><option value="">Everyone</option><option value="unassigned">Unassigned</option>'+options(filter,true).replace('<option value="">Choose a person</option>','')+'</select><div class="production-entry-list">'+(entries.length?entries.map(x=>'<article><div><strong>'+(x.voided?'Reversed · ':'')+esc(x.kind==='delivery'?'Inferred bottling':x.kind==='brew'?'Brewing':x.kind==='drain'?'Draining':x.kind==='labeling'?'Labelling':'Bottling')+' · '+esc(x.units)+' '+esc(x.unit)+'</strong><span>'+esc(root.__OPS_PRODUCTS__?.[x.product]?.label||x.product.replaceAll('_',' '))+'</span><span>'+esc(names(identity(x)))+' · '+esc(date(x.created_at))+' · '+esc(x.source)+'</span>'+(x.note?'<p>'+esc(x.note)+'</p>':'')+'</div><button data-edit="'+x.id+'">Edit</button></article>').join(''):'<p>No production entries in this view.</p>')+'</div>'+(data.length===50?'<button data-more>Load more</button>':'');
  const select=host.querySelector('select');select.value=filter;select.onchange=()=>{filter=select.value;safe(()=>ledger(true));};host.querySelector('[data-refresh]').onclick=()=>safe(()=>ledger(true));host.querySelector('[data-more]')?.addEventListener('click',()=>safe(()=>ledger(false)));
  host.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editEntry(entries.find(x=>x.id===b.dataset.edit)));
 }
 function editEntry(x){const d=modal('Edit production entry','<p>'+esc(x.units)+' '+esc(x.unit)+' · '+esc(x.product)+'</p><label>Performed by<select required>'+options(identity(x),true)+'</select></label><label>Note<textarea maxlength="1000">'+esc(x.note)+'</textarea></label><small>Changing the worker or note leaves stock quantities unchanged.</small>');
  const close=()=>{d.close();d.remove();};d.querySelector('[data-cancel]').onclick=close;d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{await rpc('edit_production_entry',{p_id:x.id,p_worker:d.querySelector('select').value,p_note:d.querySelector('textarea').value});close();await Promise.all([ledger(true),attendance()]);}catch(err){d.querySelector('[role=alert]').textContent=errorMessage(err);b.disabled=false;}};
 }
 async function readAll(table){let rows=[];for(let page=0;;page++){const {data,error}=await root.MAIN_SB.from(table).select('*').order('id').range(page*1000,page*1000+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}}
 async function attendance(){
  const host=$('productionAttendance');if(!host)return;
  const [shifts,work]=await Promise.all([readAll('production_shifts'),readAll('production_entries')]);
  const totals=new Map();for(const s of shifts){const id=identity(s);if(!totals.has(id))totals.set(id,{hours:0,active:null,work:new Map()});const t=totals.get(id);if(s.ended_at)t.hours+=(new Date(s.ended_at)-new Date(s.started_at))/3600000;else t.active=s;}
  for(const x of work){if(x.voided)continue;const id=identity(x);if(!id)continue;if(!totals.has(id))totals.set(id,{hours:0,active:null,work:new Map()});const t=totals.get(id),key=x.kind+' · '+x.product.replaceAll('_',' ')+' ('+x.unit+')';t.work.set(key,(t.work.get(key)||0)+Number(x.units));}
  host.innerHTML='<h2>Production shifts & work</h2><p>Clocked-out shifts are included in the pay balances below.</p>'+([...totals].map(([id,t])=>'<article class="worker-production-summary"><strong>'+esc(names(id))+'</strong><span>'+t.hours.toFixed(2)+' hours completed'+(t.active?' · Working since '+esc(date(t.active.started_at)):'')+'</span>'+(t.active?'<button data-clockout="'+t.active.id+'" data-person="'+id+'">Clock out</button>':'')+'<details><summary>Work completed</summary><ul>'+[...t.work].map(([key,n])=>'<li>'+esc(key)+': <strong>'+n+'</strong></li>').join('')+'</ul></details></article>').join('')||'<p>No shifts yet. Clock in from Production to start.</p>')+'<details><summary>Shift history</summary>'+shifts.sort((a,b)=>b.started_at.localeCompare(a.started_at)).map(s=>'<article class="worker-shift"><span><strong>'+esc(names(identity(s)))+'</strong> · '+esc(date(s.started_at))+' → '+(s.ended_at?esc(date(s.ended_at)):'Working now')+'</span><button data-shift="'+s.id+'">Correct times</button></article>').join('')+'</details>';
  host.querySelectorAll('[data-clockout]').forEach(b=>b.onclick=()=>safe(async()=>{await clock('out',b.dataset.person,b.dataset.clockout);}));
  host.querySelectorAll('[data-shift]').forEach(b=>b.onclick=()=>editShift(shifts.find(s=>s.id===b.dataset.shift)));
 }
 function localInput(value){const d=new Date(value);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 function editShift(s){const d=modal('Correct shift times','<p>'+esc(names(identity(s)))+'</p><label>Start<input type="datetime-local" name="start" required value="'+localInput(s.started_at)+'"></label><label>End<input type="datetime-local" name="end" required value="'+(s.ended_at?localInput(s.ended_at):'')+'"></label><small>Saved hours and pay will be recalculated using this shift’s original hourly rate.</small>');
  const close=()=>{d.close();d.remove();};d.querySelector('[data-cancel]').onclick=close;d.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=d.querySelector('[type=submit]');b.disabled=true;try{await rpc('correct_production_shift',{p_id:s.id,p_start:new Date(d.querySelector('[name=start]').value).toISOString(),p_end:new Date(d.querySelector('[name=end]').value).toISOString()});if(shift?.id===s.id){person=null;shift=null;bar();}close();await attendance();root.loadWorkers?.();}catch(err){d.querySelector('[role=alert]').textContent=errorMessage(err);b.disabled=false;}};
 }
 root.refreshProductionWorkers=async function(){if(loading)return;loading=true;try{await loadPeople();bar();await Promise.all([ledger(true),attendance()]);}catch(e){root.showToast?.(errorMessage(e));}finally{loading=false;}};
 root.addEventListener('gremier:stock-changed',()=>safe(()=>ledger(true)));
 root.addEventListener('gremier:production-kiosk-open',()=>safe(()=>root.chooseProductionWorker({clockIn:true})));
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&document.body.classList.contains('production-kiosk'))safe(()=>root.chooseProductionWorker({clockIn:true}));});
})(window);

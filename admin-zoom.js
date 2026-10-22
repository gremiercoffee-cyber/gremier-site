/* Page zoom leaves navigation and zoom controls at their normal size. */
(function(){
 'use strict';
 const key='gremier_admin_zoom',min=70,max=130;
 let value=100;
 try{value=Number(localStorage.getItem(key))||100;}catch{}
 value=Math.max(min,Math.min(max,value));
 const content=document.getElementById('websiteMain');
 if(!content)return;
 function apply(){
  content.style.zoom=String(value/100);
  document.querySelectorAll('.admin-zoom').forEach(control=>{
   control.querySelector('.zoom-reset').textContent=value+'%';
   control.querySelector('.zoom-out').disabled=value<=min;
   control.querySelector('.zoom-in').disabled=value>=max;
  });
  try{localStorage.setItem(key,String(value));}catch{}
 }
 for(const parent of [document.querySelector('.sidebar-bottom'),document.querySelector('.mobile-header')]){
  if(!parent)continue;
  const control=document.createElement('div');control.className='admin-zoom';control.setAttribute('role','group');control.setAttribute('aria-label','Page zoom');
  control.innerHTML='<button type="button" class="zoom-out" aria-label="Zoom out">−</button><button type="button" class="zoom-reset" aria-label="Reset page zoom" title="Reset to 100%">100%</button><button type="button" class="zoom-in" aria-label="Zoom in">+</button>';
  control.querySelector('.zoom-out').onclick=()=>{value=Math.max(min,value-10);apply();};
  control.querySelector('.zoom-in').onclick=()=>{value=Math.min(max,value+10);apply();};
  control.querySelector('.zoom-reset').onclick=()=>{value=100;apply();};
  if(parent.classList.contains('sidebar-bottom'))parent.prepend(control);else parent.insertBefore(control,parent.querySelector('#pushBellBtn'));
 }
 apply();
})();

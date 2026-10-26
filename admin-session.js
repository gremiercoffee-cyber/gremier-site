/* Reload restores this window; a fresh launch starts at Dashboard. */
(function(root){
 'use strict';
 const normalize=tab=>tab==='schedule'?'orders':tab==='today'?'dashboard':/^[a-z]{3,20}$/.test(tab||'')?tab:null;
 function startTab({type,sessionTab,historyTab,lastTab,search=''}){
  if(['reload','back_forward'].includes(type)){
   const previous=normalize(sessionTab)||normalize(historyTab)||normalize(lastTab);
   if(previous)return previous;
  }
  const query=new URLSearchParams(search);
  return normalize(query.get('tab'))||({expenses:'expenses',receipts:'finance'})[query.get('finance')]||'dashboard';
 }
 const api={startTab};if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 const read=(storage,key)=>{try{return storage.getItem(key);}catch{return null;}};
 const first=startTab({type:root.performance?.getEntriesByType?.('navigation')?.[0]?.type,
  sessionTab:read(root.sessionStorage,'gremier_admin_screen'),historyTab:root.history?.state?.__gremierAdmin?root.history.state.tab:null,
  lastTab:read(root.localStorage,'gremier_admin_tab'),search:root.location.search});
 root.GremierAdminNavigation={startTab:()=>first,remember(tab){
  const screen=normalize(tab)||'dashboard';
  try{root.sessionStorage.setItem('gremier_admin_screen',screen);}catch{}
  try{root.localStorage.setItem('gremier_admin_tab',screen);}catch{}
 }};
 root.openAdminLog=()=>{
  const production=root.document.getElementById?.('tab-production');
  if(production&&production.style.display!=='none'&&root.__gremierOpenProductionLog){root.__gremierOpenProductionLog();return;}
  if(root.__gremierOpenLog)root.__gremierOpenLog();
  else root.__gremierPendingLog=true;
 };
})(typeof window==='undefined'?globalThis:window);

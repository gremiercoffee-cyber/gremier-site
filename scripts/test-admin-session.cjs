const {test}=require('node:test'),assert=require('node:assert/strict');
const {startTab}=require('../admin-session.js');
test('reload restores the same window before stale links or another window’s last screen',()=>{
 assert.equal(startTab({type:'reload',sessionTab:'storedeliveries',historyTab:'orders',lastTab:'dashboard',search:'?finance=expenses'}),'storedeliveries');
 assert.equal(startTab({type:'reload',historyTab:'stock',lastTab:'orders'}),'stock');
 assert.equal(startTab({type:'reload',lastTab:'schedule'}),'orders');
});
test('fresh launches open Dashboard even if the previous app window was closed elsewhere',()=>{
 assert.equal(startTab({type:'navigate',sessionTab:'orders',historyTab:'stock',lastTab:'storedeliveries'}),'dashboard');
 assert.equal(startTab({lastTab:'orders'}),'dashboard');
});
test('fresh explicit deep links work and Back/Forward restores the current screen',()=>{
 assert.equal(startTab({type:'navigate',search:'?finance=receipts'}),'finance');
 assert.equal(startTab({type:'navigate',search:'?tab=stock'}),'stock');
 assert.equal(startTab({type:'back_forward',sessionTab:'expenses',search:'?tab=stock'}),'expenses');
 assert.equal(startTab({type:'reload',sessionTab:'<script>',historyTab:'today'}),'dashboard');
});
test('header plus opens the existing log handler without navigating, and queues early clicks',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),values=new Map();let opened=0;
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const root={document:{},location:{search:''},sessionStorage:storage,localStorage:storage,performance:{getEntriesByType:()=>[{type:'reload'}]}};
 vm.runInNewContext(fs.readFileSync('admin-session.js','utf8'),{window:root,URLSearchParams});
 root.openAdminLog();assert.equal(root.__gremierPendingLog,true);
 root.__gremierOpenLog=()=>opened++;root.openAdminLog();assert.equal(opened,1);
 root.document.getElementById=()=>({style:{display:'block'}});let production=0;root.__gremierOpenProductionLog=()=>production++;root.openAdminLog();assert.equal(production,1);assert.equal(opened,1);
 root.GremierAdminNavigation.remember('schedule');assert.equal(values.get('gremier_admin_screen'),'orders');
});

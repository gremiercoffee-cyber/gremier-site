const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('admin.html','utf8');
function navigation(){
 const start=html.lastIndexOf('function showTab(tab) {'),end=html.indexOf('// ══ SITE IMAGES',start);
 assert.ok(start>0&&end>start);
 const nodes=new Map(),calls=[],saved={};
 for(const prefix of ['tab-','nav-','tbar-'])for(const name of ['orders','stock','dashboard'])nodes.set(prefix+name,{style:{display:'none'},classList:{add(){},remove(){}},closest(){return null}});
 const document={getElementById:id=>nodes.get(id),querySelectorAll:selector=>selector==='.tab-content'?[...nodes].filter(([id])=>id.startsWith('tab-')).map(([,node])=>node):[]};
 const window={__gremierReloadSchedule:()=>calls.push('schedule'),__gremierPushAdminTabState:tab=>calls.push('history:'+tab)};
 const context={document,window,localStorage:{setItem:(key,value)=>saved[key]=value},loadOrders:()=>calls.push('orders'),loadDashboard:()=>calls.push('dashboard')};
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 return {show:context.showTab,nodes,calls,saved};
}
test('Orders loads both its order list and schedule without exposing a separate Schedule page',()=>{
 const h=navigation();h.show('orders');assert.equal(h.nodes.get('tab-orders').style.display,'block');
 assert.deepEqual(h.calls,['history:orders','orders','schedule']);assert.equal(h.saved.gremier_admin_tab,'orders');
});
test('old Schedule shortcuts and saved-history targets open the merged Orders screen',()=>{
 const h=navigation();h.show('schedule');assert.equal(h.nodes.get('tab-orders').style.display,'block');
 assert.deepEqual(h.calls,['history:orders','orders','schedule']);assert.equal(h.saved.gremier_admin_tab,'orders');
 h.show('dashboard');assert.equal(h.nodes.get('tab-orders').style.display,'none');assert.equal(h.nodes.get('tab-dashboard').style.display,'block');
});
test('the schedule and monthly portal have one stable mount each, ordered around the customer list',()=>{
 const orders=html.slice(html.indexOf('<!-- ORDERS -->'),html.indexOf('<!-- PRODUCTS -->'));
 assert.equal((html.match(/id="ops-schedule-root"/g)||[]).length,1);
 assert.equal((html.match(/id="ops-schedule-extras-root"/g)||[]).length,1);
 assert.ok(orders.indexOf('ops-schedule-root')<orders.indexOf('ordersTable'));
 assert.ok(orders.indexOf('ops-schedule-extras-root')>orders.indexOf('closedOrdersCard'));
 assert.doesNotMatch(html,/id="(?:tab|nav|tbar)-schedule"/);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function worker(existing=[]){const handlers={},messages=[],opened=[],shown=[];
 const clients=existing.map(url=>({url,postMessage:m=>messages.push(m),focus:async()=>{}}));
 const self={location:{origin:'https://gremiercoffee.co.il'},addEventListener:(type,fn)=>handlers[type]=fn,clients:{matchAll:async()=>clients,openWindow:async url=>opened.push(url)},registration:{showNotification:async(title,options)=>shown.push({title,options})}};
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),{self,URL});
 return {messages,opened,shown,async click(action='share_expenses'){let work;handlers.notificationclick({action,notification:{data:{url:'/admin.html?finance=expenses&expense_share=1'},close(){}},waitUntil:p=>work=p});await work;},async push(){let work;handlers.push({data:{json:()=>({title:'Expense batch available',actions:[{action:'share_expenses',title:'Share batch'}]})},waitUntil:p=>work=p});await work;}};
}
test('Share batch notification action focuses an existing /admin app and opens its expense batch',async()=>{
 const w=worker(['https://gremiercoffee.co.il/admin']);await w.click();assert.equal(w.opened.length,0);assert.equal(w.messages[0].type,'gremier:share-expenses');
});
test('a closed app opens directly to auto-prepared expenses for notification body or action',async()=>{
 for(const action of ['','share_expenses']){const w=worker();await w.click(action);assert.equal(w.opened[0],'/admin.html?finance=expenses&expense_share=1');}
});
test('native expense notifications retain their Share batch action',async()=>{
 const w=worker();await w.push();assert.equal(w.shown[0].options.actions[0].action,'share_expenses');
});

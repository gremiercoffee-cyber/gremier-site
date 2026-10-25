/* Prepared receipt images stay on this device, scoped to the signed-in admin. */
(function(root){
 'use strict';
 const DB='gremier-expense-batches',STORE='prepared',TTL=24*60*60*1000;
 let opening;
 function database(){
  if(!root.indexedDB)return Promise.reject(Error('Device cache unavailable'));
  return opening||=(new Promise((resolve,reject)=>{
   const request=indexedDB.open(DB,1);
   request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
   request.onsuccess=()=>resolve(request.result);request.onerror=request.onblocked=()=>{opening=null;reject(request.error||Error('Device cache unavailable'));};
  }));
 }
 async function access(mode,action){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),request=action(tx.objectStore(STORE));let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
 root.GremierExpenseCache={
  async get(owner,key){try{const row=await access('readonly',s=>s.get(owner));if(row&&Date.now()-row.at>TTL){await access('readwrite',s=>s.delete(owner));return null;}if(!row||row.key!==key)return null;return row.files.map(f=>new File([f.blob],f.name,{type:f.type}));}catch{return null;}},
  async put(owner,key,files){try{await access('readwrite',s=>s.put({key,at:Date.now(),files:files.map(f=>({name:f.name,type:f.type,blob:f}))},owner));}catch{/* Preparation and sharing still work without device storage. */}},
  async clear(){try{await access('readwrite',s=>s.clear());}catch{}}
 };
})(window);

(function(root){
 const api={
  parse(raw,step=1){const text=String(raw).trim();if(!/^\d+(?:\.\d{1,3})?$/.test(text))return null;const v=Number(text);return Number.isFinite(v)&&v<=1000000&&(step!==1||Number.isInteger(v))?v:null;},
  bump(value,step,direction){return Math.max(0,Math.round((Number(value)+step*direction)*1000)/1000);}
 };
 if(typeof module==='object')module.exports=api;else root.GremierStockNumbers=api;
})(typeof window==='object'?window:globalThis);

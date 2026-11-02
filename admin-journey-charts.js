/* Session-based conversion series. Missing denominators are gaps, never fabricated 0%. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const metrics={checkout:{label:'Visits reaching checkout',num:'checkout',den:'visits',note:'Visits that opened checkout ÷ all visits'},completion:{label:'Checkout → purchase',num:'checkout_paid',den:'checkout',note:'Visits that opened checkout and paid ÷ visits that opened checkout'},overall:{label:'Overall conversion',num:'paid',den:'visits',note:'Visits with a verified paid order ÷ all visits'}};
 function series(days,from,to,metric='checkout',grain='day'){
  const m=metrics[metric],source=new Map(days.map(d=>[d.day,d])),groups=new Map();
  for(let t=Date.parse(from+'T12:00:00Z');t<=Date.parse(to+'T12:00:00Z');t+=864e5){
   const date=new Date(t),day=date.toISOString().slice(0,10);let key=day;
   if(grain==='month')key=day.slice(0,7);
   if(grain==='week'){date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));key=date.toISOString().slice(0,10);}
   if(!groups.has(key))groups.set(key,{label:key,from:day,to:day,num:0,den:0});
   const g=groups.get(key),d=source.get(day)||{};g.to=day;g.num+=Number(d[m.num]||0);g.den+=Number(d[m.den]||0);
  }
  return Array.from(groups.values()).map(g=>({...g,value:g.den?100*g.num/g.den:null}));
 }
 function bars(rows){
  const list=rows.filter(r=>Number(r.events)>0).sort((a,b)=>b.events-a.events).slice(0,12),max=Math.max(1,...list.map(r=>Number(r.events)));
  return `<section class="wj-card"><h3>Most popular pages</h3>${list.length?`<div class="wj-page-bars">${list.map(r=>`<div><span>${esc(r.label)}</span><div><i style="width:${Math.max(1,100*r.events/max)}%"></i></div><strong>${Number(r.events).toLocaleString('en-IL')}</strong></div>`).join('')}</div>`:'<p class="wj-note">Page views will appear here as visitors accept analytics.</p>'}</section>`;
 }
 function chart(days,from,to,metric,grain){
  const m=metrics[metric],values=series(days,from,to,metric,grain),w=Math.max(280,Math.min(760,root.document?.getElementById('wjTrend')?.clientWidth||760)),h=230,left=42,right=16,top=15,bottom=38,x=i=>left+(w-left-right)*(values.length===1?.5:i/(values.length-1)),y=v=>h-bottom-(h-top-bottom)*v/100;
  let segments=[],part=[];values.forEach((v,i)=>{if(v.value===null){if(part.length)segments.push(part);part=[];}else part.push([x(i),y(v.value)]);});if(part.length)segments.push(part);
  const ticks=[0,25,50,75,100].map(v=>`<line x1="${left}" y1="${y(v)}" x2="${w-right}" y2="${y(v)}" stroke="#ece9e3"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${v}%</text>`).join('');
  const labelIndexes=[...new Set([0,Math.floor((values.length-1)/2),values.length-1])];
  const labels=labelIndexes.map(i=>`<text x="${x(i)}" y="${h-10}" text-anchor="${i===0?'start':i===values.length-1?'end':'middle'}">${esc(values[i]?.label||'')}</text>`).join('');
  const n=values.reduce((s,v)=>s+v.num,0),d=values.reduce((s,v)=>s+v.den,0);
  return `<div class="wj-trend-total"><strong>${d?(100*n/d).toFixed(1)+'%':'—'}</strong><span>${n.toLocaleString('en-IL')} of ${d.toLocaleString('en-IL')} visits in this period</span></div><p class="wj-note">${m.note}. Grouped by ${grain}; no visits means a gap.</p><svg class="wj-trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${m.label} over time"><title>${m.label} over time</title>${ticks}${segments.map(p=>`<polyline points="${p.map(v=>v.join(',')).join(' ')}" fill="none" stroke="#b8874e" stroke-width="3" stroke-linejoin="round"/>`).join('')}${values.map((v,i)=>v.value===null?'':`<circle cx="${x(i)}" cy="${y(v.value)}" r="${values.length>100?2:4}" fill="#b8874e" tabindex="0"><title>${esc(v.from===v.to?v.from:v.from+' – '+v.to)}: ${v.value.toFixed(1)}% (${v.num}/${v.den})</title></circle>`).join('')}${labels}</svg>${d?'':'<p class="wj-note">No qualifying visits in this period yet.</p>'}<details><summary>View exact numbers</summary><div class="table-wrap"><table><thead><tr><th>Period</th><th>Converted</th><th>Visits</th><th>Rate</th></tr></thead><tbody>${values.map(v=>`<tr><td>${esc(v.from===v.to?v.from:v.from+' – '+v.to)}</td><td>${v.num}</td><td>${v.den}</td><td>${v.value===null?'—':v.value.toFixed(1)+'%'}</td></tr>`).join('')}</tbody></table></div></details>`;
 }
 const api={metrics,series,bars,chart};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.GremierJourneyCharts=api;
})(typeof window==='undefined'?globalThis:window);

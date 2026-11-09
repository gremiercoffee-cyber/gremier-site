/* Website traffic: how each WhatsApp group and Status post performed. */
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const NAMES={group:'Groups',group_status:'Group status',status:'My Status'};
 const num=n=>Number(n||0).toLocaleString('en-IL');
 const shekels=n=>'₪'+Math.round(Number(n||0)).toLocaleString('en-IL');
 function byChannel(links){return Object.keys(NAMES).map(channel=>{const rows=links.filter(l=>l.channel===channel);return {channel,name:NAMES[channel],posts:rows.length,clicks:rows.reduce((s,l)=>s+l.clicks,0),paid:rows.reduce((s,l)=>s+l.paid,0),revenue:rows.reduce((s,l)=>s+Number(l.revenue||0),0)};});}
 const api={byChannel};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(!root.document)return;
 let serial=0;
 const tile=c=>`<div class="wj-tile"><span>${esc(c.name)}</span><strong>${num(c.clicks)} clicks</strong><small>${num(c.paid)} paid orders · ${shekels(c.revenue)} · ${num(c.posts)} posts</small></div>`;
 const buyers=l=>l.buyers.length?`<div class="wj-note">${l.buyers.map(b=>`#${esc(b.order_number)} ${esc(b.name)} · ${shekels(b.total)}`).join('<br>')}</div>`:'';
 const row=l=>`<tr><td><b>${esc(l.label)}</b><div class="wj-note">${esc(NAMES[l.channel])}${l.detail?' · '+esc(l.detail):''}</div>${buyers(l)}</td><td>${num(l.clicks)}</td><td>${num(l.started)}</td><td>${num(l.paid)}</td><td>${shekels(l.revenue)}</td></tr>`;
 root.GremierLinkReport={async load(from,to){
  const box=document.getElementById('wjLinks');if(!box)return;const seq=++serial;
  try{
   const client=typeof sb!=='undefined'?sb:root.MAIN_SB||root.ADMIN_SB;
   const r=await client.functions.invoke('site-journeys',{body:{action:'link_report',from,to}});
   if(r.error||r.data?.error)throw Error(r.data?.error||'unavailable');
   if(seq!==serial)return;
   const links=r.data.links||[];
   box.innerHTML=`<section class="wj-card"><h3>WhatsApp links</h3><p class="wj-note">Each group and Status post has its own link. Clicks count everyone who opened it. An order counts if it was placed on that visit, or within a week for people who accepted analytics.</p><div class="wj-tiles">${byChannel(links).map(tile).join('')}</div>${links.length?`<div class="table-wrap"><table><thead><tr><th>Post</th><th>Clicks</th><th>Started checkout</th><th>Paid</th><th>Sales</th></tr></thead><tbody>${links.map(row).join('')}</tbody></table></div>`:'<p class="wj-note">No clicks in this period yet.</p>'}</section>`;
  }catch(e){if(seq===serial)box.innerHTML=`<section class="wj-card"><h3>WhatsApp links</h3><p class="wj-note">Couldn’t load the link report.</p></section>`;}
 }};
})(typeof window!=='undefined'?window:globalThis);

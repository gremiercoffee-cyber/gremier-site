const {test}=require('node:test'),assert=require('node:assert/strict'),{byChannel}=require('../admin-tracking-links.js');
test('the report adds up each channel separately',()=>{
 const rows=byChannel([{channel:'group',clicks:5,paid:1,revenue:'100'},{channel:'group',clicks:2,paid:0,revenue:0},{channel:'status',clicks:9,paid:2,revenue:'50.5'}]);
 assert.deepEqual(rows.map(r=>[r.channel,r.posts,r.clicks,r.paid,r.revenue]),[['group',2,7,1,100],['group_status',0,0,0,0],['status',1,9,2,50.5]]);
});

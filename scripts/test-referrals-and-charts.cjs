const {test}=require('node:test'),assert=require('node:assert/strict');
const {couponState,referralState,reminderText}=require('../supabase/functions/_shared/referral-model.ts');
const {series,bars}=require('../admin-journey-charts.js');
const {trafficSeries,trafficChart}=require('../admin-journey-charts.js');
test('closed coupons include exhausted, turned off and expired codes; per-user is not global exhaustion',()=>{
 assert.equal(couponState({is_active:false,max_uses:1,uses_count:1}),'used up');
 assert.equal(couponState({is_active:true,one_time_per_user:true,uses_count:10}),'active');
 assert.equal(couponState({is_active:true,expires_at:'2020-01-01'}),'expired');
 assert.equal(couponState({is_active:false}),'inactive');
});
test('code creation and sharing never mean a paid redemption',()=>{
 assert.equal(referralState({created_at:'2026-01-01'}),'unshared');
 assert.equal(referralState({shared_at:'2026-01-02',paid_orders:0}),'shared');
 assert.equal(referralState({opened_at:'2026-01-02',paid_orders:0}),'shared');
 assert.equal(referralState({paid_orders:1}),'used');
 const mail=reminderText('REF-ABC123','https://example.com/unsubscribe');
 assert.match(mail.text,/complete and pay/);assert.match(mail.text,/REF-ABC123/);assert.match(mail.text,/unsubscribe/);
});
test('conversion trends have distinct denominators and zero denominators are gaps',()=>{
 const days=[{day:'2026-11-01',visits:100,checkout:20,paid:8,checkout_paid:6}];
 assert.equal(series(days,'2026-11-01','2026-11-02','checkout')[0].value,20);
 assert.equal(series(days,'2026-11-01','2026-11-02','completion')[0].value,30);
 assert.equal(series(days,'2026-11-01','2026-11-02','overall')[0].value,8);
 assert.equal(series(days,'2026-11-01','2026-11-02','overall')[1].value,null);
});
test('weekly/monthly trends divide summed counts rather than averaging daily rates',()=>{
 const days=[{day:'2026-11-02',visits:10,checkout:5},{day:'2026-11-03',visits:90,checkout:9}];
 assert.equal(series(days,'2026-11-02','2026-11-03','checkout','week')[0].value,14);
 assert.equal(series(days,'2026-11-02','2026-11-03','checkout','month')[0].value,14);
});
test('popular page bars exclude zero views and escape page labels',()=>{
 const html=bars([{label:'<bad>',events:5},{label:'Empty',events:0}]);
 assert.ok(html.includes('&lt;bad&gt;'));assert.ok(!html.includes('Empty'));
});
test('traffic counts are summed, untracked history is blank, and later empty days are zero',()=>{
 const days=[{day:'2026-11-02',visits:3},{day:'2026-11-02',visits:2},{day:'2026-11-03',visits:7}];
 const d=trafficSeries(days,'2026-11-01','2026-11-04');
 assert.deepEqual(d.map(x=>x.value),[null,5,7,0]);
 assert.equal(trafficSeries(days,'2026-11-01','2026-11-04','month')[0].value,12);
 assert.match(trafficChart(days,'2026-11-01','2026-11-04'),/Busiest day: 2026-11-03/);
 assert.match(trafficChart(days,'2026-11-01','2026-11-04'),/Not tracked yet/);
});

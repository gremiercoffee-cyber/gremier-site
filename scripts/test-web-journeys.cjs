const {test}=require('node:test'),assert=require('node:assert/strict');
const {cleanJourney,dateRange,jerusalemMidnight,linkJourneyOrder}=require('../supabase/functions/_shared/web-journey-model.ts');
const id='11111111-1111-4111-8111-111111111111';
const batch={consent:true,visitor_id:id,session_id:id,events:[{id,kind:'page_view',page:'Home'}]};
test('requires affirmative consent and random UUIDs',()=>{assert.throws(()=>cleanJourney({...batch,consent:false}));assert.throws(()=>cleanJourney({...batch,visitor_id:'email@example.com'}));});
test('only categorical metadata survives; URLs, typed data and personal fields are dropped',()=>{
 const result=cleanJourney({...batch,user_id:'forged-member',email:'secret@example.com',referrer:'https://example.com/path?email=secret',events:[{id,kind:'active',page:'Product',seconds:1000,text:'customer address',url:'?token=secret'}]});
 assert.equal(result.referrer,'example.com');assert.equal(result.events[0].seconds,30);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('address'));
 assert.ok(!JSON.stringify(result).includes('forged-member'));
 assert.throws(()=>cleanJourney({...batch,events:[{id,kind:'typing',page:'Home'}]}));
});
test('rejects unbounded batches, arbitrary page URLs and invalid ranges',()=>{assert.throws(()=>cleanJourney({...batch,events:Array(21).fill(batch.events[0])}));assert.throws(()=>cleanJourney({...batch,events:[{id,kind:'page_view',page:'/admin?secret'}]}));assert.throws(()=>dateRange({from:'2026-11-02',to:'2026-11-01'}));});
test('Jerusalem date boundaries honor summer and winter offsets',()=>{assert.equal(jerusalemMidnight('2026-07-01'),'2026-06-30T21:00:00.000Z');assert.equal(jerusalemMidnight('2026-11-01'),'2026-10-31T22:00:00.000Z');});
test('optional analytics never breaks checkout on missing storage/network',async()=>{await assert.doesNotReject(()=>linkJourneyOrder({},null,id));await assert.doesNotReject(()=>linkJourneyOrder({from(){throw Error('offline');}},batch,id));});

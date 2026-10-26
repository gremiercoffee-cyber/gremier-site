const assert=require('node:assert/strict');
const fs=require('node:fs');
const {summarize,usRows,usEstimate,csvRows}=require('../admin-financials.js');
function month(name,website,other,cogs,operating,asset=0) {
  return {month:name,income_minor:website+other,cost_of_sales_minor:cogs,operating_expenses_minor:operating,
    expenses_minor:cogs+operating,net_minor:website+other-cogs-operating,fixed_assets_minor:asset,
    website_receipt_count:website?1:0,is_partial_month:name.endsWith('10'),sources_minor:{website,other},
    categories:[{label:'Income',group:'income',amount_minor:website+other},{label:'קניות בארץ',group:'cost_of_sales',amount_minor:cogs},
      {label:'שכירות רכב',group:'operating_expenses',amount_minor:operating},{label:'רכוש קבוע',group:'fixed_assets',amount_minor:asset}],
    suppliers:[{label:'Supplier',amount_minor:cogs+operating}]};
}
const payload={schema_version:1,report_year:2026,as_of_date:'2026-10-20',currency:'ILS',
 monthly:[month('2026-01',0,10000,2000,3000,50000),month('2026-10',25000,5000,10000,5000)],coverage:{}};
const m=summarize(payload);
assert.equal(m.totals.income,40000,'Website receipts are included once, not added again');
assert.equal(m.totals.expenses,20000,'Asset purchases are excluded from P&L expenses');
assert.equal(m.totals.net,20000);
assert.equal(m.grossProfit,28000);
assert.equal(m.margin,50);
assert.equal(m.totals.fixed_assets,50000);
assert.equal(m.sources.website,25000);
assert.equal(m.sources.other,15000);
assert.equal(summarize(payload,'2026-10').totals.net,15000,'Month filter applies to all totals');
assert.equal(summarize(payload,'2026-10').suppliers[0][1],15000);
assert.throws(()=>summarize(payload,'2026-11'));
for(const change of [p=>p.monthly.push(month('2026-11',0,0,0,0)),p=>p.monthly.push(p.monthly[0]),
 p=>p.monthly[0].net_minor++,p=>p.monthly[0].sources_minor.website++,
 p=>p.monthly[0].categories[0].amount_minor++,p=>p.monthly[0].suppliers[0].amount_minor++,
 p=>p.monthly[0].income_minor=NaN]){
 const copy=structuredClone(payload);change(copy);assert.throws(()=>summarize(copy),'Reject inconsistent / future snapshot data');
}
const us=usRows(m);
assert.equal(us.find(r=>r.label==='שכירות רכב').bucket,'vehicle_lease');
assert(us.every(r=>r.deduction_minor===null),'No automatic blanket allocation or U.S. deduction');
assert.equal(usRows(m,{'שכירות רכב':'home_water'}).find(r=>r.label==='שכירות רכב').bucket,'home_water');
assert.equal(usRows(m,{'שכירות רכב':'__proto__'}).find(r=>r.label==='שכירות רכב').bucket,'vehicle_lease');
const csv=csvRows(m,payload,'us');
assert(csv.some(r=>r[4].includes('electricity')&&r[5]===''&&r[7].includes('Not separately identified')),'Missing household bills are unknown, not zero');
assert(csv.some(r=>r[6]!==''&&Number(r[6])>0),'Eligible costs appear as estimates in the CSV');
assert(csv.filter(r=>r[4].includes('Vehicle')).every(r=>r[6]===''),'Vehicle deductions stay excluded without records');
const estimate=usEstimate(m);assert.equal(estimate.deductible,12000);assert.equal(estimate.pending,58000);
const ingredientModel={categories:[{label:'כיבודים עם מעמ',group:'operating_expenses',amount_minor:10000},{label:'שכירות רכב',group:'operating_expenses',amount_minor:7000},{label:'הכנת דוח אמריקאי',group:'operating_expenses',amount_minor:2000}]};
const ingredientEstimate=usEstimate(ingredientModel,{'כיבודים עם מעמ':'purchases'});assert.equal(ingredientEstimate.deductible,10000);assert.equal(ingredientEstimate.cogs,10000);assert.equal(ingredientEstimate.pending,9000);
const injection=structuredClone(m);injection.suppliers=[['=HYPERLINK("bad")',100]];
assert(csvRows(injection,payload,'accounts').some(r=>r[4].startsWith("'=HYPERLINK")),'CSV formula strings are neutralized');
if(process.argv[2]) {
 const record=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),actual=summarize(record.payload);
 assert.equal(actual.totals.income,11035665);assert.equal(actual.totals.expenses,10992638);
 assert.equal(actual.totals.net,43027);assert.equal(actual.sources.website,3765380);assert.equal(actual.websiteCount,90);
 assert.equal(actual.months.length,10);assert.equal(actual.months.at(-1).is_partial_month,true);
 assert.equal(summarize(record.payload,'2026-01').totals.fixed_assets,790000);
 console.log('Private import reconciles with FinBot: income, expenses, result, assets, 90 website receipts and 10 months.');
}
console.log('Financial stats checks passed: reconciliation, months, double counting, assets, U.S. pending deductions, overrides and CSV safety.');

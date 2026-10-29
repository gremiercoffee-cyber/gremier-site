// A store's חשבונית מס (FinBot type 0) for its unpaid months: one line per month at the store's
// price, VAT on top. The store's later קבלה links to it by the invoice's number.
import {israelDate} from './finbot-receipt-model.ts';
import {customerFields} from './manual-receipt-model.ts';
import {invoiceShares,VAT_RATE} from './vat.ts';
const MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
export const monthLabel=(b:{year:number;month:number})=>`${MONTHS[b.month-1]} ${b.year}`;
export function invoiceCustomer(raw:any){
 const c=customerFields(raw);
 // A tax invoice to a business carries the buyer's ח.פ. / עוסק number.
 if(!c.tax_id)throw Error('store_tax_id_required');
 return c;
}
export function invoiceBills(bills:any[],storeId:string){
 if(!bills.length)throw Error('no_unpaid_months');
 for(const b of bills)if(b.store_id!==storeId||b.paid_at||b.cancelled_at||b.tax_invoice_id)throw Error('month_not_invoiceable');
 const sorted=[...bills].sort((a,b)=>a.year-b.year||a.month-b.month);
 const lines=sorted.map(b=>{const net=Math.round(Number(b.total)*100);if(!Number.isSafeInteger(net)||net<=0)throw Error('invalid_month_total');return {...b,net_minor:net};});
 return {lines,...invoiceShares(lines.map(l=>({id:l.id,net_minor:l.net_minor})))};
}
export function invoicePayload(customer:any,lines:any[],now=new Date()){
 const fmt=(iso:string)=>iso.split('-').reverse().join('/');
 return {type:'0',date:fmt(israelDate(now)),language:'HE',currency:'ILS',vatType:true,rounding:false,
  title:'Gremier Coffee',description:`אספקת קפה · ${lines.map(monthLabel).join(', ')}`,remark:'',
  customer:{name:customer.name,tax:customer.tax_id,...(customer.phone?{phone:customer.phone}:{}),...(customer.address?{address:customer.address}:{}),save:false},
  // Prices are before VAT; FinBot adds VAT (18%).
  items:lines.map(l=>({name:`אספקת קפה · ${monthLabel(l)}`,amount:1,price:l.net_minor/100,save:false}))};
}
export const VAT_PERCENT=Math.round(VAT_RATE*100);

import {receiptSettings,receiptRow,receiptOrder,issueFinbotReceipt,receiptAttachment} from './finbot-receipts.ts';
import {sendOrderEmails} from './order-email.ts';

// Separate receipt email: never replay fulfillment, payments, stock, or the order confirmation.
export async function runReceiptCatchup(db:any) {
  if(!(await receiptSettings(db)).enabled)return {paused:true,processed:0};
  let processed=0;
  for(let i=0;i<3;i++) {
    if(!(await receiptSettings(db)).enabled)break;
    const {data,error}=await db.rpc('claim_receipt_catchup');
    if(error)throw Error('catchup_claim_failed');
    const job=data?.[0];if(!job)break;
    let status='needs_review',errorCode:string|null=null;
    try {
      if(!(await receiptSettings(db)).enabled) {
        await db.from('receipt_catchup_queue').update({status:'pending',updated_at:new Date().toISOString()}).eq('order_id',job.order_id);
        break;
      }
      // Another payment callback may have won after the SQL claim. Do not email twice.
      if(await receiptRow(db,job.order_id)) {status='done';}
      else {
        const result=await issueFinbotReceipt(db,job.order_id);
        if(result.skipped==='automation_disabled') {
          await db.from('receipt_catchup_queue').update({status:'pending',updated_at:new Date().toISOString()}).eq('order_id',job.order_id);
          break;
        }
        if(!result.created)throw Error('receipt_requires_review');
        if(result.receipt?.status!=='issued'||!result.receipt.pdf_path)throw Error('receipt_requires_review');
        if(!(await receiptSettings(db)).enabled)throw Error('paused_before_receipt_email');
        const order=await receiptOrder(db,job.order_id);
        const attachment=await receiptAttachment(db,job.order_id,order.order_number);
        if(!attachment)throw Error('receipt_pdf_unavailable');
        const title=`Gremier · Receipt / קבלה · #${order.order_number||job.order_id}`;
        const text=`Your official receipt for order #${order.order_number||job.order_id} is attached. Thank you!\n\nמצורפת הקבלה עבור הזמנה #${order.order_number||job.order_id}. תודה!`;
        const sent=await sendOrderEmails({ownerSubject:title,ownerText:text,ownerAttachments:[attachment],skipOwner:!!order.customer_email,
          customerEmail:order.customer_email,customerSubject:title,customerText:text,customerAttachments:[attachment]});
        if(!sent.ok)throw Error('receipt_email_requires_review');
        status='done';
      }
    } catch(e) {errorCode=e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'catchup_requires_review';}
    const saved=await db.from('receipt_catchup_queue').update({status,error_code:errorCode,updated_at:new Date().toISOString()}).eq('order_id',job.order_id).eq('status','processing');
    if(saved.error)throw Error('catchup_status_save_failed');
    processed++;
  }
  return {processed};
}

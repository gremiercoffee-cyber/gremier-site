import { sendOrderEmails } from './order-email.ts';

/** Pending rewards survive failed mail and are retried by the daily birthday job. */
export async function sendPendingLoyaltyCodes(sb: any): Promise<void> {
  const { data, error } = await sb.from('coupons').select('id,code,customer_email')
    .like('description', 'Loyalty reward%').eq('is_active', true).is('reward_email_sent_at', null).limit(100);
  if (error) { console.error('loyalty email queue:', error.message); return; }
  for (const c of data || []) {
    if (!c.customer_email) continue;
    const key = `loyalty-${c.id}`;
    const result = await sendOrderEmails({ idempotencyKey: key, skipOwner: c.customer_email.toLowerCase() !== (Deno.env.get("NOTIFY_EMAIL") || "gremiercoffee@gmail.com").toLowerCase(),
      ownerSubject: 'Your 10% loyalty reward', ownerText: `Your reward code: ${c.code}. Enter at checkout for 10% off.`,
      customerEmail: c.customer_email, customerSubject: 'Your Gremier 10% reward code is ready 🎁',
      customerText: `You earned a 10% reward!\n\n${c.code}\n\nEnter this personal, single-use code under “Coupon or gift card” at checkout. It is not applied automatically.\nhttps://gremiercoffee.co.il/#shop\n\nצברתם הטבה של 10%!\n${c.code}\nמזינים את הקוד האישי בקופה. לשימוש אחד; ההנחה אינה מופעלת אוטומטית.`,
      customerCard: { label: 'Loyalty reward · הטבת מועדון', big: '10%', codeLabel: 'Your code · הקוד שלכם', code: c.code, note: 'Enter at checkout · מזינים בקופה' } });
    if (result.ok) await sb.from('coupons').update({ reward_email_sent_at: new Date().toISOString() }).eq('id', c.id);
  }
}

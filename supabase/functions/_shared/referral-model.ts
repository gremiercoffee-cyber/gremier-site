export function couponState(c:any,now=Date.now()){
 if(c.max_uses!=null&&Number(c.uses_count||0)>=Number(c.max_uses))return 'used up';
 if(c.expires_at&&Date.parse(c.expires_at)<now)return 'expired';
 return c.is_active?'active':'inactive';
}
export function referralState(r:any){return Number(r.paid_orders)>0?'used':r.shared_at||r.opened_at?'shared':'unshared';}
export function reminderText(code:string,optout:string){
 const link=`https://gremiercoffee.co.il/?ref=${encodeURIComponent(code)}`;
 return {subject:'Give a friend ₪20, get ₪20 ☕ | שתפו חברים וקבלו ₪20',text:
`A friend who loves coffee? Give them ₪20 off their first order with your link. When they complete and pay for that order, you get a ₪20 gift card for your next coffee.\n\nYour link: ${link}\n\nיש לכם חברים שאוהבים קפה? שתפו את הקישור שלכם ותנו להם ₪20 הנחה להזמנה הראשונה. אחרי שישלימו וישלמו על ההזמנה, תקבלו כרטיס מתנה של ₪20 לקפה הבא שלכם.\n\nהקישור שלכם: ${link}\n\nGremier Coffee\nStop promotional reminders / הסרה מתזכורות שיווקיות: ${optout}`};
}

// The cold brew topic pages Google can rank for searches beyond the brand ("קולד ברו בקבוק", "קולד ברו לאירועים",
// "what is cold brew"…). Each exists as its own Hebrew and English page, is fully in the HTML, and takes its prices
// live from the catalogue so it can't drift from the shop.
import { SITE, products, slug, esc, image } from './_catalog.js';

const WA = 'https://wa.me/972552703413';
const HERO = `${SITE}/products/classic-liter-lifestyle-v2.webp`;
const n = (v) => Number(v) || 0;
const isCoffee = (p) => ['bottles', 'minis', 'bulk'].includes(p.category) && !/syrup/i.test(p.name_en);
const lowest = (list) => (list.length ? Math.min(...list.map((p) => n(p.price))) : 0);
const barOptions = (list) => {
  const bar = list.find((p) => /premium coffee bar/i.test(p.name_en));
  return ((bar?.variations || []).find((v) => /guests/i.test(v.name || ''))?.options || []).map((o) => ({ guests: o.label, price: n(o.price) }));
};

export const GUIDES = {
  '': {
    name: { he: 'לקנות קולד ברו', en: 'Buy cold brew' },
    title: { he: 'קולד ברו מוכן בבקבוק: מחירים ומשלוח עד הבית | גרמיר קפה', en: 'Buy Cold Brew Coffee in Israel: Bottles, Minis & 5L Jugs | Gremier' },
    desc: {
      he: 'קולד ברו מוכן לשתייה בבקבוקי ליטר, מיני של 250 מ״ל וג׳ריקנים של 5 ליטר. נחלט לאט בירושלים, כשר, עם משלוח עד הבית ברחבי הארץ.',
      en: 'Ready-to-drink cold brew in 1L bottles, 250ml minis and 5L jugs. Slow-brewed in Jerusalem, kosher, and delivered to your door across Israel.',
    },
    h1: { he: 'קולד ברו מוכן לשתייה, עד הבית', en: 'Ready-to-drink cold brew, delivered' },
    lead: {
      he: 'בלי לחכות שהקפה יחלוט ובלי לסנן: מוציאים מהמקרר, מוזגים על קרח, ואם בא לכם מוסיפים חלב.',
      en: 'No steeping and no straining: take it out of the fridge, pour it over ice, and add milk if you like.',
    },
    products: isCoffee,
    body: {
      he: (c) => `
<h2>כמה עולה קולד ברו?</h2>
<p>בקבוק ליטר של גרמיר עולה ₪${c.bottle}. מארז של ארבעה מיני עולה ₪${c.mini}, וג׳ריקן של 5 ליטר מתחיל ב-₪${c.jug}, כך שהליטר יוצא זול יותר. מי ששותה קולד ברו באופן קבוע יכול לעבור למנוי חודשי ולקבל 10% הנחה.</p>
<h2>איזה גודל מתאים לכם?</h2>
<ul>
<li><b>בקבוק ליטר:</b> למקרר בבית. שישייה לבחירה מורידה 5% מהמחיר.</li>
<li><b>מיני 250 מ״ל:</b> לתיק, לעבודה או לקופסת האוכל. יש שחור בלי סוכר ויש לאטה קרם מתוק.</li>
<li><b>ג׳ריקן 5 ליטר:</b> למשפחה גדולה, <a href="/he/cold-brew/office-and-wholesale">למשרד</a> או לאירוע.</li>
</ul>
<h2>איזה קולד ברו לבחור?</h2>
<ul>
<li><b>קלאסיק, קלייה כהה:</b> עמוק וחלק. חזק מספיק לחלב וחלק מספיק לשתות שחור.</li>
<li><b>בלנד הבית, קלייה בינונית:</b> שוקולדי ובהיר. הבחירה הנכונה אם אתם לא בטוחים.</li>
<li><b>קולומביה, קלייה בהירה:</b> פירותי וקליל. הכי טוב על קרח, שחור או עם מעט חלב.</li>
<li><b>נטול קפאין:</b> אותה חלקות, לערב ולמי שמוריד קפאין.</li>
<li><b>קלאסיק מתוק:</b> כבר ממותק, רק למזוג על קרח.</li>
</ul>
<h2>משלוח קולד ברו</h2>
<p>משלוח רגיל מגיע תוך 2–5 ימי עסקים, ומשלוח מהיר תוך 1–2 ימי עסקים. הקפה מגיע קר, וחשוב להכניס אותו למקרר מיד. המחיר נקבע לפי העיר ומופיע בקופה. לפרטים לפי אזור: <a href="/delivery/jerusalem">ירושלים</a>, <a href="/delivery/bet-shemesh">בית שמש</a>, <a href="/delivery/betar-illit">ביתר עילית</a>. אפשר גם <a href="/where-to-buy">לקנות בחנויות</a>.</p>
<p>כל המוצרים <a href="/he/cold-brew/kosher">כשרים</a>. רוצים להבין קודם מה מיוחד בשיטה? קראו <a href="/he/cold-brew/what-is-cold-brew">מה זה קולד ברו</a>.</p>`,
      en: (c) => `
<h2>How much does cold brew cost?</h2>
<p>A 1-liter bottle of Gremier is ₪${c.bottle}. A pack of four minis is ₪${c.mini}, and a 5-liter jug starts at ₪${c.jug}, which brings the price per liter down. If you drink it regularly, a monthly subscription takes 10% off.</p>
<h2>Which size is right for you?</h2>
<ul>
<li><b>1-liter bottle:</b> for the fridge at home. A build-your-own six-pack takes off 5%.</li>
<li><b>250ml minis:</b> for your bag, work or a lunchbox, either black with no sugar or sweet cream latte.</li>
<li><b>5-liter jug:</b> for a big family, <a href="/cold-brew/office-and-wholesale">the office</a> or an event.</li>
</ul>
<h2>Which cold brew should you choose?</h2>
<ul>
<li><b>Classic Dark Roast:</b> deep and smooth, strong enough for milk and smooth enough to drink black.</li>
<li><b>House Blend Medium Roast:</b> chocolatey and bright. The right pick if you're not sure.</li>
<li><b>Colombia Light Roast:</b> fruity and light, best over ice, black or with a little milk.</li>
<li><b>Decaf:</b> the same smoothness, for evenings or anyone cutting back.</li>
<li><b>Sweetened Classic:</b> already sweetened, just pour over ice.</li>
</ul>
<h2>Cold brew delivery in Israel</h2>
<p>Regular delivery arrives within 2–5 business days, and expedited delivery within 1–2 business days. It arrives cold, so please refrigerate it right away. The price depends on your city and appears at checkout. Details by area: <a href="/delivery/jerusalem">Jerusalem</a>, <a href="/delivery/bet-shemesh">Beit Shemesh</a>, <a href="/delivery/betar-illit">Beitar Illit</a>. You can also <a href="/where-to-buy">buy it in stores</a>.</p>
<p>Everything is <a href="/cold-brew/kosher">kosher</a>. Curious what makes the method different? Read <a href="/cold-brew/what-is-cold-brew">what cold brew is</a>.</p>`,
    },
    faq: {
      he: [['האם הקולד ברו מוכן לשתייה?', 'כן. מוזגים על קרח ושותים, עם חלב או בלי.'], ['כמה זמן לוקח המשלוח?', 'משלוח רגיל מגיע תוך 2–5 ימי עסקים ומשלוח מהיר תוך 1–2 ימי עסקים. אין משלוחים בשבת ובחגים.'], ['יש קולד ברו נטול קפאין?', 'כן, בבקבוק ליטר.'], ['יש הנחה על קנייה קבועה?', 'כן. במנוי חודשי יש 10% הנחה ואפשר להשהות בכל זמן.']],
      en: [['Is it ready to drink?', 'Yes. Pour it over ice and drink it, with or without milk.'], ['How long does delivery take?', 'Regular delivery arrives within 2–5 business days and expedited within 1–2. There are no deliveries on Shabbat or Jewish holidays.'], ['Do you have decaf cold brew?', 'Yes, in a 1-liter bottle.'], ['Is there a discount for regular orders?', 'Yes. A monthly subscription is 10% off and you can pause any time.']],
    },
  },
  'what-is-cold-brew': {
    name: { he: 'מה זה קולד ברו?', en: 'What is cold brew?' },
    title: { he: 'קולד ברו: מה זה, מתכון ביתי ומה ההבדל מקפה קר | גרמיר קפה', en: 'What Is Cold Brew? Recipe, and Cold Brew vs Iced Coffee | Gremier' },
    desc: {
      he: 'מה זה קולד ברו, במה הוא שונה מאייס קפה, כמה קפה ומים צריך, כמה זמן משרים וכמה זמן הוא נשמר במקרר. מדריך ומתכון פשוט להכנה בבית.',
      en: 'What cold brew is, how it differs from iced coffee, the coffee-to-water ratio, how long to steep it and how long it keeps. A simple guide and home recipe.',
    },
    h1: { he: 'מה זה קולד ברו, ואיך מכינים אותו בבית', en: 'What cold brew is, and how to make it at home' },
    lead: {
      he: 'קולד ברו הוא קפה שנחלט במים קרים במשך שעות ארוכות, במקום דקות ספורות במים חמים. הזמן מחליף את החום, והתוצאה חלקה ומתוקה יותר.',
      en: 'Cold brew is coffee steeped in cold water for many hours, rather than a few minutes in hot water. Time replaces heat, and the result is smoother and sweeter.',
    },
    products: (p) => /classic dark roast$|house blend medium|colombia light/i.test(p.name_en),
    body: {
      he: () => `
<h2>במה קולד ברו שונה מאייס קפה?</h2>
<p>אייס קפה הוא בדרך כלל קפה שהוכן בחום ואז קורר או נמזג על קרח. בקולד ברו המים לא מתחממים בכלל. החליטה הקרה מוציאה מהקפה פחות מהתרכובות המרות והחמוצות, ולכן הטעם עגול ושוקולדי יותר וקל לשתות אותו גם בלי סוכר.</p>
<h2>מתכון לקולד ברו בבית</h2>
<ol>
<li>טוחנים 80 גרם קפה טחינה גסה, בערך כמו לפרנץ׳ פרס.</li>
<li>מוסיפים ליטר מים קרים ומערבבים עד שכל הקפה רטוב.</li>
<li>מכסים ומכניסים למקרר ל-12 עד 18 שעות.</li>
<li>מסננים דרך פילטר נייר, בד או מסננת עדינה.</li>
<li>מוזגים על קרח, ומוסיפים חלב או סירופ לפי הטעם.</li>
</ol>
<p>רוצים תרכיז? משתמשים ב-200 גרם קפה לליטר מים, ומדללים אחרי הסינון ביחס של 1:1 במים או בחלב.</p>
<h2>איזה קפה הכי מתאים?</h2>
<p>קלייה כהה תיתן טעם עמוק ושוקולדי שעובד טוב עם חלב. קלייה בהירה תיתן טעם פירותי וקליל שטוב יותר שחור. חשוב שהטחינה תהיה גסה: טחינה דקה נותנת משקה עכור ומריר וקשה לסנן אותה.</p>
<h2>טעויות נפוצות</h2>
<ul>
<li><b>מעט מדי קפה:</b> המשקה יוצא מימי.</li>
<li><b>השריה ארוכה מדי:</b> אחרי יותר מיממה הטעם נוטה להיות מר ועץ.</li>
<li><b>סינון חפוז:</b> משקעים שנשארים ממשיכים להשפיע על הטעם.</li>
</ul>
<h2>לא בא לכם לחכות 18 שעות?</h2>
<p>אצלנו זה כבר מוכן. אנחנו חולטים באצוות קטנות בירושלים, ואתם רק מוזגים. אפשר <a href="/he/cold-brew">לקנות קולד ברו מוכן</a> בבקבוק ליטר, במיני או בג׳ריקן.</p>`,
      en: () => `
<h2>How is cold brew different from iced coffee?</h2>
<p>Iced coffee is usually brewed hot, then chilled or poured over ice. With cold brew the water is never heated. Cold steeping pulls fewer of the bitter and sour compounds from the coffee, so it tastes rounder and more chocolatey and is easy to drink without sugar.</p>
<h2>How to make cold brew at home</h2>
<ol>
<li>Grind 80 grams of coffee coarsely, about as you would for a French press.</li>
<li>Add one liter of cold water and stir until all the coffee is wet.</li>
<li>Cover and refrigerate for 12 to 18 hours.</li>
<li>Strain through a paper filter, cloth or fine sieve.</li>
<li>Pour over ice and add milk or syrup to taste.</li>
</ol>
<p>Want a concentrate? Use 200 grams of coffee per liter of water, and dilute 1:1 with water or milk after straining.</p>
<h2>Which coffee works best?</h2>
<p>A dark roast gives a deep, chocolatey flavor that works well with milk. A light roast is fruitier and lighter, and better black. Keep the grind coarse: a fine grind makes a cloudy, bitter drink that is hard to strain.</p>
<h2>Common mistakes</h2>
<ul>
<li><b>Too little coffee:</b> the drink turns out watery.</li>
<li><b>Steeping too long:</b> past a full day it tends to taste bitter and woody.</li>
<li><b>Rushed straining:</b> leftover sediment keeps affecting the flavor.</li>
</ul>
<h2>Don't feel like waiting 18 hours?</h2>
<p>Ours is already done. We brew in small batches in Jerusalem, and you just pour. You can <a href="/cold-brew">buy ready-made cold brew</a> in liter bottles, minis or jugs.</p>`,
    },
    faq: {
      he: [['יש בקולד ברו יותר קפאין?', 'זה תלוי בכמות הקפה ביחס למים, בסוג הפולים ובזמן ההשריה. אין מספר אחד שנכון לכל קולד ברו.'], ['כמה זמן קולד ברו ביתי נשמר במקרר?', 'בדרך כלל עד כשבוע בכלי סגור. אם הטעם או הריח השתנו, עדיף לא לשתות.'], ['אפשר לחמם קולד ברו?', 'כן, הטעם נשאר חלק יחסית, אבל הוא נועד להישתות קר.'], ['צריך ציוד מיוחד?', 'לא. מספיקים צנצנת גדולה או פרנץ׳ פרס ומסננת עדינה.']],
      en: [['Does cold brew have more caffeine?', 'It depends on the coffee-to-water ratio, the beans and the steeping time. There is no single figure that is true of all cold brew.'], ['How long does homemade cold brew keep?', 'Usually up to about a week in a sealed container in the fridge. If the taste or smell has changed, skip it.'], ['Can you heat cold brew?', 'Yes, it stays relatively smooth, though it is meant to be served cold.'], ['Do you need special equipment?', 'No. A large jar or French press and a fine strainer are enough.']],
    },
    recipe: {
      he: { name: 'קולד ברו ביתי', ingredients: ['80 גרם קפה טחון גס', 'ליטר מים קרים'], steps: ['טוחנים 80 גרם קפה טחינה גסה.', 'מוסיפים ליטר מים קרים ומערבבים.', 'מכסים ומכניסים למקרר ל-12 עד 18 שעות.', 'מסננים דרך פילטר, בד או מסננת עדינה.', 'מוזגים על קרח ומוסיפים חלב או סירופ לפי הטעם.'] },
      en: { name: 'Homemade cold brew', ingredients: ['80 g coarsely ground coffee', '1 liter cold water'], steps: ['Grind 80 grams of coffee coarsely.', 'Add one liter of cold water and stir.', 'Cover and refrigerate for 12 to 18 hours.', 'Strain through a filter, cloth or fine sieve.', 'Pour over ice and add milk or syrup to taste.'] },
    },
  },
  events: {
    name: { he: 'קולד ברו לאירועים', en: 'Cold brew for events' },
    title: { he: 'בר קולד ברו לאירועים: עמדת קפה קר לשמחות | גרמיר קפה', en: 'Cold Brew Coffee Bar for Events in Israel | Gremier' },
    desc: {
      he: 'בר קפה קר לאירוע, לפי מספר האורחים: דיספנסר, קולד ברו, חלב, כוסות, קשיות וסירופים בקופסה אחת, בלי בריסטה ובלי מכונה. כשר. משלוח ברחבי הארץ.',
      en: 'A cold coffee bar for your event, sized by guest count: dispenser, cold brew, milk, cups, straws and syrups in one box, with no barista or machine. Kosher.',
    },
    h1: { he: 'בר קולד ברו לאירועים ולשמחות', en: 'A cold brew coffee bar for your event' },
    lead: {
      he: 'כל מה שצריך לעמדת קפה קר מגיע בקופסה אחת. מוזגים את הקפה לדיספנסר, והאורחים מגישים לעצמם.',
      en: 'Everything for a cold coffee station arrives in one box. Pour the coffee into the dispenser and your guests serve themselves.',
    },
    products: (p) => p.category === 'coffeebars' && /premium|dispenser/i.test(p.name_en),
    body: {
      he: (c) => `
<h2>מה מקבלים בבר הקפה?</h2>
<p>דיספנסר, קולד ברו, חלב, כוסות גדולות עם מכסים וקשיות, וסירופים של קרמל, וניל וסוכר. הכול מותאם למספר האורחים, כך שלא צריך לחשב כמויות.</p>
${c.barTable.he}
<h2>אפשר להתאים אישית</h2>
<ul>
<li>לבחור קלייה אחרת, או להוסיף נטול קפאין.</li>
<li>להחליף את החלב לחלב שיבולת שועל או שקדים.</li>
<li>להוסיף דיספנסר נוסף כדי שלא ייווצר תור.</li>
</ul>
<h2>למה קולד ברו ולא עגלת קפה רגילה?</h2>
<p>אין מכונה, אין צורך בבריסטה ואין המתנה לכל כוס. הקפה כבר מוכן, האורחים מרכיבים לעצמם את המשקה, וזה נראה טוב על השולחן. זה מתאים לימי הולדת, בר ובת מצווה, חתונות, קידושים, כנסים ואירועי חברה.</p>
<h2>איך מזמינים?</h2>
<p>בוחרים את מספר האורחים <a href="/p/premium-coffee-bar">בעמוד בר הקפה</a>, מתאימים את התוספות ובוחרים תאריך. לאירוע גדול יותר או לשאלות, <a href="${WA}">כתבו לנו בוואטסאפ</a> ונחזור אליכם תוך שעות.</p>
<p>הקפה <a href="/he/cold-brew/kosher">כשר</a>. למשרד או לצריכה קבועה, ראו <a href="/he/cold-brew/office-and-wholesale">קולד ברו בכמויות</a>.</p>`,
      en: (c) => `
<h2>What's in the coffee bar?</h2>
<p>A dispenser, cold brew, milk, large cups with lids and straws, and caramel, vanilla and sugar syrups. It's all sized to your guest count, so there's nothing to calculate.</p>
${c.barTable.en}
<h2>Make it yours</h2>
<ul>
<li>Choose another roast or add decaf.</li>
<li>Swap the milk for oat or almond milk.</li>
<li>Add an extra dispenser so no line builds up.</li>
</ul>
<h2>Why cold brew instead of a regular coffee cart?</h2>
<p>There's no machine, no barista and no waiting for each cup. The coffee is already made, guests build their own drink, and it looks great on the table. It suits birthdays, bar and bat mitzvahs, weddings, kiddushes, conferences and company events.</p>
<h2>How to order</h2>
<p>Choose your guest count on the <a href="/p/premium-coffee-bar">coffee bar page</a>, set your add-ons and pick a date. For a bigger event or any questions, <a href="${WA}">message us on WhatsApp</a> and we'll get back to you within hours.</p>
<p>The coffee is <a href="/cold-brew/kosher">kosher</a>. For an office or regular supply, see <a href="/cold-brew/office-and-wholesale">bulk cold brew</a>.</p>`,
    },
    faq: {
      he: [['צריך בריסטה או חשמל למכונה?', 'לא צריך בריסטה ואין מכונת קפה. מוזגים את הקפה לדיספנסר והאורחים מגישים לעצמם.'], ['יש אפשרות בלי חלב רגיל?', 'כן, אפשר להחליף לחלב שיבולת שועל או שקדים.'], ['אפשר לבחור תאריך?', 'כן, בוחרים תאריך בהזמנה. אין משלוחים בשבת ובחגים.'], ['מה עושים באירוע של יותר מ-125 אורחים?', 'כתבו לנו בוואטסאפ ונתאים לכם כמות.']],
      en: [['Do you need a barista or a machine?', 'No barista and no coffee machine. Pour the coffee into the dispenser and guests serve themselves.'], ['Is there an option without regular milk?', 'Yes, you can swap to oat or almond milk.'], ['Can I choose a date?', 'Yes, you pick a date when you order. There are no deliveries on Shabbat or Jewish holidays.'], ['What about more than 125 guests?', 'Message us on WhatsApp and we will work out the right amount.']],
    },
  },
  'office-and-wholesale': {
    name: { he: 'קולד ברו למשרד ולעסקים', en: 'Cold brew for offices and businesses' },
    title: { he: 'קולד ברו למשרד ולעסקים: ג׳ריקנים של 5 ליטר | גרמיר קפה', en: 'Bulk Cold Brew for Offices & Businesses in Israel | Gremier' },
    desc: {
      he: 'קולד ברו בכמויות למשרדים, לחנויות ולאירועים גדולים: ג׳ריקנים של 5 ליטר ומארז 15 ליטר במחיר הטוב ביותר לליטר. כשר, עם משלוח ברחבי הארץ.',
      en: 'Bulk cold brew for offices, shops and large events: 5-liter jugs and a 15-liter set at the best price per liter. Kosher, delivered across Israel.',
    },
    h1: { he: 'קולד ברו בכמויות, למשרד ולעסק', en: 'Bulk cold brew for your office or business' },
    lead: {
      he: 'ג׳ריקן במקרר של המשרד, וכל אחד מוזג לעצמו על קרח. בלי מכונה לתחזק ובלי קפסולות להזמין.',
      en: 'A jug in the office fridge, and everyone pours their own over ice. No machine to maintain and no capsules to reorder.',
    },
    products: (p) => p.category === 'bulk',
    body: {
      he: (c) => `
<h2>כמה זה עולה?</h2>
<p>ג׳ריקן של 5 ליטר מתחיל ב-₪${c.jug}. מארז של שלושה ג׳ריקנים, 15 ליטר, עולה ₪${c.triple}: בערך ₪${c.triplePerL} לליטר, המחיר הכי טוב שלנו.</p>
<h2>למי זה מתאים?</h2>
<ul>
<li><b>משרדים:</b> קפה קר מוכן לכל הצוות, בלי ציוד.</li>
<li><b>חנויות, מסעדות ובתי קפה:</b> קולד ברו מוכן להגשה או למכירה.</li>
<li><b>מוסדות ואירועים גדולים:</b> כמות גדולה במקום אחד.</li>
</ul>
<h2>איך שומרים?</h2>
<p>הג׳ריקן נשמר במקרר, ומוזגים ממנו לפי הצורך. הוא מגיע קר, אז חשוב להכניס אותו למקרר כשהוא מגיע.</p>
<h2>הזמנה קבועה או מחיר לעסק</h2>
<p>צריכים כמות קבועה, או מעוניינים למכור גרמיר בחנות? <a href="${WA}">כתבו לנו בוואטסאפ</a>. אפשר גם לראות <a href="/where-to-buy">אילו חנויות כבר מוכרות אותנו</a>.</p>
<p>לאירוע חד-פעמי, בדקו את <a href="/he/cold-brew/events">בר הקפה לאירועים</a>. הקפה <a href="/he/cold-brew/kosher">כשר</a>.</p>`,
      en: (c) => `
<h2>What does it cost?</h2>
<p>A 5-liter jug starts at ₪${c.jug}. A set of three jugs, 15 liters in all, is ₪${c.triple}: about ₪${c.triplePerL} per liter, our best price.</p>
<h2>Who is it for?</h2>
<ul>
<li><b>Offices:</b> cold coffee ready for the whole team, with no equipment.</li>
<li><b>Shops, restaurants and cafés:</b> cold brew ready to serve or sell.</li>
<li><b>Institutions and large events:</b> a large quantity in one place.</li>
</ul>
<h2>How do you store it?</h2>
<p>Keep the jug in the fridge and pour as you go. It arrives cold, so refrigerate it when it arrives.</p>
<h2>Regular orders or business pricing</h2>
<p>Need a regular supply, or want to sell Gremier in your store? <a href="${WA}">Message us on WhatsApp</a>. You can also see <a href="/where-to-buy">which stores carry us</a>.</p>
<p>For a one-off event, see the <a href="/cold-brew/events">event coffee bar</a>. The coffee is <a href="/cold-brew/kosher">kosher</a>.</p>`,
    },
    faq: {
      he: [['כמה ליטרים יש בג׳ריקן?', '5 ליטר. יש גם מארז של שלושה ג׳ריקנים, 15 ליטר בסך הכול.'], ['אילו טעמים יש ב-5 ליטר?', 'קלאסיק קלייה כהה, בלנד הבית וקולומביה קלייה בהירה.'], ['אפשר למכור גרמיר בחנות?', 'כן, כתבו לנו בוואטסאפ ונדבר.']],
      en: [['How much is in a jug?', '5 liters. There is also a set of three jugs, 15 liters in all.'], ['Which coffees come in 5 liters?', 'Classic Dark Roast, House Blend and Colombia Light Roast.'], ['Can I sell Gremier in my store?', 'Yes, message us on WhatsApp and we will talk.']],
    },
  },
  kosher: {
    name: { he: 'קולד ברו כשר', en: 'Kosher cold brew' },
    title: { he: 'קולד ברו כשר, בהשגחת הרב שמואל ויינער | גרמיר קפה', en: 'Kosher Cold Brew Coffee in Israel | Gremier' },
    desc: {
      he: 'קולד ברו כשר מירושלים, בהשגחת הרב שמואל ויינער. בקבוקים, מיני, ג׳ריקנים ובר קפה לשמחות, עם אפשרות לחלב שיבולת שועל או שקדים. משלוח עד הבית.',
      en: 'Kosher cold brew from Jerusalem under the supervision of Rabbi Shmuel Weiner: bottles, minis, jugs and event coffee bars, with oat or almond milk options.',
    },
    h1: { he: 'קולד ברו כשר, נחלט בירושלים', en: 'Kosher cold brew, brewed in Jerusalem' },
    lead: {
      he: 'הקולד ברו של גרמיר כשר בהשגחת ועד הכשרות של הרב שמואל ויינער, רב קהל זכרון נתן צבי.',
      en: "Gremier's cold brew is kosher under the Vaad HaKashrus of Rabbi Shmuel Weiner, Rav of Kehal Zichron Nosson Tzvi.",
    },
    products: isCoffee,
    limit: 6,
    body: {
      he: () => `
<img class="seal" src="/kashrut-sm.png" alt="חותמת ועד הכשרות, הרב שמואל ויינער" width="120" height="120" loading="lazy">
<h2>מה מכיל חלב?</h2>
<p>הלאטה קרם (אוריג׳ינל, קרמל ווניל) מכיל חלב, וכך גם החלב שמגיע עם בר הקפה. הקפה השחור, כמו הקלאסיק, בלנד הבית, קולומביה ונטול הקפאין, נמכר בלי חלב.</p>
<h2>קפה קר לשמחה</h2>
<p><a href="/he/cold-brew/events">בבר הקפה לאירועים</a> אפשר להחליף את החלב לחלב שיבולת שועל או שקדים, לפי אופי הסעודה.</p>
<h2>איפה קונים?</h2>
<p>אפשר <a href="/he/cold-brew">להזמין קולד ברו כשר עד הבית</a>, או למצוא אותנו <a href="/where-to-buy">בחנויות</a>. אין משלוחים בשבת ובחגים.</p>
<p>לשאלות על הכשרות של מוצר מסוים, <a href="${WA}">כתבו לנו בוואטסאפ</a>.</p>`,
      en: () => `
<img class="seal" src="/kashrut-sm.png" alt="Vaad HaKashrus seal, Rabbi Shmuel Weiner" width="120" height="120" loading="lazy">
<h2>What contains milk?</h2>
<p>The Cream Lattes (Original, Caramel and Vanilla) contain milk, as does the milk supplied with a coffee bar. The black coffees, such as Classic, House Blend, Colombia and Decaf, are sold without milk.</p>
<h2>Cold coffee for a simcha</h2>
<p>With the <a href="/cold-brew/events">event coffee bar</a> you can swap the milk for oat or almond milk, depending on the meal.</p>
<h2>Where to buy</h2>
<p>You can <a href="/cold-brew">order kosher cold brew to your door</a> or find us <a href="/where-to-buy">in stores</a>. There are no deliveries on Shabbat or Jewish holidays.</p>
<p>For questions about a specific product's kashrus, <a href="${WA}">message us on WhatsApp</a>.</p>`,
    },
    faq: {
      he: [['מי נותן את הכשרות?', 'ועד הכשרות של הרב שמואל ויינער, רב קהל זכרון נתן צבי.'], ['יש אפשרות בלי חלב לבר הקפה?', 'כן, אפשר להחליף לחלב שיבולת שועל או שקדים.']],
      en: [['Who gives the kosher supervision?', 'The Vaad HaKashrus of Rabbi Shmuel Weiner, Rav of Kehal Zichron Nosson Tzvi.'], ['Can a coffee bar come without regular milk?', 'Yes, you can swap to oat or almond milk.']],
    },
  },
};

export const guidePath = (key, lang) => `${lang === 'he' ? '/he' : ''}/cold-brew${key ? '/' + key : ''}`;
export const guidePaths = () => Object.keys(GUIDES).flatMap((k) => [guidePath(k, 'he'), guidePath(k, 'en')]);

const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

function context(list) {
  const coffees = list.filter(isCoffee), bars = barOptions(list);
  const triple = n(list.find((p) => /3 . 5l/i.test(p.name_en))?.price);
  const row = (o, cur) => `<tr><td>${esc(o.guests)}</td><td>₪${o.price}</td></tr>`;
  const table = (head1, head2) => (bars.length ? `<table><thead><tr><th>${head1}</th><th>${head2}</th></tr></thead><tbody>${bars.map((o) => row(o)).join('')}</tbody></table>` : '');
  return {
    bottle: lowest(coffees.filter((p) => p.category === 'bottles' && !/6-pack/i.test(p.name_en))) || 49,
    mini: lowest(coffees.filter((p) => p.category === 'minis' && !/6-pack/i.test(p.name_en))) || 59,
    jug: lowest(coffees.filter((p) => p.category === 'bulk' && !/^3/.test(p.name_en))) || 169,
    triple: triple || 489,
    triplePerL: ((triple || 489) / 15).toFixed(1).replace(/\.0$/, ''),
    barTable: { he: table('מספר אורחים', 'מחיר'), en: table('Guests', 'Price') },
  };
}

const CSS = `
body{margin:0;font:17px/1.7 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1a1a1a;background:#faf8f5}
main{max-width:760px;margin:0 auto;padding:22px 18px 64px}
header{display:flex;align-items:center;gap:10px;margin-bottom:18px}header img{width:42px;height:42px;border-radius:50%}header a{color:inherit;text-decoration:none;font-weight:700}header .lang{margin-inline-start:auto;font-weight:500;font-size:.9rem;color:#555}
nav.crumbs{font-size:.85rem;color:#777;margin-bottom:14px}nav.crumbs a{color:inherit}
h1{font-size:clamp(1.8rem,5vw,2.5rem);line-height:1.18;margin:0 0 12px;letter-spacing:-.01em}h2{font-size:1.28rem;line-height:1.3;margin:34px 0 8px}
.lead{font-size:1.1rem;color:#444;margin:0 0 18px}a{color:#7a5230}p,li{margin-block:.45em}ul,ol{padding-inline-start:1.3em}
.cta{display:inline-block;margin:4px 0 4px 8px;padding:12px 22px;border-radius:999px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600}.cta.alt{background:#fff;color:#1a1a1a;border:1.5px solid #1a1a1a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px}.p{display:grid;gap:3px;background:#fff;border:1px solid #e6e4df;border-radius:14px;padding:10px;text-decoration:none;color:inherit}.p img{width:100%;height:auto;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#f2efea}.p b{font-size:.88rem;line-height:1.3}.p i{font-style:normal;font-weight:600;font-size:.9rem}
table{border-collapse:collapse;width:100%;max-width:340px;background:#fff;margin:14px 0}th,td{border:1px solid #e6e4df;padding:8px 12px;text-align:start}th{background:#f2efea;font-size:.9rem}
.seal{display:block;margin:6px 0 4px;border-radius:12px}
details{background:#fff;border:1px solid #e6e4df;border-radius:12px;padding:12px 16px;margin:8px 0}summary{font-weight:600;cursor:pointer}details p{margin:8px 0 0}
.more{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0}.more a{display:block;padding:8px 14px;border-radius:999px;background:#fff;border:1px solid #e6e4df;text-decoration:none;color:inherit;font-size:.9rem}`;

export function guideRoute(key, lang) {
  return async function onRequestGet() {
    const g = GUIDES[key], he = lang === 'he';
    const list = await products().catch(() => []);
    const c = context(list), url = SITE + guidePath(key, lang), other = SITE + guidePath(key, he ? 'en' : 'he');
    const home = he ? '/he' : '/', shop = `${home}#shop`;
    const items = list.filter(g.products).slice(0, g.limit || 12);
    const card = (p) => `<a class="p" href="/p/${slug(p.name_en)}"><img src="${esc(image(p.images?.[0], 400))}" alt="${esc((he ? p.name_he : p.name_en) || p.name_en)}" loading="lazy" width="400" height="400"><b>${esc((he ? p.name_he : p.name_en) || p.name_en)}</b><i>₪${n(p.price)}</i></a>`;
    const faq = g.faq[lang];
    const crumbs = [[he ? 'גרמיר קפה' : 'Gremier Coffee', SITE + home], ...(key ? [[GUIDES[''].name[lang], SITE + guidePath('', lang)]] : []), [g.name[lang], url]];
    const graph = [
      { '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) },
      { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ];
    if (g.recipe) {
      const r = g.recipe[lang];
      graph.push({ '@type': 'Recipe', name: r.name, image: [HERO], description: g.desc[lang], author: { '@type': 'Organization', name: 'Gremier Coffee' }, recipeCategory: he ? 'משקה' : 'Drink', recipeIngredient: r.ingredients, recipeYield: he ? 'ליטר' : '1 liter', totalTime: 'PT18H', recipeInstructions: r.steps.map((text) => ({ '@type': 'HowToStep', text })) });
    }
    if (items.length) graph.push({ '@type': 'ItemList', itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/p/${slug(p.name_en)}`, name: (he ? p.name_he : p.name_en) || p.name_en })) });
    const related = Object.keys(GUIDES).filter((k) => k !== key).map((k) => `<li><a href="${guidePath(k, lang)}">${esc(GUIDES[k].name[lang])}</a></li>`).join('');
    const html = `<!doctype html><html lang="${lang}"${he ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(g.title[lang])}</title><meta name="description" content="${esc(g.desc[lang])}"><link rel="canonical" href="${url}">
<link rel="alternate" hreflang="he" href="${he ? url : other}"><link rel="alternate" hreflang="en" href="${he ? other : url}"><link rel="alternate" hreflang="x-default" href="${he ? other : url}">
<meta property="og:type" content="article"><meta property="og:locale" content="${he ? 'he_IL' : 'en_US'}"><meta property="og:title" content="${esc(g.title[lang])}"><meta property="og:description" content="${esc(g.desc[lang])}"><meta property="og:url" content="${url}"><meta property="og:image" content="${HERO}">
<link rel="icon" href="/icon-192.png"><script type="application/ld+json">${json({ '@context': 'https://schema.org', '@graph': graph })}</script>
<style>${CSS}</style><link rel="stylesheet" href="/storefront-journeys.css?v=20261102-2"></head><body><main>
<header><img src="/icon-192.png" alt="" width="42" height="42"><a href="${home}">${he ? 'גרמיר קפה' : 'Gremier Coffee Co.'}</a><a class="lang" href="${guidePath(key, he ? 'en' : 'he')}" hreflang="${he ? 'en' : 'he'}">${he ? 'English' : 'עברית'}</a></header>
<nav class="crumbs">${crumbs.map(([name, item], i) => (i === crumbs.length - 1 ? esc(name) : `<a href="${item.replace(SITE, '')}">${esc(name)}</a> ›`)).join(' ')}</nav>
<article><h1>${esc(g.h1[lang])}</h1><p class="lead">${esc(g.lead[lang])}</p>
<a class="cta" href="${shop}">${he ? 'לחנות' : 'Shop the coffee'}</a><a class="cta alt" href="${WA}">${he ? 'שאלה? וואטסאפ' : 'Questions? WhatsApp'}</a>
${g.body[lang](c)}
${items.length ? `<h2>${he ? 'מהחנות שלנו' : 'From our shop'}</h2><div class="grid">${items.map(card).join('')}</div>` : ''}
<h2>${he ? 'שאלות נפוצות' : 'Common questions'}</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
</article>
<h2>${he ? 'עוד על קולד ברו' : 'More about cold brew'}</h2><ul class="more">${related}</ul>
</main><script src="/storefront-journeys.js?v=20261102-4"></script></body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' } });
  };
}

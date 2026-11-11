/** Owner's physical Store route. Read-time only: never rewrite items or call an AI. */
export const STORE_ROUTE = [
 ['spices','Spices & oatmeal'],['bread','Bread, pita & challah'],['fresh','Fresh fish & chicken'],
 ['produce','Fruit & vegetables'],['dairy','Dairy, eggs & herring'],['cold','Refrigerated & frozen'],
 ['dry','Dry goods'],['cleaning','Cleaning'],['drinks','Drinks'],['snacks','Snacks'],
 ['home','Home, baby & disposables'],['other','Other items'],
] as const;
export type StoreAisle=typeof STORE_ROUTE[number][0];
const en=(words:string)=>new RegExp(`\\b(?:${words})\\b`,'iu');
const he=(words:string)=>new RegExp(`(?<![\\p{L}\\p{N}])(?:ו|ה|וה|ל)?(?:${words})(?![\\p{L}\\p{N}])`,'u');
const has=(text:string,english:string,hebrew:string)=>en(english).test(text)||he(hebrew).test(text);
export function storeAisle(item:{name:string;notes?:string}):StoreAisle{
 const name=item.name.normalize('NFKC').toLowerCase().replace(/[־–—]/g,' ').replace(/[\u0591-\u05C7]/g,'');
 const text=name+' '+(item.notes??'').normalize('NFKC').toLowerCase();
 // Specific placements beat generic ingredients (oatmeal biscuits, herring fish, etc.).
 if(has(name,'biscuits?|cookies?|crackers?|baking soda|baking powder|pickles','ביסקוויטים|ביסקוויט|עוגיות|קרקרים|פתיבר|פתי בר|סודה לשתייה|סודה לשתיה|אבקת אפייה|אבקת אפיה|מלפפונים חמוצים'))return'dry';
 if(has(name,'herrings?','הרינג|הערינג|דג מלוח|מטיאס'))return'dairy';
 if(has(name,'oatmeal|porridge|rolled oats|steel cut oats|oats|spices?|seasonings?|paprika|cumin|cinnamon|turmeric|oregano|basil|black pepper','שיבולת שועל|שיבולת|קוואקר|קואקר|תבלינים|תבלין|פפריקה|כמון|קינמון|כורכום|אורגנו|פלפל שחור'))return'spices';
 if(has(name,'tissues?|toilet paper|paper towels?|napkins?|cups?|plasticware|cutlery|disposables?|diapers?|nappies|wipes|foil|cling film|garbage bags?|trash bags?|flossers?|dental floss|toothbrush(?:es)?|toothpaste|shampoo','טישו|נייר טואלט|נייר סופג|מגבות נייר|מפיות|כוסות|כוס|חד פעמי|חד פעמיות|סכו[״"]?ם|חיתולים|טיטולים|מגבונים|נייר כסף|ניילון נצמד|שקיות אשפה|חוט דנטלי|מברשת שיניים|משחת שיניים|שמפו'))return'home';
 if(has(name,'dish soap|dishwasher|detergent|bleach|cleaners?|cleaning|laundry|sponges?|floor cleaner|soap|bathroom spray|vanish','סבון|אקונומיקה|חומרי ניקוי|חומר ניקוי|נוזל כלים|אבקת כביסה|מרכך כביסה|ספוגים|מדיח|וניש|תרסיס ניקוי'))return'cleaning';
 if(has(name,'drinks?|beer|wine|grape juice|juice|soda|cola|water|alcohol|vodka|whisk[ey]+|seltzer|sparkling water','שתייה|שתיה|משקאות|בירה|יין|מיץ ענבים|מיץ|קולה|סודה|מים|אלכוהול|וודקה|וויסקי'))return'drinks';
 if(has(text,'frozen|freezer|refrigerated|ice cream','קפוא|קפואה|קפואים|קפואות|קירור|מקפיא|גלידה'))return'cold';
 if(has(name,'canned|tinned|cans? of|crushed tomatoes|tomato paste|tomato sauce|passata|cereals?|granola bars?|cereal bars?|protein bars?|pasta|noodles|spaghetti|macaroni|rice|flour|salt|sugar|lentils|couscous|quinoa|cooking oil|olive oil|tuna','שימורים|קופסאות שימורים|עגבניות מרוסקות|רסק עגבניות|רוטב עגבניות|קורנפלקס|דגני בוקר|חטיפי דגנים|חטיפי אנרגיה|חטיפי חלבון|פסטה|אטריות|ספגטי|פתיתים|אורז|קמח|מלח|סוכר|עדשים|קוסקוס|קינואה|שמן|טונה'))return'dry';
 if(has(text,'frozen|freezer|refrigerated','קפוא|קפואה|קפואים|קפואות|קירור|מקפיא'))return'cold';
 if(has(name,'bread|pitas?|pitta|challah|challos|challas|bagels?|rolls?|buns?','לחם|לחמים|פיתה|פיתות|חלה|חלות|לחמניות|בייגל'))return'bread';
 if(has(name,'fish|salmon|tilapia|cod|trout|chicken|poultry|chicken breast|schnitzel','דג|דגים|סלמון|אמנון|פורל|עוף|עופות|חזה עוף|פרגיות|שניצל'))return'fresh';
 if(has(name,'eggs?|milk|yog[uh]rt|yog[uh]rts|cheese|butter|cream|cottage|labneh|kefir','ביצים|ביצה|חלב|יוגורט|גבינה|גבינות|חמאה|שמנת|קוטג[׳\']?|לבן|לבנה'))return'dairy';
 if(has(name,'hummus|humus|salads?|pizza|ice cream|tofu|chilled','חומוס|סלטים|סלט|פיצה|גלידה|טופו|מצונן|מצוננת'))return'cold';
 if(has(name,'apples?|bananas?|oranges?|lemons?|limes?|pears?|grapes?|berries|strawberries|blueberries|avocados?|tomatoes|tomato|cucumbers?|zucchinis?|courgettes?|carrots?|potatoes|potato|onions?|garlic|lettuce|cabbage|broccoli|cauliflower|peppers?|mushrooms?|fruits?|vegetables?|beets?|beetroot|coriander|cilantro|parsley|dill','תפוחים|תפוח|בננות|בננה|תפוזים|לימונים|אגסים|ענבים|תותים|אבוקדו|עגבניות|עגבניה|מלפפונים|מלפפון|קישואים|קישוא|גזר|תפוחי אדמה|בצל|שום|חסה|כרוב|ברוקולי|כרובית|פלפלים|פטריות|פירות|ירקות|סלק|כוסברה|פטרוזיליה|שמיר'))return'produce';
 if(has(name,'drinks?|beer|wine|grape juice|juice|soda|cola|water|alcohol|vodka|whisk[ey]+|seltzer|sparkling water','שתייה|שתיה|משקאות|בירה|יין|מיץ ענבים|מיץ|קולה|סודה|מים|אלכוהול|וודקה|וויסקי'))return'drinks';
 if(has(name,'pretzels?|chips|crisps|snacks?|popcorn|bamba|bissli|chocolate|candy|sweets','בייגלה|ביגלה|צ[׳\']יפס|תפוצ[׳\']יפס|חטיפים|חטיף|פופקורן|במבה|ביסלי|שוקולד|ממתקים'))return'snacks';
 return'other';
}
export function orderShoppingItems<T extends {name:string;notes?:string;checked:number}>(items:T[],listId:string):T[]{
 if(listId!=='store')return items;
 const needed=items.filter(i=>!i.checked).map((item,index)=>({item,index,rank:STORE_ROUTE.findIndex(a=>a[0]===storeAisle(item))}));
 needed.sort((a,b)=>a.rank-b.rank||a.index-b.index);
 return [...needed.map(i=>i.item),...items.filter(i=>i.checked)];
}

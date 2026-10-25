// Free, local "is this actionable?" rules (same as bridge/cos_bridge.py). English + Hebrew.
const COS_ASKS = new RegExp(
  "\\?|" +
  "\\b(can you|could you|would you|will you|please|pls|plz|let me know|lmk|send( me)?|need|asap|urgent|" +
  "when (can|will|are|is)|what time|how much|price|invoice|order|deliver|pick ?up|call me|remind|" +
  "don'?t forget|tomorrow|today|tonight|by (mon|tue|wed|thu|fri|sun|sat|tomorrow|tonight|\\d))\\b|" +
  "(אפשר|תוכל|תוכלי|תשלח|תשלחי|צריך|צריכה|דחוף|מתי|כמה|מחיר|חשבונית|הזמנה|משלוח|תתקשר|תתקשרי|תזכיר|" +
  "אל תשכח|מחר|היום|הערב|בבקשה|תעדכן|תעדכני)",
  "i",
);

/** Should this incoming message reach the Chief of Staff? */
function cosActionable(m, myNames) {
  const text = (m.text || "").trim();
  if (!text || text.length < 2) return false;
  if (/^(?:thanks?(?: you)?(?: so much)?|thank you(?: very much)?|ok(?:ay)?|got it|sounds good|no problem|all good|you're welcome|see you(?: (?:today|tomorrow|tonight|then))?|fyi|תודה(?: רבה)?|בסדר|סבבה|מעולה|נתראה(?: מחר)?)[\s.!…👍🙏❤️]*$/iu.test(text)) return false;
  const lower = text.toLowerCase();
  const mentioned = text.includes("@") || myNames.some((n) => n && lower.includes(n.toLowerCase()));
  if (m.isGroup && !mentioned) return false;           // groups: only when you're mentioned
  if (m.muted && !mentioned) return false;             // muted chats: same
  // A mention is routing information, not proof that an answer is owed.
  return COS_ASKS.test(text);
}

/** Courtesy alone is not an unanswered request. Keep questions with an actual request eligible. */
export function courtesyOnly(text: string) {
  return /^(?:thanks?(?: you)?(?: so much)?|thank you(?: very much)?|ok(?:ay)?|got it|sounds good|no problem|all good|you're welcome|see you(?: (?:today|tomorrow|tonight|then))?|fyi|תודה(?: רבה)?|בסדר|סבבה|מעולה|נתראה(?: מחר)?)[\s.!…👍🙏❤️]*$/iu.test(text.trim());
}
export function confirmedReply(decision: { action?: string; response_required?: boolean; confidence?: string; evidence?: string }, text: string) {
  const quote = typeof decision.evidence === 'string' ? decision.evidence.trim() : '';
  return decision.action === 'reply' && decision.response_required === true && decision.confidence === 'high'
    && quote.length >= 3 && text.toLocaleLowerCase().includes(quote.toLocaleLowerCase()) && !courtesyOnly(text);
}

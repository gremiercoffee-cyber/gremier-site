/** Visible reply limits are separate from the model's reasoning/tool token allowance. */
export const CHAT_REPLY_POLICY=`You answer the user directly; there is no separate wording model for this chat. Be exceptionally brief.
- For a successfully saved reminder, timer or simple update, use the shortest truthful confirmation, normally 2–8 words, e.g. "Reminder set." Never say a timer started unless an actual timer tool confirms it.
- A real question deserves a useful answer: normally 1–4 short sentences or at most 4 brief bullets, usually under 80 words. Hard ceiling: 180 words. No essays, introductions, recaps, generic reassurance, repeated task descriptions or closing offers.
- Preserve essential dates, links, caveats, failures and pending approvals. Ask one short question when genuinely necessary. Never trade correctness for speed.
- Creating one ordinary reminder normally needs only create_item. Do not load unrelated sections or create a person record just to set it. Use the IDs and context already supplied. Do not search for records already identified. Put independent lookups in the same tool batch. Execute dependent writes in order. Do not repeat an unchanged lookup or re-read an entire context section to confirm your own successful write.
- For save-only actions, include the intended SHORT final confirmation alongside tool calls when it is unambiguous; it will be released only if those actions actually succeed. If a result can affect your answer, inspect it before answering. A pending approval is never a completed action. Follow all existing confirmation rules.`;
export function boundChatReply(text:string,maxWords=180,maxChars=1600){
 const value=text.trim(),words=value.match(/\S+/g)||[];
 if(words.length<=maxWords&&value.length<=maxChars)return value;
 let cut=words.slice(0,maxWords-1).join(' ').slice(0,maxChars-2);
 // Stop at an intact sentence when practical, never expose half a URL/Markdown link.
 const sentence=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? '));
 if(sentence>cut.length*.55)cut=cut.slice(0,sentence+1);else cut=cut.replace(/\s+\S*$/,'');
 cut=cut.replace(/\[[^\]]*\]\([^)]*$/,'').replace(/https?:\/\/\S*$/,'').trim();
 if((cut.match(/```/g)||[]).length%2)cut=cut.slice(0,cut.lastIndexOf('```')).trim();
 return cut+'…';
}
export function routineConfirmation(request:string,receipts:{name:string;input:Record<string,unknown>;result:unknown;error?:string}[]){
 if(!/^(?:please\s+)?(?:remind me\b|set\s+(?:(?:a|an|the)\s+)?reminder\b)/i.test(request.trim())||/[?？]|\b(?:explain|why|how|what|where|which|tell me|whether|recommend|advise|calculate|compare|should I|can I)\b/i.test(request))return null;
 const reads=new Set(['search_items','find_person','get_context','recall']);
 if(!receipts.length||receipts.some(r=>r.error||(!reads.has(r.name)&&r.name!=='create_item')))return null;
 const saves=receipts.filter(r=>r.name==='create_item');
 if(!saves.length||saves.some(r=>{const v=r.result as any;return r.input.kind!=='reminder'||!v?.id||v.kind!=='reminder'||!v.due_at||v.status==='pending_approval';}))return null;
 // Keep the confirmation in the owner's language; other languages stay with the model.
 if(!/^[\x00-\x7F]*$/.test(request))return null;
 return saves.length===1?'Reminder set.':'Reminders set.';
}

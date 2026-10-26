/** Visible reply limits are separate from the model's reasoning/tool token allowance. */
export const CHAT_REPLY_POLICY=`Replies: very brief.
- A successful save: the shortest true confirmation, 2–8 words, e.g. "Reminder set."
- A real question: 1–4 short sentences or up to 4 bullets, usually under 80 words. Hard ceiling: 180 words. No intros, recaps or closing offers.
- Keep essential dates, links, caveats, failures and pending approvals. Ask one short question only when needed.
- Save-only work: put the short confirmation in finish_reply with the saves; it is shown only if they succeed.`;
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

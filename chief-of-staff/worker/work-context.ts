import type {Item} from '../shared/types';

export function isDrivingBlock(s:{name:string;activity_mode?:string}) {
 if(s.activity_mode&&s.activity_mode!=='auto')return s.activity_mode==='driving';
 return /\b(commut(?:e|ing)|driv(?:e|ing))\b|נסיעה|נהיגה|בדרך ל/i.test(s.name);
}
/** A phone call is different from an in-person conversation. Coding is not voice work by default. */
export function drivingSuitable(i:Partial<Item>) {
 if(i.execution_mode&&i.execution_mode!=='unspecified')return i.execution_mode==='call'||i.execution_mode==='voice';
 const title=(i.title??'').trim();
 if(/^call for\b|^phone (?:charger|case|repair)\b/i.test(title))return false;
 if(/\b(print|sign|deliver|grind|brew|pick up|in person)\b/i.test(title))return false;
 return /^(?:phone(?: call)?\b|call(?: back)?\b|make (?:a |the )?(?:phone )?call\b|return .{0,50}\bcall\b|להתקשר(?:\s|$)|שיחת טלפון)/iu.test(title);
}
export const EXECUTION_MODES=['unspecified','call','voice','desk','physical'] as const;

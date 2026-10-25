import type {Env} from './env';
/** Legacy add-ons may still submit conversations. Meeting inference is intentionally disabled. */
export async function detectMeeting(_env:Env,_message:unknown) {
 return {ok:true,disabled:true,agreed:false};
}

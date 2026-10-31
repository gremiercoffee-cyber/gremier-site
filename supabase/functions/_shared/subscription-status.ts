/** PayMe lifecycle codes (not the separate API response status_code=0 success flag).
 * https://docs.payme.io/marketplaces-and-platforms/lists-statuses/subscription-statuses
 */
export function subscriptionState(providerStatus: unknown, recorded = "") {
  const codes: Record<string, string> = { "1":"pending", "2":"active", "3":"paused", "4":"failed", "5":"cancelled", "6":"completed", "7":"retrying" };
  const events: Record<string, string> = { "sub-create":"pending", "sub-active":"active", "sub-iteration-success":"active", "sub-cancel":"cancelled", "sub-failure":"failed", "sub-complete":"completed" };
  const state = providerStatus == null ? events[recorded] || "unknown" : codes[String(providerStatus).trim()] || "unknown";
  const labels: Record<string, string> = {pending:"Awaiting first payment",active:"Active",paused:"Paused",failed:"Payment failed",cancelled:"Cancelled",completed:"Completed",retrying:"Payment retry scheduled",unknown:"Status unavailable"};
  return { status:state, status_label:labels[state], active:state==="active", cancelled:state==="cancelled", can_cancel:state!=="cancelled"&&state!=="completed", needs_attention:["paused","failed","retrying","unknown"].includes(state) };
}

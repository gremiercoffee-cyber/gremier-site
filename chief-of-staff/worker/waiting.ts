import {isWaiting} from '../shared/waiting';
export {isWaiting} from '../shared/waiting';
/**
 * Things the user is only waiting on ("Wait for Arnpack's quote"): the other person will answer on their own,
 * so they stay out of block reminders, wrap-ups, check-ins and briefings. Once it has been quiet too long it
 * comes back as one line: "Follow up with Arnpack? No reply in 5 days".
 */
export const FOLLOW_UP_AFTER_DAYS = 4;

type W = { kind: string; title: string; person?: string | null; created_at: string };

const waitedDays = (i: Pick<W, "created_at">) => Math.floor((Date.now() - Date.parse(i.created_at)) / 86_400_000);
/** Waiting long enough that the user should reach back out. */
export const needsFollowUp = (i: W) => isWaiting(i) && waitedDays(i) >= FOLLOW_UP_AFTER_DAYS;
/** Waiting, and not for long: nothing to say about it yet. */
export const quietWait = (i: W) => isWaiting(i) && !needsFollowUp(i);

/** "Follow up with Arnpack? No reply in 5 days: branded four-bottle packaging quote" */
export function followUpLine(i: W) {
  const what = i.title.trim().replace(/^(wait(ing)?|await(ing)?)\s+(for\s+)?/i, "");
  const who = i.person?.replace(/@.*/, "") || "them";
  return `Follow up with ${who}? No reply in ${waitedDays(i)} days: ${what}`;
}

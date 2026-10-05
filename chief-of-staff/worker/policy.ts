/**
 * The interruption rule: what buzzes the phone right away, and what waits quietly for the next
 * briefing (it still shows on the home screen and widget). Important and time-sensitive things
 * interrupt; ordinary information can wait.
 */
export type Urgency = "now" | "later";

export function urgencyFor(type: string, priority?: number | null): Urgency {
  switch (type) {
    case "event":       // a meeting is about to start
    case "reminder":    // the user asked to be reminded at that time
    case "checkin":     // "Did you…?" the user set up
    case "wa_send":     // a message waiting for the user's Send tap
    case "wa_failed":
    case "postponed":   // pushed off 3+ times: worth one direct question
    case "digest":      // the check-ins themselves
    case "briefing":
    case "mission_ask": // a mission is stuck until the user answers
    case "routine_alert": // a task the user asked to be alerted about
    case "situation":   // you're in yeshiva / at an event now: this is the moment
    case "wrapup":      // a block just ended: quick "did you get to these?"
    case "review":      // the weekly review
      return "now";
    case "overdue":
    case "headsup":
    case "email":
    case "whatsapp":
      return priority === 1 ? "now" : "later";
    case "unanswered":  // gathered into "N replies to catch up on" (Replies) instead
    default:            // waiting nudges, auto-done notes, sent confirmations, sweeps, mission progress
      return "later";
  }
}

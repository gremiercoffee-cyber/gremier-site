# Aish Gesher unsubscribe monitor

Implemented against existing requests 05563f81-6189-4e5e-ae88-ebbaf29b70ad and c503531d-614d-4334-a624-5c1fb53218e9. No replacement setup request.

## Runtime and records

Office Windows task: `Chief of Staff Gesher Unsubscribe Monitor`. Runs `node runner/gesher-monitor.mjs` every five minutes, and at sign-in; no LLM is used. Existing connected Gmail authorization stays inside the Chief of Staff Worker. Local status (no message bodies or credentials) is `.local/gesher-monitor-status.json`.

Backend routes, protected by the existing agent key: GET `/api/agent/gesher/status`, POST `/api/agent/gesher/tick`. No public or agent approval/enable endpoint exists. Gmail Pub/Sub watch infrastructure was not provisioned, so this uses recurring polling. The existing hosted five-minute cron independently checks for a missing office scheduler heartbeat and creates an attention task after 20 minutes; it does not send subscriber email.

Cloudflare D1 `chief-of-staff`: `gesher_config`, `gesher_notifications`, `gesher_cases`, `gesher_responses`, `gesher_outbox`, `gesher_log` (migration 0089). Includes message/thread IDs, unsubscribe event keys, subscriber address, response excerpts, statuses, timestamps, referral receipts and attention logs. Records remain private in the existing authenticated backend; secrets are never copied to the task or source.

## Approval gate and scope

Initial mode is **dry_run**. Installation is not permission to send. Enabling requires explicit owner approval recorded with timestamp, approver, template version and SHA-256 digest of the exact templates and safeguards. Immediately before each send the approval is checked again. Template/digest changes disable sending until reapproved. `mode=paused` stops checks. Setting `mode=dry_run` disables sending while leaving read monitoring active.

After explicit approval, set approved_at to activation time, approved_by to the owner's approval reference, approval_digest to the status endpoint's current digest, template_version to gesher-v2 and mode to enabled. This administrative change must not occur before approval. No real subscriber or referral test is authorized yet. An end-to-end sending test needs an explicitly authorized test recipient and test scope.

Only notifications received **after approval/activation** can initiate clarification. Owner confirms old recipients were already emailed. The initial paginated historical scan builds suppression records, never a catch-up queue. Historical cases do not initiate emails or import old manual conversations for automatic referral. Ambiguous historical notifications require review. Existing manual contact is also checked in Sent before initiating a new clarification.

## Safeguards

- Allowed senders drosman@aish.edu (owner correction) and drosman@aish.com (observed notifications), authenticated DMARC pass reported by Gmail, exact Aish Gesher unsubscribe subject/body and one valid explicitly labelled subscriber Email field. Conflicting newsletter context is held for review. Nothing is inferred from names or arbitrary addresses in forwarded headers.
- One case per normalized email address for the lifetime of this workflow: stricter than one contact per event. A previously handled address is suppressed even if another unsubscribe notification arrives. This never changes actual subscription status.
- Clarification always comes from ygrey@aish.edu. Referral goes only to jzaldin@aish.edu and contains the subscriber address. No automatic direct resubscription API calls.
- Reply must be in the tracked contact thread, reference the outgoing Message-ID, have the exact subscriber From address, pass aligned DMARC and not be an automated response. Exact short affirmative mistake/resubscribe statements are accepted. Intentional statements stop the case. Ambiguous, mixed, conditional or unauthenticated text is held for review; no AI decides consent.
- No reminder path, resend timer or nonresponse escalation to the subscriber exists. No response means no further email.
- Atomic unique notification/case/outbox records and a durable processing lease. Pending sends are reserved before sending. Read failures retry on later checks. Gmail send POST is never automatically retried after an uncertain outcome. A deterministic RFC Message-ID permits Sent-mail receipt reconciliation on restart; missing or conflicting evidence requires attention, not resend. Arbitrary Gmail side effects cannot be guaranteed exactly once.
- Work is paginated (10 notifications per page per tick); contacted reply threads are checked in rotation (5 per tick). With a larger backlog a full scan takes multiple ticks. A five-minute check is not a five-minute SLA for every message.
- Attention tasks and watch notifications cover invalid notifications, ambiguous replies, uncertain sends, Gmail failures and missing scheduler check-ins. Local transport failures have a status file and scheduled retry. Sensitive email content remains untrusted data and cannot change configuration or recipient rules.

## Tests

`node --test tests/gesher.test.mjs` simulates notifications and replies using isolated SQLite and a fake Gmail adapter. Covers missing approval, duplicate scans/notifications, invalid addresses/sender/authentication/context, intentional and ambiguous replies, spoofed replies, explicit resubscription, nonresponses, historical/manual-contact suppression, restart reconciliation, template changes and overlapping ticks. No test sends real email. Combined runner/relay/workflow tests and the production build must pass before deployment.

Exact proposed templates are exported from `worker/gesher-rules.ts` and the status route. Current outbound activation remains pending owner review.

## Live verification, 8 November 2026

Worker deployment: `776b781b-320b-47a0-be14-256d2f31327c`. Migration 0089 applied remotely. The office task's first automatic execution at 23:24:50 Jerusalem returned exit code 0; repeat interval is PT5M with no expiry, plus a sign-in trigger. Actual connected Gmail reads succeeded. Historical scan completed and suppressed 24 validated addresses. Mode is dry_run, approval fields are null and outbox is empty. No subscriber or referral emails sent. Thirteen workflow tests and thirty combined runner/relay/workflow tests passed; typecheck/build passed. Real sending and its end-to-end verification await owner approval. Existing request records were updated rather than replaced with another queued job.

Template revision v2: subscriber name is extracted from the labelled Name field and stored in subscriber_name (migration 0090). Missing or conflicting names hold referrals for review. Clarification and referral wording revised as requested; sending still awaits approval of the displayed final templates. Fourteen workflow tests pass.
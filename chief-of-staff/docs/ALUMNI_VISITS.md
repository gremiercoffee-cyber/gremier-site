# Alumni visit sheet workflow

Owner-authorized personal WhatsApp → owner-confirmed proposals → Sheet `1vOCi1EZyGk_rRBW0fLjyELWNe9HqAp9AZEcl318Hc2s`.

## Runtime

- `worker/alumni-visits.ts`, migration 0082. Existing bridge tracker routes and existing five-minute Worker cron; no new bot or external scheduler.
- `settings.alumni_visit_sheet_workflow.enabled` controls collection and processing. Business/Gmail/own messages rejected server-side. This does not grant account permissions.
- Authenticated agent endpoints: GET `/api/agent/alumni-visits/status?probe=1`; POST `/api/agent/alumni-visits/backfill`; POST `/api/agent/alumni-visits/process`. Existing x-agent-key authentication. Never include keys in logs.
- Future incoming messages only, starting 4 November 2026 at 12:46:04 Jerusalem time (10:46:04 UTC). Historical backfill is disabled server-side and the companion requests zero history. Earlier candidates were cancelled without sheet writes. Original message timestamps are checked against the saved cutoff; replayed old messages cannot enter processing.
- Extension 1.9.2 sends original message IDs/chat IDs/timestamps, immediately follows a candidate conversation for subsequent bare date messages, and persists failed deliveries in an account-bound local retry queue (one-minute alarm). Refresh the existing personal extension and WhatsApp tab to load it. Older readers can deliver candidates with a fallback timestamp/text fingerprint, but lack the new reliability features.
- Successful direct-chat visits add an exact chat-name follow-up rule at the next five-minute config refresh. Group conversations are not followed wholesale.

## Google

The existing Aish account can read Sheet1, with Name=A, Arrival=B, Leaving=C. No Drive API needed. No account or sharing settings changed. Read access is distinct from verified real write access; `last_success` records actual write/readback processing.

## Integrity and review

Only unambiguous confirmed visits/updates become writes. Full names match exactly after normalization. Duplicate matches, surname overlaps, partial names, uncertainty, ambiguous dates, cancellations, and formula targets are held for owner review with an app notification. Review events remain stopped; an owner answer must be handled explicitly before reprocessing. There is no automatic fuzzy merge, cancellation deletion, or clearing omitted dates.

Relative dates use the original timestamp in Asia/Jerusalem. Supported deterministic date evidence: today/tomorrow/yesterday (English/Hebrew), ISO date, day + full English month + year. Other date expressions are held for clarification rather than guessed. Calendar/date syntax can be expanded with tests.

Only individual mapped cells are written with RAW values. Unrelated cells/formulas are untouched. Each event saves source, extracted observation, intended before/after cell values, status, and readback receipt. A database lease serializes this writer; a persisted intent is reconciled after an interrupted response rather than blindly appended. Later owner edits conflicting with intent stop processing for review. Older events cannot overwrite newer applied updates for the same person/chat. This is conservative conflict detection, not a Google Sheets transactional compare-and-swap guarantee against simultaneous human edits.

At most three events per cron to bound external API work. Every sheet change requires explicit owner confirmation. Processing saves the exact cell preview and approval hash in awaiting_approval, then notifies the owner. GET status lists proposals; POST /api/agent/alumni-visits/<event-id>/decision accepts approve/reject plus the unchanged approval_hash. Use it only after an explicit owner response to the concrete preview. Rejection never writes; changed target cells stop for review. There is no automatic approval. The Google token identity is checked against the stored account using userinfo. No WhatsApp messages are sent. Existing unrelated watches are preserved.

## Validation

Run `npm run typecheck` and `node --test tests/alumni-visits.test.mjs tests/whatsapp.test.mjs tests/agent-chats.test.mjs`.

Tests cover account boundaries, deduplication, original-date timezone, blanks, formulas, identity uncertainty, blocked Google access, successful cell readback, interrupted-write reconciliation, immediate bare follow-ups, and out-of-order messages. Synthetic fixtures stay in memory; never insert sample alumni into the live sheet.

Helper v3 identifies personal/business account and scopes device identity accordingly. A personal-targeted browser job cannot be claimed by Business or legacy unidentified helpers. Each job retains normal phone approval.

## Optional write-permission diagnostic

POST /api/agent/alumni-visits/write-check/prepare reads the real literal name header and saves a same-value preview, without writing to Google. Only after explicit owner confirmation, POST /api/agent/alumni-visits/write-check/confirm with that approval_id writes the exact existing header back unchanged and verifies readback. No test person/row is inserted. The confirmation is single-use, identity-bound and expires in 24 hours. Tentative dates such as Nov 2? are preserved literally when omitted by a later update; existing rows alone do not establish confirmed visits.

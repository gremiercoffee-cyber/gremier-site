# Groups and Replies

Groups and Replies are separate navigation destinations. The address book is inside a
collapsed People section in Settings (legacy People links also open Settings).

Group messages remain editable while unsent. Review cards in chat and Groups show the
actual destination, email recipients, subject and body. Save draft persists edits; Send
uses the exact displayed text and an atomic claim to prevent concurrent duplicate sends.
Successful email sends automatically archive the message. The archive is collapsed by
default and sorts by the archive/sent time, newest first. Failures remain visible with
per-recipient results and do not silently disappear. WhatsApp links preload text; after
sending externally the user can explicitly archive that draft. No real messages are sent
by drafting or opening a page.

Replies only includes items marked as actual reply obligations, not every task received
through email or WhatsApp. Existing explicit reply tasks are migrated; email triage sets
reply_required within its existing classification call. Verified WhatsApp obligations
join the queue quietly, without the old four-hour delay or per-person notifications.

Numbers stay fixed for the current page session, including when entries are dismissed or
refreshed. A single voice note or typed instruction is interpreted against the exact
number-to-item snapshot shown on screen. The server validates all returned actions before
applying drafts/dismissals. Unknown/stale numbering or ambiguous references do not send or
dismiss messages. Drafts are persisted and editable. The red circled X and spoken “no reply
needed” both close the obligation. A finished voice note automatically applies the batch;
typed instructions use Draft / update replies.

Send email uses the original mailbox and thread, preserving Reply-To, subject and thread
headers. Delivery claims prevent repeated sends. Unconfirmed failures leave the reply
open and require checking Gmail before another send, avoiding blind retries. WhatsApp
opens the actual chat phone where known, otherwise a chat picker; opening it never claims
a message was sent. The user can mark it replied, and observed outgoing messages continue
to close the corresponding obligations. Multiple requests in one chat share a card while
message-specific reactions preserve any other unanswered requests.

Notifications use a consolidated Replies link. There are morning (10:00+) and evening
(17:00+) catch-up windows, never overnight or during driving/Shabbat. An unchanged backlog
reminds at most once in roughly 24 hours; changed queues can receive at most two daily
summaries. Muted or postponed items stay visible in the queue but do not count toward the
notification. Generic catch-up notifications and individual overdue/headsup nudges exclude
reply obligations so they do not create a second notification stream.

Tests run with fixture databases, stubbed AI/mail responses and server-rendered controls;
they do not send real messages or create paid background jobs.

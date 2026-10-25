# Meeting preparation

Meeting prep lives inside the app under the Meetings sidebar entry. Calendar meetings and
explicitly saved, dated Schedule events are available as choices; recurring daily blocks and
hidden calendar entries are excluded. Calendar sync reads the next 90 days with pagination.
Schedule and calendar IDs remain stable across rescheduling so the agenda follows the meeting.

When the user adds a thought by text, dictation or live voice, the assistant reads the meeting
list and proposes the note with candidate IDs. The note is safely held as a draft. Even a single
match must be confirmed with its name and local date/time. Multiple matches are offered as
choices in chat and a picker shown in both Home/chat and Meetings. A subsequent explicit
choice in chat or a picker click appends the original note to that meeting. The assistant
cannot propose and auto-confirm within the same turn. Unknown meetings leave the draft pending;
the user can add the meeting explicitly, choose another meeting, or discard the note.

Confirmed notes append rather than replace earlier thoughts. They can be edited or removed,
remain accessible in a collapsed archive after the meeting, and survive calendar retention.
Repeated or concurrent confirmation creates at most one entry per draft. Hidden/cancelled
meetings cannot receive new notes; nothing is attached based on an inferred match alone.

There are no proactive prep offers or prep Google Docs. Migration 0049 dismisses old prep
nudges and creates the agenda/draft storage without deleting existing documents. Old phone
prep actions redirect to Meetings. WhatsApp conversation-based meeting detection is disabled
at the server so existing add-ons cannot create guessed meetings; the add-on no longer sends
those snippets. Previously saved Schedule entries are preserved for review. Self-notes FROM
completed meetings retain their separate existing capture behavior.

Tests use fixture databases, stubbed network responses and server rendering; they create no
real notes, calendar events, documents, notifications or paid AI jobs.

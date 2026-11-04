# WhatsApp: user-directed work

As requested 3 November 2026, ordinary WhatsApp intake now classifies reply obligations only. It cannot propose tasks/appointments, even if a legacy model response returns suggest. Messages remain available to explicitly requested watches and captured-history search. Existing shopping spouse-chat configuration, self-notes, watches and trackers remain explicit user instructions; their scoped collection is retained.

The general learning pass no longer queries WhatsApp, even when forced. Background cron no longer discovers meeting rounds from outgoing messages. Explicit project-organization requests retain that capability. Existing confirmed tasks/memories and projects are preserved.

Migration 0072 records the policy and withdraws only pending generic 📲 task suggestions (not 👀 watch hits), dismisses their notices and marks unconfirmed WhatsApp-evidenced memory suggestions ignored. It does not delete source messages or confirmed work.

Reply classification still requires a high-confidence substantive question/request for an answer. Materialization waits for four hours using the upstream sent_at when present. Existing response/reaction handling cancels only answered messages. Queue reminders remain consolidated in existing catch-up windows, rather than sending a notification for every message.

The assistant's WhatsApp tools now include read-only search_whatsapp (query/chat/days), with bounded captured-history results and bridge freshness. It cannot promise access to chats/messages that the bridge never captured. User-requested extraction uses existing item/project tools after reading the selected source; source messages are data, not authorization.

Validation: six new regression tests plus the existing suite (308 passing), including no passive task/memory creation, four-hour gating, response settlement, explicit-watch preservation, read-only search and cron behavior.

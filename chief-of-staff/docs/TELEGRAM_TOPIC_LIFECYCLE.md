# Telegram topic lifecycle and job overview

The Bot API does not provide a forum-topic-deleted webhook. Existing cron now validates up to 20 mapped topics per five-minute pass using editForumTopic with only chat_id/message_thread_id. Telegram documents omitted name/icon as keeping the current values, so this cannot rename or reset the icon. A successful result or TOPIC_NOT_MODIFIED confirms presence. Permission, network, closed-topic and deleted-message errors do not delete anything.

Only explicit 400 TOPIC_ID_INVALID/TOPIC_DELETED/message-thread-not-found failures in the configured owner supergroup remove matching app entries. General and other groups are excluded. The tombstone stops schedules, hides/unpins linked jobs, skips pending/running records and suppresses late result publication. Already executing external processes cannot be unsent or retroactively revoked. Source records remain for audit; linked conversations are archived, subject mappings and shopping pin pointers are removed. Unrelated projects, lists, journal data and conversations are preserved. A send failure to a missing thread triggers the same reconciliation immediately. No topic is created or recreated automatically.

Topic rename service messages update corresponding job titles and known subject names. Closing/reopening is distinct from deletion.

App navigation groups active pinned jobs by project, with paused and finished/stopped work collapsed. Job pages default to a designed overview: short synopsis, needs-you card, next action, recommendation and at most two recent reply cards. Chat is a separate tab. Full reports, old correspondence, history and execution controls are collapsed. No model/engine metadata or notification-permission banner is shown in the overview. New generated synopses are limited to two short sentences/420 characters; existing longer summaries have a compact preview and deliberate expansion.

Validation covers deletion isolation, cancelled callbacks, history preservation, throttled no-change checks, safe handling of transient/permission/closed/pin failures, rename sync, grouped navigation and synthetic mobile/desktop overview behavior. Live synchronization is verified separately after deployment; no real topic is deleted for testing.

Official sources: https://core.telegram.org/bots/api#editforumtopic and https://core.telegram.org/api/forum .

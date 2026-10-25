# Shopping lists

Shopping lists live only in the sidebar. They have separate database tables, so automatic
shopping additions never produce tasks, home cards, reminders or briefing entries.

The main Store list cannot be deleted, but it can be renamed. Additional lists can be created,
renamed and deleted. Items support quantities, notes, editing, removing, checking and unchecking.
Text chat and live voice share the same shopping tools; “add milk to my shopping list” defaults
to Store. WhatsApp always targets that same main list.

## WhatsApp setup

1. Deploy the Worker and frontend with migration `0041_shopping.sql`.
2. Update the installed WhatsApp add-on to version 1.6.0 (background.js, content.js, reader.js
   and manifest.json). Keep its existing config.js and bridge key. Reload the extension in
   Chrome and refresh WhatsApp Web. The add-on adds the alarms permission for network retries.
3. In the app sidebar, open Shopping lists → WhatsApp setup. Choose the exact chat name for
   the user's wife, or its exact one-to-one chat ID. Enable the watch and save.
4. Keep personal WhatsApp Web open with the add-on running. Store-reading mode is required;
   the chat-list fallback cannot reliably identify both directions, so shopping is disabled
   in fallback mode. Setup changes reach the add-on within one minute.

The watch defaults off. Only the selected personal, one-to-one conversation qualifies; the
server independently rejects groups, business WhatsApp and other chat IDs. When configured by
exact name, the first matching conversation is pinned to its ID, excluding any later chat with
the same name. Use an explicit chat ID if two contacts already share that name. Messages in either
direction bypass the general request filter and 15-minute bundling. A plain bunch of food
items qualifies, in English or Hebrew, even without “buy” or “shopping list”. The model is
instructed to preserve quantities and reject past purchases, negations and unrelated talk.
This classification uses the configured fast model; regression tests substitute model output
and do not establish live model accuracy.

Only fresh messages are captured (two hours maximum age); existing chat history is not imported.
Message IDs prevent replays, including after checking off or deleting an item. Identical
unchecked names are deduplicated within a list; variants remain separate. Messages are persisted
before classification. Model failures defer processing to the cron. Lightweight classification
has no daily call-count cap. Offline add-on deliveries retry every minute, subject
to the freshness limit. Disabling/changing the watch discards pending server messages and
rechecks the selected chat before writing any extracted items.

## Verification

`npm run test:shopping` runs SQLite-backed tests and an add-on event test. They cover lists,
editing and completion, repeated messages, both directions, chat/account/group exclusion,
model failures and uncapped lightweight checks. `npm run build` checks TypeScript and builds the app.

## Recent purchases and archive

Checked items stay visible in blue for a rolling 24 hours from their purchase timestamp.
After that they appear in each list's Purchased archive, a native disclosure collapsed by
default. The timestamp is stored separately as checked_at, so editing names, quantities or
notes and repeated check requests do not extend the window. Unchecking clears the timestamp;
checking again starts a fresh window. Archived records retain edit/uncheck controls and normal
same-name duplicate protection. No deletion, scheduled job or AI call is needed to archive.
The existing 15-second refresh updates the partition while the list is open.

Migration 0047 adds checked_at and uses the last known updated_at for purchases that predate
purchase-time tracking, so old checked items do not all get a fresh 24-hour window at deploy.

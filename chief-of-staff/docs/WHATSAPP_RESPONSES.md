# WhatsApp response handling (add-on 1.7.0)

The read-only reader observes the loaded `WAWebCollections.Reactions` collection and its
explicit `reactionByMe` field. It subscribes to add/change events and checks already-loaded
models every ten seconds to catch nested updates. It does not patch WhatsApp functions,
send, click, fetch chat history, or mark anything read. See the upstream collection usage:
https://docs.wwebjs.dev/structures_Message.js.html#getReactions

Only fresh own reactions with a nonempty emoji and a parent message ID are acknowledged.
Other people's reactions, removals, stale history and reactions to one's own messages are
ignored. Reaction data availability depends on WhatsApp Web's runtime. `reaction_support`
in the add-on diagnostics indicates whether the reaction collection was available. Chat-list
fallback mode cannot resolve reaction targets and does not guess a chat-wide response.

Buffers retain individual message IDs. Reacting before forwarding removes only the parent
message. The server stores reply-required IDs selected by triage; a reaction subtracts only
that ID. A written reply acknowledges earlier requests, leaving later questions open.
Account and stable chat identity are checked independently. Signals are persisted and replayed
after classification so an acknowledgement arriving during a model call is not lost. Add-on
network failures queue reply/reaction signals locally for retry. Completion only applies to
linked `Reply to …` tasks; acknowledging a message never completes deliveries or other work.
Already-sent device notifications may still need manual dismissal; app reply cards are closed.
Legacy inbox records without message IDs cannot safely be matched to a targeted reaction.

The classifier requires a high-confidence substantive answer obligation and an exact evidence
quote from the new message. Greetings, thanks, FYIs, rhetorical questions, requested information,
optional social responses and conversation endings should not produce reply obligations.
Recent incoming messages and short outgoing snippets provide context. A question mark or
mention alone does not imply a reply is needed. Model failures never default to “reply”.

Lightweight email/WhatsApp/shopping/tracker checks have no daily call-count cap. Usage is still
logged; per-pass batching remains for runtime throughput. AI research/job approval is unchanged.
Tests use fixture model outputs and verify mechanics; they do not establish live model accuracy.

Checks: `npm run test:whatsapp`, `npm run test:shopping`, `npm run test:reminders`, `npm run build`.

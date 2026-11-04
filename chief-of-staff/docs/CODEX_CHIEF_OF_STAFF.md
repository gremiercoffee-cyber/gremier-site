# Codex as the conversation layer

The deployed CoS API can now be used directly by Codex, without asking the internal chatbot to reinterpret a request. Chief of Staff remains the shared database and action executor. This release does NOT replace live Telegram or app chat routing with Codex; that requires a persistent Codex thread/turn bridge and verified routing. Existing chat continues working.

OpenAI App Server supports creating/resuming persistent Codex threads and host tools: https://learn.chatgpt.com/docs/app-server . A future bridge should keep one stable Codex thread per Telegram conversation/topic, fetch current CoS context on every turn, and execute only documented CoS API operations. A persisted chat is not an unlimited or automatically fresh copy of database state.

## Authentication

Base: https://chief-of-staff.gremiercoffee.workers.dev/api/agent
Use x-agent-key from COS_AGENT_KEY or C:/Users/Yoni/.tokens/cos-agent-key.txt. Never print, commit or place it in chat messages, frontend bundles or URLs. The existing key is reused; no new credential or CoS passcode is required.

Local client (run in chief-of-staff):

    node scripts/cos-agent.mjs GET /capabilities
    node scripts/cos-agent.mjs POST /chats path/to/request.json

JSON payloads are read from a file so shell escaping cannot change them. GET /capabilities describes available operations. Write operations have receipts; an assistant message is not proof an action happened.

## Chats

POST /chats with {"title":"Packaging","client_ref":"codex:<stable-thread-id>","project_id":"optional existing id","job_id":"optional existing id"}. Repeated client_ref returns the same app conversation. This creates a CoS app chat, not a Codex desktop thread.

GET /chats lists non-archived general chats. GET /chats/:id reads chat metadata. GET /chats/:id/context?query=... returns the current shared context, saved checkpoint, recent 30 messages and linked job facts/brief. Use the current timestamp and source records rather than treating an old chat response as truth. General access does not expose Health conversations.

POST /chats/:id/messages with {"role":"user|assistant","content":"...","idempotency_key":"unique turn/message reference"}. Only API-created Codex chats accept writes. User role is for the owner's actual words; source material and agent output must not be misrepresented as owner instructions. Replay the same key/content to retry safely; changed content under a used key returns 409. Messages are appended, never executed or used as approval. Forged tool receipts/meta are ignored; provenance is fixed to external_codex. No LLM call is made by recording a message.

GET /chats/:id/messages returns {messages,has_more,next_cursor}, latest 100 chronologically. Pass before_message_id=next_cursor for earlier pages. PATCH /chats/:id accepts {"base_revision":N,"checkpoint":"short durable handoff","title":"optional","archived":true|false}. Message inserts and checkpoint changes advance revision; stale writes return 409. Checkpoints should contain decisions, scope, unresolved questions and record IDs, never secrets. Archived chats retain history but leave the active sidebar.

## Records

GET /cos/dashboard, /cos/items, /cos/projects, /cos/memories, /cos/replies, /cos/areas reuse existing app reads. Existing query filters apply, e.g. /cos/items?kind=waiting&status=open.

POST /cos/items and /cos/projects; PATCH /cos/items/:id and /cos/projects/:id reuse existing validation and side effects such as project progress. For agent-created items use source=codex. This API does not expose outbound sends, payments, settings, OAuth credentials, approval decisions or arbitrary tool execution. Existing external-action approval flows remain required.

GET /jobs and /jobs/:id/context provide live job knowledge. GET /waiting includes linked email state and actual latest reply where linked. POST /waiting/:item_id/link with {"email_id":"existing job_email id"} associates an explicitly identified waiting record with existing correspondence. Do not guess a link. Correspondence notifications handle that source while it is actively monitored; generic waiting reminders avoid duplicate nudges. A reply is not automatically proof the promised quote/report arrived, so only a confirmed resolution should complete the waiting record.

## Waiting behavior

Wait-for tasks are normalized to kind=waiting; existing open misfiled entries are corrected without resetting their age. Passive waits never appear in Now even after four days. Home shows a collapsed Waiting on others section with tracking rows, not completion checkboxes. Existing follow-up reminders ask whether to follow up; they do not send messages by themselves. Source tracking can be read and resolved through the API.


Live verification (3 November 2026): deployment 8efd44b9-79a2-4f1e-a5c6-75199ff1c593. Created a clearly named verification chat, appended a harmless assistant message, fetched current context, saved a checkpoint and archived the verification chat. Existing dashboard returned zero passive wait-for entries in Now; 23 waiting records remained tracked. No supplier messages were sent, no waiting item was marked complete, and live Telegram chat routing was not switched. 325 JavaScript tests passed, plus the mobile Home waiting-row check.

# Chief of Staff: judgment and wording

Released 2026-10-16. Live Worker version: `754661ed-53c8-4415-98b1-0e2e3a0ca4a9`.

`MODEL_BRAIN=gpt-6.1-sol`, `MODEL_WRITER=gpt-6-luna`. The legacy main/fast variables remain compatible, but a legacy `fast` label does not send classification to Luna. Unknown purposes default to the brain.

## Responsibilities

- Sol: WhatsApp/email/shopping triage, reply obligations, meeting detection, project matching, watch/tracker decisions, lasting-memory learning, planning, brain dumps, prioritization, briefings, and research judgments.
- Sol interprets chat and performs authorized actions with existing handlers; Luna phrases a compact final handoff and execution receipts. Luna receives no action tools, full history or full memory catalog. A wording failure never replays actions. Unguided reply drafting remains a judgment task; an explicitly guided reply can use Luna for wording.
- Existing code schedules fixed reminders, checks time/completion/reaction state, deduplicates notifications and delivers alerts. No model is added to these mechanical paths. Existing smarter message-obligation checks use Sol.
- The Realtime audio model remains the spoken interface. A single `consult_chief` tool sends personal decisions and actions to Sol. Old live-voice sessions must reconnect; direct old tools cannot bypass the decision layer.
- Research/spending and send approvals stay in the existing handlers. No proactive research jobs, paid model escalations, new budget settings or additional polling schedules are introduced.

## API and accounting

Sol uses Responses with low reasoning, including tool loops. Function outputs retain call IDs and reasoning items; optional tool-schema fields retain non-strict semantics. Dynamic tool loading and existing save-only round shortcuts remain supported. Incomplete classifications are rejected rather than treated as decisions or silently downgraded. Small JSON jobs have room for reasoning tokens.

Each Sol agent round is logged under `<purpose>:brain`; final text wording is separately logged as `chat_wording` on Luna. Existing usage accounting includes the provider's total output tokens, including reasoning, and cached input. Exact cache-write premiums and Realtime audio/transcription are still outside the current meter.

The earlier $2.30/month calculation represented upgrading background work while leaving chat interpretation on Luna. This release also gives Sol chat interpretation, so that figure is not a forecast for this architecture. Actual cost depends on Sol reasoning, caching and tool rounds; Luna only receives the compact result. No fixed monthly cost is promised.

## Validation

Production build/typecheck and 43 automated tests passed, including 10 provider/routing integration tests with mocked network responses. They cover legacy fast-tier judgment routing, Responses compatibility, reasoning carry-forward, dynamic tools, pending approvals, tool failures, round limits, refusal preservation, wording failures without action replay, and paid-search limits. Existing reminder, shopping, reaction, and notification tests remain green. No live research or task/reminder was created for verification.

Official compatibility references:
- https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.1-sol
- https://developers.openai.com/api/docs/guides/function-calling

## Faster, concise chat (18 October 2026)

Normal text and dictation chat now use Sol for both judgment and the short final answer. The automatic Luna rewrite is removed from this path. Other explicit wording work (titles/guided drafts) retains Luna; compatibility callers using `renderReply` still work. The brain model and low reasoning effort remain unchanged.

`shared/chat-replies.ts` requests 2–8-word routine confirmations and usually fewer than 80 words for substantive answers. Responses uses `text.verbosity=low`. A separate visible-reply guard caps chat at 180 words/1,600 characters; it does not shrink the 4,096-token reasoning/tool allowance. If a guard truncates a response with failed actions or pending approval, the code retains a short explicit warning. No extra rewrite call is used to enforce the limit.

A narrow receipt-based shortcut returns “Reminder set.” after a successful ordinary reminder save, without an additional model call. It does not apply to failed saves, missing/invalid receipts, questions, other languages, unrelated mutations, or requests requiring explanation. Pending approvals and tool results containing clarification or required follow-up return to Sol. Pre-tool success text is released only when eligible writes succeed.

Pure `search_items`, `find_person`, `get_context`, and `recall` lookups may run concurrently within a model batch. Identical read arguments share a result within the turn, including nested argument normalization. Writes remain sequential, invalidate the read cache, and preserve their ordering relative to reads. Function outputs and reasoning items retain their original call IDs. Context summaries are loaded once and shared between feature selection and context assembly.

Usage and diagnostic logging are deferred through the Worker request lifetime. Per-chat diagnostics now include context time, model time, tool time, model-round count and total server processing time. These measure future real requests; no fixed wall-clock speedup is promised from mocked tests. The browser still receives one completed reply, as requested; this update reduces actual work before that reply rather than adding a streaming-only effect.

Validation includes one-request direct replies, a one-round reminder save, approval/error handling, concurrent reads, write barriers/cache invalidation, nested argument distinctions, and reply length enforcement. All tests use mocked provider responses; no user reminder or research job was created for testing.


## Single-pass saves and smaller context (18 October, follow-up)

Normal chat offers a `finish_reply` tool: the brain submits all internal writes and its short intended final response together. The server executes writes in order and releases the response only on success. Failed saves return a truthful failure instead; lookup results and approvals that need interpretation still return to the brain. Questions already answerable from supplied context need one model request. The chat loop is capped at three requests (two tool batches and a final answer), replacing the former seven-request ceiling; it must not claim unfinished actions succeeded.

Conversation naming now uses the opening words with zero AI calls. Per-message background project classification was removed: the chat brain assigns projects, and the existing periodic organizer remains. The general instructions are compact, feature guides remain selectively loaded, independent context queries overlap, and settings reads exclude large internal logs. Output remains bounded and responses are held until completed.

A full SQLite-backed chat test verifies saving, automatic naming, usage logging and diagnostics use exactly one mocked provider request. Timing tests cover the real dashboard and deterministic scheduler. These are correctness/call-count tests, not measured production latency guarantees.

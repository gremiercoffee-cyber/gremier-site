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

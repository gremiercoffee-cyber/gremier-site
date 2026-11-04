# Chief of Staff → Gremier Hub (read + write)

Hand this to the coding agent that builds the Chief of Staff app. Full action list: `docs/HUB_API.md`.

## Connection

- JSON: `POST https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-api`
  with header `Authorization: Bearer <key>` and body `{ "action": "<name>", ...args }`.
- MCP (if the app speaks MCP): `https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-mcp`, same header.
  Each action becomes a tool with an input schema.
- Key: connected app **"Chief of Staff"**, scopes `read` + `write`. It is stored on Yoni's PC at
  `C:\Users\Yoni\.tokens\gremier-hub-chief-of-staff.txt`. Put it in the app's server-side secrets
  (for example `GREMIER_HUB_KEY`). Never put it in front-end code, a repo, logs or chat.
  It can be switched off in the admin app → More → Connected apps.
- `{"action":"help"}` returns the live list of actions.

Replies are `{ "ok": true, "result": … }`, or `{ "ok": false, "error": "<code>", "message": "…" }` with
HTTP 400 (bad input), 401 (bad key) or 403 (not allowed). Show `message` to Yoni; it is written for people.

## What it can do

| Job | Action |
|---|---|
| See stock | `stock` (bottles, concentrate L, beans kg, labeled bottles) |
| Set stock to a count | `set_stock` `{kind, product, qty, expected, reason}` |
| Correct stock by an amount | `adjust_stock` `{kind, product, delta, reason}` |
| Log a store delivery that happened | `log_store_delivery` `{store, quantities, date}` (deducts stock and adds the store billing row) |
| Schedule a store delivery | `schedule_store_delivery` `{store, quantities, date, time}` |
| Move a job / change planned amounts | `reschedule_job` `{job_id, date, time, quantities}` |
| Mark a scheduled delivery done | `complete_delivery` `{job_id, quantities}` |
| Brewing / drains / bottling / labeling | `start_brew`, `complete_drain`, `log_bottling`, `log_labeling` (these need `worker_id`: "owner" or an id from `production_people`) |
| Today, schedule, orders, stores, timeline | `summary`, `schedule`, `orders`, `stores`, `activity`, `outlook` |
| Note in the timeline | `log_note` `{text}` |

Product keys come from `stock`. Store names are matched loosely; an unknown name returns the list of stores.

## Rules for the agent

1. **Read the current value, show Yoni the change, and do it only after he says yes.** For stock counts, send the
   value you read as `expected`. If someone changed it in the meantime, the API refuses with `stock_changed`.
   Re-read and ask again.
2. Never guess a `worker_id`, store or product. Ask Yoni.
3. Every write appears in the admin timeline as `app:Chief of Staff`.
4. Not available through this key: payments and refunds, receipts and invoices, customer messages, prices,
   deleting records, and marking website orders fulfilled (that one emails the customer). Do those in the admin app.

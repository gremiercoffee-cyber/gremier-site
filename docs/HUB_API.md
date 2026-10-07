# Gremier Hub API

One way for outside apps — the Android widget, a Claude "chief of staff" / secretary, anything
else — to **read what's going on** in Gremier Coffee and **log things** into it.

| Piece | Where |
|---|---|
| JSON API | `POST https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-api` |
| MCP server (for Claude) | `https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-mcp` |
| Keys | Admin app → More → **Connected apps** |
| Timeline | Admin app → More → **Activity** (table `activity_log`) |
| Code | `supabase/functions/hub-api`, `hub-mcp`, `_shared/hub-actions.ts` (actions), `_shared/hub-ops.ts` (stock logic) |

## Keys

Create one key per app in **Connected apps**. A key is shown once (`ghk_…`); only its SHA-256
hash is stored (`api_keys`). Scopes: `read`, or `read` + `write` ("Can log & change things").
"Switch off" revokes it instantly. Never put a key in a public repo or in front-end code.

Send it as `Authorization: Bearer ghk_…` (hub-api also accepts `x-hub-key`; hub-mcp also
accepts `?key=ghk_…` for MCP clients that can't send headers).

## JSON API

`POST { "action": "<name>", ...args }` → `{ "ok": true, "result": … }` or
`{ "ok": false, "error": "<code>", "message": "…" }`. `{"action":"help"}` lists everything.

**Read**

| action | args | returns |
|---|---|---|
| `summary` | – | today: jobs, next delivery, pending drains, orders to fulfil, unpaid orders, store money owed/unbilled, concentrate (L), beans (kg) |
| `schedule` | `from`, `to` (YYYY-MM-DD), `include_done` | jobs (brew, drain, bottling, labeling, delivery); open jobs include overdue ones |
| `orders` | `status` (`to_fulfil` \| `unpaid`), `limit` | website orders |
| `stock` | – | inventory (bottles), concentrate, beans, labeled bottles |
| `stores` | – | stores with phone & prices |
| `activity` | `since` (ISO), `limit` | the timeline |
| `widget_config` | – | the Android widget's buttons (server-driven) |

**Write** (needs `write` scope; every write lands in the timeline credited to `app:<key name>`)

| action | args | does exactly what the admin app does |
|---|---|---|
| `start_brew` | `product` (classic\|houseBlend\|colombia\|decaf), `kg` (1\|1.5\|2\|3) | deducts beans, schedules the drain (22h classic / 18h others) |
| `complete_drain` | `job_id` or `product` | adds concentrate (3kg→19L, 2→12.7, 1.5→9.5, 1→6.4), closes the brew |
| `log_store_delivery` | `store` (fuzzy), `quantities` {product_key: n}, `date` | done delivery job, deducts inventory, adds the `store_deliveries` billing row, flags the WhatsApp delivery note |
| `complete_delivery` | `job_id` (default next due), `quantities` (actuals) | marks a scheduled delivery done with the same stock/billing effects |
| `log_bottling` | `product` (bottled key, e.g. classic_liter, vanilla_mini, jerry_can), `units` | adds the bottles to stock and uses concentrate (minis 4/L ×0.29; liters ×0.44 classic / ×0.5 others; jerry cans 5 L) |
| `adjust_stock` | `kind` (inventory\|concentrate\|beans\|labeled), `product`, `delta` | stock correction |
| `log_note` | `text` | adds a note to the timeline |

Product keys: `classic_liter, sweetened_classic, house_blend, colombia_liter, decaf_liter,
classic_mini, vanilla_mini, original_mini, caramel_mini, house_blend_mini, vanilla_syrup,
caramel_syrup, sugar_syrup, jerry_can…, dispenser` (see `stock`).

## Activity timeline

`activity_log(at, actor, action, summary, ref)` is filled automatically by database triggers
on `jobs`, `store_deliveries`, `orders`, `store_billing` — so it records what happens from
**every** source: `admin:<email>` (the admin app), `website` (customer orders/payments),
`app:<name>` (connected apps), `system` (crons/webhooks). A secretary can poll
`activity` with `since` to see what you did.

## Connecting a Claude secretary (MCP)

1. Connected apps → create a key named e.g. "Secretary" (tick "Can log & change things" if it
   should log for you).
2. Claude Code: `claude mcp add --transport http gremier https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-mcp --header "Authorization: Bearer ghk_…"`
   Claude.ai / desktop custom connector: URL `…/functions/v1/hub-mcp?key=ghk_…`.
3. Tools appear as `summary`, `schedule`, `log_store_delivery`, … (write tools only for write keys).

Writes change real stock and billing — a secretary should confirm amounts before logging.

## Adding an action

Add the logic to `_shared/hub-ops.ts` (mirror the admin's behaviour in `admin-src/react-1.jsx`),
register it in `ACTIONS` in `_shared/hub-actions.ts` (scope + description), add an input schema
in `hub-mcp/index.ts` `SCHEMAS`, and redeploy `hub-api` and `hub-mcp`. Return `refs`
(`"<table>:<id>"`) from writes so the timeline credits the app.

## Android widget

`android/` — Kotlin app, built by `.github/workflows/android-widget.yml` on every push to
`android/**`, published as `GremierHub.apk` on the `widget-latest` GitHub release. Buttons come
from `widget_config`, so most changes need no app update. Signing key: GitHub secrets
`ANDROID_KEYSTORE_*` (backup: `~/.gremier-widget.keystore` + `.pass` on the office PC).

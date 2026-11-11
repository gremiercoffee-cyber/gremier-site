# D1 usage controls

- Health app: local answers still persist instantly. Pending changes sync on the existing 10-second local timer; idle remote state refresh happens at most every five minutes while visible. Returning after one minute refreshes. No idle reads while hidden.
- Health history date counts load only when History is opened. Removed the unused home recovery-dashboard fetch. Indexed the measurement revision lookup.
- Health / computer helper / Codex queue heartbeats: at most one database write every two minutes, enforced atomically server-side. Online detection allows that interval. Health queue housekeeping also runs only on a persisted heartbeat; request expiry is still checked on claim and result.
- Health runner idle polling: ten seconds on its next launch, rather than two. Server-side write protection works immediately for already-running versions too. Pending replies check every three seconds instead of every second.
- Automatic Google Health sync: every four hours; manual Sync still runs immediately. WHOOP automatic sync: daily after history is complete, every four hours during backfill. Existing scheduled tasks still check due work normally.
- Calendar: unchanged events no longer rewrite rows. Deletion uses the returned account-scoped ID set, so unchanged meetings are preserved. Rescheduled meetings still reset reminders; hidden flags stay unchanged.
- Migration 0079 adds indexes for project status counts, measurement revisions/types/time windows, WhatsApp lookups, and queue expiry.

Verified with SQLite-backed behavioral tests, query plans and a mobile browser fixture. Historical usage cannot be undone. Compare Cloudflare daily usage after deployment; no whole-day savings figure has yet been measured.


## Sleep and Body Scores — 4 November 2026

The home uses `/api/daynote/scores`, which reads a 30-day compact range and zero source history while the dirty checkpoint is empty. Actual remote verification: 28 rows read across three quiet queries, zero written (25 observed dates). One-time 260-day score backfill cost 8,973 reads and 780 writes. Source measurements stayed at 2,650; both journal entries stayed intact. Average nightly document: 1,905 bytes. These figures exclude migration setup and other assistant work; they are not a measured whole-day bill reduction.

Google still checks every four hours (six automatic checks/day); normal score inputs use seven daily/session streams, approximately 42 API page requests/day before pagination/retries. Raw HR pages are disabled by default. Identical upstream rows no longer delete/reinsert; updates are conditional on actual payload changes. Per-date dirty checkpoints update only changed scores and the next 28 baseline dates. New sleep epochs are reduced in memory, while pre-upgrade payloads are preserved once in a legacy archive before replacement. See `SLEEP_BODY_SCORES.md` for assumptions and pessimistic change budgets.


## Research version 2 — 5 November 2026

Supersedes the v1 quiet-query figure above for the new research endpoint. Actual quiet v2 function: five D1 queries, 65 rows read, zero written. Reads include the compact recent history, bounded journal records and one private profile; no raw source-history read occurs while the dirty checkpoint is empty. Once sufficient labels exist, the model can read up to 365 compact days; source/entry/profile revisions invalidate its small binding-local compute cache.

One-time v2 input refresh: 9,233 reads, 520 writes, excluding archive-migration setup/profile storage. The 260 previous v1 documents are retained in an archive; current daily input documents average 1,669 bytes. All 2,650 sources and two journals remain. Weekend assumptions live in one revisioned profile, not generated daily rows. Owner-confirmed duration corrections use the existing journal rather than duplicating sensor rows. Four-hour aggregate Google cadence and disabled default raw HR polling are unchanged. Account-wide whole-day savings remain unmeasured.

## Account write alert audit — 5 November 2026, 01:10–01:25 Israel

The email sent 4 November 23:06 UTC reports 76% of **100,000 rows written/day**, not storage. Account analytics shortly afterwards reported 77,101 writes: chief-of-staff 63,636; gremier-status 11,164; saykeys-metrics 2,301. Chief storage was 18,935,808 bytes. Compressing JSON cannot address most of this quota: D1 counts row and index writes. Daily reset is midnight UTC (02:00 Israel on this date). Historical usage will not fall after a fix.

One-day expensive-query analytics attributed 17,896 row writes to the previous unconditional health-runner settings upsert (8,948 calls), and 5,549 to relay liveness. These include earlier code and deployment/backfill activity, so they are not a steady-state forecast. Existing conditional health/helper/Codex heartbeats, calendar upserts, aggregate Google ingestion and dirty-date score processing remain enabled.

This release adds:

- Relay liveness writes at most once per minute while unchanged, with immediate readiness/detail transitions. Its 90-second online window, claim checks on every poll, and uncertain-delivery safeguards are preserved. In a fixture, 100 additional idle polls caused **zero** changes; a stale timestamp and readiness changes updated immediately.
- WHOOP reconciles missing upstream IDs only after a complete successful recent-window fetch, instead of deleting and reinserting the entire window. Identical measurements do not update their timestamp/indexes. Fixtures verify zero measurement updates on repeated payloads, real corrections, missing-ID reconciliation, preservation outside the window, failed-fetch retention and disconnect guards. Raw historical records remain intact.
- The installed Windows health runner was still running the old 2-second loop from 3 November. Updated its installed script and restarted only that verified idle runner, retaining `health-ai-runner.mjs.pre-d1-20261105.bak`. Live process 43292 uses the existing 10-second source loop: theoretical idle polls drop from 43,200 to 8,640/day (80%). This is request savings, not a measured account-wide write reduction. Other runners were left running because their current intervals already matched.

Build and 362 tests passed before deployment; the additional recent-window reconciliation test passed afterwards. Deployment version `31c04033-424a-41f4-bb83-e4bc2cd0e8d0`. Read-only live verification confirmed the new process is alive, relay ready, and no queued/running health, relay or job work. No source-history deletion, quota upgrade, or public business-content rewrite was performed. The Status caption rewrites in the daily report are historical; the current local Status worker has no caller of the legacy rewrite function, so no speculative change was deployed there. A complete post-release daily account total has not yet been measured.

Reference: https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/d1/observability/find-expensive-queries/ .


## Health reminder/alert pipeline — 5 November 2026

New health reminders use a compact preference row, a single current journal and (only during daytime with alerts enabled) a single current nightly document, guarded against dirty-cache work. There is no raw measurement-history scan on cron. The five-minute scheduler is needed for the owner's 23:45 time. Same-value preference/subscription upserts do not write. Normal repeated completed delivery claims have zero writes; a synthetic 30-repeat cron test confirmed no additional changes. Successful sends add a small delivery/lease record, retained 30 days; notification bookkeeping and audience selection add modest bounded reads, not unbounded ingestion. Push device subscriptions are separate from measurements. This is a behavior test, not an account-wide observed daily savings figure.

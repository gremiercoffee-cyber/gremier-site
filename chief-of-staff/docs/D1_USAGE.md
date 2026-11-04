# D1 usage controls

- Health app: local answers still persist instantly. Pending changes sync on the existing 10-second local timer; idle remote state refresh happens at most every five minutes while visible. Returning after one minute refreshes. No idle reads while hidden.
- Health history date counts load only when History is opened. Removed the unused home recovery-dashboard fetch. Indexed the measurement revision lookup.
- Health / computer helper / Codex queue heartbeats: at most one database write every two minutes, enforced atomically server-side. Online detection allows that interval. Health queue housekeeping also runs only on a persisted heartbeat; request expiry is still checked on claim and result.
- Health runner idle polling: ten seconds on its next launch, rather than two. Server-side write protection works immediately for already-running versions too. Pending replies check every three seconds instead of every second.
- Automatic Google Health sync: every four hours; manual Sync still runs immediately. WHOOP automatic sync: daily after history is complete, every four hours during backfill. Existing scheduled tasks still check due work normally.
- Calendar: unchanged events no longer rewrite rows. Deletion uses the returned account-scoped ID set, so unchanged meetings are preserved. Rescheduled meetings still reset reminders; hidden flags stay unchanged.
- Migration 0079 adds indexes for project status counts, measurement revisions/types/time windows, WhatsApp lookups, and queue expiry.

Verified with SQLite-backed behavioral tests, query plans and a mobile browser fixture. Historical usage cannot be undone. Compare Cloudflare daily usage after deployment; no whole-day savings figure has yet been measured.

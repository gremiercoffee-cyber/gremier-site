# Hashgacha submission tracking

The source is the Hashgacha database behind https://nightseder.ygrey.workers.dev,
not incoming email. The existing online form saves weekly_reports.rabbi_submitted_at
and rabbi_rating. Admin notes/ratings are not evidence of a rabbi submission.

integrations/hashgacha-status.sql installs a small read-only RPC in the shared
Supabase project. It exposes only teacher/class identity, reporting week, expected
and submitted counts, and the last submission timestamp, for classes with report
links for that week. It never returns student identities, notes, ratings or report
link tokens. A hashed integration key protects the RPC; the key table has RLS and
no public/anon/authenticated table privileges. Chief of Staff stores a separate
read key and public API configuration as Worker secrets, without any service-role
or database-management credential.

D1 migration 0051 stores reporting campaigns and exact class-to-existing-task
bindings. Existing task IDs and project assignments stay intact. The initial
campaign is the seven night-seder reports requested on 22 October 2026, keyed to
the Hashgacha reporting week starting Sunday 18 October. It does not roll into
25 October just because a new week starts.

The cron checks active campaigns every 15 minutes before Google sync and normal
reminders. Only positive expected counts, full submitted counts and a real source
submission timestamp complete a task. Partial reports, zero-sized classes, missing
classes, malformed responses and failed checks never complete a missing task.
Verified receipts are retained if a roster changes later. Once all reports are
received, the project finishes through normal task completion and reminders stop.

Home shows the period, received count, missing names, expandable per-rabbi status,
a Check reports button and a link to Hashgacha. The assistant can read that same
status with get_hashgacha_reports, and attach future explicitly chosen weeks/tasks
with track_hashgacha_reports. No extra AI classifier or research job runs to poll
submissions.

A missing-report summary can remind the user once per local day after 10:00 and
before 21:00, outside driving and Shabbat. Individual generic overdue/waiting
notifications are suppressed for source-tracked tasks. Muted, postponed or manually
closed follow-ups do not trigger reminder nagging. Email replies cannot complete
these bound tasks, and email triage does not receive them as completion candidates.
No emails or WhatsApp follow-ups are sent to rabbis automatically.

Tests use in-memory databases and fixture source responses, including partial and
missing reports, failed checks, period mismatch, receipt preservation, reminders,
manual closure and Home rendering. No test report is inserted into the live app.

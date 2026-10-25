# Fixed recurring reminders and AI job confirmation

Monthly reminder rules support multiple dates, a local time, a timezone, notes and a link.
One ordinary reminder item represents each month. Calendar dates rearm that item; Done
suppresses the remaining dates for that month. The next month gets a new item. No model is
called to create occurrences, repeat, complete or restart a reminder. Existing notification
delivery rules (including Shabbat quiet hours) still apply. Days beyond a month's length
are clamped to its final day. A snoozed reminder is not pulled forward by the calendar rule.

Rules appear in Lists & projects → To-do under Repeating reminders. The linked occurrence
appears among ordinary reminders; its link can be opened from the edit sheet or notification.
The card supports schedule/link editing and pausing. Chat/voice use save_recurring_reminder,
separate from the paid research task tools.

AI research task runs (manual, scheduled, one-off, adaptive follow-up) now queue an explicit
approval before starting. Pending proposals do not create routine_runs or call the provider.
Each research run needs its own approval. Tasks & trackers and Today show the approval cards,
including instructions and an indicative estimate, not an actual bill. Approval is claimed
atomically; replayed taps cannot start duplicate jobs. Changed instructions/depth/schedule
invalidate an old confirmation. Failed approvals stay failed instead of silently retrying.

New missions require confirmation of the goal/plan before creation. Existing missions must
be confirmed once before continuing. That confirmation authorizes the mission's ongoing
work on the approved goal; separate research jobs it requests still need confirmation.
Idea research steps require approval before queueing, including previously queued steps.
Ordinary conversations, transcription and existing non-task background classifiers/briefings
are unaffected by the task approval policy.

Validation: npm run test:reminders, npm run test:shopping, npm run build.


## Actionable timing

Prepared future monthly reminder items stay in storage and browsing views, but do not enter home standalone tasks, project steps, Now cards, catch-ups or phone active-notification status until due. Muted/snoozed items and items attached to another time block stay quiet. Task deadlines may still need preparation and are not treated as future reminder instructions.

WhatsApp meetings save quietly into Schedule; the daily briefing includes today's saved meetings. The deterministic scheduler emits the meeting alert during its actual window, not at detection. Old Now/meeting alerts stop appearing after their window. Relative dates in meeting detection use each message's full authoring date. Home refreshes visible attention data once a minute without any AI calls; the existing cron still runs every 15 minutes.

## Completing and clearing work

Task alerts use Done (complete), Later (pick a new time), and Not needed (close without completing).
Home and Today share the same action controls. Less common actions are under More: Hide alert
clears only the current alert; Mute alerts keeps the task open in All tasks but suppresses reminders.
The task editor also offers Done, Not needed and Reopen. Choosing Later does not clear an alert
until a new time is saved, so cancelling the picker cannot silently hide unfinished work.

A schedule block's standing note repeats every time that block runs. It is not a task and has no
completion state. Such alerts explicitly offer Remove repeating note, preserving any real tasks
in the same card. Old phone buttons cannot remove a note changed after the alert was generated.
The assistant must use an attached item for one-time work; standing notes are only for instructions
the user explicitly wants repeated. An October 18 audit found inventory work saved as a standing
Coffee time note, explaining why dismissing that card allowed it to return the next day.

Regression coverage: tests/attention.test.mjs exercises note-only alerts, permanent note removal,
stale actions, preservation of other work, completion, cancellation, rescheduling and muting.

Task check-offs now remove rows optimistically before the PATCH resolves, including Now,
home projects/standalone tasks, shared task rows and reminder groups. A per-view overlay
survives stale refreshes while saving and rolls back only the failed item with an error.
Different items can be completed concurrently; duplicate taps do not repeat a write.
Shopping applies the same immediate response to checked state and purchase color, preserving
the 24-hour visibility rule. Saves run in the background; no success requires a full refetch.
Deferred-promise regression tests cover immediate state, independent saves, stale reads,
rollback, duplicate taps and later reopened tasks.

## Driving and commute context

Commutes are a driving activity, separate from the destination's life area. Legacy commute/
drive names are recognized automatically; activity_mode can explicitly select driving or
standard (for example a passenger/train journey). Tasks retain execution_mode: call, voice,
desk, physical, or unspecified. The assistant sets this in its existing filing call, without
an additional classifier. Clear "Call…" titles work for old tasks. Generic coding, email,
physical errands and in-person conversations do not qualify automatically; voice work must
be explicit. The task editor's How to do it field permits correction.

Driving checklists draw calls/voice work across areas, respect snooze/mute and scheduled task
windows, and do not inherit the destination's tasks. Future timed calls wait. This same
eligibility applies to Now, proactive item checks, grouped cards, phone cleanup and push
delivery. General briefing/review/catch-up interruptions wait during the drive; browsing and
daily records retain the full schedule. Commutes with no suitable tasks stay quiet, omit
standing destination notes and generate no end-of-drive wrap-up. Arrival uses normal context.

Equivalent overlapping blocks with the same window, area, note, keywords and task IDs suppress
the second checklist instead of sending the same work twice. This handles overlapping Coffee
time/Coffee work blocks without modifying the user's schedule or deleting tasks.

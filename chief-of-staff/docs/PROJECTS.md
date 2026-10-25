# Project-first organization

Named projects represent outcomes, events or initiatives, not entire life areas, topics, people or a week's workload. Separate alumni visits/events remain separate projects. A lone task is standalone unless explicitly called a project; connected work arriving later can turn it into one without duplicating the original task. Shopping stays in its dedicated section.

`shared/project-policy.ts` is shared by chat/voice, brain dumps and the automatic organizer. Project tools are available on every assistant turn. Project membership matching also requires the same specific outcome or event edition, not just the same person/topic. The existing Sol brain performs classification; no research mission or recurring AI job is created for internal filing.

`worker/projectorganization.ts` checks unassigned open tasks, reminders, commitments and waiting-for items after filing conversations, during brain dumps and on the existing 15-minute pass. It proposes only confident groups with concrete shared-outcome evidence. New projects require at least two existing tasks; existing project matches may take one. It does not invent steps, change due dates, close tasks, send notifications/messages, or reassign existing project members. A changed-input fingerprint avoids repeated calls on unchanged work, with a lease and short cooldown for overlap/failures. The Projects screen also offers an explicit on-demand pass.

Migration 0046 records grouping evidence and an item assignment lock. Explicit placement corrections (including moving a task to Standalone in its editor) take precedence. Database writes validate all IDs first and compare the current task version/placement so a concurrent manual change cannot be overwritten. New groups and task moves are atomic. Standalone tasks can also be explicitly promoted into a named project, keeping the same task ID and reminder.

The sidebar opens Projects first; All tasks remains available as a flat view. Projects shows active goals, open steps, direct step entry, standalone tasks and paused/completed projects. Existing projects and their historical membership are preserved rather than silently rewritten.

Validation: `npm run test:projects`, the existing reminder/notification/shopping/WhatsApp tests, and `npm run build`. Project tests use SQLite and a stubbed model, with no external messages or paid model requests.

## Intentional work sessions

A deliberate batch such as “here is what I need to do this afternoon” is a project spanning
that specific session, even across life areas. Name it with the local date, retain optional
steps, and keep future reminders separate. The session takes precedence over automatic
subgrouping for new tasks; existing manual assignments remain protected. Sharing a deadline,
a recurring Coffee time block, or a generic week alone is still insufficient.

Chat/voice can create and populate the session with the existing project/item tools in the
same agent turn. The periodic organizer also receives the original filing message (the nearest
preceding user message within ten minutes for chat/voice tasks), creation timestamp and block
name, so it can distinguish intentional sessions from coincidental schedules. It never moves
already assigned work automatically. Policy changes invalidate the unchanged-input fingerprint.

Now presents projects by name with checkboxes for the original tasks, including standalone
work where applicable. Completion uses the same item update and project archival logic as
Projects. Failed saves leave the task visible and report an error.

Home always presents Now first, followed by the briefing/reminders and the complete open-work inventory.
Inside a scheduled block the checklist favors that block's attached and relevant work, including
explicitly attached tasks from other areas, plus currently due items. Between blocks it offers
due items and undated available tasks. Future reminders, other blocks' tasks, muted/snoozed work,
shopping and automatic reply obligations stay out. Area filters operate on each checklist task,
not the block's category. Empty and loading states keep the Now card visible. This uses existing
deterministic attention rules and adds no AI calls.

## Home discovery and timing

Home separates suggestions from inventory. Now follows context and timing rules; below the
briefing every open task, commitment and waiting-for item appears under its project or as
standalone work. Email/WhatsApp origin, muted alerts, snoozes and future work windows never
hide work from this inventory or trigger early alerts. Future reminder occurrences remain
hidden until their reminder time. Project steps expand by default; area filters apply per task.
Unknown project references fall back to standalone rather than losing the task.

Home does not show a calendar or Schedule feed. Those pages retain appointments. Existing
project organization groups related outcomes and deliberate dated sessions while preserving
manual assignments; unrelated singleton tasks stay standalone. Completion uses the original
item IDs and optimistic updates across Home and Now.

Needs your attention surfaces pending approvals, missions blocked on an answer and recent
failed latest routine runs. Replies and waiting-for tasks are included in the work inventory.
No additional AI calls, jobs, messages or notifications are created by this aggregation.
Library has been removed from the sidebar; saved ideas and memories remain searchable.

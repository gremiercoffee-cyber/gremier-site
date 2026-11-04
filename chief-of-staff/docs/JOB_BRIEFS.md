# Current project briefs

Jobs retain the existing CoS authentication, D1, execution engines and Telegram routing. Migration 0071 adds existing-project membership, a monotonic source revision, immutable brief versions, mirror status and per-job leases. Existing jobs and schedules are preserved. Pinning now controls sidebar placement only; pause/stop remain explicit chat commands.

Open a job to see its current brief first, recommendation, next action, owner questions, correspondence, full reports and conversation. Choose an existing project folder; its Projects page now links to the jobs. `start_job` accepts an existing project_id and job chat can move a job using the available project IDs. No broad-topic automatic regrouping is performed.

Every research run, job conversation and email drafting run receives shared project records, owner messages, latest correspondence, recent reports and related jobs in the same folder. External messages are untrusted evidence, never authorization. Summary generation cannot send messages or invoke tools.

Source revisions invalidate summaries for owner messages, changed instructions, research results and email changes. Related jobs in the same folder invalidate together. Background cron refreshes up to two briefs per five-minute pass using the existing provider; the app can explicitly refresh. Raw current correspondence is visible immediately after its next fetch; the UI marks a summary stale until its source revision matches. Model updates use conditional writes and immutable versions; an obsolete result cannot overwrite a newer brief. Reports sort by their input revision, not finish time. This is a current snapshot, not an assertion that external sources were checked continuously.

Telegram mirrors one short pinned message per existing job topic in the configured owner group. It edits the message without announcing routine edits. Existing research completions and new replies retain their normal notifications. The mirror uses its own lease and records revision only after edit and pin succeed. No General/private-chat fallback; missing bot pin/topic permissions are visible. Retries retain the message ID to avoid creating another message after a pin failure.

Reply checks now continue after the first supplier response (existing 15-minute check cadence and 21-day watch period). Failed fetches do not advance checked_at. Messages still require the existing explicit Send action. Sends require a matching SENT Gmail message ID, thread and recipient before recording sent; interrupted/unverified sends stay uncertain and are not automatically retried. No supplier emails were sent as part of implementation or testing.

Automated tests cover compare-and-swap, history, No Change, late reports, project isolation, shared contexts, Telegram group/topic boundaries and failure states, unpin semantics, repeated replies, and private endpoints. Browser fixtures use synthetic local records only.


Delivery verified: deployment 293849e4-17f6-43a2-b16c-070759feaf20. The existing Gremier outreach and budget follow-up job generated a real non-stale brief from nine email records and three reports; Telegram acknowledged send and pin, and mirror revision matched source revision. No supplier messages were sent. Mobile 390×844 fixture verified current-brief visibility, folder assignment, history, pin independence and no horizontal overflow. The full JavaScript suite passed 301 tests at the initial delivery check.

Trusted Codex workers can GET `/api/agent/jobs` and GET `/api/agent/jobs/:id/context` using the existing x-agent-key. POST to the context endpoint refreshes the brief and its Telegram mirror; it cannot send supplier messages. The key is never exposed to clients or reports.

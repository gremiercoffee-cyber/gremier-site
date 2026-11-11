# Automatic Codex runner — verified 8 November 2026

## Live deployment

Cloudflare Worker: https://chief-of-staff.gremiercoffee.workers.dev

Executor: Windows Scheduled Task `Chief of Staff Automatic Codex`, running as Yoni with limited privileges. It starts at sign-in, restarts after failure, and polls every 30 seconds. The repository's `runner/automatic-codex.mjs` invokes headless `codex exec` using the installed Codex authentication and default model. The older UI delivery relay is rejected by the server while `automatic_codex_enabled=true`.

This is a working local executor, **not an always-on hosted executor**. It requires this computer to remain on and Yoni signed in. Existing Cloudflare cron workflows continue independently every five minutes; the Worker cannot launch the desktop executable. Existing Claude fallback is a separate engine, not proof of hosted Codex execution.

## Verification

- `cffed0fc-3a3d-41f3-8668-14d6e6877943`: headless execution returned `HEADLESS_CODEX_VERIFIED_20261108`; Chief of Staff stored the result as done.
- `75273644-0c46-4221-91b0-39ea851bd1c3`: submitted after the scheduled task started; picked up without manually invoking the runner and returned `PERSISTENT_RUNNER_OK_20261108`; Chief of Staff stored it as done.
- 17 focused tests cover relay authorization, claim expiry, idempotent receipt delivery, heartbeat leases, execution verification, bounded transport retries and safety instructions. Production build passed.
- Older requests were already uncertain, not unclaimed queued work. They were inspected rather than replayed. The old submitted smoke test was closed with an explicit unverified/superseded result, not rerun.

## Recovery and safety

The server atomically claims one request and prevents overlapping Codex claims. The executor keeps private, atomic local receipts under `.local/automatic-codex`, pulses every 30 seconds and limits execution to 45 minutes. Transport retries have exponential backoff; the loop retries unavailable transport every 30 seconds. Completed result delivery can retry without executing the request again. Incomplete execution is never automatically replayed because tools may already have acted. Expired claims become uncertain and require reconciliation. A failed receipt does not prevent unrelated pickup.

Owner request keys prevent duplicate submissions. Repeated identical terminal receipts are accepted; conflicting receipts are rejected. No exactly-once guarantee is claimed for arbitrary external side effects.

The execution prompt requires concrete approval previews for outbound messages, unsubscribe/resubscribe, spending, sharing/security changes and sensitive deployment. Codex sandbox and approval review remain active. These instructions do not replace application-level approval enforcement. No unattended email workflow was enabled by this installation.

The unsubscribe request `c503531d-614d-4334-a624-5c1fb53218e9` repeats original `05563f81-6189-4e5e-ae88-ebbaf29b70ad` and follow-up `d4789754-1c3e-4747-a287-a745b0bdabc1`. The workflow was subsequently implemented directly on 8 November; see `GESHER_UNSUBSCRIBE.md`. It is deployed in dry-run mode with a verified five-minute office scheduler. Do not replay all three as separate workflows. Sending remains blocked pending review of exact templates and safeguards. Other older uncertain jobs retain their status pending evidence of their actual execution.

## Operation

Inspect/start/stop with Windows Task Scheduler using the task name above. Stop the task to pause headless pickup; existing requests remain saved. Do not re-enable the old UI relay as an execution substitute. Before restarting during execution, inspect the request state and private ledger; never delete receipts to force a retry.

`automatic_codex_verified` records a successful end-to-end test; it is historical proof, not current availability. `relay.online` expires after 90 seconds without a pulse.

## Hosted deployment still required

Prepared Linux systemd template: `runner/chief-of-staff-codex.service`. It is **not installed on a server**. Required resources:

1. An always-on Linux host with SSH/deployment access and sufficient disk/memory for Node and Codex. No such host/deployment credential was available in this session. A Cloudflare Workers token alone does not provide this host.
2. Node, a supported Codex CLI installation and a private checkout at `/opt/chief-of-staff`.
3. Runtime authentication provisioned securely for that host: an OpenAI API key/billing or supported Codex sign-in. Do not copy desktop session credentials into source or helper instructions. API billing may differ from the desktop ChatGPT subscription.
4. Root-owned mode-600 `/etc/chief-of-staff/runner.env` containing `COS_AGENT_KEY`, `COS_WORKSPACE=/opt/chief-of-staff` and, if needed, `CODEX_EXECUTABLE`. Configure model authentication according to the installed CLI documentation. Never print these secrets.
5. Private writable `/var/lib/chief-of-staff` and repository ledger storage, owned by `cosrunner`.

After provisioning, stop the Windows task, confirm no active request, install/enable the service and repeat a harmless end-to-end test. Keep one active executor and preserve the existing private receipt ledger during migration. Hosted deployment and a computer-off test remain unverified.

# Chief of Staff

A personal AI Chief of Staff: one assistant with persistent memory of your priorities, tasks,
commitments, projects and the people you're waiting on. You can reach it by text, live voice
or dictation. It's a mobile-first PWA running entirely on Cloudflare (Workers, D1 and Cron Triggers).

## What's in this build

| Area | What it does |
| --- | --- |
| **Chat** | One continuous conversation. The assistant files things with tools (create/update items and projects, remember facts, search). |
| **Live voice** | Hands-free conversation ("Talk") on OpenAI Realtime **gpt-realtime-2.1-mini** over WebRTC. You can interrupt it, and it uses the same tools, memory and approval rules as chat. Transcripts land in the shared conversation. |
| **Dictation** | Record a clip and get it transcribed. Transcribed on the server with OpenAI **gpt-transcribe** (falls back to on-device recognition). Available in Chat and Brain Dump. |
| **Shared state** | Text, voice and dictation all write to the same message history, memory and data. |
| **Brain Dump** | Unstructured text in. A cheap model sorts it into tasks, reminders, commitments, waiting-fors and ideas, and stores durable facts as memories. |
| **Lists** | Tasks, Reminders, Commitments, Waiting For and Ideas are kept clearly separate. Quick add, edit sheet, completion. |
| **Projects** | Personal or business projects, each with its open items. Projects can be active, paused or done. |
| **Today dashboard** | Morning briefing, nudges, items needing approval, overdue, later today, waiting for, active projects. |
| **Proactive** | A cron job runs every 15 minutes. It surfaces due reminders and overdue commitments, flags waiting-fors that have gone quiet for 4+ days, and writes a daily briefing at your chosen hour. |
| **Approvals** | Deletions and anything with outside-world effects go to a "Needs your approval" queue. The assistant never does them on its own. |
| **Memory** | Visible and editable in Settings. Injected into every conversation. |
| **Settings** | Name, time zone, briefing hour, voice, proactive on/off, theme, install, notifications, 30-day model usage, full JSON export. |
| **PWA** | Installable, with an app-shell service worker, shortcuts (Brain dump, Talk) and push-notification handlers ready for server push. |

## Architecture

```
chief-of-staff/
  src/          React + TypeScript + Tailwind frontend (Vite)
  worker/       Cloudflare Worker: /api/* routes, assistant, cron
    ai.ts         model-provider abstraction (ModelProvider interface, "main"/"fast" tiers)
    assistant.ts  system prompt, context assembly, tools, approvals
    braindump.ts  brain dump sorting (fast tier)
    proactive.ts  scheduled nudges and briefing
    realtime.ts   live voice: mints short-lived Realtime keys, runs voice tool calls
    db.ts         D1 helpers, settings, time zones
  shared/       types used by both sides
  migrations/   D1 schema
```

- **Single Worker.** It serves the built frontend as static assets and handles `/api/*`. There are
  no Durable Objects. One user with D1 doesn't need them yet.
- **Secrets stay on the server.** The browser only holds your passcode, sent as a bearer token. Every model call goes through the Worker.
- **Cost controls:**
  - Everything runs on OpenAI **GPT-6 Luna** (`gpt-6-luna`), OpenAI's efficiency-focused model.
  - Chat uses reasoning effort `low`; brain dumps and briefings use `none`.
  - The stable system prompt is sent first so OpenAI's automatic prompt caching applies.
  - Deterministic proactive checks don't call a model at all.
  - Live voice uses the mini Realtime model, and the browser only ever gets a 2-minute key.
  - Usage is logged to D1 and shown in Settings.

  Models and effort levels are set in `wrangler.toml` (`MODEL_MAIN`, `MODEL_FAST`, `EFFORT_MAIN`, `EFFORT_FAST`).
- **Adding a provider.** Implement `ModelProvider` in `worker/ai.ts` and select it in `getProvider()`.
  Set `OPENAI_BASE_URL` to route calls through Cloudflare AI Gateway.

## Deploy

You need a Cloudflare account and Node 20+.

**Windows (easiest):** in PowerShell, run

```powershell
cd path\to\gremier-site\chief-of-staff
powershell -ExecutionPolicy Bypass -File .\deploy.ps1
```

It installs dependencies, logs you in to Cloudflare, creates the database, asks for your passcode and
OpenAI key, and deploys. You can safely re-run it to redeploy after changes.

**Manually:**

```bash
cd chief-of-staff
npm install
npx wrangler login
npx wrangler d1 create chief-of-staff          # copy the database_id into wrangler.toml
npx wrangler secret put COS_ACCESS_TOKEN       # your app passcode, make it long
npx wrangler secret put OPENAI_API_KEY
npm run deploy                                 # build, migrate D1, deploy
```

Open the `*.workers.dev` URL. Then go to Settings, set your name and time zone, and add the app to your Home Screen.
A custom domain is optional and can be added later in the Cloudflare dashboard.

## Local development

```bash
printf 'COS_ACCESS_TOKEN=dev\nOPENAI_API_KEY=sk-...\n' > .dev.vars
npm run db:migrate:local
npm run build && npm run dev:worker   # full app on http://localhost:8787
# or, for hot reload: `npm run dev:worker` in one terminal and `npm run dev` in another
```

## Future capabilities (deliberately not built yet)

The data model and the approval queue are designed so these can plug in without redesigning the core:

- **Server-sent Web Push.** Subscriptions are already stored (`/api/push/subscribe`) and the service worker
  handles `push` events. What's missing is VAPID signing in the cron job.
- **Home-screen widgets.** These would read `/api/dashboard`.
- **Calendar sync.** Items already carry `due_at`. A sync job would map events to items.
- **Email and WhatsApp.** These would be new tools whose actions go through `propose_action` → approve → executor in
  `executeApproved()`.
- **Browser automation or a cloud computer.** Same approval path.
- **Coffee-business integrations** (orders, stock, wholesale clients) and smart-home integrations. Each would be a tool module plus a project/memory context source.
- **Semantic memory search** (Vectorize) for when memory outgrows what fits in the prompt.
- **Multi-user auth** (Cloudflare Access) instead of a single passcode.

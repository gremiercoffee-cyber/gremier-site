# Health Journal

> **November 2026:** Telegram was removed from Chief of Staff. Everything below that mentions Telegram is history; alerts now come only from the app.

Live standalone app: https://health.gremiercoffee.co.il/daynote/

Existing-session handoff: https://chief-of-staff.gremiercoffee.workers.dev/daynote/?open=standalone

Open with the existing Chief of Staff passcode. In Chrome choose Install app / Add to Home screen; on iPhone use Safari Share → Add to Home Screen. The existing sidebar also links to Daynote.

## What ships

A separate mobile entry point in the existing Vite application, served by the same Worker and authenticated with the existing private bearer. It uses the same D1 database, AI provider and Telegram bot. No new account, Worker, agent or AI key is required. Migrations 0067 and 0068 contain the journal schema and extraction status.

Today, History, My questions, Insights and Settings/connections are available. Eight questions are enabled initially, with a searchable original catalog inspired by public health-journaling categories. Questions have stable IDs; disabling/renaming does not erase history. Optional follow-ups are off initially. Custom questions and reordering work offline.

The complete question snapshot is loaded before starting. Taps update per-day local storage and React immediately; network sync runs independently. A 300 ms guard prevents a double tap from answering the following question. Skip, No and missing remain distinct. Back/edit, refresh/resume and background retry are supported. Sync status changes to synced only after a server acknowledgement; revisions and idempotency keys prevent silent cross-device overwrites. A conflicting device version requires an explicit choice.

The default journal date is the day you went to sleep: after midnight it stays on the previous date until a main sleep (3+ hours, not a nap) has ended today, or until noon if the watch missed the night. Use Change beside the date to journal about another day. Explicit today/yesterday in notes refer to the actual local calendar date. Sleep beginning before noon is associated with the preceding waking day; evening sleep with that day. The longest non-nap sleep is used once per journal date. Morning HRV, resting pulse, energy and manual readiness are matched to the sleep wake date. Manual energy/readiness belong to the morning of their displayed date.

Code computes means, usable counts, missingness, differences and week comparisons. The default comparison excludes illness/travel. Additional matched comparisons use weekday/exercise and, for HRV/pulse, sleep duration where both groups have observations. Sparse strata are reported, not filled in. These are associations with small-sample limitations, not causal conclusions or diagnoses. No records or insights are seeded into the owner account.

## Voice and privacy

MediaRecorder audio is persisted in local IndexedDB during recording (maximum five minutes), retained until successful processing or explicit discard. Text is an alternative. Existing backend transcription and AI extraction produce dated, evidence-linked proposals. They do not commit answers until confirmed. Conflicts require keep/replace; uncertain statements require a definite answer. New daily questions require approval; entry-only and dismissed suggestions are remembered by stable ID or normalized wording. Exact duplicates are rejected; review wording for semantically similar custom questions.

The server stores transcripts and proposals, not raw audio. Audio is transmitted to the existing transcription provider; provider retention terms still apply. Telegram voice messages remain in Telegram until deleted there. Deleting a transcript leaves already-confirmed answers and their evidence; deleting that journal day removes those answers and associated notes. Export includes journal data, measurements and health-scoped agent conversations. Full deletion also removes health-scoped stored conversations and disconnects Health; it does not delete Telegram messages or unrelated Chief of Staff data.

Public app-shell assets are cached for offline use. Sensitive API responses and OAuth callbacks are never service-worker cached. Local answers/audio are device storage, not encrypted with a separate Daynote password. Use Lock & clear this device before sharing the browser. Existing Chief of Staff access remains private; no health API is publicly readable. OAuth credentials are encrypted server-side using the existing Google token machinery. Do not rotate that encryption key without migrating existing tokens.

## Google Health setup — authorization still required

Official current API: Google Health v4, not legacy Fitbit endpoints. The existing Google web OAuth client is reused with an isolated callback/state/PKCE flow. The computer-helper configuration request is job `378de674-ef92-42f1-83c1-64766b6af6e9`; it requires the owner's phone Allow. It was waiting for approval at delivery preparation.

In the existing Google Cloud project:

1. Enable Google Health API (`health.googleapis.com`). Preserve existing APIs and OAuth redirects.
2. Add this authorized web-client redirect exactly: `https://chief-of-staff.gremiercoffee.workers.dev/api/daynote/google/callback`.
3. In Google Auth Platform → Data Access, add only these read scopes:
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
4. If the consent application is in Testing, add the owner's Google account as a test user. Personal testing does not require publishing for everyone. Sign into the supported Fitbit/Google Health app with the linked Google account and finish any account-linking/migration requirement.
5. Open Daynote → Settings/connections → Connect Google Health, choose that account and approve read access. This owner consent cannot be done silently by the helper.

The callback first checks `/v4/users/me/identity` and fetches a real data endpoint before saving a verified connection. A linked-account error or failed data fetch leaves Daynote disconnected. Only after that probe does incremental sync/backfill run. Recent seven-day overlap plus seven-day historical chunks backfill up to 90 days; retries, pagination, stable upstream IDs, transactional replacement, connection-generation guards and visible last-success/error fields are implemented. Empty or unavailable streams stay missing. Sync is checked from the existing cron, not a new scheduler. Disconnect stops future sync and deletes local Health credentials without revoking the shared OAuth client's unrelated Workspace grant.

Supported imports implemented: sleep interval/duration/raw stages, daily HRV, daily resting pulse, and exercise records. Actual availability depends on the device/account and authorization. Google Readiness is absent from the current published API data-type list; Daynote says so and provides optional manual entry. It does not create a substitute score.

No real authorized Google Health fetch or owner historical backfill has been verified yet. OAuth/API behavior is covered with fixtures, not claimed as an actual connection.

Official references: [setup](https://developers.google.com/health/setup), [get started](https://developers.google.com/health/get-started), [scopes](https://developers.google.com/health/scopes), [data types](https://developers.google.com/health/data-types), [identity](https://developers.google.com/health/reference/rest/v4/users/getIdentity), [data points](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list), [filters](https://developers.google.com/health/filters), [developer checklist](https://developers.google.com/health/developer-checklist).

Catalog inspiration: WHOOP's public [journaling article](https://www.whoop.com/us/en/thelocker/the-impact-of-whoop-on-user-behavior/) and [self-experimentation guide](https://www.whoop.com/us/en/thelocker/a-guide-to-self-experimentation-optimizing-your-habits-for-performance/). This is an original catalog, not WHOOP's exact list.

## Telegram

The existing bot created 🌿 Health, thread 197, in the configured Chief of Staff group. Live setup verified owner/group/topic restrictions and confirmed the webhook URL was unchanged. No manual Telegram setup remains. Health text uses the existing agent with health-specific read/proposal tools; voice uses the same note pipeline and links to PWA confirmation. Other topics do not receive these tools or health records. Health conversations are excluded from global learning/project filing/tidying. Reminders and weekly summaries are off by default and configurable in Settings. They post only to the Health topic.

Topic creation and routing restrictions were verified. Sending a real owner voice message and conversational coaching in the topic still need owner use; no private sample health message was posted for testing.

## Validation and deployment

Run `node --test tests/*.test.mjs`, `npm run build`, and (with a local Vite preview on port 5181) `node tests/daynote-browser.mjs`. The browser test uses isolated synthetic fixtures, never the production account. It covers offline advancement/resume, double taps, Back, skip versus No, edits during an in-flight acknowledgement, microphone denial, failed audio processing and persisted retry, and absence of API cache entries. Unit coverage includes timezone/DST, sleep matching, note conflicts/dismissals/retries, revision/deletion guards, OAuth failures/revocation/missing data and Telegram/privacy boundaries.

All 245 tests pass. Measured tap-to-next-paint: 15–31 ms for three taps in headless Chrome at 390×844 with 4× CPU throttling. This is a mobile-sized performance proxy, not a physical-phone guarantee. Network and AI operations have honest processing states. A live synthetic voice test verified transcription plus extraction (negation, explicit yesterday and uncertainty) without saving health records; the transcript did mishear a sauna phrase, reinforcing review before confirmation. Real phone microphone/install behavior and real Google account data remain owner-device verification steps.

Deploy through the existing `npm run deploy` configuration (build, D1 migrations, Worker assets). Do not create a second Worker or replace Telegram webhooks. No Daynote-specific credentials belong in client code or source control.

Final deployment: Worker version `af959719-03f9-4602-ab65-a2ac14e38359`, migrations 0067/0068 applied. Live checks: Daynote HTML, manifest/icons/service worker, private APIs rejecting unauthenticated requests, invalid OAuth state rejection, existing health endpoint and removal of temporary verification routes. Production counts remained zero journal entries, zero notes, zero measurements and zero Google connections.

Design update: renamed Health Journal. Black/charcoal background, lime primary action, one Start/Resume/Edit Journal action on the home screen. Secondary destinations are available through the header menu. Stable `/daynote/` URLs and database IDs are retained so installed links and existing records continue to work.


## Recovery dashboard and WHOOP (November 2026)

The single main screen now shows Recovery/Readiness, Strain, a learned bedtime and up to three habit suggestions, with Start Journal below. No data is seeded. Google manual Readiness has its own label and never inherits WHOOP's green threshold. WHOOP day Strain uses its 0–21 scale; it is not converted into Google cardio load. Google load is not fabricated when unavailable.

WHOOP v2 supports the needed Recovery, physiological cycles/day Strain and sleep endpoints. Connection is OAuth, not a static API key. Settings → WHOOP connection → Configure developer app accepts client ID/secret into an authenticated request and encrypts the secret server-side with the existing credential key. Never paste secrets into chat. Register callback `https://chief-of-staff.gremiercoffee.workers.dev/api/daynote/whoop/callback` and allow `read:cycles`, `read:recovery`, `read:sleep`; authorization also requests `offline` for refresh tokens. No profile, body measurement, write or workout scope is requested. Credentials and tokens are excluded from state, exports, source and explicit logs. The existing Google encryption secret must remain stable.

The computer-helper setup request is `13f40270-507b-42ea-a0a2-138712ca6886`, waiting for the owner's phone Allow at implementation time. After app setup, enter the client credentials directly in private Settings, press Connect WHOOP and approve the account consent. No authorized WHOOP data fetch has been verified yet. No account is marked connected until all three required streams pass a real API probe. Empty collections are valid missing history. Callback state is random, single-use, 15-minute and bound to an HttpOnly Secure SameSite cookie. Account IDs from fetched records are checked to prevent combining different WHOOP accounts.

Refresh tokens rotate and are persisted after refresh. The existing cron runs incremental sync with seven days of overlap, retry/pagination and staged 14-day windows back to 180 days. Stable provider IDs deduplicate records; successful window replacement reflects deleted/unscored data. Transactional updates and generation guards prevent a disconnected connection from writing late data or claiming sync success. Full Daynote deletion removes the WHOOP configuration too. Local disconnect stops sync; revoke the grant in WHOOP for provider-side revocation if desired.

Learning version 1 is a transparent conditional-neighbor system, recomputed from the latest available records and journal corrections:

- Join each morning's Recovery to that physiological cycle's Strain using WHOOP cycle ID. Join the next cycle's non-nap sleep by its recovery sleep ID. This yields starting Recovery → day Strain → subsequent sleep → next Recovery. Google and WHOOP records are never mixed into a common target.
- Use a rolling 180-day history. Exclude missing/unscored/calibrating records, naps, incomplete/implausible sleep, large cycle gaps and journal-confirmed illness/travel. Unreported confounders remain possible and are disclosed.
- A sleep target needs 28 usable total nights, 12 with Strain within 3 and starting Recovery within 20 points, and 5 green outcomes (WHOOP Recovery ≥67). The empirical target is the 60th percentile of green-outcome sleep, at least the median of the comparable cohort. It is not a physiological minimum or a guarantee.
- Add the comparable cohort's median awake time to estimate time in bed. An owner-configured wake time converts this to a Jerusalem bedtime with actual elapsed-minute subtraction across DST. Without a wake time or sufficient data, the dashboard asks for that input or says Learning. It never guesses a bedtime.
- Show cohort sizes and, only with 10 nearby-duration nights, their historical green frequency and Wilson interval. This is descriptive, not tomorrow's claimed probability. Strain marked “so far” can grow during the day and change the target.
- Validate conditional green estimates by rolling-origin evaluation: each test night uses earlier records only and compares Brier error against the earlier personal base rate. At least 10 holdout predictions and improvement are required before reporting improvement over baseline. This assesses conditional estimates at observed sleep durations, not a trial proving that the bedtime intervention works.
- Habit suggestions need at least 5 Yes and 5 No observations plus 5 one-to-one matched pairs (starting Recovery, Strain, sleep duration and weekday/weekend). An ≥8-point average difference must have the same direction in both chronological halves. Show only three suggestions with counts, labeled tentative. Medication/supplement changes are never suggested. Multiple testing and residual confounding are disclosed. These thresholds are engineering safeguards, not clinical validation.

Chief of Staff's existing health read tool receives this same calculated dashboard; it can explain the numbers without inventing statistics. Numerical learning runs in code, not in an independent LLM coach.

Official references: [WHOOP v2 API](https://developer.whoop.com/api/), [OAuth and refresh rotation](https://developer.whoop.com/docs/developing/oauth/), [developer app setup](https://developer.whoop.com/docs/developing/getting-started/), [Recovery zones](https://support.whoop.com/s/article/WHOOP-Recovery).

Validation includes encrypted-credential/no-secret-export checks, API probes, revoked access, token rotation, deduplication, disconnect races, source separation, explicit cycle/sleep joins, sparse histories, matched habit advice, temporal leakage, calibration exclusions, DST and synthetic conditional-model validation. All tests use local fixtures. No live WHOOP account fetch, owner bedtime calibration or prospective real-world recovery improvement has been verified. The browser fixture still checks offline/local questionnaire speed and persistence without touching production health records.

Recovery dashboard deployed as Worker version `5dc4ec20-47a2-44a2-ac7e-433bf28a57de`; migration 0069 applied. Live checks verified the dashboard/WHOOP setup assets, private dashboard rejecting unauthenticated reads, and invalid WHOOP OAuth state rejection. Production journal/measurement tables and WHOOP connection table remained empty. Latest isolated mobile test measured 23–39 ms tap-to-next-paint; 257 total tests passed. Helper still waiting for owner approval; real WHOOP fetch remains unverified.


## Personal cross-device transfer and visual update

This supersedes the earlier v1 provider-isolation behavior. The main screen now uses rounded elevated controls, atmospheric dark gradients and short labels. Explanation, confidence and provenance remain under Details.

Recovery/Readiness share the role of morning recovery; Strain/cardio load share the role of daily load. Vendor-native measurements remain stored unchanged. They are not percentages of a common physical scale. Google high Readiness starts at 65, WHOOP green Recovery at 67. The current published Google Health API does not list Readiness or cardio load, so both can be logged via the Scores shortcut. Cardio load is numeric native units, not limited to 100. An explicit Final load flag is required before a manual day becomes a training outcome. Sleep still comes from the authorized supported Google API. No AZM/step-count substitute is labeled cardio load.

WHOOP history can provide a clearly labeled starting sleep baseline while collecting Google measurements. After at least 14 varied usable days from each source, the transfer model compares personal empirical load/readiness percentiles (15 and 20 percentile-point windows). This is provisional distribution alignment, not an established equivalence formula. It does not extrapolate beyond observed Google inputs. Fourteen same-day paired records enable rank-correlation checks: disagreement/constant paired readings disable transferred matches. One date counts once, preferring the active Google record. Google-native matching takes over once it has 28 usable days, 12 nearby nights and 5 high outcomes, so old WHOOP history does not permanently dominate.

The combined model still matches starting state → daily load → subsequent sleep → following morning outcome. Each source uses its native high threshold. Sleep durations remain physical minutes, not converted scores. WHOOP baseline targets are explicitly not conditional on today's Google values. Native Google habit comparisons use personal load ranks and compare explicit Yes against explicit No; missing/Skip stay unknown. Provider-specific illness/travel exclusions and no-medication-advice rules remain.

Forward-only validation recalculates the percentile bridge using earlier nights for each test. It never fits normalization with future rows or doubles overlapping device outcomes. Thresholds and tests are engineering safeguards, not clinical validation or proof that a predicted bedtime will produce green readiness.

Official Google references: [Readiness calculation and categories](https://support.google.com/googlehealth/answer/14236710?hl=en), [cardio load and TRIMP](https://support.google.com/googlehealth/answer/15402655?hl=en-CA), [current API types](https://developers.google.com/health/data-types). Google score access remains manual until an actual supported score endpoint is available and verified.

Visual/transfer update deployed as Worker version `9049f840-6d4f-4201-99b4-c33d9858849c`. All 266 tests pass. The mobile fixture verified new Google scores/final-load persistence, offline answering/resume and 14–27 ms question advancement. Live assets and private dashboard rejection were verified. No real WHOOP or Google account fetch has been authorized/verified; the WHOOP helper remains waiting for Allow. No migration was needed for optional journal JSON fields.

Owner recovery: `/api/daynote/sign-in` redeems a random 256-bit one-use link stored only as a hash in Daynote settings with a 15-minute expiry. GET previews do not consume it or reveal the owner bearer; an explicit same-origin POST atomically consumes it, stores the existing bearer on the owner device and removes the link from browser history. Responses use no-store, a same-origin referrer policy and nonce CSP. No public or permanent agent mint endpoint remains. The existing passcode is not reset. Two new recovery security tests pass; total suite 268. Never put actual recovery URLs in documentation or source.

Recovery browser regression: `node tests/daynote-login-browser.mjs` uses synthetic credentials on a loopback HTTP fixture. It reproduced Chromium sending Origin:null for a form under no-referrer, then verified the same-origin policy fix, CSP execution, local token storage, single-use consumption and URL cleanup. The strict same-origin POST check remains in place. Fix deployed as `329a49c2-9d72-470c-8c5d-640bbfd7cda7`; the live GET policy was verified.

WHOOP discoverability: disconnected accounts show Connect WHOOP on Today. `?tab=settings` opens connection settings directly. A recovery link can whitelist `connect=whoop` to land there after sign-in; arbitrary redirects are not accepted. Browser fixtures verify this path, the authenticated connect request and hiding the home CTA after connection.


## Verified live WHOOP historical import

Owner OAuth and all required stream probes are now verified. The first date-window sync found only an old open cycle; the importer was corrected to paginate each complete WHOOP collection directly, keeping a fixed end timestamp and independent resumable stream cursors. Each authenticated sync imports one page per unfinished stream and atomically commits data and cursor progress. There is no 180-calendar-day import cutoff. Once all streams finish, subsequent syncs use the recent overlap window again. Settings distinguishes Importing history from History imported.

Live import completed: 231 cycles, 208 recoveries and 240 sleeps. Cycle dates span June 8, 2025–May 10, 2026; available sleep/recovery records end January 8, 2026. These are real API records, not fixtures. No health scores or raw credentials were emitted into tool output. Temporary owner-key import access was removed afterward.

For migration, the model now retains the most recent 180 recorded WHOOP nights even if the owner stopped wearing WHOOP more than 180 calendar days ago. Google observations still use the recent 180 calendar days. A disconnected/old WHOOP period is labeled as a historical starting baseline rather than inventing a current score. Two regression tests verify paginated cursor persistence and stale-but-usable history retention. This supersedes the earlier seven-day-chunk/backfill-180-day description.


## Verified owner Google Health Takeout import

The owner supplied `takeout-20261101T091057Z-1-001.zip` directly. The local importer reads only a whitelist of Google Health CSVs inside the ZIP without extracting it. Unrelated Google Fit, account, GPS, contacts and commerce files are ignored. Scripts treat README/export content as data, not executable instructions. Private local diagnostics/dependencies are gitignored.

Actual import: 216 Google Readiness daily scores (Dec 21, 2025–Oct 30, 2026), 291 daily cardio-load totals (Dec 14, 2025–Nov 1, 2026), 433 sleep sessions with stages, 222 daily HRV and 255 daily resting-heart-rate values. Total 1,417 measurements. One conflicting duplicate resting-heart-rate day (March 27, 2026) was excluded rather than guessed. No questionnaire entries were synthesized into storage or overwritten.

The archive itself includes field documentation. Readiness is a calendar-date label. Cardio-load `total` is the sum of workout and background increments for that timestamp; the importer validates this and sums unique minute increments by Asia/Jerusalem day. It does not average them or confuse weekly-goal progress percentages with daily load. UTC timestamps distinguish repeated local hours at DST changes. No-record days remain missing. An actual provided zero is retained. Multiple conflicting device values for the same instant cause that day to be withheld for review. Historical load days before the export's local date are marked final; the export day remains partial. Source-file/hash/row, export time, device/source, coverage counts and aggregation provenance are retained. Sleep durations and stage intervals keep UTC instants and original device offsets. Entire archives and minute streams are not uploaded wholesale or sent to AI.

Stable IDs make retries idempotent. Older archive revisions cannot overwrite newer imported values. Imported native Google scores enrich the analytical view without creating saved questionnaires; explicit manual scores retain priority. Dashboard labels distinguish imported versus manual values. History now includes dates with actual imported measurements even without a questionnaire. Today never substitutes an older Readiness score silently; a View latest Readiness control opens its actual date.

`python scripts/daynote_takeout.py <archive>` validates and reports only counts/date ranges. On Windows install local timezone data with `python -m pip install --target .local/daynote-python tzdata`. Upload was performed through a temporary owner-key-only backend endpoint, then removed. Raw normalized records stayed in process memory. The regular private export/deletion controls cover the imported measurements.

Live verification after import: the Oct 30 analytical view had 244 usable unique nights across sources, including 84 Google nights, and produced an exploratory sleep target from actual data. This verifies ingestion and model execution, not prospective predictive accuracy. The current Google OAuth connection is still unverified; this was a real archive import, not an API sync. The next ongoing-collection route remains unresolved—no browser screen displaying the actual scores has been verified.

Validation: 272 JS tests and 5 Python importer tests pass; the mobile fixture additionally verifies imported-history navigation, source labels, no fake saved questionnaires, manual-score persistence and the original offline/instant-answer flow.


## Android companion proof build - 1 November 2026

Source: `android-companion/`. Build with `powershell -NoProfile -ExecutionPolicy Bypass -File android-companion/build.ps1` using installed Android Studio JBR, SDK android-34 and build-tools 36.0.0. Output: `public/daynote/health-companion.apk`. Keep signing key in ignored `.local/android-companion/companion-signing.p12` for compatible updates. Personal sideloaded test build; not a Play Store release.

Install on Pixel and pair through Health Journal > Settings > Pixel companion. Copy its 10-minute single-use code into companion. Enable Accessibility manually; sideloaded restricted settings may require owner approval in Android App info. Android grants broad screen-reading capability. Service configuration AND runtime root/event checks filter com.fitbit.FitbitMobile. Only extracted numbers, capture time and short diagnostic remain locally; whole-screen text is discarded. No screenshots, raw screen uploads, automatic gestures, scheduled uploads or locked-phone capture. Latest visible screen replaces previous capture to avoid merging unrelated dates. English labels only; ambiguous values, weekly percentages and target loads fail closed. Date cannot yet be trusted automatically: owner reviews/corrects date and values, then presses Upload. Never reports uploaded before server acknowledgement.

Migration 0070 adds pairing-code hashes and scoped device-token hashes. Owner-authenticated /api/daynote/android/* routes issue/revoke/list; /api/daynote/android-device/redeem and /scores accept scoped credentials only. No CoS passcode in APK. Revoke/full data deletion invalidate device access. SQL inserts gate on live device membership even if revocation occurs during upload. Stable metric/day IDs deduplicate retries. Today's cardio load always stays partial. Manual questionnaire scores take priority over reviewed phone scores, then Takeout. Phone source labels appear in dashboard. No fabricated health records were inserted during deployment.

Verified: signature verification; APK install and successful MainActivity launch on existing Android API 37 emulator; 11 Java parser checks; 276 JS tests, TypeScript and production build. Deployed Worker version e0186879-1e65-4e8c-9a4b-dd6caba5c1cc. Mobile browser fixture also verifies authenticated phone pairing controls, APK link, and existing WHOOP connection flow. Live APK returned 200 and matched the signed local SHA-256; unauthenticated owner routes, invalid pairing, and unpaired uploads returned 401. Real Google Health screen extraction on owner's Pixel and actual phone-to-production upload are NOT yet verified. Next step is install, enable service, open detailed score, return to companion and inspect capture. Automatic collection is a later step dependent on real screen/date verification.


## Separate PWA origin - 1 November 2026

Health Journal is now also served at https://health.gremiercoffee.co.il/daynote/ by the SAME Cloudflare Worker and D1 database. Custom domain configured in wrangler.toml, workers.dev retained. Root on health host redirects to /daynote/; Chief root stays unchanged. This separates Android installation/link scope from Chief of Staff's root-scoped PWA. Manifest and service worker are scoped to /daynote/ on the new origin. Existing /daynote/ access remains available to preserve old local data.

Use old-origin /daynote/?open=standalone to reuse the authenticated session. Before leaving, flush pending journals/habits, stop for unresolved conflicts or local audio/text drafts. A server-authenticated POST /api/daynote/standalone issues a random one-use, 15-minute, hashed and destination-origin-bound sign-in link. New-origin sign-in GET is inert; explicit same-origin POST consumes the code and stores the existing bearer in new-origin private local storage. No bearer in URLs. New-origin login includes Continue with Chief of Staff to use this flow. No public login-link minting. Other pending origin-bound codes are preserved during expiration cleanup.

Existing provider tokens/data remain shared. OAuth setup and callback URLs remain on the already registered workers.dev origin: Connect from standalone uses one-use session handoff to the original connection settings, where the existing consent flow runs. Existing connected measurements/sync need no reconnect. Local offline browser storage does not cross origins and is not silently deleted; confirmed server records reload in the new app. Android companion continues using its existing scoped API endpoint, backed by the same Worker.

Phone-uploaded cardio-load cards show their actual capture timestamp in Asia/Jerusalem, separately from upload time; current-day loads remain partial. This is not continuous background collection. Separate-origin HTTPS/manifest and both app roots verified; new-origin health API returns 401 without authentication.


## Companion 0.2 missing-data diagnostics

Owner screenshot on Nov 1 showed Google Health Analyzing data, Readiness No data, Sleep No data, and Weekly cardio 1%. Owner also confirmed watch itself has no overnight sleep despite wearing it. Backend read-only check: one paired phone, no acknowledged phone upload or phone-source measurements. This establishes missing source values, not a definitive diagnosis of Google's recording/sync problem. Weekly percentage is never substituted for daily cardio load.

Reader now throttles events rather than rescheduling its delayed callback on every content event: an active progress spinner can no longer indefinitely postpone capture. Parser recognizes analyzing/no-data/weekly-only screens and shows explicit local diagnostics instead of a vague empty capture. 0.2-test version code 2 uses same signing key/package, so install updates preserve pairing and local state. 17 Java parser/diagnostic checks and signed APK build pass. Real Pixel capture remains unverified; no automatic upload was enabled by this update.


## Independent personal model (personal-health-1)

Primary dashboard now uses independent code-calculated Personal Recovery, Personal cardiovascular Load and a sleep-duration range/bedtime. Vendor reference scores remain in a collapsed section. Published evidence and all numerical prototype choices are collated in `docs/PERSONAL_HEALTH_MODEL.md` and `/daynote/research.html`. Google-label fits are reference diagnostics ONLY: changing all vendor labels cannot change primary scores or learned sleep recommendations (regression tested). Existing WHOOP history supplies only a labelled fallback baseline; no ongoing subscription is required.

Imported 308 actual daily HR histograms from the owner's Takeout, with 249 passing the coverage heuristic. One source/day, one aggregate per observed minute, UTC-to-Jerusalem mapping, no gap filling. The new local importer uses prepared D1 queries directly; no temporary public import routes were added. Live Google sync code now paginates recent HR samples and stores these summaries, preserves distinct Takeout records, respects disconnect generation guards, and marks missing/partial data honestly. Actual Google OAuth/fetch is still blocked by the existing Cloud setup helper waiting for owner Allow. No scheduled vendor-score extraction was enabled.

Scores and models recalculate deterministically as measurements arrive. In-depth source/validation documentation records the distinction between research-supported input selection, unvalidated prototype weights, vendor-reference agreement and retrospective conditional prediction. Export/deletion cover the retained summaries through the existing measurement table. Journal response flow remains local and independent of model computation.

Final independent-model checks: 288 JS tests and 6 Python tests passed; 390×844 mobile fixture at 4× CPU showed 15.8–26.4 ms tap-to-next-paint with offline/resume/skip/double-tap/back and audio-failure checks still passing. Main personal scores and collapsed tracker references visually inspected. Model outputs are included in private export alongside source measurements.

Deployment: 7b797650-7462-46ff-b75d-5d2d648b6ca3. Final private live check used a disposable, origin-bound one-use session (consumed and cleaned up): actual partial-load UI rendered, three historical dashboard requests each returned 200 with the independent model, and the public research page returned 200. No journal entries were created or changed. An earlier transient 503 recovered; duplicate first-load requests were removed and a five-result, binding-local, input-revision-invalidated memory cache added. No sensitive API response caching in the service worker. Prospective prediction accuracy and the real Google OAuth fetch remain unverified.


## Sleep Score and Body Score — 4 November 2026 (current)

This supersedes the old recovery/strain home and earlier claims that Google authorization was unverified. The app now shows large Sleep Score and Body Score circles, followed by HRV/RHR and three smaller physiological readings, with stronger whole-circle color shading. Expand scores for component measurements, source/device, missingness, methods and 30-day trends. Existing vitals charts, journals, voice/chat and confirmations remain.

The live account has Pixel Watch 4 data and a fresh real API fetch verified all five daily physiological streams. 260 actual dated score summaries were calculated; no synthetic records or questionnaire answers were created. The two existing journals and all 2,650 source records remained present. Habit associations remain collecting because this is insufficient matched journal history.

The versioned experimental method, evidence, storage rules and known limits are in `SLEEP_BODY_SCORES.md` and `/daynote/score-methods.html`. There is no new strain score. Source archive imports and legacy model code remain for compatibility; commercial scores do not drive Sleep or Body Scores. Actual quiet-query cost: 28 reads, zero writes across three queries. The one-time backfill used 8,973 reads and 780 writes, with mean summary size 1,905 bytes.

Validation: 343 JavaScript tests, 6 Python import tests, production build, and isolated mobile browser checks at 320/390/820 pixels. Visual verification covers size hierarchy, colored full-circle tint/glow, details/chart navigation, local journal advancement and overflow. Authenticated live UI on the owner's phone and prospective scientific validation are not claimed.

Deployment bookkeeping exposed an older migration whose column was already present (`0085_relay_engine.sql`). Verified the live schema before recording that prior migration as applied; no existing column or data was replaced. Additive score migration 0086 was then applied normally.

Final deployment: Worker `6f4abe81-de32-4a50-ae98-88a2f84c4154`, existing https://health.gremiercoffee.co.il/daynote/ and https://chief-of-staff.gremiercoffee.workers.dev. Migration 0086 applied; source/journal preservation verified.


## Research protocol version 2 — 5 November 2026 (current)

The hand-weighted prototype is retired. Active inputs use `nightly-inputs-2`; the UI/API research version is `sleep-body-2`. Prior prototype documents and code are preserved for review. Neither new score is claimed accurate or clinically validated. Current real-history audit found no qualifying timely independent morning outcomes, so numerical estimates remain Learning.

The private profile stores the owner's reported ideal/workable range and explicitly authorized usual weekend durations. The app asks for Friday-night and Shabbos-nap duration, prefills the owner's defaults, and uses those assumptions unless corrected. Defaults produce no fabricated watch measurements or questionnaire answers and are excluded from model training. Manual corrections take priority and preserve journal revision/offline behavior. Weekend sleep maps to Saturday morning; Shabbos naps map to the prior waking day for Sunday morning.

Sleep reference, recent seven-day recorded shortfall, missing/assumed dates, continuity, stage estimates and all five physiological readings remain available. The optional morning check-in adds independent quality/energy and sleep-context reports. A candidate ridge model is evaluated only on later dates using earlier data; actual error, measurement-pattern support and uncertainty gates control availability. The minimum data count is an engineering safeguard, not a published sufficient sample size or a promise scores will unlock.

Exact protocol, research applicability, limits and current evidence are in `SLEEP_BODY_SCORES.md` and `/daynote/score-methods.html`. Migration 0087 archives the previous prototype and adds private revisioned profile storage. Owner sources, original ZIPs and journals are preserved. No Google permissions or account access changes are included.


## Delivery verification — 5 November 2026

Deployed existing Worker version `93808222-8f28-405c-a7da-8377887dd717` at https://health.gremiercoffee.co.il/daynote/ and https://chief-of-staff.gremiercoffee.workers.dev; migration 0087 applied. Live shell and both method pages returned 200; score/profile routes reject unauthenticated access with 401. A real integrated Google sync returned all five daily streams with no warnings and zero pending score refreshes.

The private owner profile is saved at revision 1. Defaults are profile assumptions, not new measurements or journal answers. All 2,650 source records and both journals remain. All 260 original v1 documents are archived; 260 compact daily input documents now use `nightly-inputs-2`. Mean current input size: 1,669 bytes. The one-time input refresh cost 9,233 reads and 520 writes, excluding additive migration/archive setup and profile writes.

Executing the actual quiet v2 endpoint function against the real D1 binding through its authenticated API used five queries, 65 rows read and zero writes. It returned Learning for both scores with zero qualifying independent prior ratings. Source history is not scanned on quiet requests. This is a measured request, not a whole-day account billing or accuracy claim.

Validation: 360 JavaScript tests, six Python import tests, successful production build and isolated browser checks at 320/390/820 px. Browser checks verified usual 9h/2h prompt behavior with zero fabricated journal writes; explicitly saved 8.5h/1.5h corrections on the proper Saturday/Sunday dates; retired-score suppression; size hierarchy, colored whole-circle tint/glow, local journal advancement and no overflow/browser errors. Those example edits were local fixtures, never production health records. A signed-in live phone UI session and prospective predictive accuracy remain unverified. No emails/messages were sent to others and no Google permissions changed.


## Morning check-in design & day swipes — 5 November 2026

Sleep quality and morning energy now use native vertically scrollable, snapping 0–10 number wheels in two charcoal inset panels. Empty remains unknown, zero is a real rating, and Clear removes a rating. Keyboard arrows/Home/End/Delete and screen-reader spinbutton labels work. The redesigned card has a sunrise header, subtle lime shading, a human-readable date, a two-rating completion indicator and collapsed optional sleep details.

On the daily overview, swipe right for the previous date and left toward today. Date arrows and the picker remain available. Vertical page scrolling, rating wheels, form controls and chart scrubbing cannot trigger a date swipe. Date-specific ratings persist locally across navigation/reload. Stale score responses are hidden when their date differs from the displayed date; an eight-result private in-memory cache avoids redundant score fetches. Date browsing reuses the loaded vital history and does not force a journal-wide refresh on each swipe. No schema/model or owner records were changed for this UI update.

Validation: production build; 360 existing unit/integration checks; isolated mobile browser tests exercising native wheel scrolling and touch flicks, keyboard/clear/zero/unknown states, local persistence, touch date swipes, vertical scrolling and chart gesture isolation, date arrows/today limit and no extra history reads. Visual inspection and overflow checks at 320/390/820 px. Existing weekend prompt/correction and score layout checks passed. Browser fixtures never write production health data.

UI deployment verified: Worker 7a66e568-c2a6-4132-b0be-d06e2c5d1b34. Live shell, new JavaScript/CSS and service-worker cache v13 returned successfully. No data migration or production health-record edits were performed for this UI change.


## One-screen home and combined morning prompt — 5 November 2026

The check-in is now a native modal on opening Today when today's combined rating is absent. It asks for **one overall sleep-and-energy rating**, using one 0–10 wheel, not two questions. Values are drafts until Save & continue; zero is a real response and unset stays unknown. Skip today and Escape dismiss only this device's date-specific prompt without creating any journal. Answered ratings persist through normal journal sync, so another device sees completion after loading state. The navigation menu reopens the check-in for the displayed date. There is no inline morning card.

The combined answer is stored as optional `morning.overall`, validated as an integer 0–10. Existing individual quality/energy ratings and duration corrections are preserved; a combined report is never copied into two independently reported outcomes. The current sleep/body research protocol still requires the separate outcomes it specifies; combined check-ins alone do not train those two models or satisfy their 90-day gates. No inferred scores are substituted for missing labels.

On portrait phone screens at least 500px tall, the overview uses viewport-sized circles and one action row. Sleep/Body remain largest, HRV/RHR next, and the remaining three measures underneath. Health chat is in the action row. Trends and color explanations open in the detailed view; score explanations use a separate accessible dialog. These detailed views can scroll. The main screen does not hide overflow to fake a fit. Shorter landscape windows and larger text can still scroll rather than clipping controls.

Synthetic browser verification covers 320×568, 375×667, 390×664, 390×744, 390×844 and 430×932, including circle hierarchy, circle geometry, visible actions and no document scrolling; modal scroll/keyboard selection, clear/zero/unknown, one wheel only, draft/save/skip persistence, menu editing, real date-swipe gestures and cached vitals/state reads. Existing weekend duration prompts remain and are deferred while the morning prompt is open. Service worker shell v14 refreshes the UI. Build, all 364 unit/integration checks, and both mobile browser scenarios passed.

Published version: 4754b1cb-2ed8-405d-af91-767497b3ffe1. Verified the live health domain serves daynote-CioitmzF.js and shell v14.


## Inviting home and requested notifications — 5 November 2026

Home keeps the seven-circle hierarchy and one-screen portrait layout, with a warm ivory/sage background, a time-aware greeting, glass date navigation, small sleep/body symbols, forest-green actions and a notification bell. Existing native score colors are retained. Browser tests cover the prior six phone sizes plus the additional unusual-pattern link on 320×568 and 390×744.

Superseded for mornings on 9 November 2026: the "how do you feel" push now goes out once a day after waking, when the night's sleep is detected (Google's sleep stream is checked every 15 minutes from 05:00 to 13:00 until it appears), or at 12:00 if no sleep was recorded. It also names the bedtime day's journal if that is unfinished, and tapping it continues into that journal after the rating. `morning_time` is kept in stored preferences but no longer used. Owner requested and confirmed evening **23:45**, Asia/Jerusalem. Three preference toggles cover morning combined rating, evening journal and unusual physiology. Completion is checked against the synced journal (overall=0 is a valid morning answer). The worker checks every five minutes; catch-up lasts up to two hours on the same date. Shabbat suppresses all health notifications. Pattern notices only send 09:00–21:00, at most one successful notice for that date. Morning/evening tags differ. Push links include the intended date, so a late evening tap after midnight still opens the correct journal. A deliberate morning notification tap can reopen a locally skipped check-in. Evening and pattern links do not unexpectedly launch the morning prompt.

Migration 0088 adds an isolated health subscription table and an ephemeral delivery/lease table. Health pushes use health subscriptions when present, otherwise the owner's existing Chief of Staff subscriptions; business pushes never target the separate health table. The existing production account had three Chief of Staff subscriptions and zero direct health subscriptions before rollout. Their continued validity and phone-level delivery are not inferred from row counts. Health's own service worker now handles push/click events. The bell opens settings with Enable notifications on this device. Browser permission requires the user's device gesture; it is not silently granted. Previously granted permission repairs subscriptions on app open. Health subscriptions and identical preferences are conditional upserts, not repeated writes.

A successful push records delivery; zero recipients/failure clears the lease for retry. Concurrent cron claims are fenced for two minutes and normal repeated cron visits produce zero delivery writes. A crash after accepted push but before acknowledgement can still cause a retry; browser notification tags collapse repeats. Detailed health measurements stay off the lock screen. Health push TTL is two hours. Expired subscriptions are removed from their own audience table. Delivery bookkeeping older than 30 days is cleaned only after successful sends; health/journal history is untouched.

The optional physiology flag is deliberately descriptive: at least two unfavorable robust deviations of 2+ units, with at least one breathing or temperature change; HRV+RHR alone is insufficient. Each needs 14 prior same-source observations in 28 days. A fresh current-date nightly cache must exist and must not be dirty. Raw history is never scanned by notification cron. This rule is NOT a clinically validated illness-prediction model. It does not estimate infection probability or guarantee early warning; symptoms matter even without a flag. The in-app explanation links primary sources and explicitly separates their study performance from this heuristic. See `/daynote/health-patterns.html`.

Validation includes encrypted test-key routing (health/business separation and fallback), due times, DST, Shabbat, zero vs missing, completed journal, concurrent dedup, failed/zero delivery retry, no-device/no-change writes, current/dirty cache guards, multiple-parameter baseline gates, subscription validation, and safe worker notification clicks. Synthetic browser tests verify settings save, requested times, notification deep links and historical date preservation. No real push was sent as a test and no clinical accuracy claim was made.

Published `c585a32c-f260-41da-b5f6-75e43a72bf05`. Live verification confirmed the redesigned shell (`daynote-CERZBgAN.js`), notification worker v15, morning 09:00, evening 23:45, enabled health alerts, and three existing owner device subscriptions. Owner preference update cost one row write. Full suite: 370 passed, eight pre-existing optional checks skipped, zero failed; both mobile browser scenarios passed. Physical phone receipt has not been tested.

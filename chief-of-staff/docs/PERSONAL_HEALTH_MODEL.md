# Independent personal health model — research and implementation

Version: `personal-health-1`, 1 November 2026. Primary implementation: `shared/personal-health.ts`. This is a research-informed, experimental personal model. The cited literature motivates inputs and checks; it does **not** validate our chosen weights, the numerical index, or an exact sleep prescription.

## Evidence hierarchy and design decisions

| Question | Strongest relevant sources reviewed | What we use | What we do not infer |
|---|---|---|---|
| What is WHOOP Strain? | [WHOOP's current description](https://www.whoop.com/us/en/thelocker/how-does-whoop-strain-work-101/) and [HR reserve zones](https://support.whoop.com/s/article/Strain-and-Recovery-Details-Screens) | Duration and intensity of cardiovascular effort matter. WHOOP also models muscular work and compresses its output nonlinearly. | No public exact coefficients were found. Our heart-rate-only load cannot reproduce its combined muscular/cardiovascular score. A 0–21 scale is not a percentage. |
| What contributes to vendor recovery? | [WHOOP Recovery](https://support.whoop.com/s/article/WHOOP-Recovery), [Google Readiness](https://support.google.com/googlehealth/answer/14236710?hl=en) | Both use personalized physiological context. Vendor scores are external comparison labels. | Their score is not biological ground truth; matching it is not validation of our own recommendations. |
| How should cardiovascular load be quantified? | [Wallace et al. 2014, experimental comparison of training-load methods](https://pubmed.ncbi.nlm.nih.gov/24662229/); [Manzi et al. 2009, individual training-impulse model](https://pubmed.ncbi.nlm.nih.gov/19468747/) | Aggregate measured time and intensity; preserve sensor coverage; compare against personal history. | There is no universally best load formula. HR misses some muscular load. We do not call our prototype formula validated TRIMP. |
| Is HRV a sufficient readiness measure? | [Plews et al. 2013](https://pubmed.ncbi.nlm.nih.gov/23852425/), [HRV-guided training review](https://pubmed.ncbi.nlm.nih.gov/34489178/), [2026 readiness review](https://pubmed.ncbi.nlm.nih.gov/42926133/) | Compare log-HRV and RHR against the person's recent baseline; combine dimensions. | Higher HRV is not universally better. Measurement protocol and individual context matter. Training-performance prediction remains uncertain. |
| How much sleep? | [AASM/SRS adult consensus](https://pmc.ncbi.nlm.nih.gov/articles/PMC4442216/); [Walsh et al. expert consensus](https://pubmed.ncbi.nlm.nih.gov/33144349/) | An adult-duration lower guardrail and individualized observed sleep ranges. Additional need may vary with circumstances. | No fixed conversion from a strain point into minutes of required sleep, or a guarantee that a target produces green recovery. |
| Which sleep dimensions matter? | [Buysse 2014](https://pubmed.ncbi.nlm.nih.gov/24470692/); [AASM technology evaluation update](https://pmc.ncbi.nlm.nih.gov/articles/PMC8636367/) | Duration, continuity, timing/regularity, and the owner's reported experience are separate dimensions. Wearable stages remain device estimates. | No universal REM/deep-minute quotas; no penalty for missing or uncertain staging; no claim that a wrist sensor measures EEG sleep architecture precisely. |
| How does accumulated sleep loss matter? | [Van Dongen et al. randomized sleep-restriction experiment](https://pubmed.ncbi.nlm.nih.gov/12683469/); [Borbély's two-process account](https://pubmed.ncbi.nlm.nih.gov/35502706/) | Recent sleep history matters; sleep pressure and circadian timing are distinct. Use intended wake time and report timing variability. | Our debt allowance is not a full two-process physiological simulation. Circadian phase cannot be measured from a clock bedtime alone. We cannot guarantee immediate sleep at a suggested bedtime. |
| How should the journal be used? | [Saw et al. systematic review of 56 studies](https://pubmed.ncbi.nlm.nih.gov/26423706/) | Preserve self-reported energy separately and use explicit habit answers for exploratory comparisons. Low reported energy can exclude a supposedly well-rested baseline day. | A sensor score does not overrule the owner's experience. An unmentioned or skipped habit is not No; associations are not causation. |
| What data can actually arrive? | [Google v4 data types and sync availability](https://developers.google.com/health/data-types), [vitals schema](https://developers.google.com/health/data-types/vitals), [WHOOP API](https://developer.whoop.com/api/) | Google HR samples, sleep, daily HRV/RHR where authorized. WHOOP's already-imported baseline sleep-need component is an optional historical fallback. | Not raw PPG/EEG, not guaranteed live streaming, and no dependence on owning WHOOP now. |

## Independent calculations

### Morning recovery

Select one main, processed, non-nap Google sleep per waking date. Require plausible sleep duration and time in bed. Require HRV and RHR plus at least 14 valid prior observations of each component inside a 35-day lookback. Never mix WHOOP and Google HRV measurement distributions.

For each feature, subtract the prior median and divide by robust spread (`1.4826 × median absolute deviation`) with noise floors (0.1 log-HRV, 2 bpm RHR, 30 minutes sleep). Clip deviations to ±3. Initial independent index:

`clamp(50 + 12 × (0.5 × z(log HRV) − 0.3 × z(RHR) + 0.2 × z(sleep duration)), 0, 100)`.

**These coefficients, floors and scale are explicitly prototype design choices.** They were not extracted from WHOOP, Google or a clinical equation. 50 denotes the person's typical baseline, 60+ is our above-baseline band and below 40 is our below-baseline band. They are not vendor color thresholds or probabilities. Missing inputs produce no score, rather than imputed normal recovery.

Google-label ridge regression is evaluated as an external reference check. It can estimate a Google reference in diagnostics after forward evaluation, but **its prediction never sets the primary recovery index**. A regression test changes all vendor labels and asserts that primary recovery, load and the learned sleep plan are unchanged.

### Cardiovascular load

Retain one source per day (greatest observed-minute coverage), average distinct readings within each observed UTC minute, then bin rounded bpm values. Do not interpolate missing minutes, sum duplicate source streams, or infer maximum HR from a short day's peak. Reject invalid readings; retain actual covered minutes and latest measurement time. Handle Jerusalem dates using physical instants, including repeated DST hours.

Initial weighted load: `sum(minutes × max(0, (HR − restingHR) / restingHR)^2)`. This excess-heart-rate formula is **our unvalidated prototype**, chosen to emphasize sustained elevated HR without inventing a maximum HR. It is not the published Banister/Edwards TRIMP formula. A later research version may support a standard HR-reserve method after a defensible maximum-HR/reference setup is available.

After 14 sufficiently covered historical days, display a 0–100 personal index using a saturating transformation with the prior 90th-percentile impulse mapped to 90. Weighted minutes remain inspectable. Changing this display scale does not change recorded physiological inputs. Current-day loads stay partial; historical completeness initially requires at least 720 observed minutes. That threshold is a coverage heuristic, not proof of complete wear.

Google Cardio Load labels are used only for a separate historical reference fit. They cannot change the independent load. Heart rate does not measure resistance-training load, so the UI explicitly calls this cardiovascular load.

### Sleep target and bedtime

Pair a load/habit day with subsequent sleep and the following morning. Forecast outcomes use an HRV/RHR index **excluding sleep itself**, avoiding a tautology where longer sleep automatically makes the predicted outcome better by formula. Exclude known illness/travel from training comparisons. The conditional regression is tested against a sleep-only regression, rather than only a constant baseline.

With at least 12 similar days and 5 above-baseline next-morning outcomes, choose the 60th-percentile sleep duration before above-baseline HRV/RHR mornings, bounded below by the comparable-day median. This is observational, not an intervention result. Otherwise use sleep before independently above-baseline Google-measured mornings, excluding explicitly low-energy days when energy is reported. If insufficient, fall back to the median historical WHOOP **baseline sleep-need component**, with an explicit fallback label; an active subscription is not needed.

Heuristic adjustments: recent shortfall contributes at most 60 minutes (`positive seven-day shortfall / 4`, only with five observed nights); a recorded nap contributes a half-duration credit capped at 45 minutes. The target is initially constrained to 7–10 hours and rounded to 15 minutes, with a ±30-minute displayed range clipped to those bounds. These are product guardrails and prototype heuristics, not evidence of the owner's biological minimum or maximum. There is no universal ten-hour medical ceiling.

Add the owner's median observed awake time in bed, then subtract elapsed time from the intended Jerusalem wake instant; DST arithmetic is physical, not naive clock subtraction. Duration, sleep efficiency and circular bedtime variability are available separately. REM/deep estimates do not drive the target. Full circadian phase modeling and strength-load modeling are **not implemented**.

## Evaluation, recalculation and limits

- Chronological forward evaluation starts after 40 training examples, uses up to 180 previous examples, and compares a ridge fit against an explicit baseline. Reference fits require 14 test cases and at least 5% average-error improvement before appearing as available diagnostics. They never replace independent calculations.
- The conditional next-morning fit uses the **actual subsequently obtained sleep** in retrospective testing. It is not a prospective test that the owner will obtain a planned duration or that changing bedtime will cause a desired outcome. The numeric conditional output targets the HRV/RHR baseline index, not the combined primary index or a vendor score.
- New raw measurements and explicitly logged vendor labels cause deterministic recalculation. No language model performs numerical scoring. Versioned code, retained normalized measurements, archive hashes and coverage metadata allow reproduction. No synthetic account records are generated.
- Re-checks against a monthly/weekly batch of daily vendor scores are possible after those data are supplied. Scheduled Takeout retrieval and automatic monthly score capture are **not implemented**. The existing manual score/companion paths remain optional reference sources.
- Google API code and fixtures now include paginated recent HR collection (last three UTC dates), summarized into local days in memory before storage. Existing sleep/HRV/RHR backfill remains separate. Older HR gaps currently require archive import. Raw HR samples are not retained indefinitely; private minute-bin summaries are retained until health-data deletion.
- Prospective validation against the owner's energy, sleepiness, and real-world functioning is still required. One person's observational history cannot establish causality or population accuracy. No WHOOP subscription is required for operation, and buying one would not guarantee correctness.

## Delivery verification

Imported 308 actual HR-summary days from the owner's supplied archive, of which 249 satisfy the initial coverage heuristic. No raw samples were written into the repo. The importer opens only allowlisted HR CSVs, validates timezone and numerical ranges, and writes prepared, idempotent summaries to the existing private D1 database.

Retrospective Nov 1 analysis: 206 Google-readiness reference labels / 166 test dates; reference-fit MAE 6.22 vs constant-baseline 14.52. 248 Google-load reference labels / 208 test dates; MAE 9.31 vs 16.62 native load units. 143 next-morning pairs / 103 conditional tests; HRV/RHR-index MAE 7.25 vs sleep-only 8.45. These numbers describe retrospective reference/conditional agreement, not medical accuracy, prospective validation, or guarantees. Today's missing sleep/HRV/RHR still correctly produce no recovery score.

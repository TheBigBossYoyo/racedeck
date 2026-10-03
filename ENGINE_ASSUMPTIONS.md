# Engine Assumptions & Fallback Behavior Guide

Scope: the eight core analytics engines in `src/renderer/core/engines/`. For each, this
documents exact inputs, sample-size/threshold guards (with real constant names and
values), what the function returns when data is insufficient, any confidence/provenance
labels attached to output, and limitations stated in code comments or found by reading
the logic. All constant names, thresholds, and return shapes below are taken directly
from the source — nothing is inferred or assumed beyond what the code shows.

---

## StrategyEngine.ts

File: `src/renderer/core/engines/StrategyEngine.ts`

Module-level doctrine (top-of-file comment, lines 18–27): "EVERYTHING it produces is an
ESTIMATE (heuristic), never presented as fact... when inputs are missing, insights are
omitted."

### Exported functions and inputs

- `estimatePitLoss(laps: LapSample[]): PitLossEstimate | null`
- `circuitPitLoss(snapshot: RaceSnapshot): PitLossEstimate` (memoised per-snapshot via `WeakMap`)
- `servedTimePenalties(messages: RaceControlMessage[]): Map<number, number>`
- `analysePitLane(pitLaneTimes: PitLaneTime[], raceControl?: RaceControlMessage[]): PitLaneAnalysis | null`
- `StrategyEngine.degradationTrend(laps: LapSample[], lastN = 6, coeff?: FuelCoefficient): number | null`
- `StrategyEngine.undercutDelta(intervalAheadSec: number, freshGainPerLap = FRESH_TYRE_GAIN): number`
- `StrategyEngine.pitLossFor(snapshot: RaceSnapshot, greenLoss?: number): number`
- `StrategyEngine.predictPitStop(snapshot: RaceSnapshot, driverNumber: number, laps: LapSample[], greenPitLoss?: number): PitPrediction`
- `StrategyEngine.buildPitScenarios(snapshot, driverNumber, laps, offsetLaps = 3, greenPitLoss?): PitScenario[]`
- `StrategyEngine.generateInsights(snapshot, lapsByDriver: (n: number) => LapSample[], favorites: number[] = []): StrategyInsight[]`
- `StrategyEngine.pitNowAssistant(snapshot, driverNumber, laps): StrategyInsight`
- `planRemainingStrategy(snapshot: RaceSnapshot, driverNumber: number, greenPitLoss?: number): RemainingStrategy`
- `paceComparison(snapshot: RaceSnapshot, driverNumber: number): PaceBattle`
- `paceBattleBetween(snapshot: RaceSnapshot, driverA: number, driverB: number): PaceDuel`
- `pickTeammate(timing: TimingEntry[], driverNumber: number, teamOf): number | null`

### Minimum-sample / threshold constants

| Constant | Value | Used by |
|---|---|---|
| `MIN_REFERENCE_LAPS` | 3 | `estimatePitLoss` — driver's clean-lap race pace, and the ±window reference pace around a stop |
| `PIT_LOSS_REFERENCE_WINDOW` | 6 laps | window of clean laps either side of a stop |
| `MIN_STOPS_FOR_PIT_LOSS` | 4 | `estimatePitLoss` returns `null` below this many usable stops |
| `PIT_LOSS_MIN_SEC` / `PIT_LOSS_MAX_SEC` | 10 / 60 | plausibility band on a single measured stop's loss |
| `NEUTRALISED_PACE_RATIO` | 1.15 | rejects a stop's reference laps if ≥1.15× the driver's own race pace (assumed SC/red flag) |
| `PIT_LOSS_PERCENTILE` | 0.25 | which quantile of surviving losses becomes the circuit estimate (not the median — see rationale in comments) |
| `PLAUSIBLE_STOP_MAX_SEC` | 60 | `analysePitLane` — excludes red-flag stoppages/retirements from pit-lane-time stats |
| `MIN_STOPS_FOR_COMPARISON` | 5 | `analysePitLane` returns `null` below this many plausible stops |
| `SLOW_STOP_MAD_MULTIPLE` / `SLOW_STOP_MIN_MARGIN_SEC` | 4 / 4 | slow-stop threshold = median + max(4, 4×MAD) |
| (inline, `degradationTrend`) | `clean.length < 3` | returns `null` |
| `MIN_GREEN_STINT_AGE_LAPS` | 4 | gates `predictPitStop`'s green-flag verdict eligibility (stint must be this old) |
| `MIN_GREEN_RACE_PROGRESS_LAP` | 4 | gates same verdict on race progress |
| `MIN_GREEN_RECOVERY_LAPS` | 6 | minimum laps remaining to "recover" a clean-track stop |
| `MIN_OPENING_STINT_PLAN_AGE` | 4 | `planRemainingStrategy` refuses to rank plans on an opening stint younger than this |
| `MIN_OPENING_STINT_STOP_AGE` | 8 | opening-stint stop must be at least this old in the searched plan |
| `PACE_DUEL_TREND_DEADBAND` | 0.03 s/lap | `paceComparison`/`paceBattleBetween` — closing rate below this reads as noise, not a trend |
| `PACE_DUEL_MAX_PROJECTION_LAPS` | 80 | fallback horizon **only** when the session's own remaining-lap count is unknown; otherwise the real `lapsRemaining` is used uncapped (explicitly documented fix — a prior `Math.min(lapsRemaining, 40)` silently truncated late-race projections) |

### Fallback behavior

- `estimatePitLoss` → `null` when `losses.length < MIN_STOPS_FOR_PIT_LOSS`. `circuitPitLoss` then falls back to the hardcoded default `PIT_LOSS_SEC = 21.5` with `{ sampleSize: 0, source: 'default' }`.
- `analysePitLane` → `null` when `plausible.length < MIN_STOPS_FOR_COMPARISON`.
- `degradationTrend` → `null` when fewer than 3 clean laps, or when the least-squares denominator is 0 (degenerate/no lap-index variance).
- `predictPitStop` never returns `null`; on missing data it returns the `base` `PitPrediction` object with `available: false` and a `reason` string, e.g. `'Driver not in the current classification.'` or `'No numeric gap available yet for this driver — projection needs interval data.'` — every numeric field stays `null` in that case.
- `planRemainingStrategy` returns `available: false` with an explicit human-readable `reason` at each guard: `'Stint planning applies to races.'`, `'Race lap count unknown.'`, `'Too few laps remaining to plan.'` (`lapsRemaining < 2`), `'Wet conditions — the dry stint model does not apply.'`, `'Driver not in the current classification.'`, `'Opening stint is still too fresh to rank pit windows yet.'`, `'Not enough clean-lap data to model the compounds yet.'` (delegates to `compoundModel` in `AnalyticsEngine`, which is out of this doc's scope but its emptiness is checked via `model.size === 0`), and `'No legal plan found for ...'` when no plan satisfies the stop/compound rules.
- `paceComparison` / `paceBattleBetween` return `available: false` with all rival/gap fields `null` when the driver isn't found in current timing or has no known `position`.
- `projectPaceDuelClosingLaps` returns `null` when either side's `currentPace` is `null`, or the gap never crosses zero within the horizon — it does not fabricate a laps-to-resolve figure by extrapolating past the session length.

### Confidence / provenance labels

- `PitLossEstimate.source: 'measured' | 'default'` + `sampleSize: number` (0 for default).
- `StrategyInsight.confidence: 'low' | 'medium' | 'high'` and `StrategyInsight.isEstimate: boolean` — `isEstimate` is `false` **only** for the pit-lane-transit insight in `generateInsights` (measured F1 timing data), `true` everywhere else, explicitly documented: "True for a projection (the default...). False only where the insight rests on data F1 actually measured."
- `PitPrediction.confidence: 'low' | 'medium' | 'high'` and `isEstimate: true` (always, by type — this struct is never presented as measured).
- `RemainingStrategy.stopConfidence: 'high' | 'medium' | null` — sourced from `remainingStopRequirement` in `PitCycleModel.ts`, `null` "before it's known" (i.e., before `available`).
- `PitScenario.isHypothetical: boolean` — flags scenarios that don't reflect the track's real current state (e.g. `box-neutralized` when the track is actually green).

### Known limitations / calibration assumptions (from comments)

- `PIT_LOSS_SEC = 21.5` is explicitly "roughly the middle of the 2026 range; every circuit differs" — a placeholder until `estimatePitLoss` can measure the real one.
- Pit loss must be measured per-circuit because the constant "cannot serve every track" (19.0s Melbourne to 25.6s Montreal transit; loss itself varies more).
- `PIT_LOSS_PERCENTILE = 0.25` (not the median) is deliberate: contaminating effects (SC, traffic, botched stops) only ever push a stop's measured loss *slower*, never faster, so the low end of the distribution is closer to truth — documented with concrete 2026 race numbers (Melbourne p25 28.8s vs median 52.0s).
- `SLOW_STOP_MAD_MULTIPLE`/margin is scaled by each session's own dispersion because pit-lane MAD itself varies 5x across circuits (0.3s Austria/Hungary vs 1.4–1.6s Spa/Canada) — a fixed absolute margin "would be noise at one track and blind at another."
- `degradationTrend` requires a `FuelCoefficient` to be meaningful; omitting `coeff` "keeps the raw behaviour for callers holding bare laps" but a raw (uncorrected) slope will read a genuinely-degrading tyre as improving because fuel burn (~0.055 s/lap) dominates.
- `predictPitStop`'s rejoin/positions-lost projection explicitly "assumes every other car holds station" — a documented simplifying assumption, not a full field simulation.
- `PACE_DUEL_MAX_PROJECTION_LAPS` is a fallback-only cap; the code comment explicitly documents a past bug where this was misapplied as a hard cap even when the real horizon was known.

---

## ErsEstimator.ts

File: `src/renderer/core/engines/ErsEstimator.ts`

Module doctrine (lines 1–58): "The public F1 timing feed doesn't expose battery
state, so this module derives a *labelled estimate*... It is NOT real battery data —
callers must set `energyIsEstimate = true`... Honest: returns null values when
insufficient data rather than guessing."

### Exported functions and inputs

- `initErsState(): ErsDriverState`
- `startLap(state: ErsDriverState): ErsDriverState`
- `integrateErs(state: ErsDriverState, sample: ErsTelemetrySample, dt: number): ErsDriverState`
- `deriveDeployMode(sample: ErsTelemetrySample, soc: number, deployBudget = DEPLOY_BUDGET_PER_LAP): EnergyMode | null`
- `applyOvertakeEligibility(mode: EnergyMode | null, intervalAhead: number | '+1 LAP' | null): EnergyMode | null`
- `explainOvertakeEligibility(mode, intervalAhead, deployBudgetRemainingPct): { eligible: boolean; reason: string }`
- `eligibilityDurationSec(eligibleSinceClock: number | undefined, clock: number): number | null`
- `computeErsEstimate(state: ErsDriverState, latestSample: ErsTelemetrySample | null): ErsEstimate`
- `deriveEnergyTrend(points: ErsTimelinePoint[], driverNumber: number, clock: number, windowSec = DEFAULT_TREND_WINDOW_SEC): EnergyTrend`

### Minimum-sample / threshold constants

| Constant | Value | Purpose |
|---|---|---|
| `MIN_SAMPLES_FOR_ESTIMATE` | 4 | `computeErsEstimate` returns an all-null estimate below this integrated-sample count |
| `SAMPLES_FOR_MEDIUM_CONFIDENCE` | 25 | confidence tier boundary |
| `SAMPLES_FOR_HIGH_CONFIDENCE` | 120 | confidence tier boundary |
| `MAX_DT_S` | 5 | guards against cold-start time-delta spikes in `integrateErs` |
| `MAX_LAP_DURATION_S` | 150 | forces an allowance refill if no lap-boundary signal arrives (self-healing fallback, not a data-sufficiency guard) |
| `TREND_DEADBAND_PCT` | 1.5 | `deriveEnergyTrend` — below this, direction is `'stable'`, not a fabricated trend |

`isUsableTelemetry` requires `throttle`, `speed`, and `brake` all non-null; this is a
per-frame completeness gate, not a sample-count threshold — `integrateErs` is a no-op
(returns the unchanged `state`) whenever a frame fails it or `dt` rounds to 0, rather
than coercing missing channels to 0 (which the comment says "would... invent a BALANCED
drain/harvest pattern").

### Fallback behavior

- `computeErsEstimate` → when `state.sampleCount < MIN_SAMPLES_FOR_ESTIMATE` (4), returns exactly:
  ```
  { energyPct: null, deployMode: null, confidence: null, deploymentLimited: false, deployBudgetRemainingPct: 100 }
  ```
- `deriveDeployMode` → `null` "only when the sample has no usable data (all channels null)" — checked via `isUsableTelemetry`.
- `deriveEnergyTrend` → returns the constant `STABLE_NO_HISTORY = { direction: 'stable', deltaPct: null }` whenever there is no usable reading at `clock` or at `clock - windowSec` (session start, a driver only just seen).
- `eligibilityDurationSec` → `null` when `eligibleSinceClock` is undefined or the current `clock` is before it (a backward scrub past the marker) — explicitly documented as "return null rather than a fabricated number" instead of reconstructing a full scrub-anywhere-accurate history.
- `budgetOr` treats a missing/invalid budget as a **full** allowance rather than 0 or `NaN`, specifically so an older persisted state shape "must not poison the arithmetic."

### Confidence / provenance labels

- `ErsEstimate.confidence: ErsConfidence | null` where `ErsConfidence = 'low' | 'medium' | 'high'`; doc comment: "Null exactly when `energyPct` is null."
- `ErsEstimate.deploymentLimited: boolean` and `deployBudgetRemainingPct: number` surface *why* a reading may look low/flat rather than leaving the UI to infer it.
- Module-level contract that callers must set an external `energyIsEstimate = true` flag — note this labeling is a **caller responsibility**, not a field this file itself emits; the file's own honesty mechanism is the `confidence`/null pattern above.

### Known limitations / calibration assumptions (from comments)

- `INITIAL_SOC = 65` is a seeded assumption ("realistic mid-stint value"), not measured — the whole model is built on top of this seed since real battery SoC is never exposed by the feed.
- `DRAIN_DEPLOY_PER_S = 8.75` is derived directly from the published 2026 350kW MGU-K figure against a 4MJ store, and cross-checked against the regulation's own "4MJ burst ≈ 11.5s" figure — the most rigorously sourced constant in the file.
- `DRAIN_BOOST_MULTIPLIER = 1.6` is explicitly "not independently sourced, kept as a documented estimate."
- `HARVEST_BRAKE_PER_S = 6.0` / `HARVEST_LIFT_PER_S = 1.7` are "a documented proportional estimate" (scaled 4.25× off pre-2026 baseline rates), since the real recovery power in kW isn't published.
- `HARVEST_BUDGET_PER_LAP = 175` defaults to "the regulation's own mid-point" because "this app has no per-circuit energy table" — a stated future-extension gap, contrasted explicitly against `PitCycleModel.ts`'s existing per-circuit pit-loss calibration.
- `DEPLOY_TAPER_START_KMH`/`DEPLOY_CUTOFF_KMH` (340/345 km/h) model a genuinely new 2026 regulatory behavior (electrical assist cutoff at top speed) that "this model has no equivalent of pre-2026."
- Confidence "means integrated evidence, not message count" — deliberately distinct from a raw telemetry-frame counter.

---

## WeatherTrendEngine.ts

File: `src/renderer/core/engines/WeatherTrendEngine.ts`

Module doctrine (lines 3–9): "Deliberately NOT a forecast — nothing here predicts a
future value. It characterizes the real historical trend... Always pair with
`modelled` provenance." (Note: the `modelled` tag itself is a caller-side convention;
this file does not attach a provenance field to its own return types.)

### Exported functions and inputs

- `weatherFieldTrend(history: WeatherSample[], field: 'airTemp' | 'trackTemp' | 'windSpeed', lastN = 8): WeatherTrend`
- `rainTransition(history: WeatherSample[]): RainTransition`
- `dryingReadiness(history: WeatherSample[], current: WeatherSample | null): DryingReadiness`

### Minimum-sample / threshold constants

| Constant | Value | Used by |
|---|---|---|
| (inline) | `clean.length < 3` | `weatherFieldTrend` — minimum usable timestamped samples for a least-squares slope |
| `TREND_DEADBAND_PER_MIN` | 0.3 | slope magnitude below which direction is `'stable'` |
| (inline) | `history.length < 2` | `rainTransition` — needs at least 2 samples to detect a flip |
| `JUST_STOPPED_SEC` | 300 | `dryingReadiness` — rain treated as still effectively active for 5 minutes after cessation |
| `LIKELY_DRY_SEC` | 900 | after 15 minutes with no rising track temp, still resolves to `'drying'` rather than staying `'unknown'` forever |

### Fallback behavior

- `weatherFieldTrend` → `{ direction: 'stable', slopePerMin: null }` when fewer than 3 valid (finite-timestamp, non-null-value) samples remain after filtering, or when the least-squares denominator is 0.
- `rainTransition` → `{ kind: null, elapsedSec: null }` when `history.length < 2`, when the latest timestamp fails to parse, or when a flip's timestamp fails to parse (mid-scan).
- `dryingReadiness` → `'unknown'` when `current` is `null`; falls to `'unknown'` (not a guess) when it can't find a cessation transition and rain has been seen this session (`everRained`), only resolving to `'dry'` when no rain has ever been seen at all; between the "just stopped" window and "likely dry" window with a non-rising track-temp trend, it explicitly stays `'unknown'` rather than picking a side.

### Confidence / provenance labels

- No explicit numeric confidence field on any of the three return types. The
  "confidence" signal here is purely categorical: a `null` `slopePerMin`/`elapsedSec`
  (insufficient data) versus a populated one, plus the `'unknown'` state in
  `DryingReadiness` acting as this module's version of an "insufficient data" marker.
- The module doc's instruction to "always pair with `modelled` provenance" indicates the
  provenance tag lives in a shared/UI-level type, not in this file's own return values —
  worth flagging as a convention this module depends on rather than enforces itself.

### Known limitations / calibration assumptions (from comments)

- Explicitly not a forecast: it only describes what already happened in `weatherHistory`.
- `JUST_STOPPED_SEC`/`LIKELY_DRY_SEC` are fixed real-world time constants (5 min / 15 min), not derived from track-specific drying rates — a circuit-agnostic calibration.
- Same least-squares regression shape as `StrategyEngine.degradationTrend` (explicitly cross-referenced in the comment), but this one is **not** fuel-corrected (not applicable to weather) and operates on wall-clock minutes rather than lap index.

---

## SectorDegradation.ts

File: `src/renderer/core/engines/SectorDegradation.ts`

### Exported functions and inputs

- `sectorDegradationTrend(laps: LapSample[], lastN = 6, coeff?: FuelCoefficient, bestSectorsSec: readonly [number | null, number | null, number | null] = [null, null, null]): SectorDegradationPoint[]`

Returns one `SectorDegradationPoint` per sector (1, 2, 3), always length 3.

### Minimum-sample / threshold constants

| Constant | Value | Purpose |
|---|---|---|
| (inline, `sectorDegradationTrend`) | `clean.length < 3` | per-sector guard — evaluated independently for each of the 3 sectors |
| (inline, `leastSquaresSlope`) | `n < 3` | second-layer guard inside the regression helper itself |

No named minimum-sample constant exists in this file (unlike `StrategyEngine`'s
`MIN_REFERENCE_LAPS` or `FuelModel`'s `MIN_FIT_LAPS`) — the "3 clean laps" floor is
inlined at both the per-sector filter site and again defensively inside
`leastSquaresSlope`.

### Fallback behavior

- Per sector: if `cleanLaps(laps, lastN, sector).length < 3`, returns
  `{ sector, slopeSecPerLap: null, deltaToBestSec: null }` for that sector — sectors
  are evaluated **independently**, so one sector can report a real slope while another
  reports `null` for the same lap set (the code comment explains this is deliberate:
  filtering is "per SECTOR, not per lap," so one lap missing a single sector's time
  doesn't zero out the other two sectors' trends).
- `deltaToBestSec` is `null` whenever `bestSectorsSec[sector-1]` is `null` (caller didn't
  supply a session-best reference for that sector) — never substitutes a synthetic
  "best."

### Confidence / provenance labels

- No `confidence` field. The `null`-vs-populated `slopeSecPerLap`/`deltaToBestSec` pair
  is the only signal of data sufficiency.

### Known limitations / calibration assumptions (from comments)

- Fuel correction is **not** independently fit per sector — it distributes the
  whole-lap `FuelCoefficient` correction across sectors "proportional to that sector's
  average share of total lap time." The comment explicitly flags this as an
  approximation: "the honest approximation (documented here rather than presented as
  sector-measured combustion)."
- Purpose-built to distinguish concentrated ("this tyre is going off in the fast
  corners") vs. diffuse ("traffic cost a tenth everywhere") pace loss — a whole-lap
  slope alone cannot make that distinction.

---

## TyreRead.ts

File: `src/renderer/core/engines/TyreRead.ts`

Module doctrine (lines 10–13): "Every field is honest about provenance: anything the
feed cannot support comes back null rather than as a confident-looking guess."

### Exported functions and inputs

- `buildTyreRead(snapshot: RaceSnapshot, entry: TimingEntry, laps: readonly LapSample[]): TyreReadModel`

This is a composition layer: it does not implement its own regression, it calls
`StrategyEngine.degradationTrend` (min 3 clean laps, documented above),
`classifyTrackContamination` from `PitCycleModel.ts`, `compoundModel` from
`AnalyticsEngine` (out of scope), and `reconcileTyreHistory` from
`providers/f1normalize` (out of scope).

### Minimum-sample / threshold constants

| Constant | Value | Purpose |
|---|---|---|
| `DEG_STEADY_MAX` | 0.06 s/lap | condition-band boundary (fresh/steady vs working) |
| `DEG_WORKING_MAX` | 0.14 s/lap | condition-band boundary (working vs spent) |

These are **classification bands** on an already-computed slope, not sample-size
gates. This file defines **no minimum-sample-size constant of its own** — the
underlying sufficiency guard (3 clean laps) lives entirely in
`StrategyEngine.degradationTrend`, which `buildTyreRead` simply calls through.

### Fallback behavior

- `degradationPerLap` is `null` and `degradationBlocker` is set to a specific reason,
  not left ambiguous:
  - `'traffic'` when `classifyTrackContamination(...).isContaminated` is true (car is
    in close traffic, a train, lapped, pit-interaction, neutralized, or under a sector
    yellow — see `PitCycleModel.ts` below).
  - `'insufficient-laps'` when contamination is clean but `StrategyEngine.degradationTrend`
    itself returned `null` (fewer than 3 clean laps in the current-stint window).
  - `degradationBlocker` stays `null` only when a real slope was computed.
- `condition: TyreCondition | null` — explicitly "Null exactly when the slope is null,"
  i.e. no condition banding is invented in the absence of a measured slope. (Exception:
  `conditionFor` also special-cases `setAge <= 2` laps as `'fresh'` regardless of slope
  noise — a deliberate override, not a fallback-for-missing-data case.)
- `latestLapLossSec` is `null` whenever `degradationPerLap` is `null`.
- `setLabel` (e.g. `"M2"`) is `null` when there is no `TyreStintSeries` history to count
  ordinal set usage from — "The feed carries no literal set serial number... null
  without that history."
- `fieldDegradationPerLap` is `null` when `compoundModel(snapshot).get(compound)` has no
  entry for that compound this event.

### Confidence / provenance labels

- `degradationBlocker: 'traffic' | 'insufficient-laps' | null` — an explicit "why is
  this null" marker, more specific than a bare boolean.
- `fieldDegradationMeasured: boolean` — "True when the field figure is measured this
  event rather than estimated," directly distinguishing a measured vs. modelled
  provenance for the field-average comparison figure.
- `ageIsDirect: boolean` — "True when `priorStintLaps` is F1's direct statement, not an
  inference," i.e. distinguishes a value read straight off the feed from one this app
  derived.
- `contaminationReasons: readonly ContaminationReason[]` — carries through the specific
  reason codes from `PitCycleModel.classifyTrackContamination` rather than collapsing
  them to a single flag.
- `slopeSampleLaps: number` — always populated (the actual clean-lap count behind the
  slope, even when that count is 0 or below the 3-lap floor), giving the UI an honest
  sample-size readout independent of whether the slope itself computed.

### Known limitations / calibration assumptions (from comments)

- Explicitly separates `setAge` (laps on the physical tyre set, including a prior
  stint) from `stintLaps` (laps in the *current* stint only) — documented as critical
  because slicing by the wrong one "drags laps from an EARLIER stint on the same
  compound... into the window, flattening the very slope being measured."
- Field-degradation comparison is *always* fuel-corrected (not optional), specifically
  because comparing a raw driver slope against an already-corrected field slope would
  be "apples to oranges" given the ~0.055 s/lap fuel-burn effect.

---

## PitCycleModel.ts

File: `src/renderer/core/engines/PitCycleModel.ts`

### Exported functions and inputs

- `raceRulesForSession(session: SessionInfo): RaceStrategyRules`
- `remainingStopRequirement(snapshot: RaceSnapshot, entry: TimingEntry): RemainingStopRequirement`
- `classifyCloseTraffic(snapshot: RaceSnapshot, entry: TimingEntry): CloseTrafficState`
- `classifyTrackContamination(snapshot: RaceSnapshot, entry: TimingEntry): TrackContaminationState`
- `buildPitCycleField(snapshot: RaceSnapshot, greenPitLossSec: number, entries: readonly TimingEntry[] = snapshot.timing): PitCycleFieldModel`

### Minimum-sample / threshold constants

| Constant | Value | Purpose |
|---|---|---|
| `PIT_DEBT_THRESHOLD_SEC` | 1.6 | interval-ahead ceiling for "close traffic" |
| `PIT_DEBT_MAX_LOSS_SEC` | 45 | cap on cycle-adjustment / relative-adjustment seconds |
| `PIT_LOSS_MAX_SEC` / `PIT_LOSS_MIN_SEC` | 35 / 15 | clamp applied to the incoming `greenPitLossSec` before it's used as this model's "effective" pit loss |
| `SECTOR_YELLOW_WINDOW_SEC` | 90 | how long a sector yellow keeps counting as active contamination |

**This file has no sample-size or minimum-data-point guard at all** (no `laps.length <
N`-style check anywhere). It works entirely on the *current snapshot's* classification
state (timing entries, stints, race-control messages) rather than fitting a statistic
over a history — so there is nothing to be "insufficiently sampled" in the same sense
as the regression-based engines. Stated explicitly here per the task's requirement:
where no such guard exists, this document says so rather than assuming one.

### Fallback behavior

- None of the five exported functions return `null` — each always returns a
  fully-populated object, because the domain is rule/state classification, not
  a numeric fit. Missing/ambiguous *evidence* is instead threaded through as a lower
  `confidence` tier or an explicit reason string, never as an absent result:
  - `completedStops` falls back from `entry.pitStops` (feed-reported, `confidence:
    'high'`, `source: 'timing'`) to counting `visibleStints(...).length - 1`
    (`confidence: 'medium'`, `source: 'visible-stints'`) when the feed doesn't report a
    pit-stop count.
  - `remainingStopRequirement.confidence` is `'medium'` whenever the stop count came
    from `'visible-stints'`, or when the dry-compound rule can't yet be assessed for a
    driver mid-way through their stops; otherwise `'high'`. There is no `'low'` tier and
    no `null` — this is a deliberate two-state confidence, not a three/four-state one
    like the other engines.
  - `cycleFactor: string | null` is explicitly set to `null` (not a guessed string)
    when `confidence === 'medium' && stopState.completedStops > 0 &&
    !canAssessDryCompoundRule` — i.e., when the model genuinely doesn't know if the
    two-compound rule is already satisfied.
- `classifyCloseTraffic` returns `isCloseTraffic: false` (with `intervalAheadSec:
  null`) whenever the driver is P1, not running, or the interval isn't a plain
  number — never guesses an interval from adjacent data.

### Confidence / provenance labels

- `RemainingStopRequirement.confidence: 'high' | 'medium'` and `.source: 'timing' |
  'visible-stints'` — both fields directly say whether the stop count came straight
  from the feed or was inferred by counting stint records.
- `ContaminationReason` union (`'close-traffic' | 'train' | 'lapped-traffic' |
  'pit-interaction' | 'neutralized' | 'sector-yellow'`) — a multi-reason provenance list
  rather than a single boolean, explicitly built as "a superset of the single
  close-traffic condition."

### Known limitations / calibration assumptions (from comments)

- `ContaminationReason`'s doc comment states plainly: "This is current-snapshot state,
  not a retrospective per-lap history — `LapSample` retains no historical
  interval-ahead, so a true per-lap contamination record isn't reconstructable without
  new persisted data." This is a scope-down the code owns explicitly rather than
  papering over.
- `raceRulesForSession` hardcodes one circuit/year-specific exception: a
  `year === 2025 && identity.includes('monaco')` branch returning a 2-mandatory-stop
  rule label. Every other race/sprint session gets the generic "two dry compounds,
  1 minimum stop" rule. This is a real calibration limitation worth flagging: the rule
  table is not data-driven per circuit/season beyond this one hardcoded case.
- `PIT_LOSS_MIN_SEC`/`PIT_LOSS_MAX_SEC` here (15/35) are a *different* clamp band than
  `StrategyEngine.ts`'s constants of the same name (10/60) — the two files serve
  different purposes (this one bounds the "effective" pit loss used for
  position-cycle math; `StrategyEngine`'s bounds individual measured-stop-loss
  plausibility) but share a name, worth knowing when tracing either constant.

---

## FuelModel.ts

File: `src/renderer/core/engines/FuelModel.ts`

Module doctrine (lines 4–25): "a labelled ESTIMATE... The coefficient... is either
fitted from this event's own laps when a clean signal exists, or falls back to a
physical default; it is always honestly flagged. It is DELIBERATELY a no-op outside
race/sprint sessions... and whenever the race distance is unknown."

### Exported functions and inputs

- `estimateFuelCoefficient(snapshot: RaceSnapshot): FuelCoefficient`
- `fuelCorrect(lapTime: number, lapNumber: number, coeff: FuelCoefficient): number`

### Minimum-sample / threshold constants

| Constant | Value | Purpose |
|---|---|---|
| `MIN_FIT_LAPS` | 14 | total (all-drivers-combined) clean, fresh-tyre lap-time points required before the fit is trusted |
| `MAX_TYRE_AGE_FOR_FIT` | 6 laps | only laps on a set this age or younger enter the fit, so tyre degradation can't bias the fuel slope |
| `MIN_COEFF` / `MAX_COEFF` | 0.02 / 0.1 s/lap | plausibility band — a fitted value outside this range is rejected even if `MIN_FIT_LAPS` was met |
| (inline, `fitCoefficient`) | `points.length < 3` | per-driver minimum before that driver's laps contribute to the fixed-effects fit |
| `DEFAULT_S_PER_FUEL_LAP` | 0.055 s/lap | physical-default fallback |

### Fallback behavior

- `estimateFuelCoefficient` returns `{ sPerLap: DEFAULT_S_PER_FUEL_LAP, confidence:
  'estimated', totalLaps: null }` when `snapshot.totalLaps` is `null`/`≤1` or the
  session isn't race/sprint (`isFuelRelevant` false).
- Otherwise it calls `fitCoefficient`; that returns `null` when the accumulated
  cross-driver point count is `< MIN_FIT_LAPS` (14) or the regression denominator is
  `≤ 0`. When `fitCoefficient` returns `null`, or returns a value outside
  `[MIN_COEFF, MAX_COEFF]`, `estimateFuelCoefficient` falls back to
  `{ sPerLap: DEFAULT_S_PER_FUEL_LAP, confidence: 'estimated', totalLaps }` (note:
  `totalLaps` is still populated here, unlike the no-op case above).
- `fuelCorrect` is an explicit no-op — returns `lapTime` unchanged — whenever
  `coeff.totalLaps == null`, so non-race sessions and unknown-distance races pass
  through untouched rather than being "corrected" against a guessed distance.

### Confidence / provenance labels

- `FuelCoefficient.confidence: 'measured' | 'estimated'` — exactly two states,
  directly gating whether the coefficient came from this event's own lap-time fit
  or the physical-default constant.
- `FuelCoefficient.totalLaps: number | null` doubles as a provenance/no-op flag:
  `null` means "this coefficient will not correct anything," independent of the
  `confidence` field.

### Known limitations / calibration assumptions (from comments)

- `DEFAULT_S_PER_FUEL_LAP = 0.055` is derived from a stated physical assumption:
  "≈ 1.7 kg/lap × ~0.032 s/kg" — an explicit physics-based default, not an
  arbitrarily chosen number, but still a default rather than a measurement.
- The fit is a **fixed-effects** regression (each driver's laps centred on their own
  mean) specifically "so absolute pace differences between drivers cannot bias the
  slope" — a stated methodological safeguard against a plausible confound.
- Deliberately no-op outside race/sprint: "qualifying already runs low fuel; practice
  fuel loads are unknowable" — an explicit acknowledgment that the model cannot
  meaningfully apply there rather than attempting to.

---

## WinProbabilityEngine.ts

File: `src/renderer/core/engines/WinProbabilityEngine.ts`

Module doctrine (lines 7–29): "a deterministic, always-available model... Everything
here is an ESTIMATE derived only from real, available data... It is never presented
as fact, and it degrades gracefully (a quali/practice session or a snapshot without
gaps simply yields no projection)."

### Exported functions and inputs

- `WinProbabilityEngine.betaFor(snapshot: RaceSnapshot, lapsRemaining: number | null): number | null` — returns `null` when the race distance is unknown. `compute` then returns `available: false` with a reason and `lapsRemaining`, `raceProgress` and `beta` all `null`; it no longer substitutes 12 laps remaining or 45 % progress.
- `WinProbabilityEngine.compute(snapshot: RaceSnapshot): WinProbabilityModel`
- `poissonBinomialPmf(probs: number[]): number[]`
- `winProbabilitySummary(model: WinProbabilityModel, topN = 6): string`

### Minimum-sample / threshold constants

This engine notably has **no hard `laps.length < N` sample-size guard** anywhere in
`compute`. Instead of a binary sufficient/insufficient cutoff, it uses continuous
confidence-scaling formulas that asymptotically approach full confidence as evidence
accumulates:

| Constant | Value | Role |
|---|---|---|
| `paceSampleCount(...)` clamp | 0–8 laps | caps how many clean laps count toward pace-confidence, via `clamp(..., 0, 8)` |
| `rawPaceConfidence` formula | `1 - Math.exp(-samples / 2.4)` | asymptotic confidence in recent pace, not a threshold — e.g. ~1 clean lap ≈ 34% confidence, 8 laps ≈ 96% |
| `BASE_BETA` / `BETA_PER_LAP` | 0.9 / 0.18 | finishing-time noise scale that *widens* (more uncertainty) with more laps remaining, functioning as an implicit "less data about the future ⇒ less certainty" mechanism |
| `MAX_GREEN_BETA` / `MAX_BETA` | 7.5 / 12 | hard caps so beta "never flatten[s] a classified field into near-random order" |
| `SC_BETA_MULT` / `WET_BETA_MULT` | 1.45 / 1.35 | inflate uncertainty under neutralization/rain |
| `UNKNOWN_GAP_QUALITY` | 0.42 | quality score assigned to a gap that had to be inferred rather than read exactly |
| `DNF_HAZARD_PER_LAP` | 0.0016 | per-lap retirement hazard used for `survivalProbability` |
| `WIN_FLOOR` | 1e-9 | numerical floor "prevents an all-zero win field after normalisation" — not a data-sufficiency threshold |

The only true availability guards in `compute` are session-type and runner-count
checks (see Fallback behavior), not per-driver sample-size checks — per-driver
data-poverty instead lowers that driver's `confidencePct`/`dataQuality`, it does not
null out their entry.

### Fallback behavior

- `compute` returns `{ ...base, available: false, reason: 'Win projection applies to
  races and sprints.' }` when `snapshot.session.type` is neither `'race'` nor `'sprint'`.
- Returns `{ ...base, available: false, reason: 'No classified runners to project
  yet.' }` when `runners.length === 0` after filtering out DNF/retired.
- Per-driver: gaps that can't be read directly from the timing feed are *inferred*
  (interval-chain propagation, then position-based interpolation) rather than dropped
  — `resolveGapEstimates` always produces a margin for every entry, but tags the
  provenance via `GapSource: 'exact' | 'interval' | 'position' | 'lapped'` and a
  `quality` score (1.0 for exact, down to 0.2 for lapped-margin estimates). This is a
  deliberate design choice **different** from the "return null" pattern elsewhere: the
  model always produces a number for every driver, and instead pushes the honesty
  signal into `gapQuality`/`gapSource`/`confidencePct`.
- Traffic-masked pace: the code comment (lines 506–512) explicitly documents a
  corrected-in-place bug where traffic uncertainty was being double-counted (once via
  `paceConfidence`'s `paceTrafficPenalty`, again by discounting the raw magnitude) —
  fixed so `paceClosePerLap` keeps the driver's real pace advantage, only reported at
  lower confidence.

### Confidence / provenance labels

- `WinChance.confidencePct: number` (0–100) and `WinChance.dataQuality:
  WinProbabilityDataQuality` (`'low' | 'medium' | 'high'`, via `qualityBand`: `≥0.75`
  high, `≥0.5` medium, else low) — attached **per driver**.
- `WinProbabilityModel.confidencePct` / `.dataQuality` — the same tiering applied at
  the **model** level (averaged across the field).
- `WinChance.factors: string[]` — up to 3 short human-readable reasons, including
  explicit provenance callouts: `'Gap partly inferred'` (interval-derived),
  `'Gap estimated'` (position-derived), `'Pace masked by close traffic'`.
- `WinProbabilityModel.isEstimate: true` (always, by type).
- `WinChance.dnfPct` — surfaces retirement risk as its own labeled figure rather than
  silently folding it into the win/podium numbers.

### Known limitations / calibration assumptions (from comments)

- `DNF_HAZARD_PER_LAP = 0.0016` is explicitly "~0.16%/lap ≈ modern F1 reliability
  (~7% over a 45-lap race)" — a stated circuit-agnostic, era-generic reliability
  constant, not fit per team/car.
- `COMPOUND_BASELINE`/`COMPOUND_DEGRADATION` tables are fixed per-compound constants
  (e.g. SOFT baseline 0.18, degradation 0.018/lap) — not fitted to the current
  session's actual measured compound pace the way `AnalyticsEngine.compoundModel`
  (used elsewhere, e.g. `TyreRead.ts`) is; this is a separate, simpler, hardcoded
  tyre model specific to this engine.
- The Poisson-binomial approach is explicitly chosen because "finishing order is
  treated as noisy" via a logistic pairwise model — a documented statistical
  approximation, not a literal race simulation.
- `beta` is explicitly widened (not narrowed) under Safety Car/wet running: "more
  race left ⇒ more upset potential" — a modelling choice, not a measured relationship.

---

## Cross-engine conventions

Every engine documented above shares the same underlying discipline — **when the
evidence to support a number honestly isn't there, the engine says so explicitly
(via `null`, an `available: false` + `reason` string, or a downgraded
confidence/quality tag) rather than emitting a plausible-looking guess.** The exact
mechanism differs by engine, but the intent is consistent:

1. **Hard `null` on insufficient sample size**, the most literal form of the pattern:
   `StrategyEngine.degradationTrend` returns `null` whenever fewer than 3 clean laps
   are available (`clean.length < 3`), and `FuelModel.fitCoefficient` returns `null`
   below `MIN_FIT_LAPS` (14) accumulated points — in both cases the caller (e.g.
   `TyreRead.buildTyreRead`) must handle the `null` and label the gap explicitly
   (`degradationBlocker: 'insufficient-laps'`) rather than treating a `0` or a
   flat-line guess as data.

2. **`available: false` + a stated `reason`**, used by every guard-heavy projection
   function: `StrategyEngine.predictPitStop` returns `reason: 'No numeric gap
   available yet for this driver — projection needs interval data.'` instead of
   guessing a gap; `planRemainingStrategy` returns `reason: 'Not enough clean-lap data
   to model the compounds yet.'` instead of ranking plans off an ungrounded pace
   model; `WinProbabilityEngine.compute` returns `reason: 'No classified runners to
   project yet.'` instead of computing probabilities over an empty field.

3. **Confidence/provenance tagging in place of a null, when the engine's job is to
   always produce a number**: `WinProbabilityEngine.compute` never nulls out a
   driver's win chance just because their gap had to be inferred — instead it tags
   the estimate's `gapSource` (`'exact' | 'interval' | 'position' | 'lapped'`) and
   `gapQuality`, surfaces it in `factors` (`'Gap partly inferred'`), and folds it into
   a per-driver `confidencePct`/`dataQuality`. `ErsEstimator.computeErsEstimate` sits
   between the two approaches: below `MIN_SAMPLES_FOR_ESTIMATE` (4) it returns a hard
   all-null estimate, but above that threshold it still tags every reading with a
   `confidence: 'low' | 'medium' | 'high'` tier (`SAMPLES_FOR_MEDIUM_CONFIDENCE = 25`,
   `SAMPLES_FOR_HIGH_CONFIDENCE = 120`) rather than presenting a 4-sample reading and
   a 120-sample reading as equally trustworthy.

One notable exception worth naming explicitly: `PitCycleModel.ts` has **no
sample-size guard at all** — its functions classify present-snapshot rule/state
(stop counts, compound rules, traffic proximity) rather than fit a statistic over
history, so there is no "insufficient N" condition for it to guard against; its
honesty mechanism is instead a two-tier `confidence: 'high' | 'medium'` field on
`RemainingStopRequirement` reflecting whether a stop count came straight from the
feed (`source: 'timing'`) or was inferred by counting stint records
(`source: 'visible-stints'`).

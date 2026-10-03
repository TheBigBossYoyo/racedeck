# Circuit & Track-Specific Parameters Audit

Scope: every constant, table or heuristic in `src/renderer/core/engines/`, `core/providers/` (incl.
`f1/`), `shared/` and `main/` that depends on the circuit, its length, its lap time, its pit lane or
the race distance, or that is a circuit-agnostic default standing in for something that varies by
circuit. This is IMPROVEMENT_OPPORTUNITIES.md item #20 ("Circuit-Specific Tuning Parameters Audit").
No values were changed.

Checked against the working tree on 2026-09-19. `StrategyEngine.ts` had just been split into
`core/engines/strategy/*` (`PitLoss`, `PitPrediction`, `StintPlanner`, `StintLaps`, `Undercut`,
`StrategyInsights`, `PaceBattle`); citations use the new files. Line numbers are hints (`~L`).
**Unverified** marks anything not confirmed by reading code or running it. Constants that
[`ENGINE_ASSUMPTIONS.md`](ENGINE_ASSUMPTIONS.md) already documents are only repeated where the
circuit dimension is new.

---

## 0. Summary

1. **There is no per-circuit lookup table for any engine parameter.** The audit item says
   "per-circuit calibration exists for pit loss"; what exists is *per-session measurement*
   (`estimatePitLoss` from the session's own laps). The only circuit-keyed logic in the engines is a
   single Monaco-2025 rule (`PitCycleModel.raceRulesForSession`), and the only circuit-name table in
   the app is the market alias table in `shared/market.ts` (matching Polymarket titles; unrelated to
   strategy). Nothing keys on track length, DRS zones, SC probability or tyre allocation.
2. **Circuit variation is handled by measuring in-session where a measurement exists, otherwise by a
   circuit-agnostic default.** Measured per session: pit loss, compound pace and degradation, fuel
   coefficient, slow-stop threshold, circuit outline. Circuit-agnostic defaults: everything else in
   §2, including all "when is a tyre old" thresholds, the ERS recovery budget, and the win-probability
   noise model.
3. **Where a default is used, it is mostly labelled but the label often does not reach the reader**
   (§4). The five findings that matter most:
   - The default pit loss (21.5 s) is used for *every* pit projection until 4 usable stops have been
     measured across the field: roughly the opening stint of a race at every circuit, and possibly the
     whole of a Sprint, which has no mandatory stop (duration not measured). Its `source: 'default'` flag is read by
     one widget (`PitStopPredictor`); the pit verdicts, `StintPlanner`, win probability and the AI
     context use the number without it.
   - `compoundModel` marks a compound `measured: true` even when its degradation is the hardcoded
     fallback (a measured compound whose fitted slope is missing or not positive). `TyreRead` and
     `ComparisonSummary` then present or persist the fallback as measured.
   - `WinProbabilityEngine` substitutes 12 laps remaining (and 45 % race progress) when the race
     distance is unknown, and overrides exact gaps with a position-based floor in bunched fields.
   - The fuel-coefficient fit has no neutralisation filter, so a safety-car-heavy race can produce a
     fit labelled `measured` from contaminated laps (**unverified in data**).
   - `AlertEngine` hardcodes the qualifying drop zone at P16+ for every stage; the format rule in
     `QualifyingEngine` says P16 is the last safe place in Q1 and P11+ is the drop zone in Q2.
4. Several constants are lap-time-dependent but expressed in seconds (undercut range, sector-yellow
   window, lapped-car margin). Lap time differs by tens of percent across circuits (`ErsEstimator`'s comment cites Spa and Baku
   near 105 s, the Demo base lap is 92.5 s, and `trackPath` calls Monaco, about 3.3 km, the shortest
   lap), so each is right at one circuit and off at another. All could be scaled by the session's own median clean lap, which the snapshot already
   contains.
5. Recommendation on the audit's proposal (a historical lookup table for six circuits): measure first,
   prior second, explicit unknown third (§6). A table would only matter in the window before a
   session has enough laps to measure, and the repo's existing convention already handles that
   window with labelled defaults.

---

## 1. Legend

**Provenance**

| Code | Meaning |
|---|---|
| M | Measured from this session's data |
| MD | Measured, with a hardcoded fallback when the data is too thin |
| D | Hardcoded default; no data path |
| T | Table keyed on circuit, meeting or year |
| F | Format/regulation constant (season rules, not circuit) |
| P | Plausibility bound or sanity guard on data |

**Null-over-guess verdict** (`CODING_STYLE.md`)

| Verdict | Meaning |
|---|---|
| OK | Returns `null`/`available: false` with a reason, or is a pure guard |
| LABELLED | A default is applied but flagged in the returned structure |
| PARTIAL | Flagged in the structure, but only some consumers show the flag |
| SILENT | A default is applied and no flag exists |
| MISLABELLED | The flag says "measured" for a value that is a default |

"Unknown circuit" = what happens at a circuit the code has never seen. Because almost nothing is
keyed on circuit, this is usually "same as every other circuit".

---

## 2. Inventory

### 2.1 Pit loss and pit lane

| Symbol | Where | Value / unit | Source | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|---|
| `PIT_LOSS_SEC` | `strategy/PitLoss.ts` ~L16 | 21.5 s | Comment: "roughly the middle of the 2026 range". Not derived. `DemoProvider` uses the same literal (`PIT_LOSS`, L70) | D | Used until `estimatePitLoss` returns non-null | PARTIAL (see 4.1) |
| `estimatePitLoss` | `strategy/PitLoss.ts` ~L113 | s; p25 of per-stop loss | Measured: in-lap + out-lap excess over the driver's own clean pace ±6 laps | M | Works at any circuit once enough stops exist | OK |
| `MIN_STOPS_FOR_PIT_LOSS` | ~L59 | 4 stops | Chosen | P | Below this the default is used: until four cars have stopped and completed an out-lap, so most of the opening stint; in a Sprint possibly never | see `PIT_LOSS_SEC` |
| `PIT_LOSS_MIN_SEC` / `MAX_SEC` | ~L61 | 10 / 60 s | Chosen; "believable green-flag loss" | P | Rejects a measured stop outside the band | OK |
| `PIT_LOSS_PERCENTILE` | ~L83 | 0.25 | Documented with 2026 Melbourne/Monaco/Hungaroring/Spielberg numbers | D (tuned on data) | Same at every circuit | OK |
| `NEUTRALISED_PACE_RATIO`, `PIT_LOSS_REFERENCE_WINDOW`, `MIN_REFERENCE_LAPS` | ~L55–69 | 1.15 ×, 6 laps, 3 laps | Chosen | P | Same everywhere; the window is in laps, not seconds | OK |
| `SC_PIT_LOSS_FACTOR` | `strategy/PitLoss.ts` ~L17 | 0.5 × | Comment: "a stop under SC/VSC costs ~half". `StrategyInsights` text says "~40-60 %". `PitCycleModel` repeats the literal `0.5` (~L362) instead of importing it | D | Applies to SC and VSC alike; no circuit or lap dependence | LABELLED (`underNeutralization` and the rationale text "about half the green-flag loss"); the factor itself is not sourced |
| `PLAUSIBLE_STOP_MAX_SEC`, `MIN_STOPS_FOR_COMPARISON`, `SLOW_STOP_MAD_MULTIPLE`, `SLOW_STOP_MIN_MARGIN_SEC` | ~L30–45 | 60 s, 5, 4×MAD, 4 s | Comments cite 2026 maxima (28.6–44.9 s) and MADs (0.3 s Austria/Hungary, 1.4–1.6 s Spa/Canada) | M (scaled by session dispersion) + P | Adapts to the pit lane by construction; returns `null` below 5 stops | OK |
| `PIT_LOSS_MIN_SEC` / `MAX_SEC` (second copy) | `PitCycleModel.ts` L7–8 | 15 / 35 s, plus `PIT_DEBT_MAX_LOSS_SEC` 45 s | Chosen | P | **Clamps** a measured loss into [15, 35] before the cycle maths, with no flag. A measured 12 s or 40 s becomes 15 or 35 | SILENT |

Consumers of `circuitPitLoss(...).seconds` that discard `.source`: `predictPitStop` and
`buildPitScenarios` (`strategy/PitPrediction.ts`), `planRemainingStrategy` (`strategy/StintPlanner.ts`,
`stops * greenPitLoss`), `WinProbabilityEngine.compute` (via `buildPitCycleField`), `pitNowAssistant`
(via `predictPitStop`), `StrategyContext` ("Pit loss used: ~21s", the text the AI is grounded on).
`PitPrediction` carries `pitLossSec`/`greenPitLossSec` and no source. The only reader of `.source` is
`PitStopPredictor.tsx` (~L212: "measured from N stops at this circuit").

### 2.2 Tyres: degradation, compound pace, "how old is old"

| Symbol | Where | Value / unit | Source | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|---|
| `compoundPerformance` | `AnalyticsEngine.ts` ~L186 | s (pace), s/lap (deg) per compound | Measured this event; fuel-corrected; stint slope needs ≥4 clean laps (`slope`, ~L51) after trimming laps `> 1.06 ×` stint median (~L172) | M | Works anywhere; empty until a compound has ≥4 clean stint laps | OK |
| `DRY_OFFSET` | ~L296 | SOFT 0, MEDIUM 0.6, HARD 1.2 s | Comment: "rough dry-compound pace offsets". Unsourced | D | Fills compounds not yet run: base = fastest measured compound minus its offset | LABELLED (`measured: false`) |
| `FALLBACK_DEG` | ~L304 | SOFT 0.10, MEDIUM 0.05, HARD 0.03, INTER 0.06, WET 0.07 s/lap | Unsourced | D | Fills a compound with no measured slope | LABELLED since the engine-honesty pass: a fallback figure carries `degMeasured: false` (see 4.2) |
| `compoundModel` | ~L328 | — | `deg` = measured slope if `> 0`, else `FALLBACK_DEG`. Since the engine-honesty pass each entry carries `paceMeasured` and `degMeasured`, and `measured` is true only when both come from real laps | MD | — | LABELLED (fixed; see 4.2) |
| `COMPOUND_BASELINE`, `COMPOUND_DEGRADATION`, tyre score clamp | `WinProbabilityEngine.ts` ~L45–59, ~L216 | baseline 0.18/0.08/0/0.06/0.02 s; deg 0.018/0.012/0.009/0.014/0.011 s/lap; clamp −0.45..0.35 | Unsourced; a separate, simpler tyre model from `compoundModel`. Lookup by compound only | D | Same at every circuit and weekend; unknown compound uses 0.04 / 0.01 | SILENT (the model is labelled an estimate as a whole; this input is not distinguished) |
| `PIT_WINDOW_AGE` | `EngineerNotesEngine.ts` ~L39 | SOFT 16, MEDIUM 26, HARD 38, INTER 22, WET 26, UNKNOWN 30 laps | Unsourced | D | Drives "pit window open" notes at every circuit. Laps, not a fraction of race distance | SILENT (panel says "estimate"; the basis is not shown) |
| `FRESH_TYRE_GAIN`, `OUTLAP_ADVANTAGE_LAPS` | `strategy/Undercut.ts` L3–4 | 0.85 s/lap, 1.6 laps | Unsourced. `undercutDelta = 0.85 × 1.6 − interval`, so the undercut threshold is a fixed 1.36 s at every circuit. Also sets `recoveryLaps = pitLoss / 0.85` | D | Same everywhere; `compoundModel` could supply a measured worn-vs-fresh gap | SILENT |
| Degradation bands | `strategy/PitPrediction.ts` L17–19: 0.08 / 0.14 / 0.28 s/lap; `strategy/StrategyInsights.ts` ~L127/L133: 0.12 / 0.2; `TyreRead.ts` L27–28: 0.06 / 0.14; `TyrePanel.tsx`: 0.14 / 0.06, sector 0.05 | s/lap | Unsourced; five overlapping sets in four files | D | A high-wear circuit reads "heavy" for normal wear; a low-wear one never triggers | SILENT. `TyreRead` already carries the measured field figure (`fieldDegradationPerLap`) the bands could be relative to |
| `MIN_GREEN_STINT_AGE_LAPS`, `MIN_GREEN_RACE_PROGRESS_LAP`, `MIN_GREEN_RECOVERY_LAPS`, `MIN_OPENING_STINT_PLAN_AGE`, `MIN_OPENING_STINT_STOP_AGE`, `REJOIN_TRAFFIC_WINDOW` | `strategy/PitPrediction.ts` L13–16, `strategy/StintPlanner.ts` L8–9 | 4, 4, 6, 4, 8 laps; 4.5 s | Chosen | D | Laps and seconds, not scaled to race distance or lap time | OK as gates (they withhold verdicts) |
| Inline heuristics | `strategy/PitPrediction.ts` ~L248 (`positionsLost <= 4`, `slope > 0.12`), ~L253 (`Math.max(10, stops × 8)`), ~L286/307 (`traffic.length <= 2`), ~L376 (`stintAge >= 12`) | — | Chosen | D | Same everywhere | OK (verdict logic; not presented as measured) |

### 2.3 Fuel

| Symbol | Where | Value / unit | Source | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|---|
| `DEFAULT_S_PER_FUEL_LAP` | `FuelModel.ts` L28 | 0.055 s per lap of fuel | Comment: "≈ 1.7 kg/lap × ~0.032 s/kg" (physical assumption) | D | Used when `totalLaps` is null/≤1, the session is not race/sprint, fewer than `MIN_FIT_LAPS` = 14 clean fresh-tyre laps exist, or the fit leaves [0.02, 0.1] | LABELLED (`confidence: 'estimated'`); widgets show only a generic "est" badge, so PARTIAL |
| `fitCoefficient` | ~L79 | fixed-effects fit; ≥3 laps per driver, tyre age ≤ 6 | Measured this event | M | Works anywhere | see 4.6: no neutralisation filter |
| `fuelCorrect` | ~L170 | `lapTime − coeff × (totalLaps − lapNumber)` | Assumes burn is linear in laps and equal across cars | MD | No-op when `totalLaps` is null | OK |

Fuel burn per lap depends on the circuit (full-throttle share, lap length); the fit measures it when
it can, which is the correct treatment. The default is only in force in the first few laps.

### 2.4 ERS

Sourcing is in the file's own comments; only the circuit-relevant items are listed.

| Symbol | Where | Value / unit | Source | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|---|
| `HARVEST_BUDGET_PER_LAP` | `ErsEstimator.ts` L243 | 175 % of the ~4 MJ store (≈ 7 MJ) | Comment: FIA recovery cap is "circuit-dependent ~5–9 MJ" (125–225 %); 175 is the midpoint; "this app has no per-circuit energy table" | D | Same at every circuit | LABELLED as an estimate overall (`energyIsEstimate`); the circuit dependence is not surfaced; `confidence` reflects sample count, not circuit fit |
| `DEPLOY_BUDGET_PER_LAP` | L244 | 90 % | Comment: ±4 MJ per-lap delta cap | F | Same | LABELLED |
| `INITIAL_SOC` | L141 | 65 % | "realistic mid-stint value", seeded | D | Same | LABELLED |
| `MAX_LAP_DURATION_S` | L258 | 150 s | Comment cites Spa/Baku ≈ 105 s and wet Monaco ≈ 120 s | P | Refill guard only when the lap-boundary signal is missing | OK |
| `DEPLOY_TAPER_START_KMH` / `CUTOFF_KMH` | L180–181 | 340 / 345 km/h | 2026 regulations (per comment) | F | Speed-based; only reachable at the fastest circuits | OK |
| `OVERTAKE_MAX_GAP_SEC` | L509 | 1 s | 2026 Overtake Mode | F | Same | OK |

Stale comment: L224–225 refers to "the existing per-circuit pit-loss calibration in
`PitCycleModel.ts`". Pit loss is measured in `strategy/PitLoss.ts`; `PitCycleModel` only clamps it.

### 2.5 Race rules and format

| Symbol | Where | Value | Source | Prov. | Unknown circuit / year | Verdict |
|---|---|---|---|---|---|---|
| Monaco rule | `PitCycleModel.raceRulesForSession` L188 | `year === 2025 && identity.includes('monaco')` ⇒ 2 mandatory stops, two dry compounds; label "Monaco 2025: two mandatory stops" | Hardcoded; no source in the code | T (the only circuit-keyed logic in the engines) | Any other circuit/year, **including Monaco 2026**, gets the generic rule (1 stop, two dry compounds). Whether Monaco 2026 has a special rule is not stated anywhere in the repo; **unverified**. `identity` is the lowercased join of `meetingName`, `name`, `circuitName`, `location`; a missing `year` and `dateStart` silently disables the Monaco branch | SILENT (a rule change for a circuit is not distinguishable from "no special rule") |
| Generic rule | same, L195 | 1 stop minimum, `requiresTwoDryCompounds` | Sporting regulations | F | Applies to all races | OK |
| Sprint rule | same, L172 | 0 stops | Sporting regulations | F | Same | OK |
| `qualifyingCutoff` | `QualifyingEngine.ts` ~L134 | Q2 → 10; Q1 → grid − (6 if ≥22 cars, 5 if ≥16, else ⌊grid/4⌋) | Format | F | By grid size, not circuit | OK |
| Drop zone | `AlertEngine.ts` | **Fixed.** Now `qualifyingDropZoneFrom(stage, gridSize)` (cutoff + 1) with the stage from `resolveQualifyingStage`, the same source of truth as `QualifyingEngine`. Unknown stage or Q3 ⇒ no alert | F | The alert fires from P17 in a 22-car Q1 (it used to fire from P16, the last safe place), from P16 on a 20-car grid, and now also in Q2 (from P11) | OK. Residual: `QualifyingEngine.inferStage` still defaults to Q1 for the board, and Q2/Q3 have no knocked-out flag in the feed |
| `POINTS_RACE`, `POINTS_SPRINT` | `WinProbabilityEngine.ts` L62–63 | 25…1, 8…1 | 2026 points tables | F | Same | OK |

### 2.6 Battles, traffic, overtaking

There is no DRS zone or DRS-detection logic. The 2026 model is "Overtake Mode within 1 s".

| Symbol | Where | Value | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|
| Overtake range | `strategy/Undercut.ts` L5 (`OVERTAKE_RANGE`), `BattleEngine.ts` L17, `ErsEstimator.ts` L509 (`OVERTAKE_MAX_GAP_SEC`) | 1.0 s (three copies) | F | Same | OK; three copies can drift |
| `DEFAULT_BATTLE_RANGE`, `CLOSING_EPS`, `FRESH_EDGE_LAPS` | `BattleEngine.ts` L18–20 | 2.0 s, 0.03 s/lap, 4 laps | D | Same. A 2 s gap is a different fraction of a lap at Monaco than at Spa | OK |
| `UNDERCUT_GAP`, `BATTLE_GAP`, `CLOSING_RATE`, `UNDERCUT_FRESHER_BY` | `EngineerNotesEngine.ts` ~L32–37 | 2.0 s, 2.0 s, 0.25 s/frame, 8 laps | D | Same | SILENT (note text has no basis statement) |
| `PIT_DEBT_THRESHOLD_SEC` | `PitCycleModel.ts` L5 | 1.6 s (close-traffic ceiling; also hardcoded in a rationale string in `PitPrediction`) | D | Same | OK |
| `SECTOR_YELLOW_WINDOW_SEC` and `activeSectorYellow` | `PitCycleModel.ts` L54, ~L290 | 90 s | D | The window is not scaled to lap time. A yellow in **any** marshal sector within 90 s marks every driver's degradation read contaminated (the sector number is not matched to the driver's position; marshal-sector count varies by circuit) | OK (it withholds a read, never invents one); over-conservative at large circuits |

### 2.7 Win probability

| Symbol | Where | Value | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|
| `BASE_BETA`, `BETA_PER_LAP`, `MAX_GREEN_BETA`, `MAX_BETA`, `SC_BETA_MULT`, `WET_BETA_MULT` | ~L31–36 | 0.9 s, 0.18 s/lap, 7.5, 12, 1.45×, 1.35× | D | Same at every circuit. There is **no SC/VSC probability** anywhere; a neutralisation only inflates the current noise when it is already active | LABELLED (`beta` is surfaced; `isEstimate: true`) |
| `DNF_HAZARD_PER_LAP` | L71 | 0.0016 / lap | D ("~7 % over a 45-lap race") | Same; not fit to circuit, team or race length | LABELLED |
| `LAPPED_MARGIN` | L38 | 240 s synthetic margin | D | Not scaled to lap time (about 2.3 laps at a 105 s lap; 3.4 laps at an illustrative 70 s lap) | LABELLED (`gapSource: 'lapped'`, quality 0.2) |
| `fallbackGapStep` and the positional floor | ~L242, ~L273 | `1.5 + 1.6 × raceProgress` s per place (1 s under neutralisation); used as a **floor** on exact gaps | D | An exact gap smaller than the floor by more than 0.5 s is replaced by the floor and re-tagged `'position'` (quality 0.42). In a bunched field (early laps, restarts) this overwrites a measured gap with a guess | LABELLED (source and quality change), but a measured value is overridden |
| Race distance unknown | `WinProbabilityEngine.compute`, `betaFor` | **Fixed.** An unknown or non-positive `totalLaps`, or an unreported `currentLap`, returns `available: false` with a reason; `lapsRemaining`, `raceProgress` and `beta` are `null`. The 12-lap and 0.45 fallbacks are gone | — | Panel shows its empty state with `model.reason`; alerts and the AI summary go quiet | OK |

### 2.8 Track geometry and the circuit outline

| Symbol | Where | Value | Source | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|---|
| `MIN_CLOSED_LAP_UNITS` | `providers/f1/trackPath.ts` L162 | 30 000 feed units (decimetres) ≈ 3 km | Comment: shortest current F1 lap (Monaco) ≈ 3.3 km | P (track-length dependent) | A circuit with a lap under ~3 km never closes; the trace stays open | OK (falls back to an open trace, then to the schematic oval) |
| `TRACK_PATH_MAX_POINTS`, `TRACK_PATH_CACHE_MAX` | `trackPath.ts` L27; `F1LiveProvider.ts` L106 | 700 points | Zandvoort: ~45 m sample spacing, 4.26 km ⇒ ~92 points/lap, ~7 laps of window | P | Fewer laps of search window at long circuits (Spa ≈ 7 km ⇒ ~155 points/lap ⇒ ~4.5 laps); more at short ones | OK |
| `closeDistance` | `trackPath.ts` ~L230 | `max(2 × 150, 1.5 × median step)` | Adapts to sample spacing | M | Adapts | OK |
| `MIN_OPEN_TRACE_POINTS` | `F1LiveProvider.ts` L115 | 30 points | Chosen | P | Open trace shown as a placeholder only | OK |
| Outline cache key | `F1LiveProvider.ts` `trackPathCacheKey`, `TRACK_PATH_CACHE_SCHEMA_VERSION` = 3, max 40 entries | `v3/<first two segments of the session path>` | Keyed by meeting (weekend), not circuit name | M | A new meeting is a miss and is traced from live data | OK |
| Schematic oval | `widgets/TrackMap.tsx` L25–28 (`CX/CY/RX/RY`), `pointAt` | Same ellipse for every circuit | D | Used when the provider has no x/y (OpenF1, Demo); labelled with a "Schematic" badge | OK |

### 2.9 Plausibility bounds in normalisers and phase detection

| Symbol | Where | Value | Prov. | Unknown circuit | Verdict |
|---|---|---|---|---|---|
| Credible best lap | `providers/f1/timing.ts` L16–17 | `bestLap >= 40 s`; ≥ half the grid | P | A lap under 40 s (no current circuit) would never be marked fastest | OK |
| Lap-duration band | `SessionPhaseEngine.ts` ~L105 | 20–600 s between consecutive lap counts | P | Wide; fine | OK |
| Representative-lap ratio, cooldown rule | `QualifyingEngine.ts` ~L70, ~L283 | `1.07 × best`; `max(1.07 × best, best + 3 s)` | P | The ratio scales with lap time; the `+3 s` term does not | OK |
| Pace-ratio clamp | `QualifyingEngine.ts` ~L195 | 0.97–1.08 | P | Ratio-based | OK |
| `NEARBY_WINDOW_SEC` | `PitHistory.ts` L13 | 180 s | P | Correlates a pit-lane transit to a lap; not lap-time dependent | OK |

### 2.10 Circuit names, ids and calendars in code

| Where | What | Unknown circuit |
|---|---|---|
| `shared/market.ts` ~L264–316 | `GP_ALIAS_GROUPS` (24 groups: GP name ⇄ country ⇄ circuit ⇄ city) and `GP_SEARCH_LABELS` (24 labels), parallel arrays coupled **by index** (`marketSearchQueries` reads `GP_SEARCH_LABELS[key]`); `WHOLE_WORD_ALIASES` | No key match ⇒ falls back to token overlap and date proximity in `pickBestEvent`; returns `null` when nothing matches. Spain's group holds both `barcelona`/`catalunya` and `madrid`, so a season with both cannot be told apart by alias (the date bonus is the tie-break) |
| `main/practice-service.ts` ~L85–150 | Curated driver profiles with `practiceAppearances` per named meeting (Mexico City, Abu Dhabi, Japan, Austria, ...) and source URLs | Affects the practice briefing only; a driver or meeting not listed simply has no record |
| `shared/standings.ts` L37, L153 | `circuitId` parsed from the standings source | Parsed, not used anywhere else (grep) |
| `DemoProvider.ts` L68–70, L125 | Synthetic circuit "Autódromo Virtuale": 57 laps, 92.5 s base lap, 21.5 s pit loss, SC laps 33–36 | Demo only |

### 2.11 Explicitly absent

Searched for and not found in `src/`: SC/VSC deployment probabilities or any hazard other than the
retirement rate; DRS zones, DRS detection or per-circuit overtaking difficulty; track length,
lap distance or corner counts; tyre allocation (C1–C5 by weekend) or compound-to-circuit tables;
pit-lane length or speed limit; a per-circuit ERS energy table; a per-circuit degradation or fuel
table; time-zone or altitude data (`lib/units.ts` says so for time zones).

---

## 3. How the app degrades at a circuit it has not seen

| Aspect | Behaviour |
|---|---|
| Pit loss | 21.5 s default until 4 stops are measurable, then measured. Labelled `default` in the data, shown to the user in one widget |
| Slow-stop calls | `null` until 5 plausible stops; then scaled to the pit lane's own spread |
| Compound pace / degradation | Empty until a compound has ≥4 clean stint laps; unmeasured compounds are filled from `DRY_OFFSET` and `FALLBACK_DEG`; the degradation fallback is also used for a *measured* compound with a non-positive slope, still flagged measured |
| "Old tyre" thresholds, degradation bands, undercut range | Identical everywhere |
| Fuel | 0.055 s/lap default flagged `estimated` until a fit is available |
| ERS | Same 175 % harvest budget everywhere; flagged as an estimate, not as circuit-generic |
| Mandatory-stop rule | Generic one-stop rule; only Monaco 2025 differs |
| Win probability | Same noise model, hazard and floors; 12-lap default when distance unknown |
| Circuit outline | Traced from the reference car's positions and cached per meeting; open trace, then schematic oval, when it cannot close |
| Market matching | Token/date fallback, `null` if nothing plausible |

---

## 4. Silent or mislabelled defaults, ranked

Ranked by (how often it applies) × (how far the number flows) × (how invisible the default is).
"Proposal" gives a data-derived route and an explicit-unknown route; the first is preferred where the
session contains the data.

### 4.1 Default pit loss is unlabelled outside one widget

- **What happens.** `circuitPitLoss` returns `{ seconds: 21.5, sampleSize: 0, source: 'default' }`
  until `estimatePitLoss` has 4 usable stops (each needs an in-lap, an out-lap and ≥3 clean reference
  laps within ±6 laps, so the first stops of a race qualify only after a few laps and only a few
  stops in). Every consumer reads `.seconds` only. Verdicts such as "BOX NOW", "UNDERCUT NOW",
  positions lost, the stop-plan ranking and the AI context ("Pit loss used: ~21s") are computed from
  it. Only `PitStopPredictor` tells the user.
- **Why it matters.** It applies at every circuit through most of the opening stint (and in a Sprint
  possibly the whole session), which is when strategy calls are most sensitive to it. The code's own comment puts 2026 pit loss at 18.3–31.3 s (`pitLossFor`, `strategy/PitLoss.ts` ~L263).
- **Proposal, data-derived.** (a) Add `pitLossSource: 'default' | 'measured'` and `pitLossSampleSize`
  to `PitPrediction` and `RemainingStrategy`, and print "generic pit loss, not yet measured here" in
  the rationale and in `StrategyContext`. (b) Cap verdict `confidence` at `'low'` while the source is
  `default`. (c) Seed from a same-weekend measurement: the Sprint or an earlier session's measured
  value could be stored beside the outline cache, keyed by the same meeting key; it is the same pit
  lane. (d) Relax `MIN_STOPS_FOR_PIT_LOSS` to 2 with a `'low'` tag, so the label clears earlier.
- **Proposal, explicit unknown.** Make `seconds: number | null` and have `predictPitStop` return
  `available: false, reason: 'Pit loss not yet measured at this circuit.'` until measured. This is
  the strictest reading of null-over-guess and costs the pit-now verdict during the first stint.

### 4.2 `compoundModel` labels fallback degradation as measured

> **Status: fixed.** `CompoundModelEntry` now carries `paceMeasured`, `degMeasured` and `measured` (true only when both come from real laps). The fallback number is kept so `StintPlanner` still has a value, but it is never flagged measured. `ComparisonSummary` persists degradation only when `degMeasured`, otherwise `null` (the persisted shape is unchanged, so saved entries load as before). The Tyre panel and `TyreRead` show "(estimated)" for a fallback figure. The text below is the original finding.

- **What happens.** For a compound with a measured pace, `deg` is the measured median slope when it
  is `> 0`, otherwise `FALLBACK_DEG[compound]` (0.10 / 0.05 / 0.03 s/lap), and the entry is
  `measured: true` regardless (`AnalyticsEngine.compoundModel` ~L328–350). A negative or missing
  slope is normal on a track that is rubbering in, or with too few stint laps.
- **Where it leaks.** `TyreRead.fieldDegradationMeasured` (shown as "measured this event") and
  `ComparisonSummary.degradationByCompound`, whose comment says "only where measured this event
  (never the fallback estimate)", persisted into the comparison library. `StintPlanner` ranks plans
  on the same numbers (it does not read the flag).
- **Proposal.** Split the flag into `paceMeasured` and `degMeasured`; set `degMeasured` only when the
  slope was used. `ComparisonSummary` and `TyreRead` then read `degMeasured`. If a negative slope is
  a real observation, keep it (as `deg < 0`, flagged) instead of replacing it: the planner can clamp
  at its own boundary, where the clamp is visible.

### 4.3 Win probability substitutes race-distance and gap guesses

> **Status: race-distance half fixed; positional-floor half still open.** Unknown distance now yields `available: false` with a reason (see 2.7). The positional gap floor that overrides exact gaps more than 0.5 s smaller is unchanged. The text below is the original finding.

- **What happens.** With `totalLaps` or `currentLap` null the engine runs on 12 laps remaining and
  45 % progress; the exposed `lapsRemaining` stays `null`. Separately, a positional floor of
  `1.5 + 1.6 × progress` s per place overrides exact gaps that are more than 0.5 s smaller.
- **Proposal.** Return `available: false, reason: 'Race distance unknown.'` when `totalLaps` is null
  (the strategy engines already do this: `planRemainingStrategy` returns "Race lap count unknown."),
  or keep the projection but tag `model.distanceAssumed = true` and show it. For the floor, derive the
  per-place step from the session's own measured intervals (the code already averages
  `knownSteps` for missing gaps, ~L336) instead of a fixed formula; never override an exact gap, only
  lower its quality when it looks contradictory.

### 4.4 Pit-cycle clamp on measured pit loss

`buildPitCycleField` clamps the incoming pit loss into [15, 35] s (`PitCycleModel.ts` L7–8, ~L359)
after `estimatePitLoss` admitted [10, 60] s, and the two files use the same constant names with
different values. A measured value outside the band is silently replaced.
**Proposal.** Import one pair of bounds, or return the clamped flag with the field model
(`effectivePitLossSec` is already returned; add `clamped: boolean`).

### 4.5 Degradation bands and "pit window" ages are circuit-agnostic and undisclosed

Five sets of s/lap bands (§2.2) and `PIT_WINDOW_AGE` (16/26/38 laps) classify tyres identically at
every circuit. **Proposal, data-derived.** Express the thresholds relative to the event's measured
compound degradation (`compoundModel(...).get(compound).deg` when `degMeasured`), e.g. "heavy" =
more than 1.5× the field figure, and only fall back to fixed bands, with a label, when the field figure
is unmeasured. For `PIT_WINDOW_AGE`, derive from the fastest-to-slowest stint length observed for that
compound so far this race (`stints` already hold it), or from the stint plan's own optimum, and say
"typical stint so far" in the note text.

### 4.6 Fuel fit has no neutralisation filter (unverified risk)

`fitCoefficient` excludes pit laps and tyre age > 6, but not safety-car, VSC or red-flag laps
(`PitLoss` and `stintSlopesByCompound` both do). Laps under neutralisation are slow and, being early
in a stint, land in the fit at high "laps of fuel remaining", which biases the slope upward. The
plausibility band [0.02, 0.1] would reject an extreme result but not a moderate one, which would be
labelled `measured`. Not reproduced with data. **Proposal.** Reuse the ratio test from
`estimatePitLoss` (`lapTime > 1.15 × the driver's median`) and skip laps while `trackStatus` was not
`CLEAR`, which the lap sample does not carry today (a `LapSample` field would be needed, or the timeline).

### 4.7 Format constants that disagree with each other

> **Status: fixed.** `AlertEngine` now derives the drop zone from `QualifyingEngine` (`resolveQualifyingStage` and `qualifyingDropZoneFrom`); see 2.5. The text below is the original finding.

`AlertEngine.dropZoneFrom = 16` versus `QualifyingEngine.qualifyingCutoff` (§2.5). Not circuit-related
but the same class: two hardcoded copies of one fact. **Proposal.** Have `AlertEngine` call
`qualifyingCutoff(stage, gridSize)` with the stage from `snapshot.qualifyingPart`.

### 4.8 Lap-time-dependent constants expressed in seconds

`LAPPED_MARGIN` (240 s), `SECTOR_YELLOW_WINDOW_SEC` (90 s), the undercut threshold (1.36 s from
`FRESH_TYRE_GAIN × OUTLAP_ADVANTAGE_LAPS`), `UNDERCUT_GAP`/`BATTLE_GAP` (2 s). **Proposal.** Compute
`medianCleanLap(snapshot)` once (the clean-lap median already exists in `estimatePitLoss` as
`racePace`; memoise it on `laps`) and express these as fractions of it, with the current value as the
ratio at a reference lap time. When no clean laps exist yet, use the constant and label it.
`FRESH_TYRE_GAIN` can be replaced by the measured worn-vs-fresh pace gap from `compoundModel`.

### 4.9 Monaco rule is keyed on one year

`PitCycleModel.raceRulesForSession` (§2.5). **Proposal.** Do not extend the string match. Move the
race rules to a small versioned table keyed on `(year, meetingKey)` with a `source` URL per entry,
and make an unknown pair return `{ ...genericRule, ruleConfidence: 'assumed' }` so `stopConfidence`
already exposed by `remainingStopRequirement` drops to `'medium'` for circuits/years the table does
not cover. `confidence: 'high' | 'medium'` exists on `RemainingStopRequirement`; only its `source`
term would change.

### 4.10 ERS recovery budget is the same at every circuit

`HARVEST_BUDGET_PER_LAP` = 175 % against a comment-stated range of 125–225 %. The feed carries no
battery data, so it cannot be measured. **Proposal.** Keep the default, but (a) widen `confidence`
by the circuit-uncertainty band, or (b) show the estimate as a range at circuits without a stated
budget, and (c) if a table is added, source each entry from the FIA per-event document and carry a
`budgetSource` so a missing entry reads as `'default'`. Fix the stale comment at L224.

---

## 5. What a per-circuit table would have to look like, if one is added

Not a recommendation to add one (§6), but if the audit's lookup table is built:

1. **Key.** Use the feed's meeting key and year (`SessionInfo.meetingId`, `year`), the same identity
   the outline cache already uses (`trackPathCacheKey`), not `circuitName`/`meetingName` strings
   (`shared/market.ts` shows how many spellings one round has).
2. **Value shape.** `{ value, unit, source, asOf, nSessions }` per parameter. A bare number cannot
   say where it came from.
3. **Lookup returns a tri-state.** `{ kind: 'measured' | 'prior' | 'default' | 'unknown' }`, so callers
   cannot use it without deciding what to show. Never return a bare `number`.
4. **Precedence.** This session's measurement, else the same weekend's earlier session, else a prior
   from a previous year at the same circuit (flagged `prior`, with the year), else the labelled default.
5. **Versioning.** Bump a schema version and drop stale entries on regulation changes (the outline
   cache does this: `TRACK_PATH_CACHE_SCHEMA_VERSION`).
6. **Tests.** A test that every table key resolves and every consumer displays the source.

---

## 6. On the audit's proposal

IMPROVEMENT_OPPORTUNITIES.md #20 suggests extracting per-circuit tyre-degradation and fuel curves
from 2026 races at five or six circuits and storing them as a lookup applied by the engines.

- **Tyre degradation and fuel are already measured per event** (`compoundPerformance`,
  `fitCoefficient`). A table adds information only in the early laps, before the session has data,
  and the repo's convention for that window is a labelled default. That window is short for
  degradation and fuel; it is most of the opening stint for pit loss (§4.1), where a same-weekend seed is
  cheaper and safer than a historical table.
- **Overfit and drift risk.** Six circuits' worth of one season's data would define priors for
  compounds, cars and regulations that change; a stale prior is worse than a labelled default because
  it looks measured.
- **Coverage.** A new or returning circuit falls through to the default anyway, so the labelled-default
  path must be correct regardless. Fixing §4.1–4.3 does that.
- **Order of work.** Fix the labelling first (4.2, 4.1, 4.3 are small), then measure how much the
  default costs in the first stint using recorded sessions, and only then decide whether a prior earns
  its maintenance cost. The audit's effort estimate (High) covers the data extraction, not the
  provenance plumbing above.

---

## 7. Open questions

- Whether Monaco 2026 (or any 2026 round) has a special mandatory-stop rule; nothing in the repo says.
- How long the default pit loss stays in force in practice: depends on when 4 stops with ≥3 clean
  reference laps each accumulate. Measure on recorded sessions; not done here.
- Whether an SC-affected race can yield a `measured` fuel coefficient (§4.6); needs a recorded
  safety-car race.
- Whether `StintPlanner` output changes materially when `FALLBACK_DEG` replaces a measured negative
  slope (§4.2); needs a run on a track-evolution session.
- The magnitude of the ERS budget error at low- and high-recovery circuits; the feed has no
  ground truth.

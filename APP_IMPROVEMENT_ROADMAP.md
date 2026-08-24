# RaceDeck Improvement Roadmap

This audit ranks improvements by user impact, correctness risk, and implementation leverage. It is based on the current renderer widgets, strategy engines, normalized snapshot fields, F1 archive/live subscriptions, tests, and the real-session work already completed.

Priority meanings:

- **P0 - Correctness / trust:** wrong conclusions, misleading displays, or data already fetched but discarded.
- **P1 - High user impact:** major race-watching or decision-speed improvement.
- **P2 - Strong enhancement:** useful depth after the core surfaces are trustworthy.
- **P3 - Polish / expansion:** valuable, but not before P0-P2.

## Completed During This Audit

1. **Fuel-corrected degradation everywhere it drives strategy.** `StrategyEngine` previously fitted degradation to raw lap times, even though fuel burn makes every later lap faster. The default correction is about 0.055 s/lap: a tyre genuinely losing 0.03 s/lap could therefore appear to be improving. Pit advice, degradation alerts, and the new dossier tyre read now use the same fuel-corrected basis as field compound analytics.
2. **Battery model rebuilt around bounded lap allowances.** ERS no longer uses an arbitrary spring toward 60%. It tracks deployment and harvest allowances, refills on lap boundaries, survives missing lap timing, tapers charge acceptance near the working-window ceiling, and labels estimate confidence.
3. **Battery display explains the number.** Timing rows and the dossier now distinguish a settling estimate from a settled one and show when the lap deployment allowance is spent.
4. **Fast tyre read added to Driver Dossier.** It separates set age from current-stint laps, identifies used sets, suppresses degradation claims in close traffic, shows measured s/lap, cumulative time lost, remaining runway, and comparison with the field on that compound.
5. **Driver Dossier decomposed.** Tyre, speed-mark, and battle presentation were extracted into focused components instead of extending one oversized module.

## P0 - Correctness And Trust

### 1. Consume `TyreStintSeries` instead of downloading and discarding it

**Evidence:** both archive and live services request `TyreStintSeries`, but the renderer has zero references to it. Current tyre/stint state is reconstructed from `TimingAppData` and `CurrentTyres` only.

**Why it matters:** this feed can improve set identity, new-versus-used status, stint transitions, and tyre history. Those are exactly the inputs needed for trustworthy age, degradation, and strategy comparisons.

**Implementation:** parse it at the main-process boundary, normalize it into explicit tyre-set records, reconcile it against `CurrentTyres`, and add disagreement tests. Prefer direct feed statements over inference while preserving replay-clock bounds.

### 2. Calibrate the ERS estimator against complete real sessions

**Evidence:** public F1 data has throttle, brake, speed, and active-aero channels but no actual state of charge. The module is necessarily an estimate.

**Why it matters:** a physically bounded model can still be miscalibrated by circuit layout, telemetry decimation, wet conditions, safety cars, or red flags.

**Implementation:** run representative high/medium/low-deployment circuits through the estimator; assert no rail-to-zero/100, sensible intra-lap swings, lap-boundary refill behavior, and no spikes across feed gaps. Store calibration fixtures, not captured DRM/video data.

### 3. Add real-race UI regression scenarios, not qualifying-only archive QA

**Evidence:** the archive E2E proves map and telemetry readiness but the latest-session target may be qualifying. Pit cycles, mandatory stops, degradation, tyre age, and ERS lap budgets need a race.

**Why it matters:** the most consequential logic only exists during races.

**Implementation:** pin one stable public race archive and assert: a just-pitted contender is cycle-adjusted correctly; pending stop debt is shown; traffic suppresses false degradation; served penalties and cleared investigations disappear; ERS and tyre panels render non-misleading provenance.

### 4. Make measured / inferred / estimated provenance consistent across the whole app

**Evidence:** ERS and strategy expose estimate markers, pit-lane transit can be measured, and compound models carry `measured`; the visual language is inconsistent between widgets.

**Why it matters:** similar-looking numbers currently have different evidentiary strength.

**Implementation:** define a shared provenance type and badge primitive (`measured`, `feed-derived`, `modelled`, `insufficient`). Require every analytic output to declare one. Tooltips should state source, sample count, and replay-time boundary.

### 5. Prevent stale-feed conclusions

**Evidence:** map polling and high-rate data were improved, but widget models generally consume the latest available snapshot without exposing per-feed age.

**Why it matters:** during a partial live outage, a smooth interpolated marker or stable percentage can look current when its source stopped updating.

**Implementation:** track last-update time per stream and driver; fade or freeze derived claims after an explicit freshness threshold; show `STALE 3.2s` instead of continuing to recompute from old data.

## P1 - High User Impact

### 6. Show battery direction and lap budget, not only SoC

**Current state:** the UI shows estimated charge, mode, confidence, and a spent-allowance warning.

**Next step:** add a short history buffer and display `charging / stable / draining`, recent percentage-point change, and deployment allowance remaining for the current lap. This answers whether the driver is preparing an attack or has already used the electrical budget.

### 7. Add a compact tyre trend sparkline to Driver Dossier

**Current state:** the dossier gives a numeric, fuel-corrected slope and clear explanation.

**Next step:** show the last 6 clean, fuel-corrected laps with traffic/pit laps visibly excluded. The chart should make a cliff, flat trend, or recovery obvious without reading prose.

### 8. Expose tyre-set identity and history

**Evidence:** current surfaces show compound and age, but not which physical set was reused or when it previously ran.

**Implementation:** after consuming `TyreStintSeries`, show `M2 - used, 8L before fit`, prior stint laps, and whether the age is direct or inferred. Add a set-history drawer in the dossier.

### 9. Build a one-click sync health panel

**Evidence:** video-follow calibration improved TOD sync, but failure reasons remain distributed across session matching, playback probing, auth, and replay clock state.

**Implementation:** one compact status line: matched event, video clock, data clock, offset, drift, last successful probe, and exact reason auto-follow paused. Include `Recalibrate now` and `Use current moment as anchor` actions.

### 10. Surface per-feed availability and loading progress

**Evidence:** `DataAvailabilityMap` exists, archive enrichment is staged, and optional feeds arrive independently.

**Implementation:** replace generic loading with capability chips for timing, positions, telemetry, radio, tyres, weather, and pit timing. This prevents users interpreting temporarily absent data as a broken feature.

### 11. Use speed-trap and per-lap speed data beyond one dossier block

**Evidence:** `sessionBests` is consumed only by Driver Dossier; per-lap `speedI1`, `speedI2`, and `speedST` are normalized but have no widget consumer.

**Implementation:** add rival speed deltas to driver comparison and telemetry views, identify straight-line versus corner-performance tradeoffs, and correlate speed loss with battery deployment and active-aero state.

### 12. Improve map continuity through brief position outages

**Current state:** 250 ms polling and interpolation fix normal stutter.

**Next step:** add a short, bounded dead-reckoning window using last velocity and lap path, then visibly mark extrapolated positions. Snap only when confidence expires or a new point materially disagrees.

### 13. Add race-state bookmarks to replay

**Evidence:** race story, race control, pits, radio, session phases, and timeline data already exist separately.

**Implementation:** generate clickable markers for start, safety car/VSC, red flag, pit stops, lead changes, penalties, radio, and fastest laps. Clicking should seek both data and TOD video through the existing sync engine.

### 14. Make strategy uncertainty visible

**Evidence:** pit and win models carry confidence and fallback paths, but the UI mainly emphasizes the recommendation.

**Implementation:** show the two or three assumptions that dominate the answer: measured/estimated pit loss, stop-debt confidence, pace sample size, traffic contamination, and weather state. Include the condition that would flip `STAY OUT` to `BOX`.

## P1 - Product And Engineering Foundations

### 15. Create `DESIGN.md` from the existing component system

**Evidence:** the app has an established Tailwind/component vocabulary but no design-system contract.

**Why it matters:** spacing, typography, status colors, estimated-data treatment, focus states, charts, and dense dashboard behavior are currently conventions rather than an enforceable system.

**Implementation:** document existing tokens and primitives first; do not redesign while extracting. Include accessibility constraints, dense-data hierarchy, estimated-versus-measured states, motion rules, and accepted debt.

### 16. Add React render diagnostics to development

**Evidence:** renderer stalls were previously severe enough to nearly crash the app. Memoization fixed the known hotspot, but there is no persistent render-regression guard.

**Implementation:** add dev-only React profiling/render diagnostics and a CI static scan. Establish budgets for timing tower, map, dossier, and charts. Keep all tooling out of production packages.

### 17. Add performance budgets for feed derivation and memory retention

**Current state:** feed derivation improved from 3.64 ms/tick to 0.006 ms in one measured path, and high-rate retention is bounded.

**Next step:** codify maximum derivation time, retained point count, heap growth over a race replay, and render commits per snapshot. Fail CI on regression instead of relying on another live freeze report.

## P2 - Strong Enhancements

### 18. Weather trend and crossover modelling

**Evidence:** weather history is available and displayed, while strategy mostly reacts to current rainfall.

**Implementation:** show track/air temperature trend, wind change, rain onset, drying rate, and estimated slick/intermediate crossover. Keep forecasts explicitly modelled unless a forecast source is added.

### 19. Sector-level degradation diagnosis

**Evidence:** per-lap sectors and ranked session-best sectors are available.

**Implementation:** identify whether lost pace is concentrated in traction, high-speed, or straight-line sectors. This separates tyre wear from traffic, battery deployment, active aero, and driver error more reliably than whole-lap slope alone.

### 20. Automatic traffic contamination beyond the immediate car ahead

**Current state:** close traffic suppression uses interval to the directly preceding classified car.

**Implementation:** detect trains, blue flags, lapped traffic, pit-entry/out-lap interactions, safety-car compression, and sector yellows. Mark each affected lap individually instead of suppressing a whole current stint based only on the latest interval.

### 21. Strategy scenario comparison

**Implementation:** compare `pit now`, `+3 laps`, `next neutralization`, and `stay out` side by side with cycle-adjusted rejoin, traffic, required stops, tyre runway, and uncertainty. Avoid a single recommendation hiding close alternatives.

### 22. Driver comparison with synchronized telemetry overlays

**Evidence:** speed, throttle, brake, gear, RPM, active aero, sectors, and lap timing already exist.

**Implementation:** select two laps/drivers and align by lap progress, then show braking points, throttle pickup, speed delta, gear, and aero mode. Label telemetry decimation and missing channels.

### 23. Team-radio indexing and bookmarks

**Current state:** clips are playable.

**Implementation:** link clips to replay time, driver dossier, race-story events, and user bookmarks. Optional local transcription should be opt-in and clearly separated from official text.

### 24. Pit-stop performance history

**Evidence:** measured pit-lane transit is already normalized and used for one slow-stop insight.

**Implementation:** show every stop against the session median, served-penalty adjustment, under-SC context, and rejoin outcome. Distinguish total pit-lane transit from stationary stop time because the feed does not provide the latter here.

### 25. Explain active-aero / overtake eligibility

**Current state:** current mode is shown and one-second eligibility is inferred.

**Implementation:** show why Overtake is available/unavailable, how long the car has remained eligible, and whether deployment allowance is left. Never imply the driver's button press is directly observed.

### 26. Improve long-session navigation

**Implementation:** searchable event list, keyboard next/previous event, lap jump, driver pit jump, radio jump, and recently viewed moments. Preserve current synchronized video/data position.

### 27. Export a race debrief

**Implementation:** generate a local Markdown/JSON debrief with selected drivers, pit cycles, tyre trends, penalties, radio bookmarks, and key charts. Include source/provenance and replay timestamp for every claim.

## P2 - Reliability And Accessibility

### 28. Unified error state with actionable recovery

**Implementation:** classify provider, auth, archive, live socket, telemetry enrichment, TOD DRM, and sync failures. Each state should say what still works and offer the correct recovery action instead of generic refresh advice.

### 29. Keyboard-first dense dashboard navigation

**Implementation:** documented shortcuts for driver focus, widget focus, replay seek, next incident, pin/unpin, dossier open, and command palette. Add visible focus and screen-reader labels to every compact chart/control.

### 30. Color-independent state encoding

**Implementation:** ensure tyre, sector, penalty, investigation, battery, and confidence states use text/icon/pattern in addition to color. Validate high-contrast and color-vision-deficiency modes.

### 31. Replay determinism tests

**Implementation:** seeking backward then forward to the same clock must produce identical timing, tyre, ERS, race-control, and strategy state. Add property-style tests around session reset, source switching, and live-to-replay transitions.

### 32. Cache schema/version visibility

**Implementation:** expose cache version, circuit outline version, and session enrichment state in diagnostics. On invalidation, state what was rebuilt rather than silently doing work that looks like a freeze.

## P3 - Product Expansion And Polish

### 33. Personalized race-watch profiles

Save favorite drivers, preferred widgets, alert thresholds, and dossier defaults per session type without hiding critical race-control states.

### 34. User annotations

Add timestamped notes and tags tied to driver/lap/event, exportable with the debrief.

### 35. Comparison library across races

Persist derived, source-labelled summaries for comparing pit loss, degradation, straight-line speed, team pace, and weather across events. Never persist licensed TOD media.

### 36. Plugin-safe derived metrics

Expose a readonly, replay-bounded snapshot API for local user metrics. Sandboxed plugins must declare required feeds and provenance and cannot access TOD credentials or DRM state.

### 37. Localization and unit preferences

Centralize copy, number formatting, temperature, speed, and timezone handling. Ensure dense labels remain usable when translated text expands.

## Recommended Execution Order

1. **Trust foundation:** TyreStintSeries, provenance, stale-feed detection, race E2E.
2. **Core race surfaces:** battery direction/budget, tyre sparkline/set history, sync health, map outage continuity.
3. **Data leverage:** sector diagnosis, speed/aero/ERS correlation, pit history, weather crossover.
4. **Engineering guardrails:** `DESIGN.md`, render diagnostics, performance/memory budgets, replay determinism.
5. **Power-user workflow:** bookmarks, synchronized comparison, debrief export.

## Audit Boundary

This list covers the current repository's available normalized data, fetched F1 topics, renderer widgets, strategy/analytics engines, replay/sync flow, TOD integration, and testing/performance infrastructure. It deliberately excludes speculative features that would require private team telemetry, unlicensed data, or pretending estimated values are measured.

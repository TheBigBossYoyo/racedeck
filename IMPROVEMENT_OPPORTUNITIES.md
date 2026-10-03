| 23 | Snapshot derivation pattern | Documented | `SNAPSHOT_DERIVATION.md`. Two contract weaknesses it flagged were reproduced and fixed (`stints` identity under a gap-fill; the pit-lap index missing from the lap-cache key), plus an OpenF1 undated-lap cache bug || 20 | Circuit-specific tuning audit | Audited | `CIRCUIT_TUNING.md`: there is no per-circuit table; pit loss is measured per session. Three silent-default violations were fixed (fallback degradation marked measured, qualifying drop zone, 12-lap distance fallback). Still open: the unlabelled default pit loss, circuit-agnostic degradation bands, the win-probability positional gap floor, the Monaco-2025-only rule || 18 | Theme/unit integration for widgets | Partial | Telemetry speed, radio times and wind/pressure now follow the units settings (new `wind` and `pressure` fields); the track-temperature line uses a theme token; `performanceMode` drops the backdrop blur on `WidgetFrame` panels. Open: wind direction, and colours with no matching theme token (see `ACCESSIBILITY_AUDIT.md`) || 11 | Keyboard navigation consistency | Partial | Audited and fixed: focus rings (plus a global `:focus-visible` rule), named icon-only buttons, a combobox `CommandPalette` with focus trap and focus return, keyboard-operable `PhaseStrip`. Open: roving tabindex for `PhaseStrip` segments, an optional `aria-label` on `Segmented` || 10 | Colour-independent state audit | Partial | `ACCESSIBILITY_AUDIT.md` lists the findings; the clear-cut ones are fixed across 24 widgets. Open: focused-row tint in `TimingTower`, and states with no matching token (see the doc) || 8 | Snapshot derivation perf monitoring | Done | `DerivationTimings` ring buffers for snapshot build, fan-out and widget render, shown on the About page. No real numbers yet: run the app on a live/replay session and read them. Widget render numbers exist only in dev builds || 7 | Provider abstraction boundary | Done | New `core/model/` (snapshot, feedHealth, timeline types) and `core/normalize/` (pure helpers). Import edges: engines -> providers 28 -> 0, widgets -> providers 1 -> 0, no file-level cycles. `F1LiveProvider` takes an injected `TrackPathCacheStorage`. `tests/unit/layering.test.ts` enforces the rules. One commented allowlist entry remains (`persistTrackPathStorage.ts`, the constructor default that existing tests rely on) || 5 | Widget composition / prop drilling | Documented | `WIDGET_COMPOSITION.md`. The prop-drilling premise is mostly wrong (widgets take no props); the real cost is whole-snapshot subscriptions (29 of 34 widgets). A ranked list of consolidations is in the doc; none implemented || 4 | Critical data path test coverage | Partial | ~2,030 unit tests (from ~780 at the start of this pass): live socket, market/standings/practice services, OpenF1 provider, auth, IPC validation, layering. Coverage `include` widened in `vitest.config.ts`, but `@vitest/coverage-v8` is not installed (installing it changes `package.json`), so there are no coverage numbers or threshold yet || 2 | Schema validation for the F1 transform pipeline | Partial | Non-destructive feed validators (`f1/feedValidators.ts`, `FeedQualityTracker`) count and describe wrong-typed values for six feeds and surface them in `SystemStatus` ("Data notes" chip; a warning only for sustained drift). Output is proven byte-identical. The normalizers themselves still read through casts, and nothing is rejected or repaired |# Fresh Improvement Opportunities

This audit identifies genuine new gaps and opportunities beyond the existing `APP_IMPROVEMENT_ROADMAP.md`. These are areas for strengthening the codebase's maintainability, resilience, and architectural clarity — not features in the roadmap already.

## Architecture & Data Flow

### 1. Error Boundary for Widget Isolation

**Gap:** No error boundary component exists. A crash in any widget (e.g., during recomputation or render) can cascade to the entire dashboard. All 40+ widgets are unprotected.

**Impact:** Medium. One malformed data shape or derivation logic error in a heavy widget (Track Map, Timing Tower, charts) can render the whole dashboard inert mid-session.

**Effort:** Low. Add a `<WidgetErrorBoundary>` wrapper and apply it to dashboard grid items. Catch crashes, log with context, show a card-level error state instead of crashing the whole app.

---

### 2. Schema Validation for F1 Data Transform Pipeline

**Gap:** The `F1LiveProvider` and `f1normalize` modules perform deep, multi-stage transforms on raw F1 API JSON with no intermediate schema validation. If a feed's shape ever changes or a parsing assumption breaks, the error bubbles late (possibly in a dependent engine's useMemo).

**Impact:** Medium. Feed API breakage would be silent until UI derivation fails. Live sessions especially would degrade into cascading errors.

**Effort:** High. Introduce Zod or a lightweight schema for each major feed type (TimingData, DriverList, PositionSeries, CurrentTyres, TyreStintSeries). Validate at the provider boundary before normalization. Log and expose validation failures in `SystemStatus`.

---

### 3. Inter-Store Coordination Patterns Documentation

**Gap:** 23 Zustand stores exist with complex cross-store dependencies (sessionStore → syncStore → videoStore; strategyStore ← sessionStore's snapshot changes). No documented contract or pattern.

**Impact:** Low. Works now, but makes adding new stores or refactoring painful. Store-to-store calls are implicit and easy to miss in diffs.

**Effort:** Low. Add a `STORE_ARCHITECTURE.md` documenting: store responsibilities, permitted downstream callers, lifecycle hooks (initialization order, cleanup), and async coordination points (e.g., why sessionStore.selectSession must notify syncStore).

---

## Testing & Resilience

### 4. Critical Data Path Test Coverage Audit

**Gap:** Repos like `@renderer/core/engines/StrategyEngine`, `ErsEstimator`, `PitCycleModel`, and `TyreRead` have rich business logic but scattered/incomplete test coverage. The roadmap mentions these as P0 (trust-critical) but test depth is unclear.

**Impact:** Medium. These engines drive race-watching decisions (pit advice, ERS budget, degradation). An undetected drift in their logic could mislead viewers.

**Effort:** High. Run coverage reports for each critical engine; identify branches with <70% coverage. Add property-based or scenario-driven tests (e.g., "pit stop recommendation stays stable under 1-second data jitter").

---

### 5. Widget Composition & Prop Drilling

**Gap:** Complex widgets like `DriverDossier`, `StrategyInsightsPanel`, and `TyrePerformancePanel` pass many props through 2-3 levels of child components. Refactoring becomes error-prone.

**Impact:** Low. Doesn't break functionality but makes extending or splitting these widgets harder.

**Effort:** Medium. Create a `<WidgetContext>` pattern (or lean on sessionStore selectors) to reduce prop threading. Document preferred extraction points for large widgets.

---

## Code Quality & Maintainability

### 6. Track Map Architecture Documentation

**Gap:** `TrackMap.tsx` has been the source of many recent fixes (closure detection, outline generation, marker flicker, live-session geometry). No up-to-date design document explaining its multi-stage pipeline: raw positions → closed outline → projected markers → labels.

**Impact:** Low. The widget works, but future geometry or position-tracking bugs will require reverse-engineering its current state machine.

**Effort:** Low. Add a 2-3 page `TRACK_MAP_DESIGN.md` explaining: input data shapes, the closure/projection algorithm, marker animation lifecycle, and label layout rules. Reference the recent fix commits.

---

### 7. Provider Abstraction Boundary Tightness

**Gap:** The `DataProvider` interface is generic (snapshot output). `F1LiveProvider`, `OpenF1Provider`, and `DemoProvider` each handle enrichment, caching, and feed orchestration differently. Callers can't predict which provider-specific quirks apply.

**Impact:** Low. Works as long as all providers reach parity, but makes testing new providers hard.

**Effort:** Medium. Formalize a `ProviderContract` documenting: feed availability guarantees, cache invalidation rules, error retry behavior, and enrichment staging. Optionally move common patterns (cache, retry, enrichment) to a base class or mixin.

---

## Performance & Observability

### 8. Performance Monitoring for Snapshot Derivation

**Gap:** The roadmap calls for performance budgets (P1 item 17), but there's no live instrumentation for snapshot derivation time per tick. Regressions would only surface as user-reported UI stalls.

**Impact:** Medium. Without baseline metrics, optimization priorities are guesswork.

**Effort:** High. Add dev-mode timing hooks to `sessionStore.recompute()` and each critical engine (StrategyEngine, ErsEstimator, SectorDegradation). Export metrics to local storage. Build a simple dev dashboard showing p50/p99 derivation times over a session replay.

---

### 9. Memory Retention Audit for High-Rate Data

**Gap:** The codebase caps position/telemetry retention (bounded queues in FeedMemo), but no audit confirms that a full-race replay stays within reasonable heap bounds. GC pressure during long sessions is unknown.

**Impact:** Low. Hasn't been a reported issue, but long race replays or older machines could degrade.

**Effort:** High. Run a heapdump capture for a 2-hour race replay (50+ laps). Analyze retained data by type (position samples, telemetry, timing entries). Confirm retention is bounded and GC is not pathological.

---

## Accessibility & UX

### 10. Accessibility Audit for Color-Independent States

**Gap:** Roadmap item P2 30 (color-independent encoding) was shipped, but many widgets still rely on color-only state differentiation beyond the documented cases (tyre compounds, sectors, penalties). Verify across all widgets.

**Impact:** Medium. Color-vision-deficient users may miss critical state changes despite the P2 work.

**Effort:** Medium. Audit a representative widget set (TimingTower, TyrePerformancePanel, BattleRadar, StrategyInsights) for state encoding. Add patterns (icons, text labels, fill patterns) where color is the only encoding. Document the pattern in a design system guide.

---

### 11. Focus Management & Keyboard Navigation Consistency

**Gap:** StatusBar and some shell components have focus handling; dashboard widgets do not document their keyboard entry points. Dense tables (Timing Tower, tyre lists) lack tab order documentation.

**Impact:** Low. Keyboard-only users can navigate but not efficiently.

**Effort:** Medium. Audit the densest widgets for tab order and focus traps. Add documented keyboard shortcuts for common actions (focus next driver, expand dossier, seek to incident). Test with screen reader.

---

## Data Integrity & Error Messaging

### 12. Live Feed Stale Data Indicators Per-Driver

**Gap:** `SystemStatus` shows general feed staleness; individual timing/position/telemetry updates per driver aren't tracked. A driver's data could be 15+ seconds stale while others are live, unnoticed by the user.

**Impact:** Low. Affects race-watching precision but rarely critical unless a driver is having a critical moment.

**Effort:** Medium. Add a `lastUpdateTime` map per driver in the snapshot. Expose in `AvailDot` or a per-driver indicator in TimingTower. Fade or mark entries if their last update is older than the core feed's freshness threshold.

---

### 13. Pit Lane Entry/Exit Event Logging

**Gap:** The app can infer pit entry/exit from position and pit times, but no explicit pit-event log is generated or displayed. Users can miss pit cycles in telemetry-only views.

**Impact:** Low. Users can infer pits from race context but a UI timeline would be clearer.

**Effort:** Medium. Use `PitCycleModel` logic to emit pit-lane-event tuples (driver, lap in, lap out, duration, compounds before/after). Expose in a small panel or timeline scrubber overlay.

---

## State Management & Persistence

### 14. Session State Reset & Provider Switching Guarantees

**Gap:** Switching providers calls `setProvider()` which clears stores, but the cleanup isn't atomic. A mid-flight snapshot derivation could read stale data from a half-cleared store during the transition.

**Impact:** Low. Unlikely but possible edge case during rapid provider switches.

**Effort:** Low. Wrap `setProvider()` actions in an atomic update; use Zustand's batch API to ensure all store clears complete before recompute triggers.

---

### 15. Persist Store Recovery on Corruption

**Gap:** `persist.ts` handles localStorage serialization but has no recovery for corrupted data. If a store's persisted JSON is malformed, the app falls back to defaults silently.

**Impact:** Low. JSON corruption is rare, but users lose settings/layout without knowing why.

**Effort:** Low. Add a try-catch in `persist` with a recovery path: log the corruption, emit a `SystemStatus` warning, and offer a "Reset to Defaults" recovery action.

---

## Documentation & Onboarding

### 16. Component Library & Pattern Documentation

**Gap:** The UI component set (WidgetFrame, Badge, TyrePill, EmptyState, ErsBar, etc.) is used across 40+ widgets but has no centralized gallery or prop documentation.

**Impact:** Low. Makes new widgets harder to build consistently.

**Effort:** Low. Create a simple Storybook-style component showcase or a markdown guide showing each primitive's props, usage, and states (empty, loading, error, dark/light).

---

### 17. Engine Assumptions & Fallback Behavior Guide

**Gap:** Engines like `StrategyEngine`, `ErsEstimator`, `WeatherTrendEngine`, and `SectorDegradation` have complex heuristics but sparse inline documentation of assumptions (sample-size minimums, fallback values, confidence thresholds).

**Impact:** Medium. Helps future maintainers and prevents mis-use (e.g., applying strategy advice when the sample size is too small).

**Effort:** Medium. Add a structured comment block to each engine's export functions documenting: inputs required, minimum data points, fallback behavior when inputs are missing, confidence/source labels, and known limitations (e.g., "ERS model is calibrated for dry conditions").

---

## Feature Integration Points

### 18. Theme & Unit Preference Integration for Widgets

**Gap:** `ThemeEngine` and units preferences (shipped P3) exist but some widgets hardcode unit labels or don't respect theme tokens for derived colors (e.g., battery charge gradient, tyre wear bars).

**Impact:** Low. Theme/units work but adoption is inconsistent across widgets.

**Effort:** Low. Audit chart colors, tyre/battery fill gradients, and numeric labels in 5-10 widgets. Replace hardcoded values with theme tokens and unit formatters.

---

### 19. Plugin Sandbox Integration with Widget Lifecycle

**Gap:** `PluginSnapshotApi` exposes a snapshot reader but doesn't tie to individual widget lifecycles. A plugin can't easily subscribe to a specific driver's data changes or re-render when the layout changes.

**Impact:** Low. Plugins work but are limited to reading whole-snapshot state.

**Effort:** High. Extend `PluginSnapshotApi` with pub/sub for driver changes, layout events, and time-seek events. Document use cases.

---

## Monitoring & Diagnostics

### 20. Circuit-Specific Tuning Parameters Audit

**Gap:** `StrategyEngine` uses circuit-agnostic constants (PIT_LOSS_SEC, FRESH_TYRE_GAIN, OVERTAKE_RANGE). Per-circuit calibration exists for pit loss but not for tyre degradation curves or fuel consumption. Strategy advice accuracy likely drifts across circuits.

**Impact:** Medium. Strategy recommendations are generic; they'd be sharper with per-circuit tuning.

**Effort:** High. Analyze historical 2026 race data across 5-6 diverse circuits (Monaco, Monza, Spa, Singapore, Suzuka, Australia) to extract circuit-specific tyre degradation and fuel curves. Store as a lookup table; apply in engines.

---

### 21. Live Session Reconnection Backoff Strategy

**Gap:** `F1LiveSocket` has a retry loop but no documented backoff strategy. Network blips could cause rapid reconnection attempts or long dead time without a clear signal to the user.

**Impact:** Medium. During a glitchy network, the app's behavior is unpredictable.

**Effort:** Low. Implement exponential backoff with jitter and a max delay (e.g., 30s). Expose backoff state in `SystemStatus` so users see "retrying in 8s…".

---

## Code Patterns & Consistency

### 22. Nullable Data Handling Pattern Enforcement

**Gap:** The codebase uses `null` liberally (strong discipline visible in comments like "null over guess"), but some widgets and engines use optional chaining (`?.`) while others use explicit checks. Patterns are inconsistent.

**Impact:** Low. Works but makes diffs harder to read and mistakes easier.

**Effort:** Low. Document the pattern: prefer explicit `if (x == null)` checks at data boundaries; use `?.` only in short chains (≤2 deep). Add to TypeScript coding style guide.

---

### 23. Signal/Snapshot State Derivation Pattern

**Gap:** Widgets compute derived state from the snapshot in different ways: some use useMemo, others use custom hooks, others compute inline. No pattern guidance.

**Impact:** Low. Performance consistency suffers if hot paths aren't memoized uniformly.

**Effort:** Low. Add a guideline: all snapshot derivations that are called on every render should be wrapped in `useMemo` with `snapshot` as the dependency, not the whole store. Document and lint.

---

## Completeness

### 24. Telemetry Enrichment Completion Rate Visibility

**Gap:** Enrichment (position + telemetry derivation on the main process) is staged and can take minutes for a long race. No UI feedback shows how many laps have been enriched or when enrichment will complete.

**Impact:** Low. Users see warnings but can't track progress.

**Effort:** Medium. Add a simple progress bar or percentage in `SystemStatus` showing `Enriching: 2457 of 5000 laps`. Update live as chunks complete.

---

### 25. Missing Feeds / Optional Feed Fallback Documentation

**Gap:** Many feeds are optional (TyreStintSeries, WeatherDataSeries, TeamRadio, PitLaneTimeCollection, TlaRcm). If a provider doesn't fetch a feed, dependent widgets degrade silently. No UI or guide explains which features require which feeds.

**Impact:** Low. Happens mostly with archive/demo sessions where limitations are expected.

**Effort:** Low. Document in a `FEATURE_AVAILABILITY.md`: which feeds enable which features (e.g., "pit history requires PitLaneTimeCollection + CurrentTyres"). Link from tooltips in widgets.

---

## Summary

These 25 opportunities range from **low-effort documentation** (guides, comments, architecture docs) to **high-effort engineering** (schema validation, performance instrumentation, circuit-specific tuning). Grouped by priority:

- **Quick wins (low effort, medium-high impact):** #3 (store architecture doc), #6 (track map design doc), #13 (pit event log UI), #15 (persist corruption recovery), #16 (component library guide), #17 (engine documentation), #21 (reconnection backoff), #22 (nullable pattern), #25 (feature availability guide).

- **Medium effort, high impact:** #1 (error boundary), #4 (test coverage audit), #8 (perf monitoring), #10 (accessibility audit), #20 (circuit-specific tuning).

- **High effort but foundational:** #2 (feed schema validation), #9 (memory audit), #11 (keyboard nav).

Addressing the low-effort items first would pay immediate dividends in maintainability; medium-effort items strengthen resilience; high-effort items unlock the next layer of feature richness and accuracy.

---

## Implementation status

Updated after the batch-3 and follow-up passes. "Done" means the code and its tests exist in the working tree; it does not mean the item was exercised in a packaged build.

| # | Item | Status | Where |
|---|---|---|---|
| 1 | Error boundary for widget isolation | Done | `WidgetErrorBoundary` (auto-resets on a per-session-second key from `widgetRegistry.tsx`) plus a `RootErrorBoundary` in `App.tsx` |
| 2 | Schema validation for the F1 transform pipeline | **Open** | Boundary validation was added for persisted/imported settings and IPC arguments, not for the feed transforms |
| 3 | Store architecture doc | Done | `STORE_ARCHITECTURE.md` (now with §7, persistence safety) |
| 4 | Critical data path test coverage | Partial | ~280 tests added for the live socket, market/standings/practice services, OpenF1 provider, auth, IPC validation. Coverage `include` widened in `vitest.config.ts`, but `@vitest/coverage-v8` is not installed, so there are no coverage numbers or threshold yet |
| 5 | Widget composition / prop drilling | Open | |
| 6 | Track map design doc | Done | `TRACK_MAP_DESIGN.md` |
| 7 | Provider abstraction boundary | Open | Layering issues are catalogued in the architecture review (providers import a store, engines and providers import each other); no refactor yet |
| 8 | Snapshot derivation perf monitoring | Open | Hot paths were optimised (memoised engines, single publish per poll, replay checkpoints) but no in-app instrumentation was added |
| 9 | Memory retention audit | Partial | ERS points trimmed to the retained CarData window; retention constants shared between socket and provider; persisted track-path cache and radio transcripts bounded. Other feed topics are deliberately kept whole (they feed cumulative state) |
| 10 | Colour-independent state audit | Open | New indicators (stale marker, pit-log "In pit", error/success messages) are icon+text |
| 11 | Keyboard navigation consistency | Open | |
| 12 | Per-driver stale indicators | Done | `DriverFeedTracker`, `snapshot.driverFreshness`, `DriverStaleMarker` in `TimingTower.tsx` |
| 13 | Pit lane event log | Done | `PitEventLog.ts`, `PitEventLogPanel.tsx` (`pit-log` widget; not in any default preset) |
| 14 | Atomic provider switching | Done | `resetSessionScopedStores()` runs on a provider switch and on a successful load |
| 15 | Persist corruption recovery | Done | `config-recovery.ts` backs the file up **before** electron-store can overwrite it; surfaced through `persistStatusStore` and the status bar |
| 16 | Component library guide | Done | `COMPONENT_LIBRARY.md` |
| 17 | Engine assumptions guide | Done | `ENGINE_ASSUMPTIONS.md` |
| 18 | Theme/unit integration for widgets | Open | `performanceMode` now drops the backdrop blur on `WidgetFrame` panels only |
| 19 | Plugin sandbox lifecycle | Partial | A timed-out plugin worker is now terminated. **The plugin sandbox very likely cannot run in a packaged build**: the app CSP (`script-src 'self'`, no `blob:`, no `unsafe-eval`) blocks both the Blob Worker and `new Function`. The runner now reports that honestly. Whether to ship it, hide it, or bundle a real worker is a product decision |
| 20 | Circuit-specific tuning audit | Open | |
| 21 | Reconnect backoff | Done | `liveStore.ts`; the attempt counter was being reset by the retry itself, so delays never grew (fixed, with tests) |
| 22 | Nullable pattern | Done | `CODING_STYLE.md` |
| 23 | Snapshot derivation pattern | Open | |
| 24 | Enrichment completion visibility | Done | `describeEnrichmentProgress`; session time covered vs. duration, no percentage or ETA because no total is sent |
| 25 | Feed availability guide | Done | `FEATURE_AVAILABILITY.md` (its `file:line` references pre-date this pass and have drifted) |

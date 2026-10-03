# Widget Composition & Data Access

Scope: how the dashboard widgets in `src/renderer/widgets/` get their data today, where that is
wasteful or duplicated, and a concrete pattern to consolidate it. This is
IMPROVEMENT_OPPORTUNITIES.md item #5 ("Widget Composition & Prop Drilling"). Nothing here has been
implemented; the code samples in §5–§6 were type-checked against the current tree in a scratch
project (they compile) but are proposals, not files in the repo.

Measured on 2026-09-19 from the working tree, which other people were editing at the same time
(`TyrePerformancePanel`, `GapChart`, `LapTimeSeriesChart` and others changed while this was
written). Counts move; §9 has the commands to re-measure. Line numbers are hints (`~L`); search by
symbol. **Unverified** marks anything not confirmed by reading or running code.

Read first: [`SNAPSHOT_DERIVATION.md`](SNAPSHOT_DERIVATION.md) (what is stable inside a snapshot and
why), [`STORE_ARCHITECTURE.md`](STORE_ARCHITECTURE.md), [`COMPONENT_LIBRARY.md`](COMPONENT_LIBRARY.md)
§3–4 (frame/empty-state conventions, not repeated here), [`CODING_STYLE.md`](CODING_STYLE.md).

---

## 0. Summary

1. **The audit's premise is mostly not borne out.** No widget receives props from the dashboard
   (`WidgetRenderer` renders `<Component />`), no component receives `snapshot` as a prop, and the
   three widgets the audit names do not drill much: `StrategyInsightsPanel` has one child with one
   prop, `TyrePerformancePanel` has no child components, and `DriverDossier` passes pre-built model
   slices one level down (one 2-hop chain: `read.stintHistory` → `TyreHistoryDrawer`). The only
   chains that go past one hop are two `colorOf` callbacks (§4).
2. **The real cost is subscription granularity and repeated derivation, not prop threading.**
   29 of the 34 registered widgets subscribe to the whole `snapshot`, directly or through a shared
   hook, and the snapshot is a new object on every publish (4 Hz while playing). 21 `useMemo` calls
   are keyed on the bare snapshot and therefore recompute every publish. The same driver lookup is
   rebuilt in 15 places.
3. **Do not add a `<WidgetContext>` for snapshot data.** A React context cannot bail out per
   consumer, so every consumer would re-render on every publish, which is what the whole-snapshot
   subscriptions already do. Zustand selectors are the right mechanism; the fix is to use them
   narrowly (§5).
4. Two bugs found on the way (§7, ranks 1–2): a `useMemo` keyed on `snapshot` drives an effect that
   calls `practiceStore.load` on every publish and retries on every publish after a thrown error, and
   `WinProbabilityPanel`'s `matched` memo is keyed the same way.
5. Ten consolidations are ranked in §7. The first five are each half a day or less.

---

## 1. How widgets get data today

### 1.1 Access paths

| Path | Used by | Notes |
|---|---|---|
| `useSessionStore((s) => s.snapshot)` | 26 widgets directly | Re-renders on every publish (§2). |
| Same, through a hook in `lib/` | +3: `usePracticeBriefing` (2 widgets), `useFocusDriver` (9 widgets + `CommandBar`; 8 of the 9 also subscribe directly) | The hook's own whole-snapshot subscription re-renders every caller regardless of what it returns. |
| Narrow field selector | `AnnotationsPanel` (`clock`, `snapshot?.currentLap`, `snapshot?.drivers ?? EMPTY_ARRAY`), `TrackStatusBanner`, `TransportBar`/`SessionPicker` (`useShallow`), `CommandPalette` (`drivers`), `SettingsPage` (`drivers`), `ReplayView` (`availability.live`) | The pattern to copy; `AnnotationsPanel` still re-renders every tick because of `clock` and `useFocusDriver`. |
| Store *functions* as data sources | `getDriverLaps(n)` (6 widgets), `getTelemetry(n)` (3), `effectiveDataTime()` (`WinProbabilityPanel`), `getDiagnostics()` (`TrackMap`), `getRaceControlHistory()` (`SessionSyncController`, via `getState()`) | Non-reactive: they read the store at call time. `getDriverLaps` returns a **new array on every call**. |
| Shared UI hooks | `useSampledValue` (`WinProbabilityPanel` 1 s, `TelemetryTracePanel`), `useLastGood` (`GapChart`, `TelemetryTracePanel`), `useTyreColors` (2) | Rate-limit or bridge dropouts; orthogonal to the problem here. |
| Other stores | alerts, race story, engineer notes, radio, standings, market, strategy, settings (16 widgets read `settingsStore`), video, sync | Each owns its own state; no snapshot involvement. |
| Engines called in the widget body | 22 of 35 widget files import from `core/engines` (some for types only) | Called inside `useMemo([snapshot, ...])` or, in a few widgets, directly in render (§3.6). |

A widget therefore has no props, reads global state itself, and calls engines with the whole
`RaceSnapshot`. `WidgetRenderer` (`components/dashboard/widgetRegistry.tsx`) documents the intent: it
keeps the widget element reference stable "so React skips the widget itself; it still subscribes to
the stores it needs".

### 1.2 Per-widget table (34 registered widgets)

"Whole" = subscribes to `s.snapshot` (directly or via hook). "Fields" is what the widget body reads off
it. "Deps" describes the `useMemo` dependency style for the widget's main derivation.

| Widget | Snapshot access | Fields read / engine called | Deps |
|---|---|---|---|
| `tod-video` | none (video store) | — | — |
| `timing-tower` | whole | `timing`, `drivers`, `availability`, `currentLap`, `totalLaps`, `feedFreshness`, `driverFreshness` | `driverMap`: `[drivers]` (narrow); rows: `[snapshot, scope]` |
| `qualifying-monitor` | whole + `clock`, `duration`, `timeline`, `focusDriver` | `buildQualifyingBoard(snapshot)`, `buildQualifyingFocusProjection`, `drivers`, `laps`, `sessionClock` | `[snapshot]` ×3, `driverMap` `[drivers]` |
| `track-map` | whole + `focusDriver`, `playing` | `positions`, `timing`, `drivers`, `trackPath`, `feedFreshness`, `trackStatus`, `session`, `availability` | trace/outline: narrow; labels: `[dots, ...]` |
| `race-control` | whole | `raceControl`, `trackMessage`, `drivers`, `availability` | `driverMap`: `[drivers]`; list built in render |
| `team-radio` | whole | `teamRadio`, `drivers` | `[clips, favorites]` |
| `weather` | whole | `weather`, `weatherHistory`, `availability`; three trend engines called **in render** | none |
| `tyre-strategy` | whole | `stints`, `timing`, `drivers`, `currentLap`, `totalLaps` | `[snapshot]` |
| `gap-chart` | whole | `timing`, `drivers`, `availability` | narrow (`timing`, `drivers`) |
| `lap-time-chart` | whole + `getDriverLaps`, `focusDriver`, `comparison` | `laps`, `timing`, `drivers`, `availability` | in flux |
| `position-trend` | whole + `focusDriver`, `comparison` | `laps`, `lapPositions`, `timing`, `drivers` | option built per render (**unverified** whether memoised) |
| `driver-comparison` | whole + `getDriverLaps`, `getTelemetry` | `timing`, `drivers`, `sessionBests`, `clock`, `session` | `[timing, ...]`, `[snapshot, ...]` |
| `telemetry` | whole via `useSampledValue` + `getTelemetry` | `timing`, `drivers`, `session`, `availability` | `[focusDriver, snapshot?.timing]` |
| `strategy-insights` | whole + `getDriverLaps`, `useFocusDriver` | `StrategyEngine.generateInsights`, `pitNowAssistant` | `[snapshot, focusDriver, favorites]` |
| `pit-predictor` | whole + `getDriverLaps`, `useFocusDriver` | `StrategyEngine.predictPitStop`, `circuitPitLoss` | `[snapshot, driver]`; `driverMeta` `[drivers]` |
| `pit-log` | whole | `buildPitEventLog(snapshot)` | `[snapshot]`; drivers `[snapshot?.drivers]` |
| `stint-planner` | whole + `getDriverLaps`, `useFocusDriver` | `planRemainingStrategy`, `StrategyEngine.buildPitScenarios` | `[snapshot, driver]` ×2 |
| `pace-battle` | whole + `useFocusDriver` | `paceComparison`, `paceBattleBetween`, `timing`, `drivers` | **none**: engines and a driver `Map` run in render |
| `driver-dossier` | whole + `getDriverLaps`, `getTelemetry`, `useFocusDriver` | six engine calls (`predictPitStop`, `planRemainingStrategy`, `paceComparison`, `buildTyreRead`, `sectorDegradationTrend`, `buildPitStopHistory`) | `[snapshot, driver]` |
| `ai-engineer` | whole + `useFocusDriver` | `drivers` only | `[snapshot, focusDriver]` |
| `team-pace` | whole | `teamPace(snapshot)` (reads `laps`, `drivers`, fuel inputs) | `[snapshot]` |
| `tyre-lab` | whole | `compoundPerformance`, `bestTyrePerTeam` (reads `laps`, `stints`, `drivers`, `currentLap`, `totalLaps`, `session.type`) | narrow (in progress, with `eslint-disable`) |
| `win-probability` | whole + `effectiveDataTime()` + `useFocusDriver` | `WinProbabilityEngine.compute` on a 1 s sampled snapshot; `matchOutcomesToDrivers(result, drivers)` | `compute`: `[modelSnapshot]`; `matched`: `[snapshot, result]` |
| `championship` | whole + `currentSession` | `projectChampionship(championship, snapshot)` | `[championship, snapshot]` |
| `battle-radar` | whole + `useFocusDriver` | `computeBattles(snapshot, ...)` | `[snapshot, favorites]` |
| `race-story` | `hasSession` only | — (own store) | — |
| `engineer-notes` | `hasSession` only | — (own store) | — |
| `alerts` | none | — (own store) | — |
| `sync` | `currentSession`, `providerId`, `timeline` | `getRaceControlHistory()` via `getState()` on click | — |
| `practice-runs` | whole | `PracticeEngine.analyze(snapshot)` | `[snapshot]` |
| `practice-intelligence` | whole via `usePracticeBriefing` | `session`, `drivers` (request body) | see §7 rank 1 |
| `weekend-upgrades` | whole via `usePracticeBriefing` | same | same |
| `annotations` | narrow, but whole via `useFocusDriver` | `currentLap`, `drivers` | — |
| `plugins` | whole | `projectPluginSnapshot(snapshot, feeds)` **at click time only**; `availability` | — |

Counting: whole-snapshot subscribers are 26 direct + `practice-intelligence` + `weekend-upgrades` +
`annotations` = 29 of 34. Only `tod-video`, `race-story`, `engineer-notes`, `alerts` and `sync` avoid
the snapshot subscription entirely. The shell has the same issue in three always-mounted components:
`TitleBar` (reads only `trackStatus`, a string), `StatusBar` (reads `availability`, `currentLap`,
`totalLaps`, two array lengths, but also subscribes to `clock` so it re-renders every tick anyway) and
`CommandBar` (`timing`, `drivers`, plus `useFocusDriver`).

---

## 2. What actually re-renders, and why narrowing sometimes buys nothing

Mechanics (zustand 5 with `useSyncExternalStore`):

- A selector's result is compared with `Object.is`. A component re-renders only when the selected
  value changes.
- `sessionStore.recompute()` publishes a **new snapshot object every time**, so
  `useSessionStore((s) => s.snapshot)` re-renders on every publish. So does any `useMemo` that lists
  `snapshot` in its dependencies: it recomputes at the publish rate and saves nothing.
- A selector that returns a fresh object or array (`{ a, b }`, `x ?? []`) is treated as changed on
  every store update and, in zustand 5, can loop forever ("Maximum update depth exceeded", React
  #185). This is what crashed the app at launch (`lib/utils.ts` `EMPTY_ARRAY` comment). Two rules
  follow: use `EMPTY_ARRAY` for fallbacks, and wrap object-returning selectors in `useShallow`
  (already done in `TransportBar`, `SessionPicker`, `WinProbabilityPanel`).

Which snapshot fields are worth selecting narrowly depends on identity stability
(`SNAPSHOT_DERIVATION.md` §4):

| Select this | Buys re-render savings? |
|---|---|
| `drivers` | Yes on every provider. |
| `laps`, `stints` (with `currentLap`, `totalLaps`, `session.type` for fuel-aware engines) | Yes; stable between lap completions. F1 caveat: `stints` is new every call while a `CurrentTyres` gap-fill applies. |
| `raceControl`, `weatherHistory`, `teamRadio`, `lapPositions`, `sessionBests`, `pitLaneTimes`, `tyreStintHistory`, `currentTyres` | Yes on the F1 provider (memoised). On OpenF1/Demo `raceControl`/`weatherHistory` are new arrays every call, so no. |
| A primitive off any field (`trackStatus`, `currentLap`, `weather?.rainfall`, `availability.live`) | Yes on every provider. |
| `timing`, `positions`, `weather`, `availability`, `sessionClock`, `feedFreshness`, `driverFreshness` | No: new objects every call. Select a primitive from inside them, or accept the per-tick render. |

Engine-heavy focus-driver widgets (`DriverDossier`, `PitStopPredictor`, `StintPlanner`,
`StrategyInsightsPanel`, `PaceBattlePanel`, `WinProbabilityPanel`) depend on `timing` gaps, so they
legitimately change every publish. For them the saving is computing less per publish (§3.7), not
rendering less.

---

## 3. Where the same derivation is repeated

### 3.1 Driver lookup by number (15 `Map` builds, 24 code-fallback lines)

`new Map(snapshot.drivers.map((d) => [d.number, d]))` or a projection of it, rebuilt independently in:
`AnalyticsEngine` ×2 (`teamPace`, `bestTyrePerTeam`), `WinProbabilityEngine.compute`,
`radioNotifyStore`, and widgets `PaceBattlePanel` (in render, every render), `PitEventLogPanel`,
`PitStopPredictor`, `PositionTrendChart`, `QualifyingMonitor`, `TrackMap`, `TyreStrategyTable` (inside
a `[snapshot]` memo, so every tick), plus four bespoke projections: `GapChart`, `LapTimeSeriesChart`,
`RaceControlFeed` (code only), `TimingTower` (code/team/colour).

Only `TimingTower`, `PitEventLogPanel`, `PitStopPredictor`, `QualifyingMonitor` and `RaceControlFeed` key
theirs on `drivers` (which is stable). The rest rebuild it every publish or every render.

The display-code fallback `` driver?.code ?? `#${n}` `` appears on 24 lines in 20 files
(engines: `AlertEngine`, `BattleEngine`, `DebriefBuilder`, `EngineerNotesEngine`, `RaceBookmarks`,
`RaceStoryEngine`, `StrategyContext`, `WinProbabilityEngine`, `strategy/PaceBattle`,
`strategy/PitPrediction`, `strategy/StintPlanner`, `strategy/StrategyInsights`; stores
`radioNotifyStore`, `strategyStore`; widgets `AnnotationsPanel`, `BattleRadarPanel`,
`PaceBattlePanel`, `PitEventLogPanel`, `PitStopPredictor`, `TeamRadioPanel`).

### 3.2 Team colour

`hexColor(x.teamColour)` (fallback `#8A8F98`, `lib/utils.ts`) is called from 25 sites in 19
widget/shell files, each after its own lookup in §3.1. The normalisers already fill `teamColour`
from `teamColorFor` (`shared/constants.ts`) when the feed omits it, so the fallback is applied twice
with the same default.

### 3.3 Grouping laps and stints by driver

`AnalyticsEngine.lapsByDriver` is cached per `laps` array and exported as `driverLaps(snapshot, n)`.
Independent re-groupings that do not use it: `PositionTrendChart` (widget, per option build),
`FuelModel.fitCoefficient` (memoised by its wrapper), `strategy/PitLoss.estimatePitLoss` (memoised),
`DebriefBuilder` (one-off filter), `strategy/PaceBattle.paceDuelSide` (`snapshot.laps.filter` per
driver, per call, un-memoised). Stints by driver: `TyreStrategyTable` and `PitEventLog`.

### 3.4 The "clean lap" predicate and `numericGap`

`lapTime != null && lapTime > 0 && !isPitInLap && !isPitOutLap` is written out in eight files
(`AnalyticsEngine`, `FuelModel`, `PracticeEngine`, `strategy/PitLoss`, `strategy/StintLaps`,
`TyreRead`, `WinProbabilityEngine`, `DriverDossier`) with four near-variants (`QualifyingEngine`,
`SectorDegradation`, `RaceBookmarks`, `LapTimeSeriesChart`, which tests `!== null` and not `> 0`).
`numericGap` is defined three times (`PitCycleModel`, `strategy/StintLaps` exported,
`WinProbabilityEngine`). These are engine-level, but each widget that filters laps by hand copies the
same rule, so a change to what "clean" means has to be made in a dozen places.

### 3.5 Per-driver laps via `getDriverLaps`

Six widgets call `getDriverLaps(n)` (`DriverComparisonCard`, `DriverDossier`, `LapTimeSeriesChart`,
`PitStopPredictor`, `StintPlanner`, `StrategyInsightsPanel`, the last one once per watched driver
inside `generateInsights` plus once more for `pitNowAssistant`). Each call allocates a new array of
new `LapSample` objects (provider `.map`) and filters it again (store `.filter`), while
`snapshot.laps` already holds the same time-bounded data and `driverLaps(snapshot, n)` returns it
without allocating. The function is also left out of the `useMemo` dependency lists with an
`eslint-disable` in five places (`DriverDossier`, `PitStopPredictor`, `StintPlanner` ×2,
`StrategyInsightsPanel`), out of ten `exhaustive-deps` suppressions under `widgets/`.

### 3.6 Engines run in render with no memo

`WeatherPanel` calls `weatherFieldTrend` ×2, `rainTransition`, `dryingReadiness` in the function body,
over `weatherHistory` (a growing array on OpenF1/Demo). `PaceBattlePanel` calls `paceComparison` /
`paceBattleBetween` and builds its driver `Map` in the body. `RaceControlFeed` copies and reverses the
whole `raceControl` array on each render.

### 3.7 The same focus-driver projection computed by several widgets per tick

For one focus driver, with the "Strategy Wall" preset (`LayoutManager` `strategy-wall`) mounted:

| Call | Where | Per publish |
|---|---|---|
| `predictPitStop` | `DriverDossier`, `PitStopPredictor`, `pitNowAssistant` (`StrategyInsightsPanel`), `buildPitScenarios` (`StintPlanner`, which calls it twice, or once under a safety car) | up to 5 |
| `planRemainingStrategy` (searches 0/1/2-stop plans) | `DriverDossier`, `StintPlanner` | 2 |
| `paceComparison` | `DriverDossier`, `PaceBattlePanel` | 2 |
| `buildPitCycleField` (inside each `predictPitStop` that gets past its early returns; loops the whole field) | — | up to 5 |

The "Driver Focus" preset mounts the same set. None of these is memoised in the engine, and all take
the same snapshot object, which is shared by every subscriber within a publish. **Unverified:** the
cost per call was not measured; use the About page's snapshot-build and (dev build) widget-render
p50/p95 to size it before prioritising.

---

## 4. Prop drilling: what is there

Measured by listing every function component in `widgets/` and `components/shell/` with four or more
destructured props, then reading the widgets the audit names.

| Finding | Detail |
|---|---|
| Props passed by the dashboard | None. `WidgetRenderer` renders `<Component />`. |
| `snapshot` passed as a prop | None. (`BattleRadarPanel.codeOf(snapshot, n)` is a helper function, not a component.) |
| Most props on one component | `MarketStatus` in `WinProbabilityPanel`: 11 props, one hop, all derived locally. |
| Chains longer than one hop | `PitStopPredictor` → `PredictionBody(prediction, pitLoss, colorOf, codeOf)` → `RejoinLane(prediction, colorOf)`; `PaceBattlePanel` → `DuelSummary(duel, colorOf)` → `DuelSideCard(side, colorOf)`. Both thread a `colorOf(n)` closure over a driver `Map` two levels. |
| `DriverDossier` | Builds one `model` object in a 60-line `useMemo`, then passes slices: `TyrePanel(read, sectors)` → `TyreHistoryDrawer(stints)` (2 hops, one value), `PitHistoryPanel(stops)`, `BattleLine(...)`, `SpeedMarks(...)`. `ErsGauge` receives nine individual props copied from the `TimingEntry` (`energyPct`, `deployMode`, `energyIsEstimate`, `energyConfidence`, `energyDeploymentLimited`, `feedFreshness.CarData`, `energyTrend`, `energyTrendDeltaPct`, `energyDeployBudgetPct`). |
| `StrategyInsightsPanel` | `InsightRow({ ins })`: one prop. |
| `TyrePerformancePanel` | No child components. |

So: one repeated closure (`colorOf`/`codeOf`) that disappears once leaves can call a driver-index hook
(§5.2), and one wide flat prop list (`ErsGauge`) that would be tidier as a single `TimingEntry`-shaped
object. Extraction of `DriverDossier` is worth doing for size and testability, not for drilling
(§8).

---

## 5. Recommended pattern

Three small layers, all built on the zustand store that already exists. No new context.

### 5.1 A selector-hooks module (`src/renderer/store/snapshotSelectors.ts`, new)

One place that owns "how a widget reads the snapshot", so widgets never write
`useSessionStore((s) => s.snapshot)` unless they truly need the whole object.

```ts
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Driver } from '@shared/models'
import type { RaceSnapshot } from '@renderer/core/providers/types'
import { EMPTY_ARRAY, hexColor } from '@renderer/lib/utils'
import { useSessionStore } from './sessionStore'

/** Stable across ticks (see SNAPSHOT_DERIVATION.md 4.1). */
export const useDrivers = (): readonly Driver[] =>
  useSessionStore((s) => s.snapshot?.drivers ?? EMPTY_ARRAY)

/** Primitives re-render only when they change. */
export const useTrackStatus = () => useSessionStore((s) => s.snapshot?.trackStatus ?? 'UNKNOWN')
export const useHasSnapshot = () => useSessionStore((s) => s.snapshot != null)
```

Add one hook per identity-stable field a widget needs (`useRaceControl`, `useWeatherHistory`,
`useTeamRadio`, ...). Each is one line, and the file becomes the checklist of what is safe to select.

### 5.2 Lookup helpers cached on the identity that matters

```ts
export interface DriverIndex {
  get(n: number): Driver | undefined
  code(n: number): string   // "#n" when unknown, the same fallback used everywhere today
  colour(n: number): string // hexColor(teamColour) with the shared fallback
}

const indexCache = new WeakMap<readonly Driver[], DriverIndex>()

export function driverIndex(drivers: readonly Driver[]): DriverIndex {
  let index = indexCache.get(drivers)
  if (index == null) {
    const byNumber = new Map(drivers.map((d) => [d.number, d]))
    index = {
      get: (n) => byNumber.get(n),
      code: (n) => byNumber.get(n)?.code ?? `#${n}`,
      colour: (n) => hexColor(byNumber.get(n)?.teamColour ?? null)
    }
    indexCache.set(drivers, index)
  }
  return index
}

export const useDriverIndex = (): DriverIndex => driverIndex(useDrivers())
```

Engines that only have a snapshot call `driverIndex(snapshot.drivers)`. One `Map`, one `#n`
fallback, one colour fallback, and it is cached for as long as `drivers` is stable.

### 5.3 Engine input slices for lap-derived data

Widen the lap-based engines' parameter type from `RaceSnapshot` to the fields they read. A
`RaceSnapshot` still satisfies it structurally, so no existing caller changes.

```ts
// in FuelModel.ts (or a shared types file); memoizeOnLapInputs, estimateFuelCoefficient,
// compoundPerformance, bestTyrePerTeam, teamPace, compoundModel take LapInputs
export type LapInputs = Pick<
  RaceSnapshot,
  'laps' | 'stints' | 'drivers' | 'currentLap' | 'totalLaps'
> & { session: Pick<RaceSnapshot['session'], 'type'> }
```

and a hook that re-renders only when one of those actually changes:

```ts
const selectLapParts = (s: { snapshot: RaceSnapshot | null }) => {
  const snap = s.snapshot
  return snap == null ? null : {
    laps: snap.laps, stints: snap.stints, drivers: snap.drivers,
    currentLap: snap.currentLap, totalLaps: snap.totalLaps, sessionType: snap.session.type
  }
}

export function useLapInputs(): LapInputs | null {
  const p = useSessionStore(useShallow(selectLapParts))
  return useMemo(
    () => p == null ? null : {
      laps: p.laps, stints: p.stints, drivers: p.drivers,
      currentLap: p.currentLap, totalLaps: p.totalLaps, session: { type: p.sessionType }
    },
    [p]
  )
}
```

This replaces the hand-written, lint-suppressed dependency list that `TyrePerformancePanel` has
started to use (`[laps, stints, drivers, currentLap, totalLaps, sessionType]` with a callback that
still takes the whole `snapshot`). With the slice type, a missing input is a compile error instead of
a silent stale value.

### 5.4 A primitive-returning focus-driver selector

```ts
export function resolveFocusDriver(
  timing: RaceSnapshot['timing'] | undefined,
  focusDriver: number | null, selected: number | null, favorites: readonly number[]
): number | null { /* the body of today's useFocusDriver memo */ }

export function useFocusDriver(): number | null {
  const selected = useStrategyStore((s) => s.selectedDriver)
  const favorites = useSettingsStore((s) => s.favorites)
  return useSessionStore((s) => resolveFocusDriver(s.snapshot?.timing, s.focusDriver, selected, favorites))
}
```

The result is a number, so `Object.is` suppresses re-renders while the focus does not change. Today's
hook subscribes to the whole snapshot, so every caller re-renders each publish even though the answer
rarely changes; narrowing any widget that calls it is pointless until this is fixed.

### 5.5 Rules for widget authors

1. Subscribe to the smallest value that carries the identity or primitive you need (table in §2). If a
   widget needs the whole snapshot only on a user action, read it with `useSessionStore.getState()`
   inside the handler.
2. Never list a bare `snapshot` in a `useMemo` dependency array. List the identity-holding fields.
   If you need to suppress `exhaustive-deps`, the dependency list is probably wrong or the engine's
   input type is too wide (§5.3).
3. Never use `getDriverLaps` output as a dependency; it is new on every call.
4. Look drivers up through `driverIndex`; do not build another `Map`.
5. Return `EMPTY_ARRAY` for absent arrays; wrap object-returning selectors in `useShallow`.
6. If an effect calls the network or IPC, its dependencies must be values that change when the request
   changes, not the snapshot (§7 ranks 1–2).
7. Do not add a React context for snapshot-derived data. Use it, if at all, for static per-widget
   configuration.

---

## 6. Worked examples (real widgets)

### 6.1 `PluginsPanel`: the snapshot is needed only on click

Before (`widgets/PluginsPanel.tsx` ~L37 and ~L63):

```tsx
const snapshot = useSessionStore((s) => s.snapshot)          // re-renders 4x/s, incl. the code editor
...
const run = async (id: string, pluginSource: string, requiredFeeds: PluginFeed[]) => {
  if (!snapshot) return
  const missing = validatePluginManifest({ id, name: id, requiredFeeds }, snapshot.availability)
  ...
  const projected = projectPluginSnapshot(snapshot, requiredFeeds)
  const result = await runPlugin(pluginSource, projected)
```

After:

```tsx
const hasSnapshot = useSessionStore((s) => s.snapshot != null)  // boolean: re-renders on load/unload only
...
const run = async (id: string, pluginSource: string, requiredFeeds: PluginFeed[]) => {
  const snapshot = useSessionStore.getState().snapshot           // read at click time
  if (!snapshot) return
  ...same body...
```

`disabled={!snapshot || ...}` becomes `!hasSnapshot`. The widget re-renders on session load and
unload instead of at the publish rate. Also removes the stale-closure question (the run uses the
snapshot at the moment of the click). Same shape applies to `TitleBar` (only `trackStatus`; use
`useTrackStatus()`), and `AiRaceEngineer` (only `drivers` and a boolean).

### 6.2 `PaceBattlePanel`: driver lookup and a callback drilled two levels

Before (`widgets/PaceBattlePanel.tsx` ~L202, ~L274, ~L163):

```tsx
const meta = new Map(snapshot.drivers.map((d) => [d.number, d]))      // rebuilt every render
const colorOf = (n: number) => hexColor(meta.get(n)?.teamColour ?? null)
...
<DuelSummary duel={duel} colorOf={colorOf} />                          // → DuelSideCard colorOf={colorOf}
<RivalCard rival={battle.ahead} side="ahead" colorOf={colorOf} />
```

After:

```tsx
// leaf components read the (cached) index themselves; no callback crosses a component boundary
function DuelSideCard({ side }: { side: PaceDuelSide }) {
  const drivers = useDriverIndex()
  ...
  style={{ backgroundColor: drivers.colour(side.number) }}
}
<DuelSummary duel={duel} />
<RivalCard rival={battle.ahead} side="ahead" />
```

Removes the per-render `Map`, the `colorOf` prop from `DuelSideCard`, `DuelSummary` and `RivalCard`, and
the same pattern in `PitStopPredictor` (`colorOf`/`codeOf` through `PredictionBody` to `RejoinLane`).
`useDriverIndex()` re-renders the leaf only when `drivers` changes.

### 6.3 `TeamPacePanel`: a `[snapshot]` memo that never hits

Before (`widgets/TeamPacePanel.tsx` ~L10):

```tsx
const snapshot = useSessionStore((s) => s.snapshot)
const rows = useMemo(() => (snapshot ? teamPace(snapshot) : []), [snapshot])   // recomputes every publish
```

`teamPace` reads only `laps`, `drivers` and (via `estimateFuelCoefficient`) `stints`, `currentLap`,
`totalLaps`, `session.type`.

After (with `teamPace(inputs: LapInputs)`):

```tsx
const inputs = useLapInputs()
const rows = useMemo(() => (inputs ? teamPace(inputs) : []), [inputs])  // recomputes on lap completion
```

The component now re-renders and recomputes when a lap completes instead of four times a second. The
same change fits `TyrePerformancePanel`, `PositionTrendChart`, `TyreStrategyTable` (stints/timing) and
`LapTimeSeriesChart`. Caveat from `SNAPSHOT_DERIVATION.md` §4.3.1: on the F1 provider, while a
`CurrentTyres` gap-fill applies, `stints` is a new array every call, so widgets that depend on it
still recompute each publish until the provider memoises that array.

### 6.4 `usePracticeBriefing`: a `snapshot` memo that drives an effect

Before (`lib/usePracticeBriefing.ts`):

```ts
const snapshot = useSessionStore((state) => state.snapshot)
const request = useMemo(() => snapshot ? { year: snapshot.session.year, ..., drivers: snapshot.drivers.map(...) } : null, [snapshot])
useEffect(() => { if (request) void store.load(request) }, [request, store.load])
```

`request` is a new object on every publish, so the effect runs on every publish.
`practiceStore.load` returns early only while `loading` or a `result` is set (it compares a
key), so after a **thrown** error (`result: null, loading: false`) the request is retried on every
publish, and with no bridge it calls `set({ error })` on every publish. Two widgets use the hook.

After: select `session.year/meetingName/countryName/dateStart` and `drivers` separately (or select the
already-computed request key) and memoise `request` on those, so the effect runs when the request
changes. **Unverified in the running app**; established by reading `usePracticeBriefing` and
`practiceStore.load`.

---

## 7. Ranked consolidations

Effort: S = about half a day or less, M = one to two days, L = three or more. "Gain" is the
expected benefit; none of these has been measured. Rank weighs correctness first, then breadth.

| # | Consolidation | Evidence | Effort | Gain | Risk |
|---|---|---|---|---|---|
| 1 | Key snapshot-derived requests on the values they contain, not on `snapshot`: `usePracticeBriefing`'s `request`; `WinProbabilityPanel`'s `matched` (`[snapshot, result]` → `[result, drivers]`) | §6.4. `matched` is a new `Map` every publish (fuzzy-matches every market outcome against every driver) and is a dependency of the effect that calls `loadHistory` for every driver token, which retries per publish for tokens whose history request threw (`marketStore.loadHistory` catch path records no entry) | S | Removes a per-publish IPC retry and two per-publish computations; fixes a latent bug | Low; effects run less often, so test the initial load and a session switch |
| 2 | Primitive-returning `useFocusDriver` (§5.4) | 9 widgets + `CommandBar`; prerequisite for narrowing the widgets in rank 4 | S | Unblocks rank 4; no direct saving for widgets that already subscribe to the snapshot | Low; same resolution rule, unit-testable as a pure function |
| 3 | `driverIndex` / `useDriverIndex` with `code()` and `colour()` (§5.2); replace the 15 `Map` builds, 24 `#n` fallbacks and, over time, the 25 `hexColor(x.teamColour)` calls | §3.1–3.2 | M (mechanical; 14 files) | One definition of the fallback code/colour; removes per-render/per-tick map builds in `PaceBattlePanel`, `TyreStrategyTable`, `TrackMap`, `PositionTrendChart` | Low; do widgets first, engines after (engines keep their own `codeOf` until touched) |
| 4 | Narrow the subscription of widgets whose inputs are identity-stable: `PluginsPanel` (`getState` at click), `TitleBar` (`trackStatus`), `AiRaceEngineer` (`drivers`), `WeatherPanel` (`weatherHistory` + primitives; also memoise its three trend calls), `RaceControlFeed` (`raceControl`, `trackMessage`, `drivers`), `TeamRadioPanel` (`teamRadio`, `drivers`) | §1.2, §2, §3.6. Savings are real on the F1 provider; on OpenF1/Demo `raceControl`/`weatherHistory` are re-created every call | S each, M together | Removes ~6 whole-widget re-renders per tick (`RaceControlFeed` re-renders its whole message list; `WeatherPanel` re-runs its trend engines) | Low; each widget's read set was checked from its source, but re-check when editing |
| 5 | Engine input slices + `useLapInputs` (§5.3) for `TeamPacePanel`, `TyrePerformancePanel`, `PositionTrendChart`, `TyreStrategyTable`, `LapTimeSeriesChart` | §6.3; replaces the `eslint-disable` dependency list | M | Those widgets recompute on lap completion instead of every publish | Low-medium; type-only change to engines, plus the `stints` gap-fill caveat |
| 6 | Cached per-driver laps for widgets: a `useDriverLaps(n)` on `snapshot.laps` (using the `lapsByDriver` cache) in place of `getDriverLaps(n)` in `DriverDossier`, `DriverComparisonCard`, `LapTimeSeriesChart`, `PitStopPredictor`, `StintPlanner`, `StrategyInsightsPanel` | §3.5. Removes an array + N `LapSample` allocations per driver per publish per widget | M | Less allocation; stable dependency for those memos | Medium: `getDriverLaps` and `snapshot.laps` differ for OpenF1 laps without a start date, and `generateInsights` takes a `(n) => LapSample[]` callback. Verify parity with a test on OpenF1 fixtures first |
| 7 | Share the focus-driver projections across co-mounted widgets: a `WeakMap` keyed on the snapshot object (one snapshot per publish, shared by all subscribers) for `predictPitStop`, `planRemainingStrategy`, `paceComparison` | §3.7: up to 5 / 2 / 2 calls per publish for one driver | M–L (the engines take a `laps` argument today; it must come from the snapshot to key safely) | Cuts the largest per-publish CPU cost in the strategy layouts, **if** measurement says it matters | Medium; needs equivalence tests (`engine-memo-characterization.test.ts` shows the pattern). Measure first |
| 8 | One clean-lap predicate and one `numericGap` (export from `AnalyticsEngine`/`StintLaps`, import everywhere); route the remaining lap/stint groupings through the cached helper (`PositionTrendChart`, `paceDuelSide`, `DebriefBuilder`) | §3.3–3.4: 8 exact copies + 4 variants; 3 `numericGap`s | S–M | Consistency; `paceDuelSide` and `PositionTrendChart` stop regrouping per publish | Low; the variants may be deliberate (e.g. `SectorDegradation` filters per sector) so review each |
| 9 | Remove the 2-hop `colorOf`/`codeOf` closures (`PitStopPredictor`, `PaceBattlePanel`); give `ErsGauge` a single `TimingEntry`-shaped `energy` prop | §4, §6.2 | S (after rank 3) | Fewer props; leaves stay decoupled from the parent | Low |
| 10 | Extract `useDriverDossierModel(driver)` and section components from `DriverDossier`; give `WinProbabilityPanel`'s market matching/history its own hook | §8 | M | Testability; a place to memoise the six engine calls (rank 7) | Low; `render-budget.test.ts` covers the mount commit count |

Ranks 1–4 need no design decisions and touch few files. Rank 6 and rank 7 are the ones to measure
before committing.

---

## 8. Preferred extraction points for the large widgets

The audit asks for these to be documented. Sizes are at the time of writing.

| Widget (lines) | Extract | Leave in place |
|---|---|---|
| `DriverDossier` (~470) | The `useMemo` that builds `model` (six engine calls) into `useDriverDossierModel(driver)` returning `null`/model; `DossierRadioList` and the identity header into their own files under `widgets/driverDossier/` next to `TyrePanel`, `PitHistoryPanel` | The driver picker and the section order; `pickDriver` stays a store action |
| `WinProbabilityPanel` (~430) | Market matching + history + `syncOdds` state (`matched`, `replayFairByDriver`, the two effects) into `useMarketOdds(snapshot.drivers, session)`; `MarketStatus` already is a component | The model table and metric switch |
| `TrackMap` (~420) | Already split into `trackMap/` (outline, labels, tracking); extract the dot-building block (coordinate vs schematic mode) into a pure function beside `positionTracking.ts` | The SVG frame and animation config |
| `SessionSyncController` (~400) | Not reviewed in depth. It calls `buildCandidates(getRaceControlHistory(), ...)` from two handlers, which suggests one helper | Everything else |

Rule of thumb: a hook that returns a model (`use...Model`) holds derivation and subscription; a
component that takes the model and renders holds markup. That matches how `DriverDossier` already
passes `TyreReadModel`/`SectorDegradationPoint[]` to `TyrePanel`.

---

## 9. Re-measuring

Whole-snapshot subscribers (direct):

```sh
grep -rln "useSessionStore((s) => s.snapshot)\|useSessionStore((state) => state.snapshot)" src/renderer/widgets
```

`useMemo`/`useCallback` dependency lists (paste into a scratch `.js` file, run with
`node memos.js src/renderer/widgets | grep -E "deps=\[([^]]*[ ,])?snapshot"`):

```js
const fs = require('fs'), path = require('path')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
for (const f of walk(process.argv[2]).filter((f) => /\.tsx?$/.test(f))) {
  const s = fs.readFileSync(f, 'utf8'), re = /use(Memo|Callback)\(/g
  let m
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length, depth = 1
    while (i < s.length && depth > 0) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; i++ }
    const dm = /,\s*\[([^\[\]]*)\]\s*\)$/.exec(s.slice(m.index, i))
    console.log(path.relative(process.argv[2], f) + ':' + s.slice(0, m.index).split('\n').length + ' deps=[' + (dm ? dm[1].trim() : '?') + ']')
  }
}
```

Duplicated lookups:

```sh
grep -rn "new Map(.*drivers" src/renderer          # driver Map builds
grep -rn '?? `#${' src/renderer                    # code fallback
grep -rn "hexColor(" src/renderer/widgets src/renderer/components
grep -rn "isPitOutLap" src/renderer/core src/renderer/widgets   # clean-lap predicate copies
```

To size the per-publish cost before ranks 6–7: run the app, open About, read the snapshot-build and
fan-out p50/p95 (`DerivationTimings`), and use a dev build to read `widgetRender` (React Profiler
`actualDuration`, populated only in development).

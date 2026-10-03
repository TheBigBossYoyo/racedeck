# Snapshot Derivation Guide

Scope: how a `RaceSnapshot` is built and published, what is cached and where, which identity
guarantees consumers can rely on, and what to check when adding a derived field or an engine.
This is IMPROVEMENT_OPPORTUNITIES.md item #23 ("Signal/Snapshot State Derivation Pattern").

Everything below was checked against the working tree on 2026-09-19, which already contains the
day's changes: `F1LiveProvider` replay checkpoints and memoised `drivers`, the engine memos in
`FuelModel`/`AnalyticsEngine`/`strategy/PitLoss`, and the single-publish-per-poll path in
`sessionStore`/`liveStore`. Line numbers are hints (`~L`); several of these files were still being
edited while this was written, so search by symbol name. Where something could not be verified it
is marked **unverified**.

Companion docs: [`STORE_ARCHITECTURE.md`](STORE_ARCHITECTURE.md) (store graph),
[`ENGINE_ASSUMPTIONS.md`](ENGINE_ASSUMPTIONS.md) (engine fallbacks),
[`CODING_STYLE.md`](CODING_STYLE.md) (nullability), [`WIDGET_COMPOSITION.md`](WIDGET_COMPOSITION.md)
(how widgets should consume what is described here).

---

## 0. Summary

1. `sessionStore.recompute()` asks the active provider for a **new `RaceSnapshot` object every
   time** (`getSnapshotAt(t)` returns a fresh object literal in all three providers). The snapshot
   object's identity therefore changes on every publish (every 250 ms while playing, 600 ms in
   performance mode, plus seeks and live polls). The *fields inside it* have very different
   lifetimes; that is what the contracts in §4 pin down.
2. **`useMemo(fn, [snapshot])` never saves work.** The dependency changes on every publish, so the
   memo recomputes every time. The guideline written in `CODING_STYLE.md` ("wrap in `useMemo`
   keyed on `snapshot` itself") is correct as a *style* rule but has no performance effect; the real
   caching lives in the provider (`FeedMemo`, lap/stint caches) and in the engines (`WeakMap`
   keyed on the `laps` array). To get a memo hit, key on the field that actually holds the
   identity (`snapshot.laps`, `snapshot.drivers`, ...), not on the snapshot.
3. The identity guarantees that exist today are: `drivers` (all providers), `laps` and `stints`
   (between lap completions / app-data merges), the `FeedMemo` feeds on the F1 provider, and
   `driverFreshness`/`feedFreshness` being `undefined` outside a live F1 session. They are pinned
   by tests listed in §8. Several are weaker than they look (§4.3).
4. Shared results returned by `AnalyticsEngine`/`FuelModel`/`PitLoss` (and every array in a
   snapshot) are **read-only by convention only**: the types are mutable and nothing is frozen
   (§5).
5. Engines are keyed on `laps` identity, so any code that copies or re-filters `snapshot.laps`
   before calling an engine silently defeats the memo (§3.3, §4.3).

---

## 1. The pipeline

```
 feeds (main-process IPC / OpenF1 REST / bundled sim)
        │  ingest once per load or live poll        (provider-private caches)
        ▼
 DataProvider.getSnapshotAt(t)      ← pure-ish function of (feeds, t); builds a NEW RaceSnapshot
        ▼
 DataProviderManager.getSnapshotAt  ← pass-through to the active provider
        ▼
 sessionStore.recompute()           ← set({ snapshot })  then  4 ingest fan-outs
        ▼
 widgets: useSessionStore(selector) ← re-render when the selected value changes (Object.is)
```

### 1.1 Who calls `getSnapshotAt`

| Caller | Time argument | Notes |
|---|---|---|
| `sessionStore.recompute()` (~L370) | `effectiveDataTime()` = playhead clock shifted by the sync offset | The only call that feeds `state.snapshot`. Wrapped in a try/catch that sets `error`. |
| `sessionStore.selectSession` (~L241) | `duration` | Builds `bookmarks` once per session load from a whole-session snapshot. |
| `sessionStore.getRaceControlHistory()` / `getFullSnapshot()` | `duration` | Whole-session reads (sync wizard, comparison library, exports). |
| `sessionStore.getDriverLaps()` fallback | `effectiveDataTime()` | Only when `state.snapshot` is still `null`. |

A request at or past the session end is a *whole-session read*. `F1LiveProvider` gives those their
own replay cursor (`viewFor`, ~L1290) so they never drag the playhead's; `OpenF1Provider` and
`DemoProvider` have no such split (see §4.3, item 5).

### 1.2 Publish cadence

- **Playback:** `play()` runs a `setInterval` (250 ms, or 600 ms with `performanceMode`). Each
  tick does `set({ clock })` and then `recompute()` (`set({ snapshot })`): two store notifications,
  one snapshot build.
- **Seek / step:** `seek()` does `set({ clock, recentSeeks })` then `recompute()`.
- **Live poll (`liveStore.runPoll`, ~L195):** `reloadSession({ deferPublish: true })` extends
  `duration`/`timeline` but does not publish; `followLiveEdge` then calls `seek` inside
  `asProgrammaticSeek`, which publishes the poll's one snapshot and does not record a
  `recentSeeks` entry. Before this change a poll built, fanned out and rendered the same frame
  twice. Pinned by `tests/unit/live-single-publish.test.ts`.
- **Provider background updates:** `manager.setUpdateListener` (bottom of `sessionStore.ts`) calls
  `recompute()` whenever the active provider fires `onUpdate` (enrichment progress; throttled to
  `ENRICHMENT_NOTIFY_MIN_MS` = 300 ms in `F1LiveProvider`, except forced notifications on completion or failure). These publishes are independent of the
  poll cadence, so "one snapshot per poll" does not mean "one per 250 ms tick".
- **Fan-out after each publish:** `useAlertStore`, `useRaceStoryStore`, `useEngineerNotesStore`,
  `useRadioNotifyStore` each `ingest(snapshot)` synchronously. Their bookkeeping (`prevSnapshot`
  etc.) is module-level, not reactive (see `STORE_ARCHITECTURE.md` §1).
- **Timing:** `recordDerivation(buildMs, fanOutMs)` (`DerivationTimings.ts`) keeps a 240-sample ring
  of each; `getDerivationTimingStats()` is read by `AboutPage`. `snapshotBuild` covers
  `getSnapshotAt` plus `set({ snapshot })`, so it includes the synchronous notification of
  subscribers but not React's later render. `widgetRender` (React Profiler) is only populated in
  a dev build.

---

## 2. How each provider builds a `RaceSnapshot`

`RaceSnapshot` is declared in `core/providers/types.ts` (~L49). Required fields: `session`,
`drivers`, `timing`, `laps`, `stints`, `raceControl`, `weather`, `weatherHistory`, `positions`,
`availability`, `clock`, `currentLap`, `totalLaps`, `trackStatus`. Everything else is optional and
means "this provider does not carry that feed" (`undefined`), which is different from "the feed is
empty" (`[]`).

### 2.1 Field sources

| Field | `F1LiveProvider` (live + archive) | `OpenF1Provider` | `DemoProvider` |
|---|---|---|---|
| `session` | `normalizeSessionInfo(data.summary)`, **rebuilt on every `ingest`** (load or live poll) | set at load | set at load |
| `drivers` | `view.memos.drivers` = `mergeTopThreeDrivers(this.drivers, topThreePoints, clock)`; `this.drivers` re-normalised only when a `DriverList` point merged | `this.drivers` (load-time) | `driverCache` (load-time) |
| `timing` | `buildTiming(view.timing, view.app, drivers, raceControl)` **every call**; then `applyCurrentTyres` and `attachErs` mutate the fresh entries | `drivers.map(buildTiming)` every call, sorted every call | built every call |
| `laps` | `lapsUpTo(view, clock)`: cached per view, key = per-driver completed-lap counts | `allLapsUpTo(wall)`: single cache, same key scheme | `allLapsUpTo(progs)`: single cache, same key scheme |
| `stints` | `applyCurrentTyresToStints(stintsAtCurrentState(view), currentTyres)`; cache keyed on `view.appStateVersion` | `stintCache` = `allStints()`, built once at load, **whole session, not clipped to `t`** | `stintCache`, built once at load, whole session |
| `raceControl` | `FeedMemo` over `RaceControlMessages` | `.filter` on every call | `.filter` on every call |
| `weather` | `weatherAt(nearestAtOrBefore(...))` builds a **new object every call** | element of the source array (stable object) | element of the source array (stable object) |
| `weatherHistory` | `FeedMemo` over `WeatherData` | `.filter` on every call | `.filter` on every call |
| `positions` | `positionsAt(clock, timing)` every call (interpolated x/y) | built every call (`lapProgress` only, x/y null) | built every call |
| `trackPath` | `this.trackPath` reference; replaced only when `adoptTrackPath` succeeds | absent | absent |
| `lapPositions`, `sessionBests`, `pitLaneTimes`, `teamRadio`, `currentTyres`, `tyreStintHistory` | one `FeedMemo` each | absent | absent |
| `trackMessage` | `FeedMemo` (string or null) | absent | absent |
| `feedFreshness`, `driverFreshness` | only when `session.id === 'live'`, new objects every call | absent | absent |
| `availability` | new object every call | new object every call | new object every call |
| `sessionClock`, `qualifyingPart` | from `sessionClockPoints` / `view.timing` | absent | absent |
| `currentLap`, `totalLaps`, `trackStatus` | `LapCount`/`TrackStatus` feeds, `totalLaps` from `deriveTotalLaps()` at ingest | derived | constants / sim |

### 2.2 `F1LiveProvider` in more detail

The F1 provider holds two `ReplayView`s (`playhead`, `wholeSession`, ~L319), each with its own
merged-timing cursor and its own caches. A backward seek restores the nearest of up to
`MAX_CHECKPOINTS` = 240 merged-state checkpoints spaced `CHECKPOINT_INTERVAL_SEC` = 60 s apart
(`advanceTo`/`rewind`, ~L1301/L1325), so at most 60 s of timing is re-merged instead of the whole
session. Past the 240th checkpoint (about four hours of session time) `nextCheckpointT` returns
`null` and seeks re-merge from the last one. Each checkpoint stores `structuredClone`s of the merged
`timing` and `app` state, so they are the provider's main memory cost.

Ingest is incremental for a live session (`continuing = true`): rolling builds (`lapBuild`,
`driverBuild`, `ersBuild`) and the playhead cursor survive between polls, and only newly appended
points are processed. A fresh session replaces the builds and calls `resetFeedMemos()`.
`resetCursor()` (backward seek to before the first checkpoint) resets the cursor and the lap/stint
caches but **not** the `FeedMemo`s, because those are keyed by data, not by cursor position.

Stream arrays are appended **in place** once the provider owns a copy (`appendToStream`, ~L684),
and the two high-rate topics are trimmed in place (`trimHighRateStream`). No cache may therefore
key on a stream array's identity or length alone; `FeedMemo` keys on the prefix length plus the last
point *object*.

The lap and stint caches:

- `lapsUpTo` (~L1374): key is `completedCounts.join(',')` (one count per driver). Same key ⇒ same
  array. `ReplayView.invalidateDerived()` (called from `resetCursor`/`restore`) clears the cache, so
  identity changes after any backward seek even if the counts did not.
- `stintsAtCurrentState` (~L1396): key is `view.appStateVersion` (number of `TimingAppData` points
  merged). Then `applyCurrentTyresToStints` returns the *same* array when no gap-fill applies, and
  a *new* array when one does (see §4.3, item 1).
- `pitLapIndex()` (~L1181): cached on the number of `PitLaneTimeCollection` points.
- `timelineCache`: rebuilt at each ingest.

### 2.3 `OpenF1Provider` and `DemoProvider`

Both rebuild `timing`, `positions`, `raceControl` and `weatherHistory` from scratch per call. Both
cache `laps` on the completed-count key with a **single** cache slot, and both build `drivers` and
`stints` once at load. Neither has `FeedMemo`, checkpoints or a whole-session cursor.
`DemoProvider` is deterministic and synthetic (57 laps, `Autódromo Virtuale`).

---

## 3. What is memoised, and where

### 3.1 Inventory

| Layer | Mechanism | Key | Protects | Invalidated when |
|---|---|---|---|---|
| Provider | `FeedMemo` ×10 per `ReplayView` (`newSnapshotMemos`, ~L1780) | count of stream points `≤ clock`, identity of the last one, optional `deps` | `raceControl`, `drivers`, `currentTyres`, `tyreStintHistory`, `weatherHistory`, `lapPositions`, `sessionBests`, `pitLaneTimes`, `teamRadio`, `trackMessage` | a point is added at or before `clock`; the last consumed point object changes; a listed dep changes (`drivers` depends on `this.drivers`, `teamRadio` on `feedPath`); `resetDerived()` on a new session |
| Provider | `lapCache` (per view on F1; single on OpenF1/Demo) | per-driver completed-lap counts | `snapshot.laps` identity | any driver completes a lap; cursor reset/restore (F1) |
| Provider | `stintCache` | `appStateVersion` (F1) / none (OpenF1, Demo: whole session) | `snapshot.stints` identity | app-data merge (F1) |
| Provider | `pitLapIndexCache`, `timelineCache`, `trackPath` | pit point count / per ingest / per adoption | pit-lap flags, scrubber timeline, circuit outline | see §2.2 |
| Provider | merge checkpoints | session time (60 s grid) | backward seeks | fresh session |
| Engine | `lapsByDriverCache` (`AnalyticsEngine.ts` ~L76) | `WeakMap` on the `laps` array | per-driver grouping used by `driverLaps`, `teamPace`, `driverRecentPace`, ... | new `laps` array |
| Engine | `memoizeOnLapInputs` (`FuelModel.ts` ~L131), used by `estimateFuelCoefficient` and `compoundPerformance` | `WeakMap` on `laps`, plus `stints` identity, `currentLap`, `totalLaps`, `session.type` compared on hit | fuel fit, compound rows | any of those five inputs differs; one entry per `laps` array, so a second snapshot with the same `laps` but different `stints` overwrites the first |
| Engine | `pitLossByLaps` (`strategy/PitLoss.ts` ~L169) | `WeakMap` on `laps` only | `circuitPitLoss` | new `laps` array |
| Widget | `useMemo` | dependency array | anything | see §3.3 |
| Widget | `useSampledValue(value, ms, identity)` | time | `WinProbabilityPanel` (1 s), `TelemetryTracePanel` | interval elapsed or `identity` changed |
| Widget | `useLastGood(value, graceMs)` | last non-null value, 5 s grace | chart dropouts | grace expires |
| Shell | `WidgetRenderer` (`widgetRegistry.tsx`) | `widgetKey`; error boundary `resetKey` = `sessionId:floor(clock)` | keeps the widget element reference stable across the once-a-second wrapper re-render | widget key changes |

`memoizeOnLapInputs` documents its own contract: `compute` "must read nothing else off the
snapshot", and the returned value "is shared between callers: treat it as read-only".

### 3.2 What is **not** memoised

These recompute on every call, i.e. once per consumer per publish:

- Everything in `StrategyEngine` except `circuitPitLoss`: `predictPitStop`, `buildPitScenarios`,
  `planRemainingStrategy`, `generateInsights`, `pitNowAssistant`, `paceComparison`,
  `paceBattleBetween`. `buildPitScenarios` runs `predictPitStop` twice.
- `AnalyticsEngine.teamPace`, `bestTyrePerTeam`, `driverRecentPace`, `compoundModel` (it wraps the
  memoised `compoundPerformance` but builds a new `Map` each call).
- `WinProbabilityEngine.compute`, `buildTyreRead`, `buildPitStopHistory`, `buildPitEventLog`,
  `PracticeEngine.analyze`, `buildQualifyingBoard`, `computeBattles`, `projectChampionship`.
- In the F1 provider: `buildTiming`, `positionsAt`, `weatherAt`, `attachErs` (including
  `deriveEnergyTrend` per driver), and `sessionClockRemainingAt` (a linear scan of the clock points;
  the point count was not measured).

In `planRemainingStrategy`, `snapshotWithKnownLaps` (`strategy/StintLaps.ts`) returns the snapshot
itself when no lap needs dropping and `{ ...snapshot, laps: filteredCopy }` otherwise. In the second
case the `laps` identity is new on every call, so the `WeakMap`s above miss. Whether this happens
in practice depends on `LapSample.sessionTime` vs `snapshot.clock` for the provider in use
(**unverified**).

### 3.3 The `useMemo([snapshot])` problem

`useMemo` with `snapshot` in its dependency list recomputes at the publish rate. At the time of
writing 21 `useMemo` calls in `src/renderer/widgets/` depend on a bare `snapshot`/`modelSnapshot`
(measured with the script in [`WIDGET_COMPOSITION.md`](WIDGET_COMPOSITION.md) §9; the count moves as
widgets are edited). Widgets that key part of their work on narrow dependencies so far are `TimingTower`
(`driverMap` on `[snapshot?.drivers]`), `PitEventLogPanel`, `RaceControlFeed`,
`QualifyingMonitor` and `PitStopPredictor` (driver maps on `drivers`), `GapChart`
(`timing`/`drivers`) and, in progress, `TyrePerformancePanel`
(`[laps, stints, drivers, currentLap, totalLaps, sessionType]` with an `eslint-disable` because the
callback still receives the whole `snapshot`). Correct memoisation needs the dependency list to be
exactly the set of fields the engine reads, which is the reason for the input-slice types proposed
in `WIDGET_COMPOSITION.md` §5.3.

`useSessionStore(s => s.snapshot)` re-renders the subscriber on every publish for the same reason,
regardless of what the component then does with it.

---

## 4. Identity-stability contracts

"Stable" means `Object.is(a, b)` between two consecutive `getSnapshotAt` calls within the same
loaded session and the same feed contents. Tests that pin a contract are named in the last column.

### 4.1 Field table

| Field | Guarantee (F1Live) | Guarantee (OpenF1 / Demo) | Pinned by |
|---|---|---|---|
| `snapshot` | never stable | never stable | — |
| `session` | stable between ingests; **new object at every live poll**. `totalLaps` is assigned on it right after creation, before publish | stable | — |
| `drivers` | stable across polls that carry no `DriverList` change and no new `TopThree`-only driver; a new array (same content plus the gap-filled driver) otherwise | stable for the whole session | `f1-live-ingest.test.ts` ~L87 (`keeps the same drivers array across polls`), `driver-freshness.test.ts` ~L192, `performance.test.ts` ~L75 (Demo) |
| `laps` | same array until some driver completes a lap, or the cursor is reset by a backward seek | same until some driver completes a lap; single slot, so a whole-session read replaces it | `performance.test.ts` ~L77/L80 (Demo), `engine-memo.test.ts` (engines rely on it) |
| `stints` | same array until an app-data merge or cursor reset; **new array on every call while a `CurrentTyres` gap-fill applies** (§4.3) | same array for the whole session | `performance.test.ts` ~L76 (Demo), F1 invalidation test in the same file |
| `raceControl`, `weatherHistory`, `currentTyres`, `tyreStintHistory`, `lapPositions`, `sessionBests`, `pitLaneTimes`, `teamRadio` | same array until the feed gains a point `≤ clock`, the last point object changes, or a dep changes | `raceControl`/`weatherHistory`: **new array every call** (`.filter`); others absent | `feed-memo.test.ts`, `f1-live-ingest.test.ts` ~L134 |
| `trackMessage` | string or `null` (primitive) | absent | — |
| `weather` | **new object every call** (values equal) | stable element of the source array | — |
| `trackPath` | same reference until the outline is adopted/replaced | absent | `f1-live-ingest.test.ts` (outline attempts) |
| `timing`, `positions` | new arrays of new objects every call | same | — |
| `availability`, `sessionClock` | new objects every call | `availability` new every call; `sessionClock` absent | — |
| `feedFreshness`, `driverFreshness` | live only: new objects every call (wall-clock ages). **`undefined` for every non-live session and for every other provider**; `driverFreshness` is deliberately not part of `drivers` so `drivers` keeps its identity | always `undefined` | `driver-freshness.test.ts` ~L178–L221 |
| `clock`, `currentLap`, `totalLaps`, `trackStatus`, `qualifyingPart`, `trackMessage` | primitives | primitives | — |

### 4.2 What consumers may rely on

- **`drivers` is safe as a `useMemo`/`WeakMap` key** for lookups (`Map` by number, code/colour
  projections). It changes only when driver *content* can change.
- **`laps` is safe as a memo key for anything derived only from lap samples**, and `laps`+`stints`+
  `currentLap`+`totalLaps`+`session.type` for the fuel-aware engines. This is what the three engine
  memos rely on and `engine-memo.test.ts` pins.
- **A `FeedMemo` feed array is stable between feed events** on the F1 provider. It is *not* a
  contract on OpenF1/Demo for `raceControl`/`weatherHistory`; a widget that narrows its selector to
  those fields gets its re-render savings on F1 data only.
- **`driverFreshness`/`feedFreshness` are `undefined` outside a live F1 session.** Consumers must
  treat "absent" as "staleness is meaningless here" and render nothing, not as "fresh"
  (`staleDriverFeeds` and `formatStaleness` return `null` for absent input, and `TimingTower` and
  `TrackMap` render nothing in that case).
- **`getSnapshotAt` is a deterministic function of (feeds, clock)** with one documented exception:
  `energyEligibleForSec` depends on forward-playback history kept in
  `ReplayView.eligibleSinceClock`, so it can differ after a backward scrub
  (`replay-determinism.test.ts` header; `ErsEstimator.eligibilityDurationSec`). Reading a snapshot
  is otherwise idempotent from the caller's point of view, although it moves the provider's cursor.

### 4.3 What consumers must **not** rely on

Each item is a place where the guarantee is weaker than the table suggests. None was reproduced in a
test; severity is a judgement from reading the code.

1. **`stints` identity while a gap-fill applies (F1).** *(Reproduced and fixed: `ReplayView.stintsWithTyres` now memoises the gap-fill on the identity of its two inputs, so a new array appears only when `CurrentTyres` or the app-data stints change. Pinned by `snapshot-derivation-contracts.test.ts`. The original analysis follows.)* `applyCurrentTyresToStints` returns a fresh
   array whenever any active stint lacks a compound that `CurrentTyres` supplies. That happens on a
   mid-session live connect and right after a stop. While it lasts, `stints` is new on every call, so
   `memoizeOnLapInputs` (which compares `stints` identity) misses on every publish and
   `compoundPerformance`/`estimateFuelCoefficient` recompute at the tick rate. Correct results,
   lost caching. Fix would be to memoise the gap-filled array on `(stints, currentTyres)`.
2. **`laps` cache key ignores the pit-lap index (F1).** *(Reproduced and fixed: the pit-lap index's identity is now part of the F1 lap-cache key. Pinned by `snapshot-derivation-contracts.test.ts`. The original analysis follows.)* `lapsUpTo` keys on completed counts only,
   but each `LapSample`'s `isPitInLap`/`isPitOutLap` come from `pitLapIndex()`, which changes when
   `PitLaneTimeCollection` gains a point. If a pit entry lands for an already-completed lap and no
   driver completes a lap before the next read, the cached array keeps the old flags until the next
   completion (normally within seconds, since some car completes a lap most seconds; not measured). **Unverified** whether the feed ever orders
   events that way.
3. **`laps` identity is reset by every backward seek (F1)**, because `invalidateDerived()` clears
   the cache. Engine memos then rebuild once. Harmless, but do not assume identity survives a scrub.
4. **`drivers` on F1 is stable per content, not per session.** A `TopThree` point that names a
   driver `DriverList` lacks produces a new array (`mergeTopThreeDrivers` returns the same array
   when it adds nobody). Seeking backward across such a point swaps the array back.
5. **OpenF1 and Demo have one lap cache.** *(Still true for the whole-session eviction described here. Separately, a different OpenF1 cache bug was found and fixed: completed-lap counting stopped at the first lap with no `date_start`, so the key froze while later laps kept completing and a backwards clock returned the wrong set. Demo's key order is deterministic and needed no change.)* `getFullSnapshot()`/`getRaceControlHistory()` (bookmarks,
   sync wizard, comparison library) evict the playhead's cached `laps`; the next tick allocates a
   new array. The F1 provider avoids this with a separate `wholeSession` view.
6. **`getDriverLaps(n)` (store function) returns a fresh array on every call.** *(Measured and deliberately left alone: a full 20-driver sweep costs about 0.23 ms in a late race, and the store filters the result into a fresh array anyway, so a provider-level memo could not fix identity.)* Providers `.map` to
   new `LapSample` objects and the store `.filter`s again. It is safe to mutate and never safe as a
   dependency. `snapshot.laps` already holds the same time-bounded data grouped by
   `driverLaps(snapshot, n)`; the two differ slightly for OpenF1 laps with no start date
   (`getDriverLaps` can include them, `allLapsUpTo` drops them). **Unverified** which callers care.
7. **`weather`, `sessionClock`, `availability`, `timing`, `positions` are new objects every call
   on every provider that supplies them.** Narrowing a selector to one of these buys nothing;
   select a primitive from inside it (`s.snapshot?.weather?.rainfall`) or use `weatherHistory`.
8. **`OpenF1`/`Demo` `stints` are the whole session's stints, not clipped to `t`.** *(Unchanged.)* Engines that
   need "stints so far" already clip by `lapStart <= currentLap` (`StintPlanner`, `PitEventLog`);
   a new consumer must do the same or it will see future stints in replay.

---

## 5. Read-only by convention

Nothing in a snapshot is frozen, and the `RaceSnapshot` types are plain mutable arrays
(`laps: LapSample[]`, `drivers: Driver[]`, ...). The following are shared between consumers, or
between a consumer and the provider's own state, and **must not be mutated**:

| Object | Shared with | Where it is documented |
|---|---|---|
| every array on `snapshot` (`drivers`, `laps`, `stints`, `raceControl`, `weatherHistory`, `teamRadio`, `trackPath`, ...) | the provider's memos/caches and every other widget | `AnalyticsEngine.ts` ~L74 ("never mutated after they are handed out") |
| `driverLaps(snapshot, n)` result | `lapsByDriverCache` | typed `readonly LapSample[]` (the only readonly in the chain) |
| the grouping `Map` behind it | `lapsByDriverCache` | not exported; comment "Do not mutate the result" |
| `compoundPerformance(snapshot)` rows | `memoizeOnLapInputs` cache; also read by `compoundModel`, `TyreRead`, `ComparisonSummary` | `AnalyticsEngine.ts` ~L184 ("Rows are shared between callers: read-only") — typed as a mutable `CompoundRow[]` |
| `estimateFuelCoefficient(snapshot)` | fuel memo | `FuelModel.ts` ~L128 (on `memoizeOnLapInputs`) |
| `circuitPitLoss(snapshot)` | `pitLossByLaps` | comment on the `WeakMap` only |
| the array `getTimeline()` / `state.timeline` returns | `timelineCache` in the provider | none |

Checked for violations: a search of `src/renderer/widgets`, `components/shell`, `lib`, and the
engines that consume these results (`TyreRead`, `ComparisonSummary`, `DebriefBuilder`) for
`.sort(`, `.reverse(`, `.splice(`, `.push(` on a snapshot- or engine-derived value found only
operations on copies (`[...x].sort`, `.filter(...).sort`) or on locally built arrays. No violation
was found on 2026-09-19. Nothing enforces this, so it will regress silently; making the collections
`readonly` on `RaceSnapshot` and on the memoised return types is the cheapest guard (a type-level
change; not done here).

Two boundaries where sharing is intentional:

- **Plugins.** `projectPluginSnapshot` (`PluginSnapshotApi.ts`) copies *references* to
  `snapshot.laps` etc. into the projection, but `pluginRunner` hands it to a Web Worker via
  `postMessage`, which structured-clones it, so a plugin cannot mutate the originals.
- **Persistence.** `trackPath` is passed by reference to `saveBoundedTrackPath`, which only reads
  it.

---

## 6. Purity and hidden state in `getSnapshotAt`

Building a snapshot is not free of side effects, and a new derived field must not add to them:

- `advanceTo` moves the view's merge cursor and may push checkpoints into a list shared by both
  views.
- `attachErs` mutates `view.eligibleSinceClock` (a `Map`) as it reads.
- `applyCurrentTyres` and `attachErs` mutate `timing` entries in place. That is safe only because
  `buildTiming` returns entries built for this call; never call them on cached data.
- `ingest` mutates `this.session.totalLaps` on the object it just created, before anything
  publishes it.

Anything added to `getSnapshotAt` must stay cheap (it runs at the tick rate, plus at every seek
step), must not depend on wall-clock time unless it is live-only (as `feedFreshness` is), and should
be a pure function of the feeds and `clock`.

---

## 7. Checklist: adding a derived field or an engine

1. **Decide where it belongs.**
   - A pure function of one feed's points up to `clock` (like `raceControl`, `teamRadio`): a
     normaliser in `core/providers/f1/*` plus a `FeedMemo` in `newSnapshotMemos()`, read with
     `view.memos.x.read(points, clock, compute, deps)`. Pass every non-stream input in `deps`.
   - A function of other snapshot fields: an engine in `core/engines/`. Take the narrowest input
     type you can (`Pick<RaceSnapshot, ...>`), not `RaceSnapshot`.
   - Needs the previous snapshot (diffs, notifications): an `ingest(snapshot)` store wired into
     `sessionStore.recompute()` and reset in `resetSessionScopedStores()` (see
     `STORE_ARCHITECTURE.md` §6, item 7).
2. **Make the field optional and absent for providers that lack the feed.** `undefined` means "not
   carried"; `null`/`[]` means "carried, nothing yet". Add an `availability` flag if the UI should
   gate on it.
3. **State its identity contract** in the field's doc comment: what keeps it stable, what changes
   it. Add a test in the style of `performance.test.ts` (same reference across ticks, new reference
   after the input changes) or `f1-live-ingest.test.ts`.
4. **Choose a cache key that actually holds identity.** Use `snapshot.laps` (and the other inputs
   `memoizeOnLapInputs` compares) for lap-derived values. Never key on: the snapshot object; a raw
   stream array (grows in place); `timing`/`positions`/`weather`/`availability` (new every call);
   `getDriverLaps()` output (new every call); `snapshotWithKnownLaps(...).laps` when it copied.
5. **If you use `memoizeOnLapInputs`, list every input.** `compute` may read only `laps`, `stints`,
   `currentLap`, `totalLaps`, `session.type`. If it needs `drivers` (like `teamPace`), it cannot use
   that helper as written; extend the key or memoise in the widget on `drivers`.
6. **Do not mutate inputs; treat shared results as read-only.** Copy before sorting. Return
   `readonly` types where you can.
7. **Follow null-over-guess** (`CODING_STYLE.md`): return `null`/`available: false` with a reason,
   or a provenance tag, rather than a default that looks measured. See `ENGINE_ASSUMPTIONS.md`
   "Cross-engine conventions".
8. **Keep it deterministic.** Same feeds and clock ⇒ same value after any seek pattern. If it needs
   playback history, document the exception next to `energyEligibleForSec` and pin it.
9. **Consume it with a narrow selector.** In the widget, subscribe to the field that has the
   identity you documented (see `WIDGET_COMPOSITION.md` §5), not to `snapshot`.
10. **Measure.** Read the snapshot-build p50/p95 in About after your change (or run
    `RACEDECK_PERF_BENCHMARK=1 npx vitest run tests/unit/perf-benchmark.test.ts` for a full Demo
    replay). Both are informational; there is no CI budget.

---

## 8. Tests that pin these contracts

| Contract | Test |
|---|---|
| `FeedMemo` keying, in-place append, replaced-data detection | `tests/unit/feed-memo.test.ts`, `f1-live-ingest.test.ts` ("stream growth") |
| `drivers` identity across polls; new array when `DriverList` changes | `f1-live-ingest.test.ts` (`live ingest: driver list identity`) |
| `driverFreshness` separate from `drivers`; `undefined` outside live | `driver-freshness.test.ts` (`F1LiveProvider per-driver freshness (live)`) |
| Demo `drivers`/`stints`/`laps` stable between lap completions, `laps` new after completions; F1 stint invalidation on an in-place app-data patch | `performance.test.ts` (`snapshot allocation boundaries`) |
| Engine memos: same reference for a new snapshot object sharing `laps`; recompute on changed `laps`/`stints`/`currentLap`/`totalLaps`/session type; `circuitPitLoss` keyed on `laps` | `engine-memo.test.ts`; outputs unchanged by memoisation: `engine-memo-characterization.test.ts` |
| Replay checkpoints, whole-session cursor, no future leakage, checkpoint bound | `f1-replay-cursor.test.ts` |
| Backward/forward seek determinism | `replay-determinism.test.ts` |
| One recompute per live poll; live-edge follow not recorded in `recentSeeks` | `live-single-publish.test.ts` |
| Recompute timing rings | `derivation-timings.test.ts`, `derivation-timings-recompute.test.ts` |
| Commit budgets for `TimingTower`, `TrackMap`, `DriverDossier` | `render-budget.test.ts` |

The `stints` gap-fill identity, the pit-lap-index lap-cache key, OpenF1's undated-lap counting and Demo's cache key order are pinned by `snapshot-derivation-contracts.test.ts`.

Gaps: nothing pins F1 `laps` identity between lap completions (only Demo is tested), and nothing checks that a whole-session read leaves the playhead's `laps` identity alone on OpenF1/Demo. One suspected stale case is unverified: `stintsAtCurrentState` keys only on `appStateVersion`, so a driver that arrives through `DriverList` without an app-data change may show no stints until the next app-data merge.

---

## 9. Suggested follow-ups (not implemented)

Ordered by value for effort; each is small.

1. Memoise `applyCurrentTyresToStints` on `(stints, currentTyres)` so `stints` identity is stable
   while a gap-fill applies (§4.3.1).
2. Add the F1 `laps`-identity test and the OpenF1/Demo whole-session-read test (§8 gaps).
3. Add the pit-lap index version to `lapsUpTo`'s key, or document why it cannot matter (§4.3.2).
4. Mark snapshot collections and memoised engine results `readonly` (§5).
5. Give OpenF1/Demo a separate whole-session lap cache, as the F1 provider has (§4.3.5).
6. Correct the guideline in `CODING_STYLE.md` "Snapshot-derived state": the dependency to key on is
   the identity-holding field, not `snapshot`.

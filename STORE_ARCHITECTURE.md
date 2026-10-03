# RaceDeck Zustand Store Architecture

Scope: `src/renderer/store/*.ts` (23 files). Every claim below is backed by a specific file/line/function found by reading the store sources, `src/renderer/core/providers/types.ts`, `src/renderer/core/DataProviderManager.ts`, and `src/renderer/App.tsx`. Where the code did not make something explicit, it is flagged as "ambiguous" rather than guessed.

---

## 1. Overview

A "store" in this codebase is a single Zustand module created with `create<T>((set, get) => ({...}))`, exported as a `use<Name>Store` hook. There is no slicing/combine middleware and no Redux-devtools wiring visible in any store file — each store is a flat, hand-written object of state fields + action functions.

Conventions observed across every store:

- **State shape**: a TypeScript interface (`XxxState`) declares both data fields and the action functions in one interface, then `create<XxxState>(...)` implements it in one literal. Actions read current state via `get()` and write via `set()` (or the functional `set((s) => ...)` form for updates that depend on prior state, e.g. `alertStore.ts` `ingest`, `layoutStore.ts` `addWidget`).
- **Selectors**: components subscribe with the selector form `useXStore((s) => s.field)` (e.g. `App.tsx` line 87: `useAppStore((s) => s.route)`). Non-reactive reads inside actions/engines use `useXStore.getState()` — this is the mechanism used for almost all cross-store calls documented in §3.
- **Actions returning new state**: nearly every mutating action builds a new object/array with spreads (`{ ...get().x, patch }`, `[...arr, item]`) rather than mutating in place — consistent with the project's immutability rule.
- **Persistence**: stores that need to survive a restart call the shared `persist` helper (`src/renderer/store/persist.ts`), which routes to Electron's `electron-store` via IPC when a bridge is present, and falls back to `localStorage`/an in-memory `Map` otherwise (so the app and tests work outside Electron too). Each such store exposes a `hydrate()` async action that is invoked once from `App.tsx`'s bootstrap effect (see §4).
- **Request/version guards**: stores that fire async work (`sessionStore`, `syncStore`, `layoutStore`, `standingsStore`, `marketStore`, `practiceStore`, `liveStore`) keep a module-level monotonic counter (`sessionLoadVersion`, `syncReadVersion`, `layoutReadVersion`, `requestVersion`, `marketRequestVersion`, `liveLoadVersion`, etc.) captured at call time and compared after each `await`, so a stale response from a superseded request is discarded instead of clobbering newer state. This is the dominant async-safety pattern in the codebase.
- **Non-reactive module state**: several "ingest" stores (`raceStoryStore`, `engineerNotesStore`, `radioNotifyStore`) keep bookkeeping (`prevSnapshot`, `lastClock`, `sessionId`, `seenUrls`) as plain module-level `let` variables outside the Zustand store, specifically so that updating them never triggers a re-render — only the derived `set()` calls do.
- **Engines vs stores**: business logic (alert detection, sync math, layout serialization, race-story diffing) lives in `src/renderer/core/engines/*` classes/functions; the store is a thin reactive wrapper that owns a module-level engine instance (e.g. `alertStore.ts`'s `const engine = new AlertEngine()`, `syncStore.ts`'s `const engine = new SessionSyncEngine()`) and exposes its outputs as state.

---

## 2. Store responsibility table

| Store | File | State it owns | What triggers its updates |
|---|---|---|---|
| **sessionStore** | `sessionStore.ts` | Active `DataProviderManager` selection, session catalog/list, `currentSession`, playhead (`clock`, `duration`, `playing`, `speed`), the current `RaceSnapshot`, session `timeline`, whole-session `bookmarks`, `recentSeeks`, `focusDriver`, `comparison`, `noSpoiler` | App bootstrap (`init`), user provider/session selection (`setProvider`, `selectSession`), playback ticking (`play`'s internal `setInterval`), manual seeks/steps, `manager.setUpdateListener` firing on provider background updates, `useSyncStore` offset changes, `useSettingsStore.performanceMode` changes |
| **syncStore** | `syncStore.ts` | Broadcast-delay `sync` state (via `SessionSyncEngine`), sync `candidates`, wizard event type, "follow the TOD video" `follow`/`anchor` state, `followEligible` flag, `lastMatchedEvent`, `lastProbeAtMs` | User offset/nudge/broadcaster/calibrate actions, `sessionStore.selectSession`/`setProvider` (scope + follow-eligibility), the `FOLLOW_POLL_MS` internal timer polling the TOD player via `bridge().video.probePlayback()` |
| **alertStore** | `alertStore.ts` | `alerts` list (via `AlertEngine`), `muted`, `unseen` count | `sessionStore.recompute()` calling `ingest(snapshot)` every tick; `settingsStore.alerts` changes (applied via `App.tsx`'s subscription, see §4); user dismiss/mute/clear |
| **raceStoryStore** | `raceStoryStore.ts` | Narrative `events` feed (via `diffSnapshots`) | `sessionStore.recompute()` calling `ingest(snapshot)`; `sessionStore.selectSession` calling `reset()` |
| **engineerNotesStore** | `engineerNotesStore.ts` | Proactive `notes` feed + `lastHighId` (via `deriveEngineerNotes`) | Same as raceStoryStore: `sessionStore.recompute()`'s `ingest`, `sessionStore.selectSession`'s `reset()` |
| **radioNotifyStore** | `radioNotifyStore.ts` | `current`/`queue` of new-team-radio popup notices | `sessionStore.recompute()`'s `ingest(snapshot)` (diffs `snapshot.teamRadio`, live-session-gated); user `dismiss()` |
| **annotationsStore** | `annotationsStore.ts` | Per-session user-authored `annotations`, persisted per `sessionId` | `sessionStore.selectSession` calling `hydrateForSession(session.id)`; `setProvider` calling `reset()`; user add/update/remove |
| **profileStore** | `profileStore.ts` | Saved `RaceWatchProfile`s per `SessionType`, `autoApply` flag | User `saveCurrentAsProfile`/`applyProfile`/`removeProfile`/`setAutoApply`; `sessionStore.selectSession` reads it (`autoApply` + `hasProfile`/`applyProfile`) after a session loads |
| **standingsStore** | `standingsStore.ts` | Championship baseline (`SeasonChampionship`), request `key` | `ChampionshipPanel.tsx` widget calling `load(year, sessionDate)` from the session snapshot — a UI-driven call, not a store-to-store one |
| **marketStore** | `marketStore.ts` | Polymarket `result` (win odds), per-token `historyByToken`/loading/error | `WinProbabilityPanel.tsx` widget calling `refresh`/`loadHistory` on an interval; also read (not written) by `strategyStore.marketSummary()` via `useMarketStore.getState()` |
| **strategyStore** | `strategyStore.ts` | AI-briefing state (`briefing`), chat `history`/`asking`, `selectedDriver` | User "generate briefing"/"ask" actions; reads `sessionStore.snapshot`/`focusDriver`/`getDriverLaps`, `settingsStore.ai`/`favorites`, and `marketStore.result` to build AI context |
| **practiceStore** | `practiceStore.ts` | Practice-session AI briefing `result`, `requestKey` | `usePracticeBriefing.ts` hook calling `load(request)` from UI |
| **liveStore** | `liveStore.ts` | F1-Live connection `status`, `loggedIn`, `busy`, `notice` | `bridge().f1.onLiveStatus` push events (main-process SignalR client), user `connect`/`disconnect`/`openLogin`; drives `sessionStore.setProvider('f1live')`/`selectSession('live')`/`seek`/`pause`/`reloadSession` internally |
| **videoStore** | `videoStore.ts` | Native TOD WebContentsView `state` (mode, url, DRM), `connected`, surface visibility flags | `bridge().video.onStateChanged` push events; user mode/URL/bounds changes; reads `settingsStore.tod` prefs when setting mode |
| **radioPlaybackStore** | `radioPlaybackStore.ts` | Which team-radio clip URL is currently playing + its `HTMLAudioElement` | User clicking play on a clip in `TeamRadioPanel`/`DriverDossier` (`toggle(url)`) |
| **radioTranscriptStore** | `radioTranscriptStore.ts` | Per-clip-URL transcription `entries` (status/text/error), persisted | User requesting a transcript (`transcribe(url)`); reads `settingsStore.ai` for the AI provider config |
| **layoutStore** | `layoutStore.ts` | Current dashboard `grid`, `currentLayoutId`, `savedLayouts`, `editMode` | User layout edits/drag-resize (`updateGrid`), preset/save/load/delete actions, widget add/remove/toggle; read+written by `profileStore.saveCurrentAsProfile`/`applyProfile` |
| **settingsStore** | `settingsStore.ts` | Theme, alert config, favorites, TOD prefs, AI config, market/voice config, per-widget module flags, performance mode, sync presets, units | User Settings-page edits; `exportAll`/`importAll` backup-restore; `hydrate()` on boot applies `ThemeEngine.apply(...)` as a side effect |
| **onboardingStore** | `onboardingStore.ts` | Welcome-tour `open` flag | First-run `hydrate()` (persisted "seen" flag), command-palette `openTour()`, `WelcomeTour` `dismiss()` |
| **appStore** | `appStore.ts` | App metadata (`info`), window `maximized` state, current `route`, `ready` flag | `bridge().app.info()`/`window.isMaximized()` on `init()`, `bridge().window.onMaximizedChanged` push events, route navigation, `App.tsx` bootstrap calling `setReady(true)` at the end |
| **comparisonLibraryStore** | `comparisonLibraryStore.ts` | Saved cross-race `ComparisonSummary` entries, persisted | User saving/removing a comparison from `ComparisonLibraryPage` |
| **pluginStore** | `pluginStore.ts` | Saved local plugin scripts (`SavedPlugin[]`), persisted | User adding/removing a plugin script |

---

## 3. Dependency graph

Derived strictly from `import { useXStore } from './xStore'` lines found via grep across `src/renderer/store/*.ts` (no other store-to-store imports exist in the directory):

```
sessionStore  ─┬─▶ syncStore          (sessionStore.ts:10)
               ├─▶ alertStore         (sessionStore.ts:11)
               ├─▶ settingsStore      (sessionStore.ts:12)
               ├─▶ raceStoryStore     (sessionStore.ts:13)
               ├─▶ engineerNotesStore (sessionStore.ts:14)
               ├─▶ radioNotifyStore   (sessionStore.ts:15)
               ├─▶ annotationsStore   (sessionStore.ts:16)
               └─▶ profileStore       (sessionStore.ts:17)

liveStore     ─┬─▶ sessionStore   (liveStore.ts:4)
               └─▶ settingsStore  (liveStore.ts:5)

profileStore  ─┬─▶ settingsStore  (profileStore.ts:5)
               └─▶ layoutStore    (profileStore.ts:6)

radioTranscriptStore ─▶ settingsStore (radioTranscriptStore.ts:4)

strategyStore ─┬─▶ sessionStore  (strategyStore.ts:22)
               ├─▶ settingsStore (strategyStore.ts:23)
               └─▶ marketStore   (strategyStore.ts:24, also matchOutcomesToDrivers helper)

videoStore    ─▶ settingsStore (videoStore.ts:7)
```

No other store imports another store's hook. `standingsStore`, `marketStore`, and `practiceStore` are called only from React components/widgets (`ChampionshipPanel.tsx`, `WinProbabilityPanel.tsx`, `usePracticeBriefing.ts`) — confirmed by grepping for `useStandingsStore|useMarketStore|usePracticeStore` across `src/renderer`, which returned only those widget/hook files plus the stores' own definitions and `strategyStore.ts`. So those three are UI-orchestrated, not store-orchestrated, except for `strategyStore`'s direct read of `marketStore`.

**Why each real cross-store call exists:**

- **`sessionStore` → `syncStore`** (`sessionStore.ts` `selectSession`, `effectiveDataTime`, and the module-level `useSyncStore.subscribe(...)` at the bottom of the file): the sync offset shifts which data-clock moment is rendered (`effectiveDataTime()` calls `syncMath.dataTimeForVideo(clock, offset, duration)`), and a session switch must reset the sync engine's scope key (`useSyncStore.getState().setScope(...)`) and follow-eligibility (`setFollowEligible(...)`) because those are inherently per-session/per-provider facts that only `sessionStore` knows (it owns `providerId`/`currentSession`). The subscription at the file's end (`useSyncStore.subscribe((state, prev) => { if (offsetSeconds changed) session.recompute() })`) exists so that nudging the sync offset while paused visibly re-renders the shifted snapshot — otherwise a paused dashboard would look unchanged after a sync correction.
- **`sessionStore` → `alertStore`, `raceStoryStore`, `engineerNotesStore`, `radioNotifyStore`** (`sessionStore.ts` `recompute()`): all four are "ingest on every new snapshot" feeds. `sessionStore` is the single place a fresh `RaceSnapshot` is produced, so it fans that snapshot out to each feed's `ingest(snapshot)` in one place rather than each feed independently subscribing to the session store (avoiding N separate `useSessionStore.subscribe` wire-ups and keeping ingestion order deterministic). `selectSession` additionally calls `resetEngine()`/`reset()` on `alertStore`/`raceStoryStore`/`engineerNotesStore` because a new session must not carry over alerts/narrative from the previous one.
- **`sessionStore` → `settingsStore`** (`sessionStore.ts` `play()` reads `performanceMode` for the tick interval; the file-level `useSettingsStore.subscribe(...)` restarts playback at the new cadence when `performanceMode` toggles mid-playback): performance mode is a global user preference owned by `settingsStore`, but it changes the session ticker's `setInterval` cadence, so `sessionStore` must react to it live, not just read it once.
- **`sessionStore` → `annotationsStore`** (`selectSession` calls `void useAnnotationsStore.getState().hydrateForSession(session.id)`; `setProvider` calls `reset()`): annotations are scoped per session id, so they must be (re)loaded exactly when the session they belong to changes, and cleared when the provider itself changes (a different provider's session ids are not comparable).
- **`sessionStore` → `profileStore`** (`selectSession`, after computing `startClock` etc.): a saved race-watch profile should auto-apply only once a session's `SessionType` is known, which happens after `manager.loadSession(id)` resolves — hence the read happens inside `selectSession`, not in `profileStore` itself (which has no way to know when a session loads).
- **`liveStore` → `sessionStore`** (`loadLiveSession`, `runPoll`, the `onLiveStatus` handler): `liveStore` only manages the F1-Live SignalR connection; once a session is confirmed live, something has to point the dashboard at it, extend its timeline on each poll (`session.reloadSession()`), and keep the playhead pinned near the live edge (`session.seek(duration - EDGE_MARGIN)`). That orchestration necessarily calls into `sessionStore` because `sessionStore` is the only store that owns `providerId`/`currentSession`/the playhead.
- **`liveStore` → `settingsStore`** (`scheduleNextPoll` reading `performanceMode`): the live poll cadence (`getLiveReloadCadenceMs`) is halved in performance mode, mirroring the same setting `sessionStore` also consults for its own ticker.
- **`profileStore` → `settingsStore`, `layoutStore`** (`saveCurrentAsProfile`, `applyProfile`): a race-watch profile is defined as a bundle of favorites + alert overrides (owned by `settingsStore`) and a layout choice (owned by `layoutStore`). Per the file's own comment, `applyProfile` "only ever calls the *existing* settings/layout actions... it never mutates state directly," so a profile can't do anything a manual settings change couldn't — this is a deliberate constraint to avoid a profile becoming a second, divergent path into those stores' state.
- **`radioTranscriptStore` → `settingsStore`** (`transcribe`): transcription is an AI call, and the AI provider/key config lives in `settingsStore.ai`; the transcript store just borrows it at call time rather than duplicating it.
- **`strategyStore` → `sessionStore`** (`resolveDriver`, `currentPrediction`, `generateBriefing`, `ask`): the AI strategist needs the live `RaceSnapshot`, the user's `focusDriver`, and per-driver lap history — all owned by `sessionStore` — to build its race context and pit/pace predictions.
- **`strategyStore` → `settingsStore`** (same functions): needs `ai` config to call the AI bridge, and `favorites` as a fallback when resolving which driver to focus on.
- **`strategyStore` → `marketStore`** (`marketSummary`): when the user has opted into the Polymarket overlay (`settingsStore.market.enabled`), the AI briefing/chat context is enriched with de-vigged market win odds already fetched into `marketStore.result`; `strategyStore` only reads this (via `matchOutcomesToDrivers`, imported from `marketStore.ts`), it never triggers a market refresh itself.
- **`videoStore` → `settingsStore`** (`setMode`): the TOD URL and auto-fallback preference are user settings; `videoStore` reads them each time it asks the main process to change the video surface's mode.

---

## 4. Lifecycle & initialization order

All bootstrap sequencing lives in `src/renderer/App.tsx`'s `useBootstrap()` effect (runs once on mount, guarded by a `cancelled` flag for cleanup):

1. `await useSettingsStore.getState().hydrate()` — awaited alone, first, before anything else. `settingsStore.hydrate()` also applies the loaded theme via `ThemeEngine.apply(...)` as a side effect.
2. `await Promise.all([...])` — hydrates, in parallel, once settings are ready: `syncStore.hydrate()`, `layoutStore.hydrate()`, `profileStore.hydrate()`, `comparisonLibraryStore.hydrate()`, `radioTranscriptStore.hydrate()`, `pluginStore.hydrate()`, `appStore.init()`.
3. `useVideoStore.getState().connect()` — wires the `bridge().video.onStateChanged` listener and does an initial `refresh()`.
4. `useLiveStore.getState().init()` — wires `bridge().f1.onLiveStatus` and calls `refreshLogin()`.
5. `await useSessionStore.getState().init()` — this is the one that actually loads data: sets the active provider to `'demo'` (`manager.setActive('demo')`), calls `refreshSessions()`, then `selectSession('demo-2024-gp', { seekFraction: 0.42 })`, landing the dashboard mid-race by default.
6. `alertStore.setConfig(settingsStore.alerts)` is applied once, then `useSettingsStore.subscribe(applyAlerts)` keeps `AlertEngine`'s config in lockstep with `settingsStore.alerts` for the rest of the session.
7. `useAppStore.getState().setReady(true)`.
8. `void useOnboardingStore.getState().hydrate()` — fired last and not awaited, since the welcome tour must never block startup (the store's own comment: "never block startup on the tour").

**Notably not hydrated in this bootstrap**: `standingsStore`, `marketStore`, `practiceStore`, `radioPlaybackStore`, `annotationsStore` have no `hydrate()`/`init()` call in `App.tsx` — `standingsStore`/`marketStore`/`practiceStore` are pure request-driven (no persisted local state to hydrate), `radioPlaybackStore` has no persistence at all, and `annotationsStore` is intentionally hydrated per-session by `sessionStore.selectSession` (`hydrateForSession(session.id)`) rather than once at boot, since its content is session-scoped, not global.

**Provider switching / reset** (`sessionStore.setProvider`, `sessionStore.ts` line 122): bumps `sessionLoadVersion` (invalidating in-flight loads), calls `get().pause()`, calls `manager.setActive(id)` (which calls `active.cancelPendingLoads?.()` on the outgoing provider — `DataProviderManager.ts` line 59), resets `sessions`/`currentSession`/`snapshot`/`timeline`/`bookmarks`/`recentSeeks`/`error` to empty/null, calls `useAnnotationsStore.getState().reset()`, calls `useSyncStore.getState().setFollowEligible(false)`, then `refreshSessions()`.

**Session switching / reset** (`sessionStore.selectSession`, line 160): bumps `sessionLoadVersion`, pauses, disables follow-eligibility, awaits any pending `reloadSession()` in flight (`reloadPromise`) to avoid racing a live-timeline extension against a fresh load, calls `manager.loadSession(id)`, then on success: `useSyncStore.getState().setScope(...)`, `useAlertStore.getState().resetEngine()`, `useRaceStoryStore.getState().reset()`, `useEngineerNotesStore.getState().reset()`, `useAnnotationsStore.getState().hydrateForSession(...)`, builds `bookmarks` from a full-duration snapshot, applies a saved profile if `autoApply` + `hasProfile` (via `profileStore`), sets `followEligible` based on `providerId === 'f1live' && session.id === 'live'`, and finally calls `get().recompute()` to produce the first snapshot.

**Teardown**: no store in the directory defines a `dispose()`/`destroy()` action of its own. Teardown is provider-level (`DataProvider.dispose?()`/`cancelPendingLoads?()` on the `DataProviderManager`, `sessionStore.ts` via `manager.setActive`) and listener-level (`liveStore`/`videoStore`/`appStore` each keep a module-level `unsub`/`unsubscribe` closed over the bridge listener, re-subscribed idempotently via a guard check like `if (!hasBridge() || unsub) return` in `liveStore.init()`). `App.tsx`'s bootstrap effect cleanup only unsubscribes the settings-alert sync (`unsub?.()`); it does not tear down the session/live/video stores on unmount — consistent with `App` being the top-level, never-unmounted root. **Ambiguous**: whether any store is expected to be reset on a full app "sign out" or similar user-facing reset flow was not found in the codebase; no such action exists in any store read.

---

## 5. Async coordination points

Concrete places where one store's action awaits or triggers async work that lives in (or affects) another store:

- **`sessionStore.selectSession` awaits `syncStore`**: `await useSyncStore.getState().setScope(...)` (`sessionStore.ts` line 174) — this itself is async because `setScope` (`syncStore.ts` line 233) does a `persist.get(...)` round-trip to read a saved offset for the new scope before resolving.
- **`sessionStore.selectSession` fires-and-forgets `annotationsStore`**: `void useAnnotationsStore.getState().hydrateForSession(session.id)` (`sessionStore.ts` line 178) is explicitly not awaited — annotations are allowed to populate slightly after the rest of the session UI is ready, guarded internally by `annotationsStore`'s own `readVersion` counter so a stale hydrate can't clobber a newer one.
- **`syncStore`'s follow-mode polling loop** (`restartFollowFromCurrentOffset`, `runFollowTick`, `syncStore.ts` lines 333–451): a `setTimeout`-driven loop that calls `bridge().video.probePlayback()` (main-process IPC into the native TOD webview) every `FOLLOW_POLL_MS` (1000 ms) and, when the derived offset drifts past `FOLLOW_DEADBAND_SEC`, calls `engine.setOffset(...)` and `set({ sync: applied, ... })` — an async IPC round-trip feeding back into `syncStore`'s own `sync` state (not a different store, but the clearest async-loop pattern in the directory, and it's what `sessionStore` reacts to via the `useSyncStore.subscribe` at the bottom of `sessionStore.ts`).
- **`liveStore.loadLiveSession` drives a multi-step async chain into `sessionStore`** (`liveStore.ts` lines 140–156): `await session.setProvider('f1live')` → `await new Promise(r => setTimeout(r, 1500))` (deliberate wait for the SignalR socket to accumulate an initial snapshot) → checks `useLiveStore.getState().status` is still connected+live → `await session.selectSession('live')` → `useSessionStore.getState().seek(duration - EDGE_MARGIN)` → `startPoll()`. Each step is guarded by `loadVersion !== liveLoadVersion` checks so a disconnect mid-chain aborts cleanly.
- **`liveStore.runPoll` awaits `sessionStore.reloadSession()`** (`liveStore.ts` line 120): the live poll loop extends the growing live timeline by calling into `sessionStore`, then re-seeks to the live edge if new data arrived, then reschedules itself — this is the mechanism that keeps a live dashboard "playing" the growing feed without the user manually advancing the clock.
- **`profileStore.applyProfile` synchronously calls into `settingsStore`/`layoutStore`** (`profileStore.ts` lines 68–71) — not async itself, but it's invoked from inside `sessionStore.selectSession`'s async flow (after `await manager.loadSession(id)`), so its effects land as part of that larger async chain.
- **`strategyStore.generateBriefing`/`ask` await `bridge().ai.complete(...)`** (`strategyStore.ts` lines 178, 216) after synchronously pulling context from `sessionStore.snapshot`, `settingsStore.ai`, and `marketStore.result` — the cross-store reads happen before the await, so they reflect a single consistent moment rather than being re-read after the AI call resolves.
- **`radioTranscriptStore.transcribe` awaits `bridge().ai.transcribe(...)`** (`radioTranscriptStore.ts` line 74) using `settingsStore.ai` captured just before the call.

---

## 6. Guidance for adding a new store

Derived from the conventions actually observed above (not invented):

1. **One file per store**, named `xxxStore.ts` in `src/renderer/store/`, exporting a single `useXxxStore = create<XxxState>((set, get) => ({...}))`. Define the `XxxState` interface with data fields and actions together, as every existing store does.
2. **Put business logic in an engine, not the store**, when the logic is non-trivial (diffing, scoring, math) — follow `alertStore`/`AlertEngine`, `syncStore`/`SessionSyncEngine`, `raceStoryStore`/`diffSnapshots`. Keep a module-level engine instance outside the Zustand store if it needs to retain internal state across calls without triggering re-renders (see `let prevSnapshot`/`lastClock`/`sessionId` pattern in `raceStoryStore.ts`/`engineerNotesStore.ts`).
3. **If the store needs to persist anything**, use the shared `persist` helper from `./persist` with a namespace constant from `@shared/ipc-contract`'s `STORE_NS` (add one if needed), expose a `hydrate()` action, and register that call in `App.tsx`'s `useBootstrap()` — either in the parallel `Promise.all` block (global/app-scoped data) or scoped to a lifecycle event like session load (per-session data, following `annotationsStore`'s `hydrateForSession` pattern called from `sessionStore.selectSession`).
4. **Validate persisted data on read** before trusting it (see `isEntryMap`, `isComparisonSummaryArray`, `isSavedPluginArray`, `sanitizeAnnotations`, `sanitizeGrid`) — every store that reads back a persisted blob guards against a malformed/legacy shape rather than assuming it's well-formed.
5. **Guard concurrent async work with a version counter** whenever an action does an `await` and then writes state — bump a module-level `let xRequestVersion` (or similar) before the async call, capture it, and compare after each `await` before calling `set(...)`, exactly as `sessionStore`, `syncStore`, `layoutStore`, `standingsStore`, `marketStore`, `practiceStore`, and `liveStore` all do. This is the codebase's established defense against stale-response races (provider switches, rapid session changes, etc.).
6. **Cross-store calls only via `useXStore.getState()`**, never by importing another store's internals directly, and only in the direction that matches ownership: a store should reach into another store only for data/actions it doesn't itself own (e.g. `strategyStore` reading `sessionStore.snapshot` because only `sessionStore` produces snapshots). Before adding an import, check for a cycle — the existing graph (§3) is a DAG rooted at `sessionStore`/`settingsStore`; avoid introducing an edge back into `sessionStore` from something `sessionStore` already depends on, since `syncStore`'s own comment (`sync.ts` line ~127) calls out avoiding exactly this ("The session store owns that fact and pushes it here, rather than this store reaching back into it, which would close an import cycle").
7. **If the new store needs to react to every new race snapshot**, don't have it subscribe to `sessionStore` independently — instead add an `ingest(snapshot)` action and wire it into `sessionStore.recompute()` alongside the existing `alertStore`/`raceStoryStore`/`engineerNotesStore`/`radioNotifyStore` calls (`sessionStore.ts` lines 323–326), and add the matching `reset()` call to `sessionStore.selectSession` if the feed is session-scoped.
8. **Keep actions immutable**: build new arrays/objects with spreads rather than mutating `get()`'s result in place, matching every store read here and the project's global coding-style rule.
9. **Reads that only apply when a bridge/Electron main process is available** should check `hasBridge()` first and degrade with a clear `error` string when absent (see `marketStore.refresh`, `standingsStore.load`, `practiceStore.load`, `radioTranscriptStore.transcribe`) — this is what keeps stores usable in tests/browser contexts without an Electron shell.

---

## 7. Persistence safety

How saved data is protected, end to end. Each layer handles a different failure:

| Failure | Where it is handled | Result |
|---|---|---|
| The config file is not valid JSON at launch | `src/main/config-recovery.ts`, called by `PersistenceLayer`'s constructor **before** electron-store opens the file | The file is renamed to `racedeck.corrupt-<ts>.json` (never overwritten), the app starts on defaults, and `PersistenceLayer.recovery` reports the backup path. `persist.checkRecovery()` (called first in `App.tsx`'s bootstrap) copies it into `persistStatusStore.recoveredBackup`, and `StatusBar` shows it with a Dismiss action. |
| A localStorage/in-memory fallback entry fails to parse (tests, non-Electron) | `persist.ts` `reportCorruption` -> `persistStatusStore.corruptions` | Warning with a "Reset to defaults" action. In Electron the main process parses the file, so this path only fires outside the shell. |
| Valid JSON with the wrong shape (import file, hand-edited or legacy data) | Per-store normalizers on `hydrate()` (settings, profiles, plugins, comparison library, annotations, radio transcripts, layouts) | Bad values fall back to defaults and damaged list entries are dropped one by one. A single bad plugin no longer wipes the rest. |
| A settings import that points the AI provider at another endpoint | `mergeImportedAi` (`src/shared/ai.ts`) | The stored API key is kept only when the imported config targets the same endpoint. |
| High-frequency edits (grid drag, sync-offset slider) | `src/renderer/store/persistWrite.ts` | Writes are coalesced (400 ms trailing) and flushed on `pagehide`/`beforeunload` and before actions that read the same key. Fire-and-forget writes log failures instead of dropping them silently. |
| Untrusted arguments from the renderer | `src/main/ipc/validate.ts`, `trusted-sender.ts` | Store namespaces must be in `STORE_NS`, keys cannot start with `__`, a `.` in a key is escaped to `%2E` (the store joins `namespace.key` as a path), and values over 5 MB are rejected. |

`persistStatusStore` is written by `persist.ts` and read only by `StatusBar` (through `SystemStatus`). It has no dependency on any other store, so it adds no cycle to the §3 graph.

## 8. Layering rules (enforced)

The renderer core depends in one direction: `providers -> model <- engines`. `tests/unit/layering.test.ts` fails the suite if this is broken.

- `src/renderer/core/model/` holds the neutral data shapes (`RaceSnapshot`, feed-health and timeline types). `providers/types.ts` keeps only the provider contract (`DataProvider`, `ProviderCapabilities`, `ProviderDiagnostics`) and re-exports the model types so older imports still resolve.
- `src/renderer/core/normalize/` holds pure helpers that engines and widgets need (`nearestAtOrBefore`, `reconcileTyreHistory`, `sectorDisplayState`). `providers/normalize.ts` and `f1normalize.ts` re-export them.
- Engines import nothing from `core/providers`. `core/model` imports nothing from providers, engines, stores or components. Providers import no store, with one commented exception: `f1/persistTrackPathStorage.ts` is the default for `F1LiveProvider`'s injected `TrackPathCacheStorage`, and `DataProviderManager` injects it explicitly. `shared/` imports nothing from `renderer/` or `main/`, and the renderer imports nothing from `main/`.
- Providers may still import engines for real engine logic (`SessionPhaseEngine.buildTimeline`, `ErsEstimator`); the direction is one-way and creates no cycle.

---

## Files referenced

- `C:\Users\Youssef\Documents\F1\src\renderer\store\sessionStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\syncStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\alertStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\raceStoryStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\engineerNotesStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\radioNotifyStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\annotationsStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\profileStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\standingsStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\marketStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\strategyStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\practiceStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\liveStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\videoStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\radioPlaybackStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\radioTranscriptStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\layoutStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\settingsStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\onboardingStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\appStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\comparisonLibraryStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\pluginStore.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\store\persist.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\core\providers\types.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\core\DataProviderManager.ts`
- `C:\Users\Youssef\Documents\F1\src\renderer\App.tsx`

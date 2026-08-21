# RaceDeck — Handoff & Continuation Guide

> Paste this file (plus `README.md`) as context when continuing RaceDeck in **OpenCode**.
> It orients you fast, states the non‑negotiable guardrails, and lists exactly what's done, what's
> unverified, and what to build next.

---

## 1. What RaceDeck is

A premium **Electron + React + TypeScript** desktop F1 race companion — "a better MultiViewer."
It pairs a **legal, user‑authenticated TOD/F1 TV video surface** with a **pro‑grade live data
dashboard** (timing, strategy, telemetry, track map, race control, win probability, battle radar,
race story, ERS). Data is **provider‑abstracted**; the dashboard scrubs/replays any session and
syncs to the (delayed) video via a global offset.

**Working dir:** `C:\Users\Youssef\Documents\F1` · Windows · not a git repo (offer `git init`).

## 2. Golden rules (NON‑NEGOTIABLE — read before touching video/auth)

- **Never** bypass DRM/Widevine, extract TOD stream URLs, intercept EME/license keys, or scrape
  TOD's protected cookies/tokens. The TOD video is a **user‑authenticated browser surface only**;
  RaceDeck observes high‑level navigation/playback lifecycle, nothing protected.
- **F1 data auth is different and allowed:** the user signs into **F1's own login page** in an
  in‑app window (Chromium holds the password; RaceDeck never sees it). RaceDeck captures only the
  **F1 TV subscription token** needed to open the live‑timing feed the user pays for. This is a
  legitimate authenticated client, **not** DRM bypass or piracy.
- All credentials/keys (F1, AI) stay **local only**. Polymarket receives **only the public GP name**.
- The user holds a high bar: **deep, polished, genuinely working — not mockups.** Verify every
  change with `npm run typecheck && npm test && npm run build`, and drive the real app when you can.

## 3. Build / test / run

```bash
npm run typecheck    # tsc for node + web projects (must be clean)
npm test             # vitest — 352 unit tests (pure engines/parsers/stores/services/UI/performance)
npm run build        # electron-vite production build (must succeed)
npx electron ./out/main/index.js   # boot the built app (exit code 124 under a timeout = alive)
```

Screenshot the running app on Windows (headless‑friendly) via PowerShell `CopyFromScreen` after a
`sleep`, or drive an HTML preview with the bundled Playwright chromium
(`C:/Users/.../ms-playwright/chromium-*/chrome-win64/chrome.exe`, pass `executablePath`).

## 4. Architecture map

```
src/
  main/        Electron main. window-manager, video-surface-manager (native WebContentsView),
               ai-service, market-service (Polymarket), f1-live-service (archive fetch/decode),
               f1-auth (F1 TV login + token capture), f1-live-socket (SignalR Core live feed),
               persistence, ipc/register.ts (all channels)
  preload/     contextBridge → window.racedeck (typed IPC surface)
  shared/      framework-free + unit-tested: models (types), f1live (parsers/merge), market,
               ipc-contract, constants, video-fallback
  renderer/
    core/engines/    PURE, unit-tested: StrategyEngine, AnalyticsEngine, StrategyContext,
                     WinProbabilityEngine, BattleEngine, RaceStoryEngine, SessionPhaseEngine,
                     ThemeEngine
    core/providers/  DataProvider abstraction: DemoProvider (offline default), OpenF1Provider,
                     F1LiveProvider (real F1 data, archive + live); f1normalize/normalize (pure)
    store/           zustand: sessionStore (clock/snapshot/timeline), settingsStore, syncStore,
                     videoStore, liveStore, marketStore, raceStoryStore, alertStore, layoutStore
    widgets/         25 dashboard widgets (TimingTower, QualifyingMonitor, DriverDossier, …)
    components/      shell (TitleBar, CommandBar, Sidebar, StatusBar, TransportBar, LiveControls,
                     SessionPicker…), ui primitives, DashboardView/ReplayView/SettingsPage
    styles/globals.css   design tokens (dark + light), glass, phase colours
```

**Data flow:** `DataProviderManager` holds the active provider → `sessionStore.recompute()` calls
`provider.getSnapshotAt(effectiveDataTime)` each tick → `RaceSnapshot` fans out to widgets via
zustand selectors. `effectiveDataTime = clock − sync.offsetSeconds` so everything follows the
broadcast‑sync nudge. Providers reconstruct any moment `t` by forward‑merging the incremental feed.

## 5. Real F1 data — the two feeds (important, previously misunderstood)

- **REPLAY / archive (open, no login):** `livetiming.formula1.com/static/{year}/Index.json` →
  `.jsonStream` per‑feed files (line = `HH:MM:SS.mmm<json>`), `.z` = base64+raw‑deflate.
  Verified against real races.
- **LIVE (SignalR):** F1 moved from classic `/signalr` (clientProtocol 1.5 — now **401 auth‑gated**)
  to modern **SignalR Core `/signalrcore`**. Basic timing is **public**; the richer live data
  (**car positions, telemetry/CarData, Driver Tracker**) is now **gated behind an active F1 TV
  subscription**. So `F1LiveSocket` does a two‑tier connect:
  1. `POST /signalrcore/negotiate?negotiateVersion=1` → `connectionToken` + **AWSALB sticky cookie**
     (the websocket MUST carry that cookie back or it 404s — non‑obvious gotcha).
  2. `wss://.../signalrcore?id={token}` → handshake `{"protocol":"json","version":1}\x1e`
     (`\x1e` = record separator ends every frame) → invoke
     `{type:1,target:"Subscribe",arguments:[[topics]],invocationId:"0"}`.
  3. Initial full state = type‑3 completion `result`; live deltas = `{type:1,target:"feed",
     arguments:[topic,data,ts]}`. `.z` inflated; client pings `{type:6}` every 10s.
  - With an F1 TV token: Bearer header + cookies + `&access_token=` are attached; on 401/403 it
    transparently falls back to anonymous. `f1-auth.ts` captures the token via a `webRequest`
    `ascendontoken` sniff on the logged‑in F1 session (a real browser is required — F1's account
    API is captcha‑gated against raw password POSTs).
  - **UNVERIFIED:** whether the token actually unlocks the gated data can only be confirmed by
    Position/CarData deltas arriving **during a real green session** (negotiate accepts any token).
    Exact token‑passing mechanism isn't publicly documented — Bearer+cookie+access_token are all
    tried. Debug with `RACEDECK_DEBUG=1` (`[f1live-socket]` logs) + the Go Live status panel.

## 6. What's DONE (recent work, all verified unless noted)

- **Strategy Wall overhaul:** compact 42-row, three-tier pit wall with unified driver focus. Pit-Now and
  the remaining-strategy planner use only laps known at the replay moment; fresh lap-one tyres no
  longer trigger blanket undercut/BOX calls, including an early VSC. The model waits for a meaningful
  opening-stint sample instead of manufacturing an immediate legal stop.
- **Win Probability:** pairwise Poisson-binomial model now combines exact/inferred gaps, shrunk recent
  pace, tyre state, penalties, reliability and race-state uncertainty, with visible confidence and
  per-driver factors. Polymarket discovery expands circuit/country aliases to canonical GP names,
  uses Electron `net.fetch`, and closed markets automatically show replay-time history rather than
  resolved 0/1 prices.
- Battle Radar + Race Story engines; TOD overlay occlusion guard (native view hides under dialogs).
- F1 archive replay provider (verified) + **F1 SignalR Core live path** (anonymous verified;
  F1 TV‑gated tier unverified per §5).
- **Race‑phase timeline** (`SessionPhaseEngine`): scrubber shows pre‑race / green / yellow / VSC /
  SC / red / post as a colour strip (distinct colours, per‑segment tooltips, click‑to‑seek) + a
  phase chip ("Lap 32/52", "Safety Car", "Race finished"). Solves "the 2h35 replay includes prep".
- **Light theme redesign** (was "ugly"): opaque app‑root background so the dark Electron window
  can't bleed through translucent chrome; darkened accent for light; opaque glass; distinct phase
  colours. Quick Dark/Light/System toggle in the TitleBar.
- **2026 terminology:** technical ERS still exists, but user-facing UI says **Battery/Energy**.
  `deployMode` distinguishes `HARVEST|BALANCED|DEPLOY|BOOST|OVERTAKE`: Boost is driver-controlled
  deployment; Overtake is the separate within-1s DRS replacement. Active aero uses the official
  **Straight Mode / Corner Mode** labels (not the early X/Z labels).
- **Battery estimate for real F1 data:** `ErsEstimator` derives an honestly marked `~`/`est.` state
  of charge from throttle/braking/speed; timing eligibility upgrades Boost/Deploy to Overtake only
  inside the one-second window. Demo remains modelled/non-estimated; OpenF1 remains unavailable.
- **Live-session truthfulness:** SignalR often serves the last completed session (e.g. British GP)
  while idle. `isF1FeedLive` rejects Finalised/Complete and out-of-window sessions; the UI shows
  “Waiting”/“Latest available” and only switches the dashboard when `status.live === true`.
- **Responsive command bar:** optional labels, speed controls and phase/time copy collapse before
  essential TOD controls; verified at 1536 CSS px (typical 1920 display at 125% scale).
- **Timing replay correctness:** partial F1 classification deltas are sorted then re-ranked to a
  unique `1..N`; `Stopped` no longer means retired/OUT; Race Control penalties/investigations are
  projected into timing rows. Verified on the affected British GP replay: unique positions,
  Hamilton `+5s`, Verstappen active.
- **Race Control noise control:** repeated blue flags collapse only for the same car and lap;
  different cars/laps remain separate events with stable semantic ids.
- **Timing Tower controls:** sticky `Lcurrent/total` plus a compact Full grid / Top 10 / Top 5 /
  Top 3 selector. Battery cells always show estimated percentage and mode instead of icon-only.
- **Track Map performance:** F1LiveProvider precomputes one stable, bounded 400-point circuit path
  for the whole session, instead of rebuilding up to 20×500 SVG trails every 250ms. It is correct
  immediately on paused loads and backward seeks. Driver markers interpolate between sparse feed
  samples with `requestAnimationFrame`, snap safely on large jumps, and respect reduced motion.
- **Fastest-lap visibility:** Timing Tower uses an explicit `FL` badge and Track Map uses a purple
  halo plus label, rather than relying on a subtle colour stripe.
- **Qualifying Pro:** a dedicated Qualifying Monitor shows the Q1/Q2 cutline, drop zone, best laps,
  sector state, run state and track evolution. The phase strip uses distinct Q1/Q2/Q3 colours,
  neutral intermissions and each phase's chequered flag. Its timer counts down the active phase and
  turns red below 20 seconds; direct states (`IN PITS`, `OUT LAP`, `HOT LAP`) are separated
   from inferred `~PREP LAP` / `~COOLDOWN`. TOD is the 7-column primary surface. All six built-in
  presets are test-guarded for bounds, minimum sizes, collisions and required widgets.
- **Focused qualifying projection:** selecting a driver reveals current/best laps and sectors. During
  a detected hot lap, missing sectors use clean-lap medians adjusted by completed-sector pace, then
  produce an explicitly estimated lap time, confidence tier and projected classification position.
- **Track evolution:** normalized laps carry session completion time. The qualifying estimate pairs
  each driver's representative early/late laps and displays the median late-minus-early delta;
  pit laps and >107%-of-driver-best laps are filtered, avoiding provider array-order bias.
- **AI key persistence:** writes are serialized, Settings has an awaited Save-key action and masked
  loaded indicator, and redacted settings imports preserve the key already stored on the device.
- **Track Map motion:** archive Position data is retained at ~2 Hz and provider snapshots interpolate
  between surrounding frames before the marker RAF pass, removing the former one-second hold/jump.
- **Session loading:** official archive timing commits before high-rate position/telemetry enrichment;
  preprocessing yields between bounded chunks, decoded caches are single-entry, and stale/overlapping
  selection or live-reload requests cannot overwrite the active session. Live polling transfers only
  generation-aware per-topic deltas rather than recloning the accumulated session.
- **Streamed progressive enrichment (2026-07-22):** the `.z` high-rate feeds are decoded while they
  download (line-split + inflate per network chunk, no full-text buffering, periodic main-loop
  yields), enrichment IPC chunks (500 points) are served as soon as their offset window is decoded,
  and `F1LiveProvider` applies chunks as they arrive. The map publishes markers + outline together
  as soon as one *demonstrably closed lap* of Position data exists (`buildClosedTrackPath`: trace
  must return within 300 units of its start after ≥30,000 units ≈ 3 km travelled — a partial
  circuit is never rendered); ERS integrates incrementally per CarData batch; snapshot fan-out is
  throttled to ≥300 ms during streaming. A mid-stream network failure resumes by re-decoding the
  static file and appending only past already-served offsets. Small optional feeds now download in
  parallel with the two required feeds (only DriverList+TimingData gate the commit).
  Second pass (same day): the required core feeds are also stream-parsed during download
  (`getStreamPointsWithRetry`/`consumeResponseLines`); once the map publishes, CarData streams
  CONCURRENTLY with the Position tail (ordering guarantee is now "map publishes before telemetry
  STARTS", enforced by `loadEnrichment`'s `startCarData` gate + unit test); Position uses 250-point
  chunks until 1,000 points/publication so the closed-lap check runs earlier; renderer yields use
  `scheduler.yield()`/MessageChannel instead of clamped `setTimeout(0)` (exported `renderScheduler`);
  and a session whose optional light feed failed transiently is served but NOT cached so a reselect
  heals it. Real-session QA across two consecutive runs: core timing 2.3→1.9 s, map 4.6→4.1 s,
  telemetry green 4.9→4.2 s (vs 5.3/10.8/19.6 s cold and 2.9/8.5/16.8 s warm at baseline) — and the
  QA still asserts rendered ECharts traces, SVG markers, map-before-telemetry and process survival.
- **Third pass (2026-07-22 evening) — live + cold-path structure:**
  (a) **Incremental live ingest**: a CONTINUING live poll (same socket generation, append-only data)
  keeps rolling builds (`lapBuild`/`driverBuild`/`ersBuild` + `ersProcessed`) and the playback
  cursor, processing only newly appended points — per-poll cost is O(new points), no longer
  O(whole session) twice every 4 s; generation changes still rebuild fully (unit-tested).
  (b) **Partial timing commit**: `loadSession` commits once TimingData proves structurally usable
  (`waitForUsableTiming`); a still-downloading tail is marked `partialTiming` and streamed via the
  enrichment channel (`feed:'timing'`), preprocessed chunk-by-chunk; the session resolves only when
  fully applied, and failures reject the load exactly like before. Partial sessions are never
  cached; a Complete session's finished timing buffer is reused on reselect.
  (c) **Position early-request**: the Position request goes out at loadSession entry (saves TTFB;
  Chromium buffers under TCP backpressure) but its body is only consumed AFTER the timing stream
  completes — decoding both pipelines concurrently on the one main thread measurably delayed both
  the commit and the map (found and fixed via QA A/B).
  Verified on a quiet machine (~10 % CPU, 3 consecutive runs): core timing 1.95/2.05/2.42 s, map
  3.27/3.65/4.04 s, telemetry green 4.37/3.83/4.24 s — every milestone at or better than the second
  pass (map gap after timing narrowed from ~2.2 s to ~1.3–1.6 s), vs 5.3/10.8/19.6 s at baseline.
  Measurement lesson: the same build measured 3.8–7.6 s timing on a ~50 %-loaded machine (browser,
  VPN, Zoom) with ~2× run-to-run swings — when validating, benchmark on a quiet machine and judge
  regressions by relative gaps and back-to-back A/B runs, not by absolute one-off milestones.
- **Fourth pass (2026-07-23) — the last structural levers:**
  (a) **Lap-history scan is patch-scoped**: `appendLapHistory` iterates only the driver lines
  present in the incoming timing patch (`point.d.Lines`) instead of all ~20 merged lines every
  frame — a lap can only complete for a driver the patch touches. Values are still read from the
  MERGED line (a patch may carry `NumberOfLaps` while the time/sectors came earlier), regression-
  tested. This cut the dominant preprocessing cost ~10× on a full field.
  (b) **Per-meeting circuit-outline cache** (`STORE_NS.TRACK_PATHS`, keyed by the first two path
  segments = one race weekend = one physical layout, so zero staleness risk): a proven outline is
  persisted on first close and, on any later session of that weekend, applied before enrichment so
  the map publishes markers from the FIRST position chunk with no closed-lap wait. Validated on
  read (array, 20–400 points, finite x/y) and never used for `live`.
  (c) **QA polling resolution** raised from 1 s to 250 ms — up to ~1 s of the previously reported
  telemetry milestone was the poll interval, not the app.
  Quiet-ish machine, 3 consecutive runs (run 1 cold, runs 2–3 warm track cache): core timing
  2.08/3.18/3.00 s, map 4.36/3.73/3.51 s, telemetry 4.67/3.99/3.83 s. The KEY signal is the
  map-after-timing gap collapsing from ~2.3 s (cold, closed-lap wait) to ~0.5 s (warm cache), and
  telemetry landing ~0.3 s after the map. Absolute timing still varies with background CPU.
- **Live disconnect UX:** auth rejection, unexpected socket close and errors produce a persistent global
  sign-in/retry notice; intentional disconnect remains a neutral notification.
- **Replay/video sync:** the wizard now aligns the dashboard directly to the selected feed event and
  starts its clock, then offers bidirectional −600…+120 s visible data shifting (`+` advances data;
  `−` moves it earlier). Race-control candidates use
  exact provider session time and full-session history; offsets persist per provider/session rather
  than leaking between races. Transport/status clocks show effective shifted data time.
- **British GP opening strip:** the phase engine infers lights out from lap 2 minus representative
  early-lap duration and ignores only pre-start TrackStatus carry-over. In 2024, F1 seeds lap 1 at
  `00:00:03.991`, reaches lap 2 at `00:59:50.929`, and publishes no racing yellow, so an opening
  yellow is an artifact. In 2025, the official feed has real sector yellows from `00:56:42.108`,
  followed by a lap-2 VSC at `00:58:07.014`; these remain visible.
- **TOD protected playback:** development now uses the supported castLabs Electron `43.0.0+wvcus`
  build, with Widevine provisioned before any window is created. The TOD surface uses an explicit
  autoplay policy, exact HTTPS provider-host permission checks, and the persistent `persist:tod`
  partition for trusted provider handoffs. Stock Electron starts TOD externally because Companion
  uses the same runtime and cannot add missing DRM capability. Distribution still requires VMP
  signing; authenticated playback must be verified manually without inspecting protected traffic.
  Node.js 22.12+ is required by Electron 43. Startup requires only a Widevine component actually
  registered by the current ECS build (standard CDM on the verified Windows build), avoiding
  failures from exposed-but-unsupported experimental component identifiers.
- **Production TOD VMP path:** `npm run build:win:vmp` creates/code-signs `win-unpacked`, runs the
  pinned official castLabs EVS `sign-pkg --streaming`, fails closed unless `verify-pkg --streaming`
  passes, then creates NSIS from that exact prepackaged directory. EVS is free but requires account signup/login;
  credentials stay in EVS/environment storage and are never committed. This production signature
  is required by many commercial services even when the development CDM reports Ready.
  Without an Authenticode identity, the script disables Electron Builder's signing/edit helper to
  avoid its Windows symlink requirement; with `CSC_LINK`/`WIN_CSC_LINK`/`CSC_NAME`, code-signing
  remains enabled and still happens before VMP.
  **Verified 2026-07-15:** EVS issued and independently verified a production streaming signature
  for `release/0.1.0/win-unpacked/RaceDeck.exe` (1,464 days remaining), the signed app provisioned
  Widevine `4.10.3050.0`, and the user confirmed TOD video plays inside the Embedded surface without
  the former technical-error dialog. Installer: `release/0.1.0/racedeck-0.1.0-setup.exe`.

## 6b. New analytics (2026-07-23)

- **Fuel-corrected pace** (`FuelModel.ts`, pure + `fuel.test.ts`): a labelled estimate that normalises
  lap times to an end-of-race (near-empty) fuel reference. The coefficient is fitted from the event's
  own fresh-tyre laps via a driver-fixed-effects regression (falls back to a physical ~0.055 s/lap of
  fuel; rejects out-of-band fits), and is a deliberate no-op outside race/sprint or when the distance
  is unknown. Wired into `AnalyticsEngine` team/compound pace and — most importantly — the degradation
  slope (fuel was cancelling tyre wear), so it flows into Strategy, Battle, Win-Probability and the AI
  context through the existing `driverRecentPace`/`compoundModel`. Displayed best-laps stay raw.
- **Championship implications** (`ChampionshipEngine.ts` + `standings.ts` + `standings-service.ts` +
  `standingsStore.ts` + `ChampionshipPanel.tsx`, widget key `championship`): projects the title fight at
  the synced moment. `StandingsService` fetches public Jolpica data (same source as the practice roster;
  no key), resolves the session's round from its date, and returns the **pre-round** baseline standings.
  `projectChampionship` applies the current classification's provisional points (2026 tables reused from
  `WinProbabilityEngine`) onto that baseline, re-ranks, and computes movement + alive/eliminated/clinched
  math (conservative sprint allowance). Verified end-to-end against live Jolpica (British GP 2024 → round
  12/24, correct pre-race baseline, 3 remaining sprints). IPC: `standings.season`. Tests: `standings.test.ts`,
  `championship.test.ts`. Round-1/empty-baseline shows a graceful note (no synthetic standings yet — a
  possible follow-up).

## 6c. Proactive notes, voice & UX/accessibility (2026-07-23)

- **Engineer's Notes** (`EngineerNotesEngine.ts` pure + `engineer-notes.test.ts`; `engineerNotesStore.ts`;
  `EngineerNotesPanel.tsx`, widget key `engineer-notes`): the forward-looking counterpart to Race
  Story. `deriveEngineerNotes(prev, cur)` emits deterministic strategic notes from the snapshot diff —
  undercut threats (close + fresher tyres), pit windows (stint age vs compound thresholds), closing
  battles (gap shrink rate), safety-car/VSC stop windows and rain onset. Ingested in
  `sessionStore.recompute` beside Race Story; resets on session change / backward scrub. Deterministic
  by design (honest, offline, testable); LLM phrasing was intentionally NOT added.
- **Voice read-out** (`useSpeech.ts` `useVoiceReadout`, mounted in App): speaks high-priority notes via
  the browser `speechSynthesis` — fully local, no network, no dependency. Only while PLAYING, each note
  once. Opt-in via `settings.voice` (`VoiceConfig`, mirrors MarketConfig through hydrate/export/import)
  and the panel's speaker toggle.
- **Command palette** (`components/shell/CommandPalette.tsx`, mounted in App; `command-palette.test.ts`):
  Ctrl/⌘+K launcher. Pure `filterCommands` (exported, tested). Commands: go-to view, switch workspace,
  play/pause, edit, theme mode, colour-vision, voice toggle, focus driver, add widget. `role="dialog"`
  so the occlusion guard covers TOD. GOTCHA (cost a boot crash, React #185): a zustand selector must
  return a STABLE reference — `s.snapshot?.drivers ?? []` created a new array each call and looped
  useSyncExternalStore; fixed with `s.snapshot?.drivers ?? NO_DRIVERS` (module-const).
- **Colour-blind palettes** (`TYRE_COLORS_BY_VISION` + `tyreColorsFor` in constants; `useTyreColors`
  hook; `theme.colorVision` in ThemeConfig, `root.dataset.colorVision`): deuteranopia/protanopia
  (blue-yellow axis) and tritanopia (red-green axis) tyre palettes. Wired through `TyrePill` (covers
  most widgets), `TyreStrategyTable` and `StintPlanner`; compound LETTER always shown as redundant
  encoding. Settings → Appearance has colour-vision + voice controls.
- **Welcome tour** (`components/shell/WelcomeTour.tsx` + `onboardingStore.ts` + `onboarding.test.ts`,
  App-mounted): first-run, skippable 6-step intro (workspaces, focus, command palette, real data,
  sync). `onboardingStore.hydrate()` (called in App bootstrap) opens it once, gated on a persisted
  `onboardingSeen` flag (`STORE_NS.SETTINGS`); `dismiss()` persists + closes; `openTour()` re-opens
  from the command palette ("Show welcome tour"). It never anchors to DOM nodes (won't break as
  layouts change) and is `role="dialog"` (occlusion guard covers TOD). The e2e specs dismiss it in
  setup (click "Close tour" with a short timeout + `.catch`) so first-run never blocks the suite.
- Verified in the real app: command palette opens on Ctrl+K and filters; colour-vision applies to the
  root; the tour shows on first run, Next advances, Escape dismisses, and the palette re-opens it — no
  page errors. **All four planned themes (fuel, championship, proactive-AI+voice, UX+accessibility) are
  now fully built.** 352 unit tests.

## 7. Next improvements / backlog (suggest before building; get user sign‑off on big ones)

1. **Verify the F1 TV live tier** during an actual session with the user's login; tune token
   passing from the `[f1live-socket]` logs if positions/telemetry don't stream.
2. **Validate estimates against a real live session:** compare Battery/Boost/Overtake behaviour and
   Straight/Corner telemetry against an actual green session; tune only with evidence.
3. **Light‑mode polish pass:** ~27 `bg-white/5` hover fills stay subtle on white (mostly fine);
   audit any that need a themed token instead. Consider a WCAG contrast check on accent‑as‑text.
4. **Organisation:** `widgets/` is flat (25 files) — consider grouping by domain
   (`widgets/timing`, `widgets/strategy`, `widgets/telemetry`, `widgets/live`) with an index
   barrel; update the widget registry/layout ids carefully (they're persisted). Do as one atomic,
   test‑guarded refactor.
5. **Performance follow-up:** ECharts is now code-split and the main bundle fell ~63%; profile other
   heavy widgets before further splitting.

## 8. Gotchas that will bite you

- **Native surface z‑order:** the TOD `WebContentsView` always paints ABOVE the DOM. Overlays use
  `useSurfaceOcclusionGuard` (MutationObserver on `[role=dialog|alertdialog|menu|listbox]` →
  `videoStore.setSurfaceSuppressed`). New overlay types without those ARIA roles must extend the
  selector or they'll hide behind the video.
- **Light mode:** keep the App root's opaque `bg-bg-base` — without it the dark window
  (`window-manager.ts` `backgroundColor:'#080910'`) bleeds through translucent chrome as grey.
- **Persisted layout ids:** widget ids are stored; renaming/moving widgets needs migration.
- **Test files** show phantom `@renderer/@shared` "cannot find module" + implicit‑any diagnostics in
  some editors — they're stale; `npm run typecheck` is the source of truth (vitest has the aliases).
- **2026 data is synthetic/odd** on F1's servers (e.g. British GP LapCount claims a 57‑min lap 1);
  engines represent feeds faithfully — don't "fix" the data, handle it gracefully.

## 9. Memory

Persistent project notes live in `C:\Users\Youssef\.claude\projects\C--Users-Youssef-Documents-F1\
memory\` (`MEMORY.md` index + `racedeck-project.md`, `racedeck-user-prefs.md`). Keep them updated
when architecture or guardrails change. (OpenCode may not read these automatically — this handoff
plus README carries the same context.)

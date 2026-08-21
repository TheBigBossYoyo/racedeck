# RaceDeck

**A premium desktop Formula 1 race companion — a modern, next‑generation alternative to MultiViewer.**

RaceDeck pairs a **legal, user‑authenticated TOD viewing surface** with a **pro‑grade live F1 data dashboard** in one elegant, glassmorphic "command center" workspace. Watch the race and read the timing, strategy, track map, race control and alerts side by side — with a powerful broadcast‑sync system to line the data up with your (delayed) video feed.

> RaceDeck integrates TOD **only** through a legal, user‑authenticated browser surface. It never bypasses DRM, extracts stream URLs, intercepts license keys, reads credentials, or pirates content. See [Legal & content protection](#legal--content-protection).

---

## Table of contents

- [Highlights](#highlights)
- [Tech stack & why Electron](#tech-stack--why-electron)
- [Architecture](#architecture)
- [TOD integration & the fallback ladder](#tod-integration--the-fallback-ladder)
- [Data sources](#data-sources)
- [Getting started](#getting-started)
- [Enabling real DRM playback (castLabs)](#enabling-real-drm-playback-castlabs)
- [Layouts & widgets](#layouts--widgets)
- [Strategy intelligence & the Pit‑Now Simulator](#strategy-intelligence--the-pit-now-simulator)
- [AI Race Engineer (bring your own key)](#ai-race-engineer-bring-your-own-key)
- [Win probability & prediction market](#win-probability--prediction-market)
- [Watching the race: Battle Radar & Race Story](#watching-the-race-battle-radar--race-story)
- [Sync system](#sync-system)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Legal & content protection](#legal--content-protection)
- [Known limitations & roadmap](#known-limitations--roadmap)

---

## Highlights

- **Broadcast + Data workspace** — large TOD video with a full, draggable/resizable data wall around it (react‑grid‑layout). Save and load custom layouts, and add/remove any panel from the **Widgets** palette.
- **Six pro layouts** — Broadcast + Data, Driver Focus, Strategy Wall, Qualifying Pro, **Practice Lab**, Minimal Watch.
- **30 widgets** — the existing race and qualifying suite plus **Practice Run Board**, **Practice Driver Watch**, **Weekend Upgrades**, a **Championship** title-fight projector and proactive **Engineer's Notes** — every panel remains toggleable from the **Modules** settings tab.
- **Pit‑Now Simulator** — a deterministic "if this driver pits *now*" projection: rejoin position, positions lost/gained, rejoin gap to leader, the traffic they'd slot into, and undercut viability vs the car ahead. Pure math, works fully offline.
- **Stint Planner** — the time‑optimal **remaining** strategy (0/1/2‑stop, which compounds, which laps) over a pace + degradation model built from this event's real laps, with ranked alternatives and the two‑compound rule enforced.
- **Pace Battle** — how much faster/slower the focus driver is than the car **ahead and behind** (recent‑pace delta, closing/pulling rate, laps‑to‑catch).
- **Driver Dossier + global focus** — pick one driver anywhere and the whole app follows: a single dossier aggregates position, gaps, tyre/stint, sectors, recent laps, pace battle, pit‑now and the optimal plan.
- **AI Race Engineer** — bring your own **free** API key (Google Gemini or Groq recommended) and RaceDeck turns the live timing into a natural‑language strategist: on‑demand briefings + an ask‑anything chat, **grounded** in the real numbers (incl. the stint plan and pace battle) so it interprets rather than invents.
- **Team pace & Tyre Lab** — which team is genuinely quickest right now (fastest‑car clean‑lap pace), per‑compound pace + degradation for this event, and **the best tyre per team this weekend**.
- **Win Probability** — a built‑in model of each driver's **win / podium / points** chance and expected finish, combining track position, exact/inferred gaps, evidence-weighted recent pace, tyre state, penalties, reliability, race progress and neutralisation uncertainty at the *synced* race moment. Every row explains its strongest factors and the panel exposes data confidence. Optional **public Polymarket odds** compare live prices or automatically load historical prices at a replay moment.
- **Championship implications** — projects the title fight at the synced/scrubbed race moment: applies the current classification's provisional points onto the **real pre‑race standings** (public Jolpica F1 data) and re‑ranks, showing each driver's/team's projected position and the places they'd gain or lose "if the race finished now," plus who is mathematically alive, eliminated or has clinched late in the season. Works live and in replay.
- **Fuel‑corrected pace** — team pace, tyre‑compound pace and degradation are computed on lap times normalised for fuel load (a labelled estimate, fitted from the event's own laps where possible). This removes the fuel effect that flatters late‑race pace and, crucially, was masking real tyre degradation — feeding cleaner numbers to the strategy, battle and win‑probability models alike.
- **Engineer's Notes** — a proactive, deterministic strategy feed (the forward‑looking counterpart to Race Story): undercut threats, opening pit windows, closing battles, safety‑car stop windows and rain onset, surfaced as they emerge live or while scrubbing. High‑priority calls (a safety car, rain) can be **read aloud** by an opt‑in, fully local voice read‑out (browser speech; no network, no dependency).
- **Command palette (Ctrl/⌘+K)** — a searchable launcher for workspaces, views, driver focus, adding widgets, playback and theme/accessibility modes.
- **First-run welcome tour** — a short, skippable guided intro to workspaces, driver focus, the command palette, real F1 data and sync; reopenable anytime from the command palette.
- **Colour‑blind modes** — deuteranopia/protanopia/tritanopia‑safe tyre‑compound palettes, with the compound letter always shown so tyres stay distinguishable regardless of colour vision.
- **Battle Radar** — a whole‑field read of the on‑track fights *right now*: who's attacking whom, the interval, closing rate (and laps‑to‑pass), Overtake Mode eligibility, who's on the fresher tyre, a plain‑language verdict (PASS LIKELY / OVERTAKE / CLOSING / HOLDING) and **Overtake trains**.
- **Race Story** — an auto‑generated running narrative of the race — overtakes, pit stops, tyre changes, fastest laps, lead changes, Safety Cars and retirements — that builds as you **play or scrub** (works live and in replay), each moment clickable to focus that driver.
- **Powerful sync engine** — event-based direct alignment ("mark the safety car you just saw → jump the dashboard there"), bidirectional −600…+120 s data shifting, ±1 / ±5 s nudges, session-scoped offsets and saved presets.
- **Configurable alerts** — flags, SC/VSC, red flag, pit stops, fastest lap, weather, penalties, interval swings, qualifying elimination risk.
- **Real F1 data** — a built‑in **F1 Live Timing** provider reads Formula 1's *own* official timing feed (the source MultiViewer uses): real timing, tyres, telemetry, positions, weather and race control. **Replay** any past session from F1's open archive (no login). Go **live** during a session over F1's modern SignalR Core stream: basic timing is public, and signing in with your **F1 TV subscription** unlocks the gated live data (car positions, telemetry, Driver Tracker) — you log in on F1's own page, RaceDeck never sees your password.
- **Replay mode** — any real session (F1 official or OpenF1), scrubber, playback speed, no‑spoiler toggle, PNG export. Every panel (incl. **Win Probability** and market odds) reconstructs at the scrubbed race moment, so you can rewind a TOD replay and keep the whole dashboard in step.
- **Fully configurable** — a **Modules** settings tab enables/disables every panel; the command‑bar **Widgets** palette and **Focus driver** picker compose any workspace around one driver.
- **2026 battery & aero intelligence** — Battery state and Harvest / Deploy / **Boost / Overtake** modes are modelled for the demo and honestly marked as estimates (`~` / `est.`) for real F1 data because the public feed does not expose state of charge. Active aero uses the official **Straight Mode / Corner Mode** labels.
- **Premium UI** — glassmorphism, team colors, subtle neon accents, smooth motion, dense but readable — with **dark, light and system** color schemes.
- **Works offline** — a bundled, deterministic **Demo Grand Prix** drives the whole app (including the strategy math and analytics) without any live session.

---

## Tech stack & why Electron

| Layer | Choice |
|---|---|
| UI | React 18 + TypeScript + Vite (via `electron-vite`) |
| Desktop shell | **Electron** (with the **castLabs** Widevine‑capable build for production DRM) |
| Styling | Tailwind CSS + shadcn‑style primitives + Framer Motion |
| State | Zustand |
| Charts | Apache ECharts |
| Layout | react‑grid‑layout (drag/resize/save) |
| Persistence | electron‑store (behind a swappable `PersistenceLayer`) |
| Tests | Vitest (+ Playwright config for e2e smoke) |

**Why Electron over Tauri?** The single hardest requirement is *legitimate* DRM playback of the user's own TOD stream plus a robust fallback:

1. **Legitimate Widevine** — the castLabs Electron build provisions a properly VMP‑signed Widevine CDM via `components.whenReady()`. RaceDeck accesses `components` defensively, so it **also runs on stock Electron** (dev/CI) where DRM is simply reported as unavailable.
2. **Embedding that isn't blocked by CSP** — RaceDeck loads TOD in a **`WebContentsView` as top‑level navigation**, not an iframe. `X‑Frame‑Options` / CSP `frame-ancestors` (the usual reason "embedding" fails) **do not apply** to top‑level navigation.
3. **Companion window** — Electron's multi‑window model makes a docked companion window trivial; RaceDeck controls only its geometry, never its content.

---

## Architecture

```
main/     WindowManager · VideoSurfaceManager · AiService · MarketService · F1LiveService · F1AuthManager · F1LiveSocket · PersistenceLayer · ipc/register
preload/  contextBridge → window.racedeck   (typed, sandboxed, no Node in renderer)
shared/   models · ipc-contract · constants · ai · market · f1live · video-fallback (pure, testable)
renderer/
  core/    DataProviderManager · providers/{Demo,F1Live,OpenF1,f1normalize,normalize}
           engines/{SessionSync,Layout,Alert,Strategy,StrategyContext,Analytics,WinProbability,Battle,RaceStory,Theme}
  store/   session · video · layout · settings · sync · alert · strategy · market · raceStory · app (Zustand)
  widgets/ 28 dashboard widgets
  components/ shell (TitleBar, Sidebar, CommandBar, StatusBar, VideoModeIndicator…)
              dashboard (GridLayoutHost, widgetRegistry) · views (Dashboard/Replay/Settings/About)
```

**Core systems** map 1:1 to the brief: `VideoSurfaceManager`, `DataProviderManager`, `SessionSyncEngine`, `LayoutManager`, `AlertEngine`, `StrategyEngine`, `ThemeEngine`, `PersistenceLayer`. **Data models** (`SessionInfo`, `Driver`, `TimingEntry`, `SectorTime`, `LapSample`, `Stint`, `TyreInfo`, `RaceControlMessage`, `WeatherSample`, `PositionSample`, `TelemetrySample`, `DataAvailabilityMap`, `SyncState`, `VideoModeState`) live in `src/shared/models`. Every provider normalizes its raw payloads into these shapes; the UI never sees raw JSON, and a `DataAvailabilityMap` prevents any widget from rendering fabricated data.

---

## TOD integration & the fallback ladder

The `VideoSurfaceManager` (main process) is a state machine. It only navigates a browser surface and observes high‑level lifecycle events — it never inspects protected internals.

```
Mode A  EMBEDDED   WebContentsView (top‑level nav to TOD) overlaid on the video panel.
                   mediaKeySystem granted only for the TOD origin. User logs in normally.
                    Fail detectors: did-fail-load (main frame + hard code), render-process-gone,
                    and load watchdog. X-Frame-Options/CSP probing is read-only diagnostics.
            │  auto‑fallback (with a human‑readable reason)
            ▼
Mode B  COMPANION  Separate BrowserWindow (same persistent session) docked beside the app.
                    Uses the same Electron DRM capability as embedded mode.
            │
            ▼
Mode C  EXTERNAL   shell.openExternal → default browser. Dashboard stays synced.
```

The app clearly reports **"TOD embedded / companion / external mode active"** and, on any fallback, shows a polished banner such as:

> *"TOD playback cannot run in embedded mode on this system due to platform or content‑protection restrictions. RaceDeck has switched to Companion Window mode."*

Sign‑in state persists via Chromium's own `persist:tod` session partition — RaceDeck never reads or extracts those cookies/tokens. Playback signals come only from Chromium's own `media-started-playing` / navigation events. The surface presents a **plain desktop‑Chrome User‑Agent** (no `Electron`/app tokens) so the TOD web player renders normally — this only changes how the browser identifies itself, never DRM or content. If Widevine is unavailable, RaceDeck starts in External mode because Companion uses the same Electron runtime and cannot add DRM capability.

**Troubleshooting embedded playback.** The **TOD** status pill (panel header or command bar) shows the active mode plus *playback / embedded‑OK / Widevine* state and any fallback reason, and lets you switch **Embedded ↔ Companion ↔ External** or reload at any time. RaceDeck deliberately does not infer login state from protected browser data. If the embedded area looks blank or the player won't start: (1) **sign in** — an unauthenticated TOD page can render mostly empty; (2) use the **DevTools** button on the panel to inspect the surface (whether you're logged in); (3) confirm Widevine reports **Ready** — the repository already pins the castLabs build, and `npm run enable-drm` restores that dependency if it was replaced; a custom stock-Electron install cannot decode protected video, so use **External** mode there; (4) run with `RACEDECK_DEBUG=1` to log redacted surface lifecycle diagnostics (`[vsm]` lines).

---

## Data sources

Provider‑abstracted, with capability flags surfaced in the UI:

- **F1 Live Timing (Official)** (`f1live`) ⭐ — **Formula 1's own official timing feed** from `livetiming.formula1.com` (the same source MultiViewer and FastF1 use). Real timing, tyres/stints, telemetry (speed/throttle/brake/gear/RPM/DRS), track positions, weather and race control for **any** session. Fetched + zlib‑decoded in the **main process** and replayed into every widget, so it drives both replay of past races **and near‑live** (the archive fills in during a live session; RaceDeck's sync offset absorbs the short delay). **Public data — no login, token or credential.** F1 TV is only needed for *video*, which RaceDeck handles separately via TOD.
- **Demo** (`demo`) — bundled synthetic Grand Prix. Fully offline, deterministic, zero risk. Default so the app is rich with no network.
- **OpenF1** (`openf1`) — community [openf1.org](https://openf1.org) historical API (2023+, no key). Kept as an alternative real‑data source.

> **Two paths — replay and live.** F1's **open static archive** (`/static/…`) carries every session's data with no login and drives replay. Live timing uses F1's modern **SignalR Core** endpoint (`/signalrcore`): basic timing works anonymously, while signing in with an F1 TV subscription unlocks gated positions, telemetry and Driver Tracker. The obsolete classic `/signalr` endpoint is auth-gated and is not RaceDeck's active live path. Both active paths decode the same F1 feed format.

**How the F1 provider works.** *Replay:* `F1LiveService` (main) fetches the season `Index.json`, then the session's `.jsonStream` feeds (`TimingData`, `TimingAppData`, `WeatherData`, `RaceControlMessages`, `TrackStatus`, `LapCount`, `DriverList`, plus the zlib‑packed `CarData.z` / `Position.z`), strips BOMs, inflates the `.z` telemetry, and returns decoded timelines over IPC. Requests use Electron's persistent Chromium HTTP cache, honoring the official archive's `Cache-Control`/ETag headers across launches instead of redownloading unchanged completed feeds. Core timing is committed first (the small optional feeds download alongside it; only the required two gate the commit); position publishes before telemetry, avoiding a giant blocking structured clone and making the map usable earlier. Both the core `.jsonStream` feeds and the high‑rate `.z` feeds are **stream‑decoded**: lines are split, parsed and (for `.z`) inflated as network chunks arrive (never buffering the multi‑megabyte response), enrichment chunks are served to the renderer while the file is still downloading, and the renderer applies them progressively — the track map publishes as soon as one demonstrably closed lap of Position data exists, and once the map is live, telemetry streams concurrently with the remaining Position tail (the map always publishes before telemetry starts). On slow links the session commits as soon as TimingData proves structurally usable; the timing tail streams through the same chunk channel and is preprocessed while it downloads, and the session only counts as loaded once the full feed is applied. The Position request is issued immediately (its body is consumed only after the timing stream finishes, so the two decode pipelines never contend). Battery/telemetry integrate batch by batch, and a mid‑stream network failure resumes without disturbing already‑served data. A session whose small optional feed failed transiently is served but not cached, so reselecting it heals the gap. **Live sessions are incremental**: a continuing live poll processes only newly appended feed points (rolling lap‑history/driver/battery builds, preserved playback cursor) instead of re‑merging the entire session every few seconds — the per‑poll cost stays flat over a full race. Lap‑history extraction scans only the driver lines present in each incoming patch (a lap can only complete for a driver the patch touches) rather than every driver on every frame. The circuit outline is cached per race weekend (one meeting = one physical layout), so revisiting any session of a weekend you've already opened publishes the map from the first position chunk with no closed‑lap wait. Large preprocessing is chunked across renderer turns, decoded memory caches retain only one completed session, and overlapping selections/reloads are coalesced. *Live:* `F1AuthManager` opens F1's real login in an in‑app window (partition‑isolated — Chromium holds your password, RaceDeck reads only the feed token), and `F1LiveSocket` negotiates + opens the SignalR websocket with that auth, subscribes, decodes the same feed messages, and accumulates them into the same shape. Either way, `F1LiveProvider` (renderer) replays the incremental feed with an F1 recursive deep‑merge, reconstructing a normalized `RaceSnapshot` at any session time (`src/shared/f1live.ts`, `src/renderer/core/providers/f1normalize.ts` — both pure + unit‑tested).

**Going live.** In **Replay**, open **Go Live**. Step 1 (recommended): **Sign in with F1 TV** — a popup loads F1's own login; you sign in with your F1 TV account (RaceDeck never sees your password) and it captures your subscription token to unlock the full live data (car positions, telemetry, Driver Tracker). Step 2: **Connect** — RaceDeck opens Formula 1's real‑time SignalR Core feed, switches to the live session and pins the dashboard to the live edge, refreshing every few seconds. Play remains active at the temporary edge and resumes as new timing packets extend it; only a finished/replay timeline auto-pauses at its end. You can connect without signing in for basic timing only. Auth expiry, unexpected socket closure and connection errors produce a persistent global notice with sign-in/retry actions; intentional disconnects remain neutral. (Connection status + `RACEDECK_DEBUG=1` logs make any hiccup visible.)

---

## Getting started

**Prerequisites:** Node.js ≥ 22.12 and npm. Windows/macOS/Linux (developed & verified on Windows).

```bash
# 1. Install dependencies (downloads the Electron binary the first time)
npm install

# 2. Run in development — ONE command, ONE terminal.
#    electron-vite compiles main+preload, serves the renderer with HMR,
#    and launches the desktop window. There is no separate backend to start.
npm run dev

# 3. Type-check everything (main + preload + renderer)
npm run typecheck

# 4. Build production bundles
npm run build

# 5. Package a Windows installer (optional)
npm run build:win
```

> RaceDeck already pins the castLabs Widevine build. `npm run enable-drm` is a
> repair command that restores that exact dependency if a stock Electron package
> was installed manually; it is not a second process.

On first launch RaceDeck opens the **Demo Grand Prix** mid‑race, so the dashboard is immediately rich. Press **▶** to play, scrub the timeline, drag panels (toggle **Edit**), switch layouts, and open TOD from the video panel.

### Keyboard shortcuts

| Keys | Action |
|---|---|
| `Space` / `K` | Play / pause |
| `←` / `→` (or `J` / `L`) | Seek −10 s / +10 s (`Shift` = ±60 s) |
| `+` / `−` | Advance / rewind dashboard data by 1 s (`Shift` = 5 s) |
| `1`–`6` | Switch workspace layout |
| `E` | Toggle edit (drag/resize) mode |

---

## Enabling real DRM playback (castLabs)

Stock Electron cannot decode Widevine‑protected video. For **real TOD playback**, swap in the castLabs Widevine build and (for distribution) VMP‑sign the packaged app:

```bash
npm run enable-drm     # restores the pinned castLabs Electron 43 dependency
```

> The pinned tag **must match the app's Electron version** (currently `v43.0.0+wvcus` for Electron 43). Keep it on a castLabs-supported line: obsolete releases can lose access to downloadable CDM components.

RaceDeck's main process calls `components.whenReady()` **only if present**, so:

- **Stock Electron** → the app runs fully, but RaceDeck starts TOD in **External** mode because embedded and companion modes share Electron's missing Widevine capability. You can still select either surface for sign-in or diagnostics, but protected video cannot decode there. Use your own Chrome/Edge for playback.
- **castLabs build** → the Widevine CDM is provisioned before any window opens; **embedded and companion DRM playback work** inside RaceDeck.

Production distribution additionally requires VMP signing (macOS: sign VMP **before** code‑signing; Windows: **after**). See the castLabs `electron-releases` wiki.

#### Production VMP signing for embedded commercial playback

The public castLabs build is VMP-signed for development/UAT. A production streaming service may
still show a generic technical error even when the status says **Widevine Ready**, because Chrome
ships Google's production VMP certificate while a development ECS launch does not. RaceDeck's
Windows production pipeline therefore includes an official castLabs EVS hook:

```bash
npm run evs:install       # install/upgrade the official castlabs-evs Python client
npm run evs:signup        # one-time free EVS account signup (or: npm run evs:login)
npm run build:win:vmp     # code-sign/package, then EVS-sign + verify the streaming VMP signature
```

`build:win:vmp` first creates the unpacked Windows application (including Authenticode signing when
configured), then runs `sign-pkg --streaming` and `verify-pkg --streaming`, and finally creates NSIS
from that exact prepackaged directory. It fails closed if packaging, Python, EVS, authentication,
signing, or verification is unavailable. The EVS client is pinned to `1.3.2`. If an Authenticode
identity (`CSC_LINK`, `WIN_CSC_LINK`, or `CSC_NAME`) is configured, executable code-signing occurs
before VMP as required. Without one, the script disables Electron Builder's signing/edit helper and
still produces an EVS-signable personal-use package without requiring Windows symlink privilege. For CI, provide `EVS_ACCOUNT_NAME`,
`EVS_PASSWD`, and `EVS_NO_ASK=1`; never commit those values. Windows Developer Mode or equivalent
symlink privilege may still be required when Authenticode signing is enabled.

This is the supported production remedy—it does not bypass DRM or inspect license traffic. A real
authenticated TOD playback check must be performed with the resulting VMP-signed package.

---

## Layouts & widgets

**Layouts** (switch from the command bar; drag panels; **Save** to persist a custom workspace):

- **Broadcast + Data** — the main experience.
- **Driver Focus** — one driver, everything: dossier, pace battle, comparison, traces and pit projection.
- **Strategy Wall** — a compact three-row pit wall. Timing, Driver Dossier, Pit‑Now and deterministic Strategy Insights form the decision row; TOD, Stint Planner and Win Probability form the analysis row; Pace Battle, optional AI and Tyre Lab provide supporting evidence. Every driver-centric panel follows one focus selection.
- **Qualifying Pro** — broadcast-first qualifying desk with a dedicated Q1/Q2/Q3 colour strip, neutral intermissions, phase-local countdown (red below 20 seconds), cutline board, sectors, track evolution and direct/inferred lap intent (`IN PITS`, `OUT LAP`, `HOT LAP`, `~PREP LAP`, `~COOLDOWN`). Focusing a driver opens their live lap, personal-best lap and sector comparison; hot laps add deterministic projected sectors, lap time, confidence and projected position.

  **Track evolution** is an estimate of circuit pace change: for each driver with representative laps in both halves of the elapsed session, RaceDeck compares their best late clean lap with their best early clean lap, then takes the median driver delta. Pit laps and laps slower than 107% of that driver's best are excluded. A negative value means the track became quicker; `Building…` means there are not yet enough paired drivers.
- **Practice Lab** — a practice-engineering workspace with broadcast, timing, telemetry, lap chart, tyre/team pace, weather and map plus three dedicated panels:
  - **Practice Run Board** infers installation, qualifying, long-run and mixed programmes from completed clean laps, comparing long-run median, consistency and lap productivity without pretending to know private team plans.
  - **Practice Driver Watch** compares the practice roster with the season lineup, identifies reserve/rookie swaps, shows who they replace, sourced junior-series background and results when verified, and counts prior F1 practice appearances through OpenF1 when available or dated official F1 records when the public API requires authentication.
  - **Weekend Upgrades** parses the official FIA *Car Presentation Submissions* PDF, showing declared components and explicit no-update submissions. The same panel is appended below every existing widget in **Qualifying Pro**.
- **Minimal Watch** — very large video, compact timing strip, key alerts.

**Widgets:** Timing Tower · **Qualifying Monitor** · **Practice Run Board** · **Practice Driver Watch** · **Weekend Upgrades** · Track Map · Race Control · Weather · Tyre Strategy · Gap Chart · Lap‑Time Chart · Position Trend · Driver Comparison · Telemetry · Strategy Insights · **Pit‑Now Simulator** · **Stint Planner** · **Pace Battle** · **Driver Dossier** · **AI Race Engineer** · **Team Pace** · **Tyre Lab** · **Win Probability** · **Battle Radar** · **Race Story** · Alert Center · Sync Controller · TOD Video.

Any workspace is fully composable: hit **Widgets** in the command bar to add or remove any panel (grouped by Video / Timing / Strategy & AI / Charts / Tools), drag to rearrange, and **Save** the result. The **Modules** tab in Settings is the master switch — disable a panel there and it vanishes everywhere (and from the palette); re‑enable it and it returns to its slot. The **Focus driver** picker in the command bar (or clicking any driver) points the Dossier, Pit‑Now Simulator, Stint Planner and Pace Battle at one driver at once.

The **Timing Tower** shows position, driver, team, tyre + stint age, lap, last/best lap, gap to leader, interval, sector states, pit/retired indicators, penalties/investigations, and highlights personal/session bests and the fastest lap. Click any driver to focus it across the other widgets — including the Pit‑Now Simulator and AI Race Engineer.

The **Track Map** interpolates between surrounding F1 Position frames and then smooths each marker at display cadence. Archive Position data is retained at roughly 2 Hz, avoiding the one-second coordinate holds that previously made cars jump around the circuit while halving the high-rate transfer footprint. On session load the circuit outline and markers appear together as soon as one demonstrably closed lap of Position data has streamed in — typically a second or two after the timing tower — rather than after the whole feed has downloaded.

---

## Strategy intelligence & the Pit‑Now Simulator

Everything the `StrategyEngine` produces is a clearly‑labeled **estimate**, derived only from real, available data. It is deliberately deterministic and pure (`src/renderer/core/engines/StrategyEngine.ts`) so it can be unit‑tested — and so the AI layer is *grounded* in these numbers rather than inventing them.

- **Pit‑Now Simulator** (`predictPitStop`) — for any driver, projects the outcome of boxing *this lap*:
  - **projected rejoin position** and **positions lost/gained** (reference scenario: rivals hold station),
  - **rejoin gap to the leader** (`current gap + pit loss`), the car you'd slot **behind**, and the gap you'd have to chase,
  - the **rejoin‑traffic window** (who's within a few seconds, on which tyres and how worn — i.e. how passable),
  - **undercut viability** vs the car directly ahead, and a **verdict** (`BOX NOW` / `UNDERCUT NOW` / `BOX SOON` / `PREPARE` / `STAY OUT`) with a plain‑English rationale.
  - Pit loss is automatically **discounted under SC/VSC** (a stop is far cheaper when the field is neutralised).
- **Stint Planner** (`planRemainingStrategy`) — searches 0/1/2‑stop options over a pace + degradation model **calibrated from this event's real laps** (per‑compound pace & degradation, personalised by the driver's recent pace), enforces the dry two‑compound rule, and returns the time‑optimal remaining plan plus ranked alternatives with their time cost.
  - Legality is event-aware: a normal dry race must use two dry compounds, prior intermediate/wet use waives that dry-compound requirement, and the Monaco 2025 two-mandatory-stop rule is enforced. The panel shows how many required stops remain and says “No further stop” only after the applicable rule is satisfied.
- **Pace Battle** (`paceComparison`) — recent‑pace delta to the car **ahead and behind**, whether the gap is closing or opening, and the estimated laps to catch/be caught.
- **Team Pace & Tyre Lab** (`AnalyticsEngine`) — from clean laps only (pit and neutralised laps filtered):
  - **Team pace** ranks teams by their fastest car's representative clean‑lap pace, with the gap to the quickest team.
  - **Tyre Lab** shows per‑compound pace + median per‑stint **degradation** for this event, and computes the **best tyre per team** so far.
- **Strategy Insights** — undercut/overcut windows, degradation warnings, safety‑car opportunities, close battles and **teammate battles**.

Pick the target driver from the Timing Tower or the simulator's own driver strip — the AI Race Engineer follows the same selection.

---

## AI Race Engineer (bring your own key)

RaceDeck ships a provider‑agnostic AI layer that reads the live timing and answers strategy questions in plain language — **you supply the key**, so it stays free/cheap and fully under your control.

**How it stays honest.** The renderer builds a compact, factual **context** from the current snapshot — classification, weather, recent race control, the deterministic Pit‑Now projection, team pace and per‑compound/tyre analytics — and the system prompt forces the model to reason **only** from that context, to treat the engine's numbers as fact, and to label predictions as estimates. It interprets; it doesn't fabricate lap times or gaps.

**Where it runs.** The HTTP call is made in the **main process** (`AiService`) via a typed IPC channel, so the key never lives on the untrusted TOD surface and requests get a hard timeout. Two request shapes cover the whole landscape:

| Provider | Free? | Notes |
|---|---|---|
| **Google Gemini** ⭐ | ✅ free tier | Recommended. Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — no credit card. Fast Flash models. |
| **Groq** | ✅ free | Extremely fast open models (Llama, GPT‑OSS). [console.groq.com/keys](https://console.groq.com/keys) |
| **OpenRouter** | ✅ free models | One key, many models incl. several `:free`. [openrouter.ai/keys](https://openrouter.ai/keys) |
| **DeepSeek** | 💲 cheap | Strong reasoning; the reasoner model suits strategy. |
| **OpenAI** | 💲 paid | If you already have an account. |
| **Custom (OpenAI‑compatible)** | 🖥️ local | Ollama / LM Studio / vLLM — 100% local & private, no key needed. |

**Setup:** *Settings → AI Race Engineer* → enable, pick a provider, paste your key (there's a **Get a key** link), choose a model, and **Test connection**. Then use the **AI Race Engineer** panel to generate a briefing or ask questions ("Should the leader pit now?", "Who has the best tyre for the final stint?").

Your key is stored **locally** on your device, sent only to the provider you choose alongside the timing context, and is **excluded from exported settings by default**. The AI context also includes the **Win Probability** model so the engineer can reason about who's actually likely to win/podium.

AI configuration writes are serialized and the Settings page provides an explicit **Save key** confirmation with a masked local-key indicator. Importing a normal redacted settings backup preserves an already stored key instead of replacing it with an empty value.

---

## Win probability & prediction market

RaceDeck ships a **built‑in win model** (`WinProbabilityEngine`, pure + unit‑tested) that estimates every driver's **win / podium / points** chance and expected finishing position — from track position, gaps, recent pace and laps remaining, inflating its uncertainty under Safety Car and rain. It's evaluated at the **sync‑shifted race moment**, so it's correct live *and* at any scrubbed point of a replay. The method is a pairwise Poisson‑binomial ("who finishes ahead of whom") model; win chances are normalised to sum to 100%.

- **Metric switch** — Win / Podium / Points, sorted, team‑coloured bars, click a driver to focus.
- **Model‑vs‑market edge** — with the market overlay on, each row shows the market %, and the model‑minus‑market **edge** (green = the model rates them higher than the crowd).

**Optional Polymarket overlay (opt‑in).** *Settings → Win‑odds market* → enable to overlay **public** Polymarket win odds. RaceDeck searches both the session wording and the canonical GP name (for example Silverstone → British Grand Prix), maps each binary Yes market to its driver, and lets you **search / pin** an exact event. Closed historical events automatically use price history at the current replay moment instead of misleading resolved 0/1 prices.

Replay history uses an absolute event-time window (`startTs` / `endTs`) because Polymarket's `interval=max` path is unreliable for resolved markets. Prices are normalized across the matched driver field at each replay moment, producing comparable probabilities rather than displaying raw binary-market prices.

- Public **read‑only** data via Polymarket's open Gamma + CLOB endpoints — **no key, no account**. Fetches run in the **main process** through Electron's Chromium network stack (`net.fetch`) with a hard timeout and system-proxy support.
- RaceDeck sends **only the Grand‑Prix name** to look up the market — never your identity, TOD credentials, tokens, or any content. It's off by default and clearly labelled third‑party. Prediction‑market odds are opinion, not fact.

---

## Watching the race: Battle Radar & Race Story

Two panels are built purely to help you *follow and understand* the race as it unfolds — both deterministic, offline, and unit‑tested.

- **Battle Radar** (`BattleEngine`) scans the whole field for cars running nose‑to‑tail (within ~2 s) and, for each fight, shows the interval, the **closing rate** in s/lap (and laps‑to‑pass), **Overtake Mode eligibility**, the **tyre‑age edge** (who's on fresher rubber), whether it's a **teammate** scrap, and a verdict — **PASS LIKELY / OVERTAKE / CLOSING / HOLDING** — sorted by heat. It also flags **Overtake trains** (3+ cars nose‑to‑tail). Click a fight to focus that driver.
- **Race Story** (`RaceStoryEngine`) is an auto‑narrator: it diffs each frame against the last and logs the moments that matter — overtakes (only clean on‑track passes, never pit‑cycle shuffles), pit stops, tyre changes, fastest laps, lead changes, Safety Cars/flags and retirements. It builds as you **play or scrub**, resets cleanly when you jump back or change session, and each entry is clickable. Because it's fed by the same synced snapshots, it narrates the race **at your video's delay** and works identically in replay.

---

## Sync system

Broadcast delay varies, so RaceDeck decouples the **data clock** from the **video clock**. The Sync Wizard is the primary control: pause or watch for a recognizable event on TOD, select that event type, then mark it. Picking the matching event jumps the **whole dashboard** to that exact feed-relative time and starts its clock. Fine-tuning then applies `data = clock − offset` to timing, strategy, the Pit‑Now Simulator and Win Probability together.

- **Slider** −600…+120 s, **±1 s** fine, **±5 s** coarse. `+` advances dashboard data; `−` moves it earlier.
- **Always‑on status‑bar control** — a data-shift chip with quick −/+ nudges is docked in the status bar, so you can trim alignment from anywhere without opening the Sync Controller.
- **Persistent badge** — saved independently per broadcaster and session, so one race cannot restore another race's delay.
- **Sync Wizard** — pick the event you just saw on video (race start / SC / VSC / yellow / red / pit), click **Mark event on video**, then pick a feed event to align and start the dashboard there. Race start uses the reconstructed lights-out time directly.

The sync math is pure and unit‑tested (`src/renderer/core/engines/SessionSyncEngine.ts`).

---

## Testing

```bash
npm run test        # Vitest unit suites
npm run test:e2e    # Playwright (build first: npm run build)
```

Unit suites (352 tests) cover the required areas plus atomic/staged session loading, independently retryable required feeds, rejection of unusable partial archives, first-usable timing startup, map-first high-rate enrichment, streamed progressive `.z` decoding with chunk serving during download, mid-stream resume, closed-lap map publication gating, chunked archive transfer, runtime IPC bounds, same-provider and cross-provider cancellation, retryable high-rate downloads, generation-aware live deltas and reconnect replacement, live/archive cursor boundaries, live disconnect notices, renderer sampling, shared animation-frame batching, snapshot allocation reuse, live performance-mode cadence/theme enforcement, coherent live rank/gap normalization, calibrated points probabilities, sparse live tyre/stint merging, provider-consistent fastest-lap attribution, honest position/battery availability, live-edge playback, sourced practice-driver enrichment, practice analysis, bounded FIA upgrade parsing, practice request validation, complete-field replay odds, strategy, AI, qualifying, layout, win‑model, market, battle, race‑story & F1‑feed logic:

- **`sync.test.ts`** — offset math, clamping, nudging, wizard candidate matching.
- **`layout-persistence.test.ts`** — grid sanitation, saved‑layout serialize/deserialize round‑trip, persistence adapter.
- **`fallback.test.ts`** — failure classification, the embedded→companion→external ladder, mode copy.
- **`provider-normalization.test.ts`** — compound/flag/gap/severity normalization, binary‑search sampling, and the Demo provider's normalized snapshots (coherence, honest availability, determinism).
- **`strategy.test.ts`** — Pit‑Now projection (rejoin position, traffic and pit loss), actionable undercut/degradation gates, lap-one/VSC conservatism, and replay future-lap isolation.
- **`analytics.test.ts`** — team‑pace ranking, per‑compound performance ordering, best‑tyre‑per‑team, and the AI analytics summary.
- **`planner.test.ts`** — the compound model, the remaining‑strategy optimiser (ranking, lap coverage, two‑compound rule, wet/late‑race guards), and the pace‑battle comparison.
- **`ai-context.test.ts`** — the grounded context builder, message construction (system‑prompt first, history preserved), config‑readiness and key‑masking helpers.
- **`winprob.test.ts`** — normalisation and monotonicity, sparse-data confidence, inferred gaps, penalty/pace/tyre effects, end-race certainty, retirement exclusion and SC uncertainty.
- **`market.test.ts`** — Polymarket JSON-string arrays, resolved winner payloads, canonical GP query expansion, event ranking, price history, slug normalisation and accent-insensitive driver matching.
- **`battle.test.ts`** — battle detection invariants (attacker trails by one place, Overtake Mode range, closing rate from pace, verdicts, no in‑pit cars) and overtake‑train grouping.
- **`story.test.ts`** — the snapshot‑diff narrator: Safety Car, lead change, clean on‑track overtake (and *not* mis‑flagging a pit‑cycle swap), pit stop, tyre change, fastest lap and retirement.
- **`f1live.test.ts`** — the F1 feed parsers: BOM strip, timecode→seconds, `.jsonStream` line splitting, the recursive deep‑merge (incl. `_deleted` and type‑change overwrite), and indexed‑object→array.
- **`f1normalize.test.ts`** — F1 state → RaceDeck models: lap‑time/gap parsing, driver list, classification (order, leader gaps, tyres, fastest‑lap flag), stint lap‑range derivation, race‑control accumulation, the weather/track‑status/lap‑count readers, and the closed‑lap track‑path gate (no partial circuit is ever rendered from a partial download).
- **`performance.test.ts`** — bounded heavy-model publication, immediate session changes, one shared animation frame for a full field, immutable snapshot collection reuse between lap completions, official F1 stint-cache invalidation and runtime performance-mode theme enforcement.
- **`fuel.test.ts`** — the fuel model: coefficient recovery from field data, fuel/degradation separation, physical-default fallback, plausibility-band rejection, race/sprint-only scoping, and unmasking degradation the fuel burn was hiding.
- **`standings.test.ts` / `championship.test.ts`** — Jolpica standings/schedule parsers (with malformed-payload tolerance and sprint-weekend flags), round resolution by session date, and the championship projection: provisional-points application, re-ranking, movement, clinch/elimination math and constructor point summing.
- **`engineer-notes.test.ts`** — the proactive notes: undercut threats (and their absence on equal tyres), pit-window opening, closing battles, safety-car and rain high-priority notes, in-pit exclusion and staying quiet when nothing is happening.
- **`command-palette.test.ts`** — command filtering/ranking (label prefix over keyword match, keyword matches, empty-query passthrough, no-match).
- **`session-loading.test.ts`** — duplicate selection suppression, stale provider-load rejection, live-reload coalescing and provider-selected first usable replay time.
- **`f1-provider-loading.test.ts`** — first reconstructed archive timing frame, live cursor reset across archive switches and stale-state replacement after reconnect.
- **`f1-live-service.test.ts`** — independent required-feed retries, unusable-partial rejection, progressive chunk serving while a `.z` feed is still downloading, and mid-stream failure resume without disturbing served offsets.
- **`live-notice.test.ts` / `live-banner.test.ts`** — auth-expiry, unexpected-close and intentional-disconnect semantics plus persistent global notification UI.
- **`real-session.spec.ts`** — opt-in network regression (`RACEDECK_REAL_SESSION_QA=1`) that loads the latest official F1 archive, measures core timing/enrichment readiness and asserts process/renderer survival.

---

## Project structure

```
src/
  main/            Electron main process
  preload/         Context‑isolated bridge (window.racedeck)
  shared/          Types, IPC contract, constants, pure fallback logic
  renderer/        React app (core engines, providers, stores, widgets, views)
tests/unit/        Vitest suites
electron.vite.config.ts · tailwind.config.js · electron-builder.yml
```

---

## Legal & content protection

RaceDeck is deliberately built to respect TOD/beIN terms and content protection. It **does not**, and by design **cannot**:

- ❌ bypass DRM / Widevine or any content protection
- ❌ extract or sniff TOD stream URLs
- ❌ intercept or read license keys / EME messages
- ❌ scrape, steal, read or extract authentication cookies or tokens
- ❌ reverse‑engineer protected video playback
- ❌ pirate or redistribute content
- ❌ ship hidden auth automation or hardcoded scraping of undocumented endpoints

What it **does**: points a standard, user‑authenticated browser **surface** at TOD, lets you log in normally, and observes only high‑level navigation/playback lifecycle events to drive its UI and fallback. Credential storage is handled entirely by Chromium's own session store.

**AI Race Engineer keys:** the AI layer is entirely optional and uses **your own** provider key. It is stored locally, is used only to send RaceDeck's timing/strategy context to the endpoint you choose, is never shared with TOD/RaceDeck or any third party, and is excluded from exported settings by default. The AI never receives or processes protected video — only public timing/strategy data.

**Prediction‑market overlay:** the Polymarket win‑odds overlay is **opt‑in** and reads **public, read‑only** market data from Polymarket's open Gamma/CLOB endpoints (no key, no account). RaceDeck transmits only the public Grand‑Prix name to look up the market — never your identity, TOD credentials, tokens, or any content. Odds are third‑party opinion shown alongside RaceDeck's own model, never presented as fact.

**F1 timing data:** *replay* reads **public, read‑only** data from Formula 1's own open timing archive (`livetiming.formula1.com/static`) — no login. *Live* uses **your own F1 TV subscription**: you sign in through F1's own login page inside RaceDeck (Chromium stores the password; RaceDeck reads only the auth token needed to open the live feed), exactly as MultiViewer does. This is a legitimate authenticated client for data you pay for — not DRM bypass or piracy (RaceDeck never touches TOD's protected video or keys). For personal use.

RaceDeck is **not affiliated** with Formula 1, TOD, beIN, OpenF1, castLabs, or any AI provider.

---

## Known limitations & roadmap

- **Live timing** connects F1's real‑time **SignalR Core** feed (the *"Go Live"* control). Basic timing is a public stream; the gated live data (car positions, telemetry, Driver Tracker) is unlocked with the user's own **F1 TV subscription** — they sign in on F1's own page and RaceDeck captures only the subscription token needed to open the feed they're entitled to (a legitimate authenticated client — no DRM/video bypass; the TOD video surface is untouched). Anonymous basic timing is verified end‑to‑end against F1's real endpoint. Replay of past races uses F1's open archive and needs no login.
- **Position Trend** is derived honestly from real completed lap times (cumulative race‑time ranking per lap); a live provider's per‑lap classification feed would refine it further.
- **Telemetry** is rich from the Demo provider; OpenF1's high‑rate `car_data`/`location` feeds are intentionally not bulk‑fetched (they're very large) — the UI reports availability honestly.
- **DRM packaging**: production Widevine requires the castLabs build + VMP signing (documented above).
- Roadmap: MQTT live streaming for OpenF1 sponsor tier, real x/y track maps when `location` data is connected, and multi‑monitor companion docking presets.

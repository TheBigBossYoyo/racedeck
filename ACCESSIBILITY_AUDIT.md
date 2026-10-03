# Accessibility, keyboard and theme/unit audit

Covers IMPROVEMENT_OPPORTUNITIES.md #10 (colour-independent state), #11 (keyboard navigation) and
#18 (theme/unit integration). Scope: `src/renderer/widgets/`, `src/renderer/components/ui/`,
`src/renderer/lib/`. Shell components (`components/shell/*`), Settings, stores and engines were
audited where they touch these items but **not edited**; those findings are listed as follow-ups.

Line numbers are as of this audit. Status: **Fixed**, **Open** (reason given) or **Accepted** (no change needed).

Tests: `tests/unit/colour-independent-state.test.ts`, `tests/unit/keyboard-navigation.test.ts`,
`tests/unit/units-theme-integration.test.ts`.

## 1. Colour-independent state (#10)

Baseline already good: TimingTower sector boxes and stale marker, TyrePill (letter + `aria-label`),
ErsBar/ErsGauge (percentage text, `~`/`est.` prefixes), Badge (always text), PitEventLog "In pit" badge,
PitStopPredictor verdict/positions (text and sign), StintPlanner/TeamPace deltas (signed numbers),
RaceControlFeed flag swatch (flag name printed beside it).

| Where | What was colour-only | Fix | Status |
|---|---|---|---|
| `AlertCenter.tsx` (`SEV`, alert row) | Severity (critical/warning/notice/info) was the left border and text colour only; the icon encodes alert *type*, not severity | `sr-only` "Critical: " prefix per row; icon `aria-hidden` | Fixed |
| `RaceControlFeed.tsx` (message row) | Same: severity carried by border, tint and icon colour | `sr-only` severity prefix for critical/warning/notice (info stays unmarked) | Fixed |
| `QualifyingMonitor.tsx` (`SECTOR_TONE`, sector boxes) | Personal-best vs session-best vs none was fill hue only, no label | `role="img"` + `aria-label`/`title` per box; session-best gets the same white inset ring TimingTower uses, so it differs by pattern | Fixed |
| `QualifyingMonitor.tsx` (position cell) | "On the bubble" was amber position number only | `sr-only` "on the cut-off bubble" | Fixed |
| `DriverDossier.tsx` (`SECTOR_TONE`, S1-S3 tiles) | Personal-best / session-best sector was text colour only | `sr-only` state suffix + `title` on the S-label | Fixed |
| `TyrePanel.tsx` (sector degradation chips) | "Heavy" degradation was amber tint only | `sr-only` "(heavy degradation)" | Fixed |
| `DossierDetails.tsx` (`BattleLine`) | Closing rival = green/red trend text only when no laps-to-resolve is known | `sr-only` "closing," | Fixed |
| `DriverComparisonCard.tsx` (`Row`) | Better value = green + semibold only | `sr-only` "(better)" | Fixed |
| `TrackMapDriverMarker.tsx` | Pit / retired (fade), favourite (ring) not in the accessible name; focus state not exposed | `trackMapMarkerLabel()` spells each state; `aria-pressed` = focused | Fixed |
| `TrackMap.tsx` (track halo) | Safety car / VSC / red flag shown only by amber/red outline tint | `role="group"` + `aria-label` and `<title>` "Track map, safety car deployed" | Fixed |
| `ChampionshipPanel.tsx` (`MovementChip`) | Places gained/lost: chevron + number, but no text for AT | `role="img"` "up 2 places" | Fixed |
| `BattleRadarPanel.tsx` (intensity bar) | Fight intensity: bar width and red/amber/grey only | `role="img"` "Battle intensity: high/medium/low" | Fixed |
| `primitives.tsx` `StatusDot` | A lone dot carried state by hue alone; no way to label it | Optional `label` (renders `role="img"` + `aria-label` + `title`); decorative dots are `aria-hidden`. Current widget call sites sit next to text, so none needed a label | Fixed |
| `primitives.tsx` `Segmented` | Selected option = accent tint only | `aria-pressed` on each option, `role="group"` | Fixed |
| `TimingTower.tsx:196` | Focused driver row = `bg-accent/10` tint only (visible cue) | `aria-pressed` added for AT; visible cue unchanged | Open (visual): needs a non-tint marker, e.g. a leading bar, which is a design decision |
| `QualifyingMonitor.tsx:93` | Last-20s timer badge switches accent to danger; text is the time either way | none | Open (low): urgency is colour only; consider a pulse/icon |
| `TyrePanel.tsx:197` (`degradationTone`) | Deg value is tinted green/amber/red; the number and the "Condition" label carry the meaning | none | Accepted: redundant with text |
| `ErsGauge.tsx:33` (`MODE_META`) | Short codes `HRV/BAL/DEP/BST/OT` are cryptic (text, but unexplained) | none | Open (low): the full label is only in the `title` of `ErsBar` |
| `DriverDossier.tsx:352`, `TelemetryTracePanel.tsx:53` | Aero mode badge (sky vs amber); text label present | none | Accepted: text present |

## 2. Keyboard navigation (#11)

Findings for the dense interactive widgets:

- Clickable rows are already real `<button>`s everywhere except the track-map marker (SVG `<g>` with
  `role="button"`, `tabIndex=0`, Enter/Space) - so Enter/Space activation, tab order and roles were sound.
- The gaps were **focus ring**, **exposed selection state**, **unnamed icon-only controls** and
  **hover-only controls that never appear for a keyboard user**.
- Chromium's default focus outline still applies to plain buttons (nothing sets `outline-none` on them),
  so none of the below was "no indication at all"; but rows in clipped scroll bodies lost the outer ring, and DESIGN.md
  promises an explicit ring.

Fixed. Covered by tests: TimingTower, TrackMap marker + map label, PitEventLog, TyreStrategyTable, QualifyingMonitor, AlertCenter, RaceControlFeed, BattleLine, StatusDot, Segmented, Dialog, Slider, DriverSelect, TeamRadio. **Not covered by a test** (pure class/aria additions, verified by tsc and the existing suite only): ring-only changes in TeamPace, Championship, PaceBattle, EngineerNotes, RaceStory, WinProbability, BattleRadar and the two driver pickers; Dossier sector suffix and radio list; TyrePanel heavy chip; DriverComparison "(better)"; MovementChip; BattleRadar intensity; AnnotationsPanel, PluginsPanel and SessionSync preset button names.

| Where | Change |
|---|---|
| `primitives.tsx` | New `FOCUS_RING` / `FOCUS_RING_INSET` class constants (same tokens the `Button` already uses). `Segmented`: `type="button"`, `aria-pressed`, `role="group"`, inset ring |
| `TimingTower`, `QualifyingMonitor`, `TyreStrategyTable`, `WinProbabilityPanel`, `BattleRadarPanel`, driver pickers in `DriverDossier`/`PitStopPredictor` | Inset focus ring on the row/picker button; `aria-pressed` for "this is the focused driver" (matches the existing pickers) |
| `TeamPacePanel`, `ChampionshipPanel`, `PaceBattlePanel` (rival card), `EngineerNotesPanel`, `RaceStoryPanel` | Focus ring on the row buttons |
| `TyreStrategyTable` | Row `aria-label` lists every stint (`strategyRowLabel`), since the bars are colour-coded and only wide stints show the letter |
| `PitEventLogPanel` | Row `aria-label` now includes laps, compounds, pit-lane time (`pitLogRowLabel`); it used to be the bare driver code, hiding the row's content |
| `TrackMapDriverMarker` | `aria-pressed`, fuller label (see section 1) |
| `AlertCenter` | Dismiss button was unnamed and `opacity-0` until hover: now `aria-label`, `focus-visible:opacity-100` and a ring. Mute button `aria-label` + `aria-pressed`; clear button `aria-label` |
| `SessionSyncController` | Preset delete button was unnamed and hover-only: `aria-label`, visible on focus, ring. Fine-tune `Slider` named |
| `AnnotationsPanel`, `PluginsPanel` | Delete note/remove plugin buttons named (the plugin one had neither text nor title); link-driver toggle `aria-pressed` |
| `TeamRadioPanel`, `DriverDossier` radio list | Play/pause buttons named with driver + time, `aria-pressed` = playing, ring |
| `DriverComparisonCard` `DriverSelect` | The two `<select>`s had no accessible name; new `label` prop ("First driver"/"Second driver"), also used by `PaceBattlePanel` |
| `Dialog.tsx` | Close (X) button was unnamed: `aria-label="Close"` + ring |
| `controls.tsx` `Slider` | Forwards `aria-label` to the thumb (Radix puts the name on the root otherwise) |

### Keyboard entry points per widget

| Widget | Tab stops | Activate | Notes |
|---|---|---|---|
| Timing Tower | scope `<select>`, then per row: row button, favourite star | Enter/Space (native button) focuses the driver; star toggles favourite | Star is visible on `:focus-visible` even when not hovered |
| Track Map | one tab stop per driver dot (`role=button`) | Enter/Space focuses the driver | Ring shown via `group-focus-visible`; no arrow-key roving (dots are in position-sort order, not spatial) |
| Tyre Strategy | one row button per driver | Enter/Space focuses the driver | |
| Pit Stop Log | one row button per stop (`<ol>` of buttons) | Enter/Space focuses the driver | |
| Qualifying Monitor | one row button per driver | Enter/Space | |
| Driver Dossier / Pit-Now | picker buttons (toggle-pressed) | Enter/Space | `[` `]` cycle focus driver globally |
| Alert Center | mute, clear, per-alert dismiss | Enter/Space | |
| Win Probability | Sync toggle, metric segmented, market buttons, per-driver rows | Enter/Space | |
| Team Radio / Dossier radio | per-clip play/pause, Transcribe | Enter/Space | |
| Every widget | `WidgetFrame` is a `role=region` with `tabIndex=0` and a ring | Tab lands on the panel first | Header is the drag handle (mouse only; layout editing has no keyboard path) |
| Global | Space/K, arrows, J/L, +/-, 1-6, E, N, I, [ ], D | see `useKeyboardShortcuts.ts` | Suppressed while a button/slider/input owns focus |

Open, in files outside this task's scope (report only):

1. **Command palette** (`components/shell/CommandPalette.tsx`): `Escape` only closes when the search input has
   focus (Tab or click moves focus to a row button and Escape then does nothing; needs a dialog-level
   `onKeyDown`). Options are `<button>`s nested in `role="option"` `<li>`s, so every result is a tab stop and
   the listbox pattern is broken (needs `aria-activedescendant` on the input and non-focusable options).
   No focus trap (`aria-modal` without one), focus is not returned to the trigger on close, and the
   ArrowDown selection is not scrolled into view. Ctrl/Cmd+K is the only entry point (no visible button
   in the palette's own file; check `CommandBar.tsx`).
2. **Transport bar** (`components/shell/TransportBar.tsx`): the seek `Slider` is unnamed (pass
   `aria-label="Playback position"`, the thumb now honours it); `PhaseStrip` (line 228) is a `div` with
   `onClick` only, so click-to-seek is mouse-only; bookmark dots are 6px `<button>`s named only by `title`;
   play/skip icon buttons rely on `title` for their name (computed name works, `aria-label` is safer).
   The speed `Segmented` is fixed by the primitive change above.
3. **Global focus style**: `globals.css` has no `:focus-visible` rule. One
   `button:focus-visible, [role=button]:focus-visible { outline: 2px solid rgb(var(--accent)/.6); outline-offset: 1px }` would cover
   every remaining plain button in Settings, shell and the widgets not listed above (SessionSyncController
   nudge/candidate buttons, TodVideoPanel, PluginsPanel) without touching each file.
4. `TimingTower` row `aria-label="Focus VER"` hides position/gap/tyre from screen readers (an existing test
   pins the name); the fix is `aria-describedby` on a `sr-only` summary, which changes row text content.

## 3. Theme / unit integration (#18)

Already routed correctly: `WeatherPanel` temperatures (`formatTemp`), `DriverComparisonCard` and
`DossierDetails` speeds (`convertSpeed`/`speedUnitLabel`), `RaceControlFeed` clock (`formatClock`),
`ErsGauge` charge gradient (`rgb(var(--good|warn|danger))`), `TyrePanel` trend line (`cssVar`), tyre colours
(`useTyreColors`), delta colours (`text-good/danger/warn` tokens).

| Where | Hardcoded | Fix | Status |
|---|---|---|---|
| `TelemetryTracePanel.tsx` | Speed trace values and the 350 km/h axis ignored `units.speed`; tooltip printed raw unlabeled numbers | `speedTraceScale(unit)`: converts values and axis ceiling; series name `Speed (km/h)` / `Speed (mph)`; tooltip rounds the speed series. km/h values and axis are unchanged | Fixed. Only visible default-setting change: the tooltip series name gained the unit |
| `TeamRadioPanel.tsx`, `DriverDossier.tsx` (radio) | Capture time via `toLocaleTimeString` ignored `units.clock` | `formatClockShort(ts, unit)` in `lib/units.ts`; `local` output is byte-identical to before (asserted); an unparseable time is `--:--` instead of "Invalid Date" in the dossier | Fixed |
| `WeatherPanel.tsx:153` | Track-temp sparkline `rgb(245 158 11)` (literal amber) | `rgb(var(--warn))`, identical in dark theme, darker amber in light. Applied via `style`, since SVG stroke attributes cannot resolve `var()` | Fixed |
| `WeatherPanel.tsx:164,175` | Air/wind sparkline literals `rgb(96 165 250)` / `rgb(148 163 184)` | none | Open: no token matches these colours; routing to `--accent`/`--fg-muted` would change default output |
| `WeatherPanel.tsx:130-142,172` | Wind `m/s`, pressure `mb`, direction `°` hardcoded | none | Open: `UnitsConfig` has no wind/pressure field; needs a `settingsStore` + Settings UI change |
| `AiRaceEngineer.tsx:165` | Briefing timestamp `toLocaleTimeString()` ignores `units.clock` | none | Open (low): seconds-resolution local time; could reuse `formatClock` |
| `DriverDossier.tsx:352`, `TelemetryTracePanel.tsx:53`, `QualifyingMonitor.tsx:33-35`, `ErsGauge.tsx:34,37` | Raw Tailwind `sky-*`/`amber-*` palette for aero mode, run state, harvest/boost | none | Open: no sky/blue semantic token exists; needs a new token (both themes) before these can follow the theme |
| `RaceControlFeed.tsx:15,17` | `#3b8bff` blue flag, `orange-500` black/orange flag | none | Accepted: these are real flag colours, not app semantics |
| `GapChart.tsx:94`, `lib/echarts.tsx:26-67` | Axis/tooltip colours (`#969CAC`, `#E9ECF5`, `rgba(19,22,33,.95)`) are the dark palette baked into the registered echarts theme | none | Open: charts stay dark-styled in light mode; needs a theme rebuild on `data-theme` change (DESIGN.md "Accepted debt") |
| `TodVideoPanel.tsx:141` | `bg-[#06070b]` video letterbox | none | Accepted: intentionally near-black behind video in both themes |
| `lib/echarts.tsx:30` | Default chart series palette hex list | none | Open: the DESIGN.md chart-palette debt |

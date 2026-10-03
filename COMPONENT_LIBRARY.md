# RaceDeck Component Gallery

## 1. Overview

This document is a **usage gallery** for RaceDeck's shared UI primitives — the components in `src/renderer/components/ui/`. It shows, per component, the real prop signature and how existing widgets actually call it.

It deliberately does **not** re-document color tokens, typography scale, spacing conventions, motion rules, the estimated-vs-measured vocabulary, dense-data hierarchy, or accessibility baselines — all of that is already covered in [`DESIGN.md`](../DESIGN.md) at the repo root and should be read first. When a primitive below implements one of those system rules (e.g. `ErsGauge`'s `~`/`est.` language, `WidgetFrame`'s `role="region"`), this doc points back to the relevant `DESIGN.md` section rather than restating it.

Source files covered:
- `src/renderer/components/ui/primitives.tsx` — `Button`, `Segmented`, `Badge`, `ProvenanceBadge`, `TyrePill`, `TeamStripe`, `StatusDot`, `Kbd`, `EmptyState`
- `src/renderer/components/ui/controls.tsx` — `Switch`, `Slider`, `TooltipProvider`, `Tooltip`
- `src/renderer/components/ui/WidgetFrame.tsx` — `WidgetFrame`
- `src/renderer/components/ui/ErsGauge.tsx` — `ErsBar`, `ErsGauge` (plus the exported `MODE_META` and `ErsConfidenceLevel` type)
- `src/renderer/components/ui/Sparkline.tsx` — `Sparkline`
- `src/renderer/components/ui/Dialog.tsx` — `Dialog`, `DialogTrigger`, `DialogClose`, `DialogContent`

Every prop signature below is copied from the actual `interface`/inline type in source, not inferred. Every usage example is copied or lightly trimmed from a real call site (file:line given). Where a component has no loading/error/dark-light-specific branch in its own code, that is stated explicitly rather than assumed.

---

## 2. Per-primitive reference

### `Button` (`primitives.tsx`)

```ts
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
// variant?: 'default' | 'solid' | 'ghost' | 'outline' | 'subtle' | 'danger'  (default: 'ghost')
// size?: 'xs' | 'sm' | 'md' | 'icon' | 'icon-sm'  (default: 'sm')
```

Standard clickable action. It's a `forwardRef`-wrapped native `<button>`, so any native button attribute (`disabled`, `onClick`, `title`, `type`, …) passes through. No built-in loading/empty/error state — those are the caller's responsibility (see `disabled` usage below).

States it supports: `disabled` (native, dims via `disabled:opacity-40`), six visual `variant`s, five `size`s. No dark/light-specific branching — its colors are token-driven (`bg-accent`, `text-fg-muted`, etc.) so theming is automatic via `DESIGN.md`'s token system, not component logic.

Usage:
```tsx
// src/renderer/widgets/AlertCenter.tsx:48
<Button
  size="icon-sm"
  variant={muted ? 'default' : 'ghost'}
  onClick={() => setMuted(!muted)}
  title={muted ? 'Unmute alerts' : 'Mute alerts'}
>
  {muted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
</Button>

// src/renderer/widgets/AiRaceEngineer.tsx:237
<Button variant="solid" size="icon" disabled={asking || !input.trim()} onClick={submit}>
```

### `Segmented<T>` (`primitives.tsx`)

```ts
function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
  className
}: {
  options: { value: T; label: ReactNode; title?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
})
```

Radio-group-style single-choice control (layout switcher, theme mode, density, provider picker). Generic over the value's string-literal union so `onChange` is typed to the caller's option set. No empty/loading state — it always renders its `options` list; the active option is the only visual state (`bg-accent/20` + `shadow-inner-hairline`).

Usage:
```tsx
// src/renderer/components/settings/AppearanceSection.tsx
<Segmented
  value={theme.mode}
  options={[
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' }
  ]}
  onChange={(v) => setTheme({ mode: v })}
/>
```

### `Badge` (`primitives.tsx`)

```ts
function Badge({
  children,
  tone = 'neutral',
  className
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'danger' | 'purple'
  className?: string
})
```

Small tone-coded pill for a short status word or count. **No `title` prop** — this is documented "accepted debt" in `DESIGN.md`; every call site that needs a tooltip wraps the badge in `<span title="...">` itself (see `ProvenanceBadge` below for exactly that pattern). No empty/loading/dark-light state of its own — tone colors are tokens.

Usage:
```tsx
// src/renderer/widgets/ChampionshipPanel.tsx:79
{projection.live && <Badge tone="good">live</Badge>}

// src/renderer/widgets/BattleRadarPanel.tsx:43
<Badge tone={battles.length ? 'accent' : 'neutral'}>
  {battles.length} fight{battles.length === 1 ? '' : 's'}
</Badge>

// src/renderer/widgets/driverDossier/PitHistoryPanel.tsx:63
<Badge tone="warn">penalty</Badge>
```

### `ProvenanceBadge` (`primitives.tsx`)

```ts
function ProvenanceBadge({
  provenance,
  detail,
  className
}: {
  provenance: DataProvenance   // 'measured' | 'feed-derived' | 'modelled' | 'insufficient'
  /** Source/sample-count/replay-boundary text shown in the tooltip. */
  detail?: string
  className?: string
})
```

Thin wrapper around `Badge` that maps a `DataProvenance` value to a fixed label + tone (`measured`→good, `feed-derived`→accent, `modelled`→warn, `insufficient`→neutral) and supplies the tooltip via the wrap-in-`<span title>` pattern `Badge` itself lacks. This is the general-purpose half of the estimated-vs-measured vocabulary described in `DESIGN.md` ("Estimated-vs-measured visual language") — use it unless the value already has an established bespoke convention like `ErsGauge`'s `~`/`est.`.

Usage:
```tsx
// src/renderer/widgets/WeatherPanel.tsx:188
<ProvenanceBadge
  provenance="modelled"
  detail="Read from real weather-sample history, not a forecast — no future prediction."
  className="ml-auto"
/>
```

### `TyrePill` (`primitives.tsx`)

```ts
function TyrePill({
  compound,
  age,
  size = 'md'
}: {
  compound: TyreCompound | null
  age?: number | null
  size?: 'sm' | 'md'
})
```

Compound letter in a colored ring (colors from `useTyreColors()`, the colour-blind-safe palette per `DESIGN.md`) plus an optional `L{age}` laps-on-tyre readout. States: renders `—` when `compound` is `null` (its only "empty" case — there is no loading/error variant); `age` is omitted entirely from the DOM when `null`/`undefined` rather than shown as a placeholder. `HARD` gets a muted-fg ring/text instead of its raw color for contrast. Carries `role="img"` + `aria-label` on the compound circle per `DESIGN.md`'s accessibility baseline (color is never the only signal).

Usage:
```tsx
// src/renderer/widgets/BattleRadarPanel.tsx:116
<TyrePill compound={b.defenderCompound} size="sm" />

// src/renderer/widgets/DriverComparisonCard.tsx:252
a={<TyrePill compound={a.compound} age={a.stintAge} size="sm" />}
b={<TyrePill compound={b.compound} age={b.stintAge} size="sm" />}
```

### `TeamStripe` (`primitives.tsx`)

```ts
function TeamStripe({ color }: { color: string | null })
```

A 3px-wide vertical rounded bar used as a row accent (team color), via `hexColor(color)`. No states beyond "has a color or not" — `null` still renders the bar (with whatever `hexColor(null)` resolves to), there's no explicit empty branch in the component.

Usage:
```tsx
// src/renderer/widgets/TimingTower.tsx:175
<TeamStripe color={d?.color ?? null} />

// src/renderer/widgets/TyreStrategyTable.tsx:69
<TeamStripe color={r.color} />
```

### `StatusDot` (`primitives.tsx`)

```ts
function StatusDot({
  tone,
  pulse = false
}: {
  tone: 'good' | 'warn' | 'danger' | 'neutral' | 'accent'
  pulse?: boolean
})
```

Small colored dot; `pulse` overlays a second `animate-ping` layer for a "live" look (`DESIGN.md`'s `pulse-ring` family). Two states only: pulsing or not — no loading/empty/dark-light branching (tone classes are tokens).

Usage:
```tsx
// src/renderer/components/shell/LiveControls.tsx:57
<StatusDot tone={tone} pulse={live || state === 'connecting'} />

// src/renderer/widgets/WinProbabilityPanel.tsx:412
<StatusDot tone={matchedCount === 0 ? 'warn' : closed ? 'neutral' : 'good'} pulse={!closed && matchedCount > 0} />
```

Note: `src/renderer/components/settings/MarketSection.tsx` defines its own local `StatusDotLite({ closed }: { closed: boolean })` rather than reusing `StatusDot` — a small inconsistency worth knowing about if consolidating, not something to copy for new code.

### `Kbd` (`primitives.tsx`)

```ts
function Kbd({ children }: { children: ReactNode })
```

Renders a `<kbd>` styled as a keyboard-key label, for shortcut hints (`DESIGN.md`'s "Global keyboard shortcuts" section describes the shortcuts themselves). **Currently has no call sites anywhere under `src/renderer/widgets` or `src/renderer/components`** — it is exported but unused at present. If you're documenting a keyboard shortcut in new UI (e.g. a shortcuts-cheatsheet dialog), this is the primitive to reach for rather than inventing inline `<kbd>` styling.

### `EmptyState` (`primitives.tsx`)

```ts
function EmptyState({
  icon,
  title,
  hint
}: {
  icon?: ReactNode
  title: string
  hint?: string
})
```

The standard "no data yet" panel body — `DESIGN.md` is explicit that a widget with no data should render `WidgetFrame` + `EmptyState`, never an empty panel or a raw "Loading…" string. `icon` and `hint` are both optional; `title` is the only required prop. No loading- or error-specific variant exists — callers reuse `EmptyState` for "no session loaded" and "no results" alike, distinguished only by their `title`/`hint` text.

Usage:
```tsx
// src/renderer/widgets/BattleRadarPanel.tsx:31 (no session)
<EmptyState icon={<Swords />} title="No session loaded" />

// src/renderer/widgets/BattleRadarPanel.tsx:66 (session loaded, nothing to show)
<EmptyState
  icon={<Swords />}
  title="No close battles right now"
  hint="Fights appear when cars run within ~2s of each other."
/>

// src/renderer/widgets/AlertCenter.tsx:63
<EmptyState
  icon={<Bell />}
  title="All quiet"
  hint="Flags, safety cars, pit stops and favourite-driver events will surface here. Configure rules in Settings."
/>
```

---

### `Switch` (`controls.tsx`)

```ts
const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>
```

A styled Radix `Switch.Root`/`Thumb` pair — all Radix `Switch` props pass through untyped beyond that (`checked`, `onCheckedChange`, `disabled`, etc.). States come entirely from Radix's own `data-[state=checked|unchecked]` and `disabled:opacity-40`; no additional empty/loading/error handling in this wrapper.

Usage:
```tsx
// src/renderer/components/ReplayView.tsx:73
<Switch checked={noSpoiler} onCheckedChange={setNoSpoiler} />

// src/renderer/components/settings/Toggle.tsx
<Switch checked={checked} onCheckedChange={onChange} />
```

### `Slider` (`controls.tsx`)

```ts
const Slider = forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>
```

Styled Radix `Slider.Root`/`Track`/`Range`/`Thumb`. Same pattern as `Switch`: full Radix prop surface (`value`, `onValueChange`, `min`, `max`, `step`, …) passes through; no extra states added by the wrapper.

Usage:
```tsx
// src/renderer/components/shell/TransportBar.tsx:63
<Slider ... />   // playback scrub bar — see file for full value/onValueChange wiring

// src/renderer/components/settings/AlertsSection.tsx and AppearanceSection.tsx
<Slider ... />   // numeric settings (e.g. sync offset, volume)
```

### `TooltipProvider` / `Tooltip` (`controls.tsx`)

```ts
function TooltipProvider({ children }: { children: React.ReactNode })

function Tooltip({
  children,
  content,
  side = 'top'
}: {
  children: React.ReactNode
  content: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
})
```

`TooltipProvider` wraps a Radix `Tooltip.Provider` (`delayDuration={200}`, `skipDelayDuration={100}`) — mount once near the app root. `Tooltip` wraps a single trigger/content pair; `children` is the trigger (rendered via `asChild`), `content` is the popover body. No loading/empty state; visual identity (`bg-bg-overlay/95`, `shadow-glass-lg`, `backdrop-blur-xl`) comes straight from `DESIGN.md`'s panel tokens.

Usage:
```tsx
// src/renderer/components/shell/Sidebar.tsx:39
<Tooltip key={r} content={label} side="right">
  ...
</Tooltip>

// src/renderer/components/shell/StatusBar.tsx:161
<Tooltip content={`${label}: ${on ? 'available' : 'unavailable'}`}>
  ...
</Tooltip>
```

---

### `WidgetFrame` (`WidgetFrame.tsx`)

```ts
function WidgetFrame({
  title,
  subtitle,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  accent = false,
  noPadding = false,
  scroll = true
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  accent?: boolean
  noPadding?: boolean
  scroll?: boolean
})
```

The glass-panel shell every dashboard widget wraps itself in. `title` is the only required prop and doubles as the `aria-label` for the panel's `role="region"` (per `DESIGN.md`'s accessibility baseline — every `WidgetFrame` is `tabIndex={0}` with a focus ring, Tab-navigable). Its header (`<header class="rd-drag-handle">`) is the `react-grid-layout` drag handle — anything placed in `actions` gets `no-drag` applied automatically so header buttons stay clickable while dragging works elsewhere on the header.

States/flags:
- `accent` (`boolean`, default `false`) — adds a highlighted top border (`accent-top`) for emphasis.
- `noPadding` (`boolean`, default `false`) — body renders without the default `p-3`, for widgets that manage their own list/row padding (tables, feeds).
- `scroll` (`boolean`, default `true`) — body is `overflow-auto`; set `false` for content that manages its own internal scrolling.
- No component-level loading/error/empty state — per `DESIGN.md`, the convention is: a widget with no data renders `WidgetFrame` wrapping an `EmptyState`, not a special `WidgetFrame` prop.
- No dark/light-specific branching in this file — the `glass` class and tokens carry theming.

Usage:
```tsx
// src/renderer/widgets/BattleRadarPanel.tsx:39 (icon + actions)
<WidgetFrame
  title="Battle Radar"
  icon={<Swords />}
  actions={
    <Badge tone={battles.length ? 'accent' : 'neutral'}>
      {battles.length} fight{battles.length === 1 ? '' : 's'}
    </Badge>
  }
>
  {/* ... */}
</WidgetFrame>

// src/renderer/widgets/AlertCenter.tsx:41 (subtitle + noPadding + multi-button actions)
<WidgetFrame
  title="Alert Center"
  icon={<Bell />}
  subtitle={alerts.length ? `${alerts.length}` : undefined}
  noPadding
  actions={
    <>
      <Button size="icon-sm" variant={muted ? 'default' : 'ghost'} onClick={() => setMuted(!muted)} title={muted ? 'Unmute alerts' : 'Mute alerts'}>
        {muted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
      </Button>
      <Button size="icon-sm" variant="ghost" onClick={clear} title="Clear all">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </>
  }
>
  {/* ... */}
</WidgetFrame>
```

---

### `ErsBar` (`ErsGauge.tsx`)

```ts
function ErsBar({
  pct,
  mode,
  estimate,
  confidence,
  deploymentLimited,
  staleMs
}: {
  pct: number | null
  mode: EnergyMode | null
  estimate?: boolean
  confidence?: ErsConfidenceLevel | null   // 'low' | 'medium' | 'high'
  deploymentLimited?: boolean
  /** Ms since CarData last updated (live sessions only); undefined outside live. */
  staleMs?: number | null
})
```

Compact battery bar for a timing-tower row (one per driver, ~5 rows tall). States:
- **Unavailable**: `pct == null` → renders a dashed `BAT — · MODE —` placeholder with an explanatory `title`, instead of a blank cell.
- **Estimate + confidence**: when `estimate === true && confidence === 'low'` the fill is dimmed (`opacity-50`/`opacity-60`) — a reading still close to the seed assumption is visually deprioritized versus a settled one, per `DESIGN.md`'s confidence-labels rule.
- **Stale**: a `STALE` chip appears when `staleMs` exceeds the 5s `CARDATA_STALE_MS` threshold (via `formatStaleness`).
- **Deployment-limited**: a `LIM` chip (lock icon) when `deploymentLimited` is true.
- Border brightens (`border-accent/45`) when `mode` is `BOOST`/`OVERTAKE` ("attack" modes).
- No dark/light-specific branching — colors come from `socTone()`'s token lookups (`rgb(var(--good/warn/danger))`).

Usage:
```tsx
// src/renderer/widgets/TimingTower.tsx:236
<ErsBar
  pct={e.energyPct}
  mode={e.deployMode}
  estimate={e.energyIsEstimate}
  confidence={e.energyConfidence}
  deploymentLimited={e.energyDeploymentLimited}
  staleMs={snapshot.feedFreshness?.CarData}
/>
```

### `ErsGauge` (`ErsGauge.tsx`)

```ts
function ErsGauge({
  pct,
  mode,
  estimate,
  confidence,
  deploymentLimited,
  staleMs,
  trend,
  trendDeltaPct,
  deployBudgetPct
}: {
  pct: number | null
  mode: EnergyMode | null
  estimate?: boolean
  confidence?: ErsConfidenceLevel | null
  deploymentLimited?: boolean
  staleMs?: number | null
  /** Direction of recent battery change, from `deriveEnergyTrend`. */
  trend?: 'charging' | 'stable' | 'draining'
  /** Percentage-point change behind `trend`; null/undefined without enough history. */
  trendDeltaPct?: number | null
  /** Percentage of this lap's deployment allowance still unspent, 0-100. */
  deployBudgetPct?: number
})
```

The detailed, focused-driver counterpart to `ErsBar` (used once, in the Driver Dossier, not per-row). Superset of `ErsBar`'s states plus:
- **Trend arrow**: `trend` maps to an icon+color (`charging`→`TrendingUp`/good, `stable`→`Minus`/muted, `draining`→`TrendingDown`/danger) with an optional `trendDeltaPct` readout and a descriptive `title`.
- **Deploy budget bar**: a second, thinner progress bar shown only when `deployBudgetPct != null`, turning `bg-danger/70` at `<= 0`.
- **Deployment-limited explanation**: a full sentence (`"Lap deployment allowance spent — on reserve until the next lap."`) rather than just a chip, since there's room for prose at this size.
- Same "unavailable" (`pct == null`) placeholder pattern as `ErsBar`, but as a full-width row instead of a compact chip.
- Implements `DESIGN.md`'s `~`/`est.` estimate convention directly (the `est.` badge next to "Battery", and `~` prefixed onto the percentage) — this is the primitive that pattern is documented against, and it is deliberately *not* migrated to `ProvenanceBadge` (see `DESIGN.md` "Accepted debt").

Usage:
```tsx
// src/renderer/widgets/DriverDossier.tsx:316
<ErsGauge
  pct={model.entry.energyPct}
  mode={model.entry.deployMode}
  estimate={model.entry.energyIsEstimate}
  confidence={model.entry.energyConfidence}
  deploymentLimited={model.entry.energyDeploymentLimited}
  staleMs={snapshot.feedFreshness?.CarData}
  trend={model.entry.energyTrend}
  trendDeltaPct={model.entry.energyTrendDeltaPct}
  deployBudgetPct={model.entry.energyDeployBudgetPct}
/>
```

Also exported from this file: `MODE_META` (a `Record<EnergyMode, { label; short; tone }>` lookup for the five energy modes) and the `ErsConfidenceLevel` type — reuse `MODE_META` rather than re-deriving mode labels/colors if a new widget needs to show deploy mode outside these two components.

---

### `Sparkline` (`Sparkline.tsx`)

```ts
function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = 'stroke-fg-muted',
  className
}: {
  readonly values: readonly number[]
  readonly width?: number
  readonly height?: number
  /** Tailwind stroke color class, e.g. "stroke-warn". */
  readonly tone?: string
  readonly className?: string
})
```

A minimal pure-SVG polyline chart for a short numeric series (~6 points), deliberately not echarts — per its own doc comment, the chart-lib bundle cost isn't justified for a chart this small (~100×28px). Convention: a **rising line means "getting worse"** (e.g. slower lap times plotted higher) — y is inverted from the naive mapping, so don't assume standard "up = bigger value" when reading or extending it. States: renders a centered `—` placeholder instead of a polyline when `values.length < 2` (not enough points to draw a line) — there is no separate loading/error state, and no dark/light-specific handling (`tone` is a caller-supplied Tailwind stroke class, itself token-backed).

**Currently unused** — no widget under `src/renderer/widgets` or `src/renderer/components` imports it yet, despite the doc comment referencing an intended tyre-trend-sparkline use case (APP_IMPROVEMENT_ROADMAP.md P1 item 7). Treat the signature above as the contract to build against if wiring that up, rather than a proven call-site pattern.

---

### `Dialog` / `DialogTrigger` / `DialogClose` / `DialogContent` (`Dialog.tsx`)

```ts
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogContent({
  children,
  className,
  title,
  description
}: {
  children: ReactNode
  className?: string
  title?: string
  description?: string
})
```

`Dialog`/`DialogTrigger`/`DialogClose` are direct re-exports of the Radix primitives (all Radix props apply, e.g. `Dialog`'s `open`/`onOpenChange`). `DialogContent` is the only styled piece: a centered glass modal (`glass-strong`, `max-h-[85vh]`, `w-[min(92vw,560px)]`) with a semi-transparent blurred overlay. `title`/`description` are both optional — when neither is given, the header block (including the built-in close `X` button) is skipped entirely, so a headerless dialog must supply its own close affordance inside `children`. No loading/empty state; no dark/light-specific branching beyond the shared `glass-strong` token surface.

Usage:
```tsx
// src/renderer/components/shell/SessionPicker.tsx:25
<Dialog open={open} onOpenChange={setOpen}>
  <DialogTrigger asChild>
    {/* ... */}
  </DialogTrigger>
  <DialogContent title="..." description="...">
    {/* ... */}
  </DialogContent>
</Dialog>

// src/renderer/components/shell/CommandBar.tsx:294 (with explicit DialogClose buttons)
<Dialog>
  <DialogTrigger asChild>{/* ... */}</DialogTrigger>
  <DialogContent>
    {/* ... */}
    <DialogClose asChild>{/* cancel */}</DialogClose>
    <DialogClose asChild>{/* confirm */}</DialogClose>
  </DialogContent>
</Dialog>
```

---

## 3. Composition patterns

Sampling real widgets (`BattleRadarPanel.tsx`, `AlertCenter.tsx`, `ChampionshipPanel.tsx`, `TimingTower.tsx`, `WeatherPanel.tsx`, `DriverDossier.tsx`) shows a consistent shape:

**1. `WidgetFrame` is always the outermost element a widget returns**, both in its normal and its no-data branch:
```tsx
if (!snapshot || !report) {
  return (
    <WidgetFrame title="Battle Radar" icon={<Swords />}>
      <EmptyState icon={<Swords />} title="No session loaded" />
    </WidgetFrame>
  )
}
return (
  <WidgetFrame title="Battle Radar" icon={<Swords />} actions={...}>
    {/* real content */}
  </WidgetFrame>
)
```
The `icon` passed to `WidgetFrame`'s header is typically the *same* icon reused inside the `EmptyState` for the no-data branch (see `BattleRadarPanel.tsx`'s `<Swords />` in both places) — this keeps the panel's visual identity consistent whether or not it has data.

**2. `actions` carries a count `Badge`, a `Segmented`/`Button` control, or nothing** — never prose. `ChampionshipPanel.tsx` and `BattleRadarPanel.tsx` both put a single status `Badge` there; `AlertCenter.tsx` puts two icon `Button`s there (mute/clear). `subtitle` (a plain string) is used instead of `actions` for a short qualifying phrase like `"loading…"`, `"estimate"`, or `"derived from lap times"` — several widgets (`EngineerNotesPanel`, `PitStopPredictor`, `StrategyInsightsPanel`, `TeamPacePanel`) use `subtitle` specifically to flag "this whole panel is an estimate" per `DESIGN.md`'s estimated-vs-measured language, as an alternative to badging every individual value.

**3. `noPadding` pairs with widgets that render their own list rows** (`AlertCenter`, `RaceControlFeed`, `QualifyingMonitor`, `PracticeRunBoard`) — each row then manages its own `px-*`/`py-*` rather than inheriting the frame's default `p-3`, avoiding double-padding around row dividers.

**4. Row-level primitives compose inside the frame's body, not as siblings of it**: `TimingTower.tsx` nests `TeamStripe` (row accent) + `TyrePill` + `ErsBar` + a custom `SectorTriad` all inside one row's flex layout, inside `WidgetFrame`'s scrollable body. `DriverDossier.tsx` similarly stacks `TyrePanel` → `ErsGauge` → aero info vertically inside a single `WidgetFrame`.

**5. Provenance signalling sits next to the value it qualifies, not in the header** — `WeatherPanel.tsx` puts its `ProvenanceBadge` inline with the rain-status text (`className="ml-auto"` to push it to the row's right edge), not up in `WidgetFrame`'s `actions`. `actions`-level badges are reserved for whole-panel state (a count, a "live" flag), while `ProvenanceBadge`/`~`/`est.` decorate individual numbers.

---

## 4. Guidance for building a new widget

Derived from the conventions observed above — a rough "reach for these first" order:

1. **Wrap everything in `WidgetFrame`** with a `title` and (usually) an `icon`. Decide `noPadding` up front if you're rendering a list/table of rows rather than free-flowing content.
2. **Write the no-data branch first**: `WidgetFrame` (same `title`/`icon`) wrapping `EmptyState` with a `title` and, if there's something actionable to tell the user, a `hint`. Reuse the same `icon` in both the frame header and the `EmptyState` for visual continuity.
3. **Pick `subtitle` vs `actions` deliberately**: a short qualifying string (`"estimate"`, `"derived from lap times"`, a stage label) goes in `subtitle`; an interactive control or a count `Badge` goes in `actions`.
4. **For any per-driver row data**, reach for the existing row primitives before writing new markup: `TeamStripe` for the color accent, `TyrePill` for compound+age, `ErsBar` for battery (or `ErsGauge` if this is a single-driver focused view, not a per-row tower), `StatusDot` for a live/connection indicator.
5. **For any value that isn't a straight feed reading**, apply `DESIGN.md`'s estimated-vs-measured rule: use `ProvenanceBadge` unless the value already fits an established bespoke pattern (only `ErsGauge`'s `~`/`est.` currently qualifies — don't invent a third vocabulary).
6. **For settings/config UI** rather than a data widget: `Segmented` for a small fixed choice, `Switch` for a boolean, `Slider` for a numeric range, `Dialog`/`DialogContent` for a confirmation or picker flow, `Tooltip` (inside a mounted `TooltipProvider`) for hover explanations.
7. **Numeric values get `tnum`** (per `DESIGN.md`) regardless of which primitive renders them — several primitives above (`TyrePill`'s age, `ErsBar`/`ErsGauge`'s percentage) already do this internally, but any additional number you render alongside them needs it applied manually.
8. **Don't reach for `Kbd` or `Sparkline` expecting an established pattern to copy** — both are exported but currently have zero call sites in the widget tree; you'd be establishing the first usage, not following one.

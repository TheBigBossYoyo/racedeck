# RaceDeck Design System

This documents the design conventions that already exist in the codebase — tokens, primitives, and the rules that make a dense, live-data dashboard readable. It is a record of what's there, not a redesign. Source of truth for every value below: `tailwind.config.js`, `src/renderer/styles/globals.css`, `src/renderer/components/ui/primitives.tsx`, `src/renderer/components/ui/WidgetFrame.tsx`.

## Color tokens

All color is driven by CSS custom properties in `globals.css`, exposed as Tailwind utilities (`bg-*`, `text-*`, `ring-*`, `border-*`) via `tailwind.config.js`. **Never hardcode a hex color in a component** — every color a widget needs already has a token. The dark values live under `:root`; the light overrides live under `:root[data-theme='light']` — those two blocks are the *only* place any token is ever redefined.

| Token | Role |
|---|---|
| `bg-base` / `bg-raised` / `bg-overlay` | Three background layers, darkest to lightest (app canvas → panel → floating overlay/dropdown) |
| `panel` | Widget panel surface |
| `hairline` / `border` | Separator lines and panel borders |
| `fg` / `fg-muted` / `fg-subtle` | Primary text → secondary → tertiary/label text |
| `accent` / `accent-soft` | Primary interactive/highlight color (cyan) |
| `danger` / `warn` / `good` / `purple` | Semantic states: critical/negative, caution, positive, "best in field" |
| `speed` | Reserved for speed-related accents (currently aliases `accent`) |

Timeline/phase colors are a **separate** dedicated scale (`--phase-pre`, `--phase-green`, `--phase-q1/q2/q3`, `--phase-break`, `--phase-yellow`, `--phase-vsc`, `--phase-sc`, `--phase-red`, `--phase-post`), deliberately distinct hues from the semantic scale above so a yellow flag is never visually confused with Q2's blue. Consumed via `phaseMeta()` in `SessionPhaseEngine.ts`, not raw Tailwind classes.

## Typography

- **Sans**: `Inter var` (body/UI text)
- **Mono**: `JetBrains Mono` (anything numeric or code-like)
- **Display**: `Rajdhani` (reserved for display-scale headings; rarely used directly in dense widgets)
- **`text-2xs`** (`0.6875rem`, `0.02em` tracking): the smallest standard text size, used pervasively for labels/units in dense widgets — this is the size floor, don't go smaller with an ad hoc class.
- **`tnum` class**: applied to every numeric value throughout the app (positions, gaps, lap times, percentages) for tabular figures, so columns of numbers align. If you're rendering a number, it almost certainly needs `tnum`.

## Spacing, radius, shadow

- Spacing follows Tailwind's default scale; widgets lean on the small end (`gap-1`/`gap-1.5`, `px-1.5`/`px-2`, `py-1`/`py-1.5`) — see "Dense-data hierarchy" below.
- `rounded-xl` (0.875rem) / `rounded-2xl` (1.125rem) / `rounded-3xl` (1.5rem) are the three standard corner radii, largest for top-level panels.
- `shadow-glass` / `shadow-glass-lg`: the glassmorphic panel shadow (inset highlight + soft drop shadow) — this is what gives widgets their "floating glass" look. `shadow-glow`: accent-colored glow for emphasis (e.g. an active/focused state). `shadow-inner-hairline`: a 1px inset border via shadow instead of `border`, for surfaces that need a hairline without affecting layout.
- `backdrop-blur-xs` (2px): the minimal blur step, used under `backdrop-blur-xl` (Tailwind default) for panel backgrounds.

## Motion

Four keyframe animations are defined: `fade-in` (0.25s, panels/dropdowns entering), `pulse-ring` (1.8s infinite, live/active status indicators), `flash-purple` / `flash-green` (0.9s, one-shot highlight for "this just changed" — e.g. session-best, fastest lap).

**Reduced motion is a first-class setting**, not just an OS media query: `useSettingsStore`'s `theme.reducedMotion` flag is read directly by animation-bearing widgets (e.g. `TrackMap.tsx` swaps its interpolation duration and disables marker animation entirely when set) and `motion-reduce:transition-none` is applied on top for the OS-level preference. Any new animated element should check both.

## Primitives (`src/renderer/components/ui/primitives.tsx`)

| Component | Purpose |
|---|---|
| `Button` | Variants: `default`/`solid`/`ghost`/`outline`/`subtle`/`danger`; sizes `xs`/`sm`/`md`/`icon`. |
| `Segmented` | Radio-group-style single-choice control (layout switcher, provider picker, playback speed). |
| `Badge` | Small tone-coded pill. Tones: `neutral`/`accent`/`good`/`warn`/`danger`/`purple`. **No `title` prop** — see Accepted debt. |
| `ProvenanceBadge` | The measured/feed-derived/modelled/insufficient vocabulary (P0 work) — use this, not a bespoke badge, for any new value whose trustworthiness needs signalling. |
| `TyrePill` | Compound + age display, with the colour-blind-safe compound palette from `useTyreColors()`. |
| `TeamStripe` | Thin team-color vertical bar used as a row accent. |
| `StatusDot` | Small colored dot, optional `pulse` (uses `pulse-ring`). |
| `Kbd` | Keyboard-key label styling, for shortcut hints. |
| `EmptyState` | Icon + title + hint — the standard "no data yet" panel body. Always prefer this over a bespoke empty message. |

`WidgetFrame` (`src/renderer/components/ui/WidgetFrame.tsx`) is the panel contract every widget wraps itself in: `title` (required), `subtitle`, `icon`, `actions` (right-aligned header content, e.g. a live badge), `bodyClassName`, `accent` (highlighted border), `noPadding`, `scroll` (default `true`). A widget with no data should render `WidgetFrame` + `EmptyState`, never an empty panel or a raw "Loading..." string.

## Estimated-vs-measured visual language

RaceDeck routinely shows values the public F1 feed cannot actually supply (battery state of charge, fuel-corrected pace, projected pit outcomes). These must never look as authoritative as a real feed value:

- **`~` prefix** on the number itself (`~62%`), plus an **`est.` badge** next to the label — the pattern in `ErsGauge.tsx`. Reserved for values with an established, documented visual identity; don't introduce a second "estimate" convention next to it (see `ErsGauge`'s battery/deploy-budget UI, which deliberately was *not* migrated to `ProvenanceBadge` for exactly this reason).
- **`ProvenanceBadge`** (`measured` / `feed-derived` / `modelled` / `insufficient`) for anywhere the estimate/measured distinction isn't already covered by an established pattern like the above — the general-purpose case.
- **Confidence labels** (`low`/`medium`/`high`, e.g. `ErsGauge`'s "warming up"/"settling"/"settled") when a value's *reliability* — not just its provenance — changes over time as more evidence accrues.

## Dense-data hierarchy

The timing tower, driver dossier, and strategy panels pack many numbers into a small area on purpose — this is a cockpit, not a report. The conventions that make that work:
- Text size drops as information becomes secondary: `text-sm`/`text-xs` for primary values, `text-2xs` for labels/units, never smaller.
- Color and icon carry meaning *in addition to* text, never as the only signal (see Accessibility below) — a status is a badge/dot *and* a label, not just a colored bar.
- Numeric columns always use `tnum` so values align vertically even as digit count changes.

## Accessibility constraints

- Interactive SVG elements (e.g. `TrackMapDriverMarker`) carry `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space), and a descriptive `aria-label` built from the actual state (driver code, position, fastest-lap/estimated-position flags) — this is the baseline for any new clickable non-`<button>` element, not an aspiration.
- Focus-visible rings are explicit (`group-focus-visible:opacity-100` pattern), not relying on browser default outlines, since the glass panel backgrounds can make default outlines hard to see.
- Color is never the *only* encoding for a state that matters (tyre compound always shows its letter, not just a color; degradation/condition bands show a label, not just a tone).

## Accepted debt

Documented honestly rather than pretended away:
- `Badge` has no `title` prop — every call site that needs a tooltip on a badge wraps it in `<span title="...">`. A `title` prop on `Badge` itself would remove this repeated wrapper, but hasn't been added; new badge-with-tooltip call sites should follow the existing wrap pattern for consistency rather than inventing a third approach.
- `ErsGauge`'s estimate language (`~`/`est.`) and `ProvenanceBadge` are two parallel "this is not a measured value" vocabularies that were never unified — deliberately, per the P0 work's own reasoning (retrofitting `ErsGauge` would have regressed an established, documented UI convention for no real gain). A full-app sweep to a single vocabulary remains open.
- No design tokens exist yet for chart-specific colors (echarts series colors are set ad hoc per chart) — charts currently pick colors independently rather than from a shared chart palette.

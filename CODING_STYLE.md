# RaceDeck Coding Style

Project-specific conventions that go beyond generic TypeScript/React style. Start here before
inventing a new pattern — most nullability, state-derivation, and comment questions are already
answered below or in [`DESIGN.md`](DESIGN.md) (UI tokens/primitives) and
[`ENGINE_ASSUMPTIONS.md`](ENGINE_ASSUMPTIONS.md) (engine-specific fallback contracts).

## Nullable data handling (IMPROVEMENT_OPPORTUNITIES.md item #22)

This codebase has a strong, deliberate **"null over guess"** discipline: engines and providers
return `null`/mark data as unmeasured rather than inventing or interpolating a plausible-looking
value (see `ENGINE_ASSUMPTIONS.md`'s "Cross-engine conventions" section for the canonical
examples). That discipline only stays legible if `null`/`undefined` are *handled* consistently
too — the audit found both `?.` and explicit `if (x == null)` checks in use, with no rule for
which to reach for. This section is that rule.

### The rule

1. **At a data boundary — parsing raw provider/API JSON, or the exact point a value first
   becomes possibly-absent — use an explicit `== null` / `!= null` check**, not `?.`. This is
   where a reader most needs to see the nullability decision spelled out, and where returning
   early with a clear `null` (rather than letting the value drift into a chain) is the whole
   point of "null over guess."

   ```ts
   // src/renderer/core/providers/f1normalize.ts:49 — parseGap, at the boundary
   // where a raw feed value becomes a typed number | '+1 LAP' | null.
   export function parseGap(v: unknown): number | '+1 LAP' | null {
     if (v == null) return null
     if (typeof v === 'number') return isFinite(v) ? v : null
     // ...
   }
   ```

2. **Downstream of that boundary, `?.`/`??` are fine for short chains — at most 2 property
   hops deep.** A value that's already a typed `T | null` reads clearly through one or two
   optional-chain hops; a reader doesn't need each hop narrated.

   ```ts
   // src/renderer/widgets/WeatherPanel.tsx:81-82 — snapshot is already RaceSnapshot | null,
   // weather/weatherHistory are already-typed optional fields. Two hops, plain and clear.
   const w = snapshot?.weather
   const history = snapshot?.weatherHistory ?? []
   ```

3. **A chain going 3+ hops deep must not be written as one `?.` expression.** Break it into
   named intermediate steps (each ≤2 hops) — or an explicit `if` — so a reader can see *which*
   hop is expected to be absent, instead of a wall of `?.` where any one of three unrelated
   things could be `null`/`undefined`.

   ```ts
   // WRONG — src/main/ai-service.ts, before this fix: which of cand / content /
   // parts is actually optional here? A reader has to check the API docs to know.
   const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''

   // CORRECT — same file, after: each step is its own ≤2-hop chain, and the
   // shape of a Gemini API response (candidate → content → parts) reads as
   // three sequential facts instead of one dense expression.
   const content = cand?.content
   const parts = content?.parts
   const text = (parts ?? []).map((p) => p.text ?? '').join('')
   ```

4. **Never use `?.` to silently swallow a case that should be a real branch.** If the absence
   of a value changes what the caller should DO (show an empty state, use a fallback constant,
   log a warning) — not just what gets substituted inline — write the `if`. Every engine
   documented in `ENGINE_ASSUMPTIONS.md` follows this: `StrategyEngine.degradationTrend` returns
   `null` behind an explicit `if (clean.length < 3) return null`, never a chain of `?.` guesses.

### Where this applies most

- **Provider/normalize boundaries** (`f1normalize.ts`, `F1LiveProvider.ts`, `OpenF1Provider.ts`,
  `DemoProvider.ts`): always explicit checks — this is raw, external, untrusted JSON.
- **Engines** (`src/renderer/core/engines/*`): explicit checks at every sample-size/threshold
  guard (see `ENGINE_ASSUMPTIONS.md`); short `?.` is fine for reading an already-typed field off
  a `RaceSnapshot`/`TimingEntry` inside the function body.
- **Widgets** (`src/renderer/widgets/*`): `snapshot?.field` / `entry?.field` (1-2 hops) is the
  norm and is *not* a violation — `snapshot`/`entry` being possibly-null is already the widget's
  top-level condition, so a short chain off it is exactly what rule 2 above allows.
- **Main-process integrations calling a third-party API** (`ai-service.ts`, `f1-auth.ts`,
  `f1-live-socket.ts`): treat the response the same as any other untrusted boundary — explicit
  checks past 2 hops, per rule 3.

### What this is NOT

This is a style rule, not a mandate to rewrite working code. Don't do a mechanical repo-wide
pass converting every `?.` to an `if` or vice versa — apply it when touching a file for another
reason, or when a genuine 3+-hop chain is found (as in the `ai-service.ts` fix above, which was
the one such case found in the codebase at time of writing).

## Snapshot-derived state (related, not yet enforced — IMPROVEMENT_OPPORTUNITIES.md item #23)

Widgets compute derived state from `RaceSnapshot` in a mix of `useMemo`, custom hooks, and
inline computation with no documented preference. The guideline going forward: any snapshot
derivation that runs on every render should be wrapped in `useMemo` keyed on `snapshot` itself
(not the whole store), matching how most widgets already read `useSessionStore((s) => s.snapshot)`
as a single selector. This item hasn't been enforced or spot-fixed yet — noted here so it isn't
lost, not as a claim that it's already done.

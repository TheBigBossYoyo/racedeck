# RaceDeck — Handoff: Working Through IMPROVEMENT_OPPORTUNITIES.md

> Paste this whole file as your first message in a new Claude Code session to pick up this work
> with no prior context needed.

## What RaceDeck is

A premium Electron + React + TypeScript desktop F1 race companion (repo root:
`C:\Users\Youssef\Documents\F1`, Windows, git repo, branch `master`). It pairs a legal,
user-authenticated TOD/F1 TV video surface with a pro-grade live data dashboard (timing, strategy,
telemetry, track map, race control, win probability, battle radar, race story, battery/ERS). Data
is provider-abstracted (`DataProvider`: `F1LiveProvider` for real F1 data, `DemoProvider` for
synthetic, `OpenF1Provider`); a `RaceSnapshot` fans out to ~40 widgets via Zustand stores.

There is also an older, unrelated `HANDOFF.md` in the repo root — it's stale (written for a
different tool, predates most of the current state) and not the source of truth here. Ignore it
unless you need deep architectural background it happens to still cover correctly.

## Your task

Work through **`IMPROVEMENT_OPPORTUNITIES.md`** at the repo root — a fresh, independent codebase
audit (25 items, grouped by category: Architecture & Data Flow, Testing & Resilience, Code Quality,
Performance & Observability, Accessibility & UX, Data Integrity, State Management, Documentation,
Feature Integration, Monitoring & Diagnostics, Code Patterns, Completeness). It is **separate from**
`APP_IMPROVEMENT_ROADMAP.md` (the pre-existing, numbered P0–P3 feature roadmap, much of it already
shipped) — don't confuse the two, and don't renumber or merge them. `IMPROVEMENT_OPPORTUNITIES.md`'s
own Summary section groups its items by effort/impact — start there.

**Read `IMPROVEMENT_OPPORTUNITIES.md` in full before doing anything else.** Then read
`APP_IMPROVEMENT_ROADMAP.md` too, since several items explicitly reference it (e.g. "P2 30",
"P1 17") and you need that context to avoid re-doing or misunderstanding already-shipped work.

### Suggested sequencing (adjust with the user, don't assume this is fixed)

1. **Documentation-only items first** — genuinely low-risk, fast, and several other items (e.g. the
   test-coverage audit, the schema-validation work) benefit from having the architecture written
   down first. Per the audit's own grouping: #3 (store architecture doc), #6 (Track Map design doc),
   #16 (component library guide), #17 (engine assumptions guide), #25 (feature availability guide).
2. **Small, contained code changes** — #1 (error boundary), #14 (atomic provider-switch), #15
   (persist corruption recovery), #21 (reconnection backoff), #22 (nullable pattern — document +
   spot-fix, don't do a mechanical repo-wide rewrite).
3. **Larger/riskier engineering** — #2 (schema validation), #4 (test coverage audit), #8 (perf
   instrumentation), #20 (circuit-specific tuning). These touch trust-critical engines
   (`StrategyEngine`, `ErsEstimator`, `TyreRead`, `PitCycleModel`) — go carefully, verify each change
   against real behavior, and prefer several small PRs/commits over one giant one.
4. Confirm with the user before starting a large or architecturally-visible item (e.g. moving
   providers to a shared base class, a mechanical repo-wide pattern rewrite) — don't assume "audit
   suggested it" is the same as "user wants it done now."

Don't try to do all 25 in one sitting. Work in batches, verify each batch, and check in with the
user about what to tackle next rather than plowing through the whole list unprompted.

## Non-negotiable operational rules for this repo

- **Verify every change** with `npm run typecheck` (must be clean) and `npx vitest run` (currently
  ~781 tests, all green — keep it that way; a stray inline "cannot find module" or "implicit any"
  diagnostic shown inline while editing is a known stale/one-edit-behind artifact of this tool's
  diagnostics — trust the real `npm run typecheck`/`npx vitest run` output instead, not inline
  hints).
- **"Null over guess" discipline**: this codebase has a strong, deliberate pattern of returning
  `null`/marking data as unmeasured rather than inventing or guessing a plausible-looking value.
  Preserve this in any engine work — never synthesize data that wasn't actually measured or derived.
- **Never commit unless the user explicitly asks.** When they do, review `git status` first — there
  is a pre-existing, unexplained `.omo/` directory at the repo root that must NEVER be committed or
  modified; always stage with `git add -A -- . ':!.omo'` (and exclude any other stray non-project
  files you find, e.g. screen recordings a user drops in the working directory).
- **Installer builds** (only if/when the user asks for one): `npm run build` then
  `node scripts/package-vmp.mjs` (VMP/castLabs signing only — there is no Authenticode certificate
  configured in this environment, and that's expected, not a gap to fix). **Always bump the
  `version` field in `package.json` before building a new installer**, even for a small fix. This
  project spent an entire prior session unable to tell whether a rebuilt installer actually
  contained a fix, because every build shipped under the same version number — bumping the version
  is the only way the user can confirm (via Settings → About) that they're actually running the new
  build.
- **GateGuard**: the first Edit/Write of any file in a turn requires you to briefly state
  importers/callers, the affected public API, any data schema involved, and the user's verbatim
  instruction before the edit is allowed through. This is a hook in this environment, not optional —
  just answer it briefly and retry the same edit.
- Keep changes **small, cohesive, and well-tested** — this is an established, mature codebase with
  real conventions (widget/engine/provider/store layering, `null`-over-guess, per-widget test files
  under `tests/unit/`). Match existing patterns rather than introducing new ones without a reason.
- Only write comments that explain non-obvious *why*, never restate *what* the code does — this
  repo's own style guide (and every recent commit) follows that discipline strictly.

## Where things live (quick map)

```
src/
  main/            Electron main process: window-manager, video-surface-manager, ai-service,
                   f1-live-service, f1-auth, f1-live-socket, persistence, ipc/register.ts
  preload/         contextBridge → window.racedeck (typed IPC surface)
  shared/          framework-free, unit-tested: models, f1live, market, ipc-contract, constants
  renderer/
    core/engines/    pure, unit-tested business logic (StrategyEngine, ErsEstimator, TyreRead,
                     WinProbabilityEngine, SectorDegradation, RaceBookmarks, LayoutManager, …)
    core/providers/  DataProvider abstraction + f1normalize/normalize (pure parsers)
    store/           ~20+ Zustand stores (sessionStore is the hub; most others react to its snapshot)
    widgets/         ~40 dashboard widgets
    components/      shell (TitleBar, Sidebar, StatusBar, TransportBar, banners…), DashboardView,
                     ReplayView, SettingsPage
tests/unit/        one file per engine/store/widget of note, vitest
```

Good luck — this is a well-tested, well-understood codebase at this point. Read before you write,
verify after every change, and keep the user in the loop on anything bigger than a documentation
pass or a small contained fix.

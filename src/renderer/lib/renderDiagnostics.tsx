import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react'
import { recordWidgetRender } from '@renderer/core/engines/DerivationTimings'

/**
 * Dev-only render-cost diagnostics (APP_IMPROVEMENT_ROADMAP.md P1 item 16).
 *
 * React's own production build never invokes a Profiler's `onRender` callback
 * (timing collection is compiled out of `react-dom.production.min.js`), so
 * wrapping a subtree in `<Profiler>` is already a near-zero-cost no-op in a
 * packaged build — no separate "keep it out of production" gate is needed for
 * the measurement itself. The one thing worth gating is the console logging,
 * via `import.meta.env.DEV` (statically replaced by Vite). The same callback
 * feeds the `widgetRender` ring in DerivationTimings, so that readout is only
 * populated in a dev build.
 *
 * Deliberately always mounting the real `<Profiler>` (not conditionally, on
 * `DEV`) keeps this testable: `onRender` still fires under Vitest, so
 * `tests/unit/render-budget.test.ts` can pass its own callback to count
 * commits without needing a production/dev toggle in the test environment.
 */

export const renderProfilerOnRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
  recordWidgetRender(actualDuration)
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug(`[render] ${id} (${phase}) ${actualDuration.toFixed(2)}ms`)
  }
}

/** Wrap a subtree with render-cost profiling. `onRender` defaults to the dev console logger. */
export function DiagnosticProfiler({
  id,
  children,
  onRender = renderProfilerOnRender
}: {
  id: string
  children: ReactNode
  onRender?: ProfilerOnRenderCallback
}) {
  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  )
}

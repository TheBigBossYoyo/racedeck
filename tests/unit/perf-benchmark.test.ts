import { describe, it } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'

/**
 * APP_IMPROVEMENT_ROADMAP.md P1 item 17: heap growth and derivation time over
 * a full replay. Deliberately OPT-IN, not a CI gate (same pattern as
 * tests/e2e/real-session.spec.ts's RACEDECK_REAL_SESSION_QA) — heap usage and
 * wall-clock timing vary run to run and machine to machine, so a hard
 * threshold here would be exactly the flaky-CI-assertion problem the rest of
 * this pass deliberately avoided (see render-budget.test.ts). This is for a
 * human to read after a change that touches the hot snapshot-derivation path,
 * the same role the roadmap's own "3.64ms/tick to 0.006ms" figure was
 * produced by.
 *
 * Run with: RACEDECK_PERF_BENCHMARK=1 npx vitest run tests/unit/perf-benchmark.test.ts
 */
describe('perf benchmark (opt-in, not a CI gate)', () => {
  it('logs heap growth and derivation time across a simulated full-race replay', () => {
    if (process.env.RACEDECK_PERF_BENCHMARK !== '1') return

    const provider = new DemoProvider()
    void provider.loadSession('demo').then(() => {
      const duration = provider.getDuration()
      const stepSec = 1
      const startHeap = process.memoryUsage().heapUsed
      const startMs = performance.now()
      let ticks = 0
      for (let t = 0; t <= duration; t += stepSec) {
        provider.getSnapshotAt(t)
        ticks++
        if (ticks % 600 === 0) {
          const heapMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)
          // eslint-disable-next-line no-console
          console.log(`[perf-benchmark] t=${t}s heap=${heapMb}MB`)
        }
      }
      const elapsedMs = performance.now() - startMs
      const heapGrowthMb = ((process.memoryUsage().heapUsed - startHeap) / 1024 / 1024).toFixed(1)
      // eslint-disable-next-line no-console
      console.log(
        `[perf-benchmark] ${ticks} ticks over ${duration}s replay in ${elapsedMs.toFixed(0)}ms ` +
          `(${(elapsedMs / ticks).toFixed(3)}ms/tick avg) — heap grew ${heapGrowthMb}MB`
      )
    })
  })
})

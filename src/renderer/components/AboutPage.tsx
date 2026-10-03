import { useEffect, useState } from 'react'
import { Zap, ShieldCheck, Github, Database, Scale, Gauge } from 'lucide-react'
import { useAppStore } from '@renderer/store/appStore'
import { getDerivationTimingStats, useSessionStore } from '@renderer/store/sessionStore'
import { formatP50P95 } from '@renderer/core/engines/DerivationTimings'

const TIMING_REFRESH_MS = 3_000

/** Polls the non-reactive timing rings on mount and every few seconds, never per tick. */
function DerivationTimingCard() {
  const [stats, setStats] = useState(getDerivationTimingStats)
  useEffect(() => {
    const id = setInterval(() => setStats(getDerivationTimingStats()), TIMING_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  const samples = stats.snapshotBuild?.count ?? 0
  const rows: Array<[string, string]> = [
    ['Snapshot build p50 / p95', formatP50P95(stats.snapshotBuild)],
    ['Fan-out p50 / p95', formatP50P95(stats.fanOut)],
    ['Widget render p50 / p95', formatP50P95(stats.widgetRender)],
    [
      'Max build / fan-out',
      stats.snapshotBuild && stats.fanOut
        ? `${stats.snapshotBuild.max.toFixed(1)} / ${stats.fanOut.max.toFixed(1)}`
        : '—'
    ],
    ['Samples', String(samples)]
  ]

  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-fg">Derivation timing (ms)</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {rows.map(([k, v]) => (
          <div key={k}>
            <div className="text-2xs uppercase tracking-wide text-fg-subtle">{k}</div>
            <div className="tnum text-sm font-semibold text-fg">{v}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-2xs text-fg-subtle">
        Rolling window of recent recomputes, refreshed every few seconds. Widget render is measured
        in dev builds only.
      </p>
    </div>
  )
}

export function AboutPage() {
  const info = useAppStore((s) => s.info)
  const getDiagnostics = useSessionStore((s) => s.getDiagnostics)
  const currentSession = useSessionStore((s) => s.currentSession)
  const diagnostics = getDiagnostics()

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent/40 shadow-glow">
            <Zap className="h-6 w-6 text-black" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-fg">
              Race<span className="text-accent">Deck</span>
            </h1>
            <p className="text-sm text-fg-muted">
              A premium F1 race companion — a modern MultiViewer alternative.
            </p>
          </div>
        </div>

        <div className="glass grid grid-cols-2 gap-3 rounded-2xl p-4 sm:grid-cols-4">
          {[
            ['Version', info?.version ?? '0.1.0'],
            ['Electron', info?.electron ?? '—'],
            ['Chromium', info?.chrome ?? '—'],
            ['Platform', info?.platform ?? '—']
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-2xs uppercase tracking-wide text-fg-subtle">{k}</div>
              <div className="tnum text-sm font-semibold text-fg">{v}</div>
            </div>
          ))}
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-good" />
            <h2 className="text-sm font-semibold text-fg">Legal & content protection</h2>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-fg-muted">
            <li>• TOD is integrated only through a legal, user-authenticated browser surface.</li>
            <li>• RaceDeck never bypasses DRM/Widevine or any content protection.</li>
            <li>
              • It never extracts stream URLs, intercepts license keys, or reads cookies/tokens.
            </li>
            <li>• It never reverse-engineers protected playback or pirates content.</li>
            <li>
              • DRM playback requires the castLabs Electron build; this build is{' '}
              <span className={info?.drmReady ? 'text-good' : 'text-warn'}>
                {info?.drmReady
                  ? 'Widevine-ready'
                  : info?.drmCapable
                    ? 'castLabs-enabled, but Widevine is unavailable'
                    : 'a standard (non-DRM) build'}
              </span>
              .
            </li>
          </ul>
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="mb-2 flex items-center gap-2">
            <Scale className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-fg">TOD surface modes</h2>
          </div>
          <div className="space-y-2 text-xs text-fg-muted">
            <p>
              <b className="text-good">Embedded</b> — TOD runs inside RaceDeck via a secure,
              top-level browser surface with Widevine support.
            </p>
            <p>
              <b className="text-accent">Companion window</b> — when embedding is blocked, TOD runs
              in a docked companion window managed by RaceDeck.
            </p>
            <p>
              <b className="text-warn">External</b> — as a last resort, TOD opens in your default
              browser and the dashboard stays synced.
            </p>
          </div>
        </div>

        <div className="glass rounded-2xl p-4">
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-fg">Data & credits</h2>
          </div>
          <ul className="space-y-1 text-xs text-fg-muted">
            <li>
              • Official F1 Live Timing powers primary replay/live data; OpenF1 remains an optional
              provider.
            </li>
            <li>
              • Widevine-capable Electron by <b className="text-fg">castLabs ECS</b>.
            </li>
            <li>• Bundled Demo Grand Prix data is synthetic and deterministic.</li>
            <li>• Not affiliated with Formula 1, TOD, beIN, or OpenF1.</li>
          </ul>
          <div className="mt-3 flex items-center gap-1.5 text-2xs text-fg-subtle">
            <Github className="h-3.5 w-3.5" /> RaceDeck — built as a next-generation race companion.
          </div>
        </div>

        <DerivationTimingCard />

        {currentSession && (
          <div className="glass rounded-2xl p-4">
            <div className="mb-2 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-fg">Session diagnostics</h2>
            </div>
            {diagnostics ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  [
                    'Track path cache',
                    diagnostics.trackPathCacheStatus === 'hit'
                      ? 'hit'
                      : diagnostics.trackPathCacheStatus === 'miss'
                        ? 'rebuilt'
                        : 'n/a'
                  ],
                  ['Cache schema', `v${diagnostics.cacheSchemaVersion}`],
                  ['Telemetry points', diagnostics.enrichmentProcessedPoints.toLocaleString()],
                  ['Enrichment', diagnostics.enrichmentIssue ? 'degraded' : 'ok'],
                  ['Position points', diagnostics.trackRawPointCount.toLocaleString()],
                  [
                    'Track reference car',
                    diagnostics.trackReferenceDriver == null
                      ? 'none yet'
                      : `#${diagnostics.trackReferenceDriver}`
                  ],
                  ['Open trace length', diagnostics.trackOpenTraceLength.toLocaleString()],
                  ['Adopted outline', diagnostics.trackAdoptedLength.toLocaleString()],
                  ['Outline closed', diagnostics.trackPathClosed ? 'yes' : 'no']
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-2xs uppercase tracking-wide text-fg-subtle">{k}</div>
                    <div className="tnum text-sm font-semibold text-fg">{v}</div>
                  </div>
                ))}
                {diagnostics.enrichmentIssue && (
                  <p className="col-span-2 text-xs text-warn sm:col-span-4">
                    {diagnostics.enrichmentIssue}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">Not available for this provider.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

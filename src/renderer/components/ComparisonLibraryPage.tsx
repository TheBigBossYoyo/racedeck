import { useState } from 'react'
import { Scale, Save, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useComparisonLibraryStore } from '@renderer/store/comparisonLibraryStore'
import { buildComparisonSummary } from '@renderer/core/engines/ComparisonSummary'
import { formatTemp, formatSpeed } from '@renderer/lib/units'
import { cn } from '@renderer/lib/utils'
import type { TyreCompound } from '@shared/models'

const DRY_COMPOUNDS: TyreCompound[] = ['SOFT', 'MEDIUM', 'HARD']

function fmtSec(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(1)}s`
}

function fmtLap(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return '—'
  const m = Math.floor(ms / 60)
  const s = ms - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

export function ComparisonLibraryPage() {
  const currentSession = useSessionStore((s) => s.currentSession)
  const getFullSnapshot = useSessionStore((s) => s.getFullSnapshot)
  const { entries, save, remove } = useComparisonLibraryStore()
  const units = useSettingsStore((s) => s.units)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveCurrent = () => {
    const full = getFullSnapshot()
    if (!full) return
    save(buildComparisonSummary(full))
  }

  const compared = entries.filter((e) => selected.has(e.sessionId))

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-fg">Comparison Library</h1>
            <p className="text-sm text-fg-muted">
              Save derived, source-labelled summaries and compare pit loss, degradation, top speed,
              team pace and weather across events.
            </p>
          </div>
          <Button
            variant="outline"
            size="md"
            onClick={saveCurrent}
            disabled={!currentSession}
            title={currentSession ? 'Save this session to the library' : 'Load a session first'}
          >
            <Save className="h-3.5 w-3.5" /> Save current session
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <Scale className="mx-auto h-6 w-6 text-fg-subtle" />
            <p className="mt-2 text-sm text-fg-muted">
              No saved sessions yet. Load a session and click "Save current session".
            </p>
          </div>
        ) : (
          <div className="glass overflow-hidden rounded-2xl">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-hairline/25 text-2xs uppercase tracking-wide text-fg-subtle">
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Pit loss</th>
                  <th className="px-3 py-2">Top speed</th>
                  <th className="px-3 py-2">Track / Air</th>
                  <th className="w-8 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.sessionId}
                    className={cn(
                      'border-b border-hairline/10 last:border-0',
                      selected.has(e.sessionId) && 'bg-accent/[0.06]'
                    )}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(e.sessionId)}
                        onChange={() => toggle(e.sessionId)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{e.meetingName ?? 'Session'}</div>
                      <div className="text-2xs text-fg-subtle">{e.sessionName}</div>
                    </td>
                    <td className="tnum px-3 py-2">{fmtSec(e.pitLossMedianSec)}</td>
                    <td className="tnum px-3 py-2">{formatSpeed(e.topSpeedKmh, units.speed)}</td>
                    <td className="tnum px-3 py-2">
                      {formatTemp(e.weather.avgTrackTempC, units.temperature)} /{' '}
                      {formatTemp(e.weather.avgAirTempC, units.temperature)}
                    </td>
                    <td className="px-3 py-2">
                      <Button size="icon-sm" variant="ghost" onClick={() => remove(e.sessionId)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {compared.length >= 2 && (
          <div className="glass overflow-x-auto rounded-2xl p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg">Side-by-side</h2>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-hairline/25 text-2xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-2 py-1.5">Metric</th>
                  {compared.map((c) => (
                    <th key={c.sessionId} className="px-2 py-1.5">
                      {c.meetingName ?? c.sessionName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-hairline/10">
                  <td className="px-2 py-1.5 text-fg-muted">Pit loss (median)</td>
                  {compared.map((c) => (
                    <td key={c.sessionId} className="tnum px-2 py-1.5">
                      {fmtSec(c.pitLossMedianSec)}
                    </td>
                  ))}
                </tr>
                {DRY_COMPOUNDS.map((compound) => (
                  <tr key={compound} className="border-b border-hairline/10">
                    <td className="px-2 py-1.5 text-fg-muted">{compound} deg (s/lap)</td>
                    {compared.map((c) => (
                      <td key={c.sessionId} className="tnum px-2 py-1.5">
                        {c.degradationByCompound[compound] != null
                          ? `${c.degradationByCompound[compound]!.toFixed(3)}`
                          : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-b border-hairline/10">
                  <td className="px-2 py-1.5 text-fg-muted">Top speed</td>
                  {compared.map((c) => (
                    <td key={c.sessionId} className="tnum px-2 py-1.5">
                      {formatSpeed(c.topSpeedKmh, units.speed)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-hairline/10">
                  <td className="px-2 py-1.5 text-fg-muted">Weather (track / air)</td>
                  {compared.map((c) => (
                    <td key={c.sessionId} className="tnum px-2 py-1.5">
                      {formatTemp(c.weather.avgTrackTempC, units.temperature)} /{' '}
                      {formatTemp(c.weather.avgAirTempC, units.temperature)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-2 py-1.5 text-fg-muted">Fastest team</td>
                  {compared.map((c) => {
                    const teams = Object.entries(c.teamPaceMs).sort((a, b) => a[1] - b[1])
                    return (
                      <td key={c.sessionId} className="px-2 py-1.5">
                        {teams.length > 0 ? (
                          <span>
                            {teams[0][0]}{' '}
                            <span className="text-fg-subtle">({fmtLap(teams[0][1])})</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="px-1 pb-2 text-2xs leading-relaxed text-fg-subtle">
          Every figure here is a derived summary computed from the session's own data — never raw
          telemetry or licensed TOD media. Missing values mean the source data wasn't available for
          that session, not zero.
        </p>
      </div>
    </div>
  )
}

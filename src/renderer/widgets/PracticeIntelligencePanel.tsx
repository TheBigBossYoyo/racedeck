import { GraduationCap, Loader2, RefreshCw, ExternalLink, Repeat2 } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState } from '@renderer/components/ui/primitives'
import { usePracticeBriefing } from '@renderer/lib/usePracticeBriefing'
import { bridge, hasBridge } from '@renderer/lib/ipc'

export function PracticeIntelligencePanel() {
  const { snapshot, result, loading, error, refresh } = usePracticeBriefing()
  const swaps = result?.swaps ?? []
  const open = (url: string) => hasBridge() && void bridge().practice.openSource(url)

  return (
    <WidgetFrame
      title="Practice Driver Watch"
      icon={<GraduationCap />}
      subtitle="swaps · rookies · prior FP running"
      actions={
        <button onClick={refresh} className="no-drag rounded p-1 text-fg-subtle hover:bg-white/5 hover:text-fg" title="Refresh public practice context">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      }
      bodyClassName="space-y-2"
    >
      {!snapshot ? (
        <EmptyState title="No session loaded" />
      ) : swaps.length === 0 ? (
        <EmptyState
          icon={<Repeat2 />}
          title={loading ? 'Checking the practice roster…' : 'No practice swap identified'}
          hint={error ?? 'RaceDeck compares this session with the season roster. A normal race lineup produces no swap cards.'}
        />
      ) : swaps.map((swap) => (
        <article key={swap.driverNumber} className="rounded-xl border border-hairline/25 bg-black/15 p-2.5">
          <div className="flex items-start gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent/10 text-xs font-extrabold text-accent">{swap.code}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-fg">{swap.fullName}</div>
              <div className="truncate text-2xs text-fg-muted">{swap.teamName ?? 'Team unavailable'}</div>
            </div>
            <Badge tone="warn">FP SWAP</Badge>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-2xs">
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <span className="text-fg-subtle">Steps in for</span>
              <div className="font-semibold text-fg">{swap.replaces.join(' / ') || 'Regular driver unresolved'}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <span className="text-fg-subtle">Comes from</span>
              <div className="font-semibold text-fg">{swap.originSeries ?? 'Verified series unavailable'}</div>
              {swap.originTeam && <div className="text-fg-muted">{swap.originTeam}</div>}
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <span className="text-fg-subtle">Recent form</span>
              <div className="font-semibold text-fg">{swap.recentResults.join(' · ') || 'No verified junior result snapshot'}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] px-2 py-1">
              <span className="text-fg-subtle">Previous F1 practice</span>
              <div className="font-semibold text-fg">
                {swap.priorPracticeSessions == null ? 'Verified history unavailable' : `${swap.priorPracticeSessions} session${swap.priorPracticeSessions === 1 ? '' : 's'}`}
              </div>
              {swap.priorPracticeEvents.length > 0 && <div className="truncate text-fg-muted">{swap.priorPracticeEvents.join(' · ')}</div>}
            </div>
          </div>
          {swap.pedigree && <p className="mt-2 text-[10px] leading-relaxed text-fg-muted">{swap.pedigree}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {swap.sources.map((source) => (
              <button key={`${source.label}:${source.url}`} onClick={() => open(source.url)} className="no-drag inline-flex items-center gap-1 rounded border border-hairline/25 px-1.5 py-0.5 text-[9px] text-fg-subtle hover:text-fg">
                {source.label}<ExternalLink className="h-2.5 w-2.5" />
              </button>
            ))}
          </div>
        </article>
      ))}
    </WidgetFrame>
  )
}

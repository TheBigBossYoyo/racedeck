import { Wrench, Loader2, RefreshCw, ExternalLink, CheckCircle2 } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState } from '@renderer/components/ui/primitives'
import { usePracticeBriefing } from '@renderer/lib/usePracticeBriefing'
import { bridge, hasBridge } from '@renderer/lib/ipc'

export function WeekendUpgradesPanel() {
  const { snapshot, result, loading, error, refresh } = usePracticeBriefing()
  const upgrades = result?.upgrades ?? []
  const openDocument = () => {
    if (result?.upgradeDocumentUrl && hasBridge()) void bridge().practice.openSource(result.upgradeDocumentUrl)
  }

  return (
    <WidgetFrame
      title="Weekend Upgrades"
      icon={<Wrench />}
      subtitle="official FIA car presentation submissions"
      actions={
        <div className="flex items-center gap-1">
          {result?.upgradeDocumentUrl && (
            <button onClick={openDocument} title="Open official FIA document" className="no-drag rounded p-1 text-fg-subtle hover:bg-white/5 hover:text-fg"><ExternalLink className="h-3.5 w-3.5" /></button>
          )}
          <button onClick={refresh} title="Refresh upgrade submissions" className="no-drag rounded p-1 text-fg-subtle hover:bg-white/5 hover:text-fg">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      }
      bodyClassName="space-y-1.5"
    >
      {!snapshot ? (
        <EmptyState title="No event loaded" />
      ) : upgrades.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title={loading ? 'Loading FIA submissions…' : 'No upgrade document found'}
          hint={error ?? 'The FIA document is normally published during the event. RaceDeck never invents missing upgrades.'}
        />
      ) : upgrades.map((upgrade) => (
        <div key={upgrade.teamName} className="rounded-lg border border-hairline/20 bg-black/15 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-fg">{upgrade.teamName}</span>
            {upgrade.noUpdates ? (
              <Badge tone="neutral"><CheckCircle2 className="mr-1 h-2.5 w-2.5" />No update</Badge>
            ) : <Badge tone="accent">{upgrade.components.length || 'New'} part{upgrade.components.length === 1 ? '' : 's'}</Badge>}
          </div>
          {upgrade.components.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {upgrade.components.map((component) => <span key={component} className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent">{component}</span>)}
            </div>
          )}
          {upgrade.summary && <p className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-fg-muted">{upgrade.summary}</p>}
        </div>
      ))}
      <p className="pt-1 text-[9px] text-fg-subtle">Source: FIA Formula One Media Delegate. Submission descriptions are team-provided, not RaceDeck claims.</p>
    </WidgetFrame>
  )
}

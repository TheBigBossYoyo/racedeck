import { LayoutDashboard, Rewind, Target, Settings, Info, type LucideIcon } from 'lucide-react'
import { useAppStore, type Route } from '@renderer/store/appStore'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { Tooltip } from '@renderer/components/ui/controls'
import { cn } from '@renderer/lib/utils'

const NAV: { route: Route; icon: LucideIcon; label: string }[] = [
  { route: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { route: 'replay', icon: Rewind, label: 'Replay' },
  { route: 'strategy', icon: Target, label: 'Strategy Wall' },
  { route: 'settings', icon: Settings, label: 'Settings' }
]

export function Sidebar() {
  const route = useAppStore((s) => s.route)
  const setRoute = useAppStore((s) => s.setRoute)
  const setLayout = useLayoutStore((s) => s.setLayout)

  const go = (r: Route) => {
    // Strategy nav jumps straight to the Strategy Wall workspace.
    if (r === 'strategy') setLayout('strategy-wall')
    setRoute(r)
  }

  return (
    <nav className="z-30 flex w-[58px] shrink-0 flex-col items-center gap-1 border-r border-hairline/25 bg-bg-base/40 py-3">
      {NAV.map(({ route: r, icon: Icon, label }) => {
        const active = route === r
        return (
          <Tooltip key={r} content={label} side="right">
            <button
              onClick={() => go(r)}
              className={cn(
                'group relative grid h-10 w-10 place-items-center rounded-xl transition-all',
                active
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg-subtle hover:bg-white/5 hover:text-fg-muted'
              )}
              aria-label={label}
            >
              {active && (
                <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent shadow-glow" />
              )}
              <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.4 : 2} />
            </button>
          </Tooltip>
        )
      })}

      <div className="mt-auto">
        <Tooltip content="About RaceDeck" side="right">
          <button
            onClick={() => setRoute('about')}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl transition-all',
              route === 'about' ? 'bg-accent/15 text-accent' : 'text-fg-subtle hover:bg-white/5'
            )}
            aria-label="About"
          >
            <Info className="h-[18px] w-[18px]" />
          </button>
        </Tooltip>
      </div>
    </nav>
  )
}

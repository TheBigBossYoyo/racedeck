import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Monitor, PanelRight, ExternalLink, RotateCw, Radio } from 'lucide-react'
import { useVideoStore } from '@renderer/store/videoStore'
import { StatusDot } from '@renderer/components/ui/primitives'
import { describeMode } from '@shared/video-fallback'
import type { VideoMode, Tristate } from '@shared/models'
import { cn } from '@renderer/lib/utils'

const TONE: Record<VideoMode, 'good' | 'accent' | 'warn' | 'neutral'> = {
  embedded: 'good',
  companion: 'accent',
  external: 'warn',
  none: 'neutral'
}

function TriBadge({ label, value }: { label: string; value: Tristate }) {
  const map: Record<Tristate, { t: string; c: string }> = {
    yes: { t: 'Yes', c: 'text-good' },
    no: { t: 'No', c: 'text-danger' },
    unknown: { t: 'Unknown', c: 'text-fg-subtle' }
  }
  return (
    <div className="flex items-center justify-between text-2xs">
      <span className="text-fg-subtle">{label}</span>
      <span className={map[value].c}>{map[value].t}</span>
    </div>
  )
}

export function VideoModeIndicator({ compact = false }: { compact?: boolean }) {
  const state = useVideoStore((s) => s.state)
  const setMode = useVideoStore((s) => s.setMode)
  const reload = useVideoStore((s) => s.reload)
  const openExternal = useVideoStore((s) => s.openExternal)
  const desc = describeMode(state.mode)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'no-drag inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline/30 bg-black/20 px-2 py-1 text-2xs font-medium text-fg-muted transition-colors hover:border-hairline/60 hover:text-fg',
            compact && 'px-1.5'
          )}
          title={desc.blurb}
        >
          <StatusDot tone={TONE[state.mode]} pulse={state.playbackActive === 'yes'} />
          <span className="hidden uppercase tracking-wide min-[1800px]:inline">TOD</span>
          <span
            className={cn(
              'max-w-16 truncate whitespace-nowrap text-fg min-[1800px]:max-w-none',
              !compact && 'hidden min-[1800px]:inline'
            )}
          >
            {desc.short}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] w-64 animate-fade-in rounded-xl border border-hairline/40 bg-bg-overlay/95 p-1.5 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="px-2 py-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
              {desc.label}
            </div>
            <div className="mt-1 space-y-0.5">
              <TriBadge label="Playback" value={state.playbackActive} />
              <TriBadge label="Embedded OK" value={state.embeddedSupported} />
              <div className="flex items-center justify-between text-2xs">
                <span className="text-fg-subtle">Widevine DRM</span>
                <span className={state.drmReady ? 'text-good' : 'text-fg-subtle'}>
                  {state.drmReady ? 'Ready' : 'Unavailable'}
                </span>
              </div>
            </div>
            {state.fallbackReason && (
              <p className="mt-2 rounded-md border border-warn/20 bg-warn/5 p-1.5 text-2xs leading-snug text-warn/90">
                {state.fallbackReason}
              </p>
            )}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline/30" />
          <MenuItem icon={<Monitor className="h-3.5 w-3.5" />} onSelect={() => setMode('embedded')} active={state.mode === 'embedded'}>
            Embedded surface
          </MenuItem>
          <MenuItem icon={<PanelRight className="h-3.5 w-3.5" />} onSelect={() => setMode('companion')} active={state.mode === 'companion'}>
            Companion window
          </MenuItem>
          <MenuItem icon={<ExternalLink className="h-3.5 w-3.5" />} onSelect={() => setMode('external')} active={state.mode === 'external'}>
            External browser
          </MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline/30" />
          <MenuItem icon={<RotateCw className="h-3.5 w-3.5" />} onSelect={() => reload()}>
            Reload TOD
          </MenuItem>
          <MenuItem icon={<Radio className="h-3.5 w-3.5" />} onSelect={() => openExternal()}>
            Open tod.tv site
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function MenuItem({
  children,
  icon,
  onSelect,
  active
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onSelect: () => void
  active?: boolean
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-none transition-colors data-[highlighted]:bg-white/5',
        active ? 'text-accent' : 'text-fg-muted'
      )}
    >
      {icon}
      {children}
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
    </DropdownMenu.Item>
  )
}

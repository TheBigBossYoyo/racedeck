import { Minus, Square, X, Copy, Zap, Moon, Sun, Monitor } from 'lucide-react'
import { useAppStore } from '@renderer/store/appStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { cn } from '@renderer/lib/utils'
import type { TrackStatus } from '@shared/models'
import type { ThemeMode } from '@renderer/core/engines/ThemeEngine'

const THEME_CYCLE: Record<ThemeMode, { next: ThemeMode; icon: typeof Moon; label: string }> = {
  dark: { next: 'light', icon: Moon, label: 'Dark' },
  light: { next: 'system', icon: Sun, label: 'Light' },
  system: { next: 'dark', icon: Monitor, label: 'System' }
}

function ThemeToggle() {
  const mode = useSettingsStore((s) => s.theme.mode)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const cur = THEME_CYCLE[mode] ?? THEME_CYCLE.dark
  const Icon = cur.icon
  return (
    <button
      onClick={() => setTheme({ mode: cur.next })}
      className="no-drag grid h-8 w-9 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg"
      title={`Theme: ${cur.label} — click for ${THEME_CYCLE[cur.next].label}`}
      aria-label={`Theme: ${cur.label}. Switch to ${THEME_CYCLE[cur.next].label}`}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

const TRACK_STATUS: Record<TrackStatus, { label: string; cls: string }> = {
  CLEAR: { label: 'Track Clear', cls: 'text-good border-good/30 bg-good/10' },
  YELLOW: { label: 'Yellow', cls: 'text-warn border-warn/40 bg-warn/10' },
  VSC: { label: 'VSC', cls: 'text-warn border-warn/40 bg-warn/10' },
  SAFETY_CAR: { label: 'Safety Car', cls: 'text-warn border-warn/50 bg-warn/15' },
  RED: { label: 'Red Flag', cls: 'text-danger border-danger/50 bg-danger/15' },
  UNKNOWN: { label: '—', cls: 'text-fg-subtle border-hairline/30' }
}

export function TitleBar() {
  const { minimize, toggleMaximize, close, maximized } = useAppStore()
  const session = useSessionStore((s) => s.currentSession)
  const snapshot = useSessionStore((s) => s.snapshot)
  const status = snapshot?.trackStatus ?? 'UNKNOWN'
  const st = TRACK_STATUS[status]

  return (
    <div className="drag relative z-40 flex h-11 shrink-0 items-center gap-3 border-b border-hairline/25 bg-bg-base/60 px-3 backdrop-blur-xl">
      {/* Brand */}
      <div className="flex items-center gap-2 pl-1">
        <div className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-accent to-accent/40 shadow-glow">
          <Zap className="h-3.5 w-3.5 text-black" strokeWidth={2.5} />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-bold tracking-tight text-fg">Race</span>
          <span className="text-[15px] font-bold tracking-tight text-accent">Deck</span>
        </div>
      </div>

      {/* Center: session + status */}
      <div className="flex flex-1 items-center justify-center gap-3">
        {session ? (
          <div className="flex items-center gap-2.5">
            <span className="truncate text-[13px] font-medium text-fg-muted">
              {session.meetingName ?? session.circuitShortName ?? session.name}
            </span>
            <span className="text-fg-subtle/40">·</span>
            <span className="text-[13px] text-fg-subtle">{session.name}</span>
            <span
              className={cn(
                'rounded-md border px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide',
                st.cls
              )}
            >
              {st.label}
            </span>
          </div>
        ) : (
          <span className="text-xs text-fg-subtle">No session loaded</span>
        )}
      </div>

      {/* Quick theme toggle + window controls */}
      <div className="no-drag flex items-center gap-0.5">
        <ThemeToggle />
        <div className="mx-1 h-4 w-px bg-hairline/30" />
        <button
          onClick={minimize}
          className="grid h-8 w-11 place-items-center text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg"
          aria-label="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={toggleMaximize}
          className="grid h-8 w-11 place-items-center text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg"
          aria-label="Maximize"
        >
          {maximized ? <Copy className="h-3 w-3" /> : <Square className="h-3 w-3" />}
        </button>
        <button
          onClick={close}
          className="grid h-8 w-11 place-items-center text-fg-subtle transition-colors hover:bg-danger hover:text-white"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

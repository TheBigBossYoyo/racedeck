import { useState } from 'react'
import { Rewind, Download, EyeOff, Eye, Loader2, Info, RefreshCw, Radio } from 'lucide-react'
import { GridLayoutHost } from '@renderer/components/dashboard/GridLayoutHost'
import { SessionPicker } from '@renderer/components/shell/SessionPicker'
import { LiveControls } from '@renderer/components/shell/LiveControls'
import { TransportBar } from '@renderer/components/shell/TransportBar'
import { Button } from '@renderer/components/ui/primitives'
import { Switch } from '@renderer/components/ui/controls'
import { useSessionStore } from '@renderer/store/sessionStore'
import { hasBridge, bridge } from '@renderer/lib/ipc'

export function ReplayView() {
  const noSpoiler = useSessionStore((s) => s.noSpoiler)
  const setNoSpoiler = useSessionStore((s) => s.setNoSpoiler)
  const providerId = useSessionStore((s) => s.providerId)
  const sessions = useSessionStore((s) => s.sessions)
  const currentSession = useSessionStore((s) => s.currentSession)
  const setProvider = useSessionStore((s) => s.setProvider)
  const reloadSession = useSessionStore((s) => s.reloadSession)
  const isLive = useSessionStore((s) => s.snapshot?.availability.live ?? false)
  const [exporting, setExporting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const isLatestAvailable =
    providerId === 'f1live' &&
    !isLive &&
    Boolean(currentSession) &&
    (currentSession?.id === 'live' || sessions[0]?.id === currentSession?.id)

  const refreshLive = async () => {
    setRefreshing(true)
    try {
      await reloadSession()
    } finally {
      setRefreshing(false)
    }
  }

  const exportPng = async () => {
    if (!hasBridge()) return
    setExporting(true)
    try {
      const res = await bridge().app.capturePng(`racedeck-replay-${Date.now()}.png`)
      if (res.saved && res.path) {
        setSavedPath(res.path)
        setTimeout(() => setSavedPath(null), 4000)
      }
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="z-20 flex h-11 shrink-0 items-center gap-2 border-b border-hairline/25 bg-bg-raised/40 px-3 backdrop-blur-xl">
        <div className="flex items-center gap-1.5 rounded-lg bg-purple/10 px-2 py-1 text-2xs font-semibold uppercase tracking-widest text-purple">
          <Rewind className="h-3.5 w-3.5" /> Replay
        </div>
        {providerId === 'demo' && (
          <button
            onClick={() => void setProvider('f1live')}
            className="flex items-center gap-1 rounded-md border border-hairline/30 px-2 py-1 text-2xs text-fg-muted hover:text-fg"
            title="Switch to F1's official live-timing data for real sessions"
          >
            <Info className="h-3 w-3" /> Use official F1 data
          </button>
        )}
        <SessionPicker />

        <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-2xs text-fg-muted">
          {noSpoiler ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          No-spoiler
          <Switch checked={noSpoiler} onCheckedChange={setNoSpoiler} />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <LiveControls />
          {isLive && (
            <span className="flex items-center gap-1 rounded-md border border-good/30 bg-good/5 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-good">
              <Radio className="h-3 w-3 animate-pulse" /> Live
            </span>
          )}
          {isLatestAvailable && (
            <span className="rounded-md border border-hairline/30 bg-white/5 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
              Latest available session
            </span>
          )}
          {isLive && (
            <Button size="sm" variant="outline" onClick={refreshLive} disabled={refreshing} title="Fetch the latest live data">
              {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          )}
          {savedPath && <span className="max-w-[220px] truncate text-2xs text-good">Saved ✓</span>}
          <Button size="sm" variant="outline" onClick={exportPng} disabled={exporting}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export PNG
          </Button>
        </div>
      </div>

      <div className="z-10 flex h-10 shrink-0 items-center gap-2 border-b border-hairline/25 bg-bg-base/40 px-3">
        <TransportBar />
      </div>

      <div className="min-h-0 flex-1">
        <GridLayoutHost />
      </div>
    </div>
  )
}

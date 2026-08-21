import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  RotateCw,
  TerminalSquare,
  PanelRight,
  ExternalLink,
  Radio,
  Loader2,
  ShieldCheck,
  Tv
} from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Button } from '@renderer/components/ui/primitives'
import { VideoModeIndicator } from '@renderer/components/shell/VideoModeIndicator'
import { useVideoStore } from '@renderer/store/videoStore'

export function TodVideoPanel() {
  const bodyRef = useRef<HTMLDivElement>(null)
  const state = useVideoStore((s) => s.state)
  const { applyBounds, setVisible, activate, setMode, reload, back, openExternal, toggleDevTools } =
    useVideoStore()
  const mode = state.mode

  // Kick off a surface on first mount if none is active.
  useEffect(() => {
    if (useVideoStore.getState().state.mode === 'none') void activate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Report the body rect to the main process so the embedded WebContentsView
  // is positioned exactly over this panel (window == viewport coords).
  useEffect(() => {
    if (mode !== 'embedded') return
    setVisible(true)
    let last = { x: -1, y: -1, width: -1, height: -1 }
    const report = () => {
      const el = bodyRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const b = { x: r.left, y: r.top, width: r.width, height: r.height }
      if (
        Math.abs(b.x - last.x) > 0.5 ||
        Math.abs(b.y - last.y) > 0.5 ||
        Math.abs(b.width - last.width) > 0.5 ||
        Math.abs(b.height - last.height) > 0.5
      ) {
        last = b
        applyBounds(b)
      }
    }
    report()
    // Poll as a fallback for layout changes (grid drag/resize), but track
    // scroll + resize on the next frame so the native view stays glued to the
    // panel instead of visibly lagging behind (which looks like it floats on
    // top of other widgets while scrolling).
    const id = window.setInterval(report, 120)
    let raf = 0
    const onFrame = () => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        report()
      })
    }
    window.addEventListener('resize', onFrame)
    window.addEventListener('scroll', onFrame, true) // capture: catch inner scroll containers
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', onFrame)
      window.removeEventListener('scroll', onFrame, true)
      if (raf) window.cancelAnimationFrame(raf)
      setVisible(false)
    }
  }, [mode, applyBounds, setVisible])

  const canNavigate = mode === 'embedded' || mode === 'companion'

  return (
    <WidgetFrame
      title="TOD Broadcast"
      icon={<Tv />}
      noPadding
      scroll={false}
      actions={
        <>
          {canNavigate && (
            <>
              <Button size="icon-sm" variant="ghost" onClick={back} title="Back">
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" onClick={reload} title="Reload">
                <RotateCw className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          {canNavigate && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={toggleDevTools}
              title="Inspect TOD surface (DevTools)"
            >
              <TerminalSquare className="h-3.5 w-3.5" />
            </Button>
          )}
          <VideoModeIndicator compact />
        </>
      }
    >
      <div ref={bodyRef} className="relative h-full w-full bg-[#06070b]">
        {mode === 'embedded' ? (
          <EmbeddedUnderlay
            supported={state.embeddedSupported}
            onCompanion={() => void setMode('companion')}
          />
        ) : mode === 'companion' ? (
          <CompanionPlaceholder
            onFocus={() => void setMode('companion')}
            onEmbedded={() => void setMode('embedded')}
            onExternal={() => void setMode('external')}
          />
        ) : mode === 'external' ? (
          <ExternalPlaceholder
            onOpen={() => openExternal()}
            onEmbedded={() => void setMode('embedded')}
          />
        ) : (
          <ConnectPlaceholder onConnect={() => void activate()} />
        )}
      </div>
    </WidgetFrame>
  )
}

/** Shown UNDER the embedded view (visible only while the view is loading). */
function EmbeddedUnderlay({
  supported,
  onCompanion
}: {
  supported: 'yes' | 'no' | 'unknown'
  onCompanion: () => void
}) {
  if (supported === 'no') {
    return (
      <Center>
        <p className="max-w-sm text-center text-sm text-fg-muted">
          Embedded playback appears blocked on this system. You can switch to a companion window.
        </p>
        <Button variant="solid" size="md" onClick={onCompanion} className="mt-3">
          <PanelRight className="h-4 w-4" /> Open companion window
        </Button>
      </Center>
    )
  }
  return (
    <Center>
      <Loader2 className="h-6 w-6 animate-spin text-accent/70" />
      <p className="mt-2 text-xs text-fg-subtle">Connecting to TOD…</p>
    </Center>
  )
}

function CompanionPlaceholder({
  onFocus,
  onEmbedded,
  onExternal
}: {
  onFocus: () => void
  onEmbedded: () => void
  onExternal: () => void
}) {
  return (
    <Placeholder
      icon={<PanelRight className="h-8 w-8 text-accent" />}
      title="Companion window mode"
      body="TOD is playing in a docked companion window managed by RaceDeck. Your data dashboard stays here, perfectly in sync."
    >
      <Button variant="solid" size="md" onClick={onFocus}>
        Focus companion
      </Button>
      <Button variant="outline" size="md" onClick={onEmbedded}>
        Try embedded
      </Button>
      <Button variant="ghost" size="md" onClick={onExternal}>
        <ExternalLink className="h-4 w-4" /> External
      </Button>
    </Placeholder>
  )
}

function ExternalPlaceholder({ onOpen, onEmbedded }: { onOpen: () => void; onEmbedded: () => void }) {
  return (
    <Placeholder
      icon={<ExternalLink className="h-8 w-8 text-warn" />}
      title="External browser mode"
      body="TOD is open in your default browser. RaceDeck keeps the timing dashboard synced — use the sync offset to align it with your video."
    >
      <Button variant="solid" size="md" onClick={onOpen}>
        <Radio className="h-4 w-4" /> Open TOD again
      </Button>
      <Button variant="outline" size="md" onClick={onEmbedded}>
        Try embedded
      </Button>
    </Placeholder>
  )
}

function ConnectPlaceholder({ onConnect }: { onConnect: () => void }) {
  return (
    <Placeholder
      icon={<Tv className="h-8 w-8 text-accent" />}
      title="Connect your TOD broadcast"
      body="Load TOD inside RaceDeck and sign in normally. Playback runs through a secure browser surface — RaceDeck never sees your credentials or touches content protection."
    >
      <Button variant="solid" size="md" onClick={onConnect}>
        <Tv className="h-4 w-4" /> Launch TOD
      </Button>
    </Placeholder>
  )
}

function Placeholder({
  icon,
  title,
  body,
  children
}: {
  icon: React.ReactNode
  title: string
  body: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6"
    >
      <div className="grid h-16 w-16 place-items-center rounded-2xl border border-hairline/30 bg-white/[0.03]">
        {icon}
      </div>
      <div className="max-w-md text-center">
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">{body}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
      <div className="mt-2 flex items-center gap-1.5 text-2xs text-fg-subtle">
        <ShieldCheck className="h-3.5 w-3.5 text-good/70" />
        Browser-surface only · no DRM bypass · no credential access
      </div>
    </motion.div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
  )
}

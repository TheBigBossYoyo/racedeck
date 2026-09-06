import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Flag, OctagonAlert, ShieldAlert, TriangleAlert, X } from 'lucide-react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { cn, EMPTY_ARRAY } from '@renderer/lib/utils'
import type { TrackStatus } from '@shared/models'

/**
 * A prominent, hard-to-miss banner for whole-track incident states — red
 * flag, safety car, virtual safety car, yellow. Round-5 live-session
 * feedback: watching a real red flag at Monza, the ONLY existing indicator
 * was a small uppercase label in the title bar (`TitleBar.tsx`'s
 * `TRACK_STATUS` badge) — and that badge was itself showing "Track Clear"
 * during the red flag because of a real bug in `trackStatusAt` (an
 * unrecognized status code silently defaulted to CLEAR instead of UNKNOWN,
 * fixed alongside this). Even with that fixed, a small title-bar label is
 * not what "the app doesn't manage this at all" calls for — this is the
 * visible, state-driven indicator, styled like the existing
 * `VideoStatusBanner`/`LiveConnectionBanner` pattern.
 *
 * Shows the specific most-recent race-control message (e.g. "RACE WILL
 * RESUME AT 15:39") alongside the flag state, so "what's happening / when
 * is it resuming" is answered without hunting through the Race Control feed.
 * Re-surfaces on every genuine status change (even if a prior state was
 * dismissed) and clears itself once the track goes back to green.
 */

const STATUS_META: Partial<
  Record<TrackStatus, { label: string; icon: typeof Flag; tone: 'danger' | 'warn' }>
> = {
  RED: { label: 'Red Flag — Session Suspended', icon: OctagonAlert, tone: 'danger' },
  SAFETY_CAR: { label: 'Safety Car Deployed', icon: ShieldAlert, tone: 'warn' },
  VSC: { label: 'Virtual Safety Car', icon: TriangleAlert, tone: 'warn' },
  YELLOW: { label: 'Yellow Flag — Caution', icon: Flag, tone: 'warn' }
}

const TONE_CLS: Record<'danger' | 'warn', string> = {
  danger: 'border-danger/50 bg-danger/15 text-danger',
  warn: 'border-warn/50 bg-warn/15 text-warn'
}

export function TrackStatusBanner() {
  const status = useSessionStore((s) => s.snapshot?.trackStatus ?? 'UNKNOWN')
  const trackMessage = useSessionStore((s) => s.snapshot?.trackMessage ?? null)
  const raceControl = useSessionStore((s) => s.snapshot?.raceControl ?? EMPTY_ARRAY)
  const [dismissedStatus, setDismissedStatus] = useState<TrackStatus | null>(null)

  useEffect(() => {
    // A genuinely new status always re-surfaces, even over a dismissal of
    // the PREVIOUS status — going VSC -> full Safety Car must not stay
    // silenced just because the user dismissed the VSC banner a moment ago.
    setDismissedStatus((prev) => (prev === status ? prev : null))
  }, [status])

  const meta = STATUS_META[status]
  const visible = !!meta && dismissedStatus !== status
  const latestMessage = raceControl.at(-1)?.message ?? null
  const detail = trackMessage || latestMessage

  return (
    <AnimatePresence>
      {visible && meta && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className={cn(
            'pointer-events-auto fixed left-1/2 top-14 z-[86] flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border bg-bg-overlay/95 p-3 shadow-glass-lg backdrop-blur-xl',
            TONE_CLS[meta.tone]
          )}
        >
          <meta.icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-wide">{meta.label}</p>
            {detail && <p className="mt-0.5 text-xs leading-snug text-fg">{detail}</p>}
          </div>
          <button
            type="button"
            onClick={() => setDismissedStatus(status)}
            className="shrink-0 rounded-md p-0.5 text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg"
            aria-label="Dismiss track status banner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

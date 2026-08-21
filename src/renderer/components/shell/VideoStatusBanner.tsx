import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, X } from 'lucide-react'
import { useVideoStore } from '@renderer/store/videoStore'

/**
 * VideoStatusBanner — surfaces the human-readable reason whenever RaceDeck
 * falls back between TOD modes (embedded → companion → external). Auto-shows on
 * a new fallback reason and is dismissible.
 */
export function VideoStatusBanner({ inline = false }: { inline?: boolean }) {
  const reason = useVideoStore((s) => s.state.fallbackReason)
  const updatedAt = useVideoStore((s) => s.state.updatedAt)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)

  useEffect(() => {
    // Re-show whenever a fresh reason arrives.
    setDismissedAt(null)
  }, [reason, updatedAt])

  const visible = !!reason && dismissedAt !== updatedAt

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className={
            inline
              ? 'pointer-events-auto flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 backdrop-blur-xl'
              : 'pointer-events-auto absolute left-1/2 top-3 z-50 flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-xl border border-warn/30 bg-bg-overlay/95 p-3 shadow-glass-lg backdrop-blur-xl'
          }
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <p className="text-xs leading-snug text-fg">{reason}</p>
          <button
            onClick={() => setDismissedAt(updatedAt)}
            className="ml-1 shrink-0 rounded-md p-0.5 text-fg-subtle hover:bg-white/5 hover:text-fg"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

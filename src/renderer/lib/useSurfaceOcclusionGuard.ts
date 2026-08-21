import { useEffect } from 'react'
import { useVideoStore } from '@renderer/store/videoStore'

/**
 * The TOD surface is a native Electron WebContentsView, which always paints
 * ABOVE the web UI. So any open dialog, dropdown or select would be hidden
 * *behind* the video (and a modal's dim backdrop wouldn't cover it).
 *
 * This guard watches the DOM for open overlays and tells the video store to hide
 * the native surface while one is open, restoring it when they all close. It
 * keys off stable ARIA roles (dialog / menu / listbox) so it catches every
 * current and future overlay — while deliberately ignoring tooltips
 * (role="tooltip"), which are transient and shouldn't flicker the video.
 */

// Radix maps to these roles: Dialog→dialog, AlertDialog→alertdialog,
// DropdownMenu/ContextMenu→menu, Select→listbox.
const OVERLAY_SELECTOR = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'

export function useSurfaceOcclusionGuard(): void {
  const setSuppressed = useVideoStore((s) => s.setSurfaceSuppressed)

  useEffect(() => {
    let frame = 0
    const check = () => {
      frame = 0
      setSuppressed(document.querySelector(OVERLAY_SELECTOR) !== null)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }

    // Our overlays mount/unmount on open/close (no forceMount), so watching the
    // child tree is enough — no need to observe attribute toggles.
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    check() // initial sync

    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
      setSuppressed(false)
    }
  }, [setSuppressed])
}

import { useEffect } from 'react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useSyncStore } from '@renderer/store/syncStore'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useAppStore } from '@renderer/store/appStore'
import { LAYOUT_ORDER } from '@renderer/core/engines/LayoutManager'

/**
 * Global keyboard shortcuts.
 *
 *   Space / K        play–pause
 *   ← / →  (J / L)   seek −10s / +10s   (Shift: ±60s)
 *   + / −            sync offset ±1s    (Shift: ±5s)
 *   1–6              switch workspace layout
 *   E                toggle edit (drag/resize) mode
 *
 * Shortcuts are suppressed while typing in inputs or when an interactive
 * control (button/menu/slider) owns focus, so they never fight the UI.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"]'
        )
      ) {
        return
      }
      // Let focused interactive controls keep their native Space/Enter behavior.
      if (
        (e.key === ' ' || e.key === 'Enter') &&
        target?.closest('button, a, [role="menuitem"], [role="switch"], [role="slider"], [role="tab"]')
      ) {
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const session = useSessionStore.getState()
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault()
          session.togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          session.step(e.shiftKey ? -60 : -10)
          break
        case 'ArrowRight':
          e.preventDefault()
          session.step(e.shiftKey ? 60 : 10)
          break
        case 'j':
        case 'J':
          session.step(-10)
          break
        case 'l':
        case 'L':
          session.step(10)
          break
        case '+':
        case '=':
          useSyncStore.getState().nudge(e.shiftKey ? -5 : -1)
          break
        case '-':
        case '_':
          useSyncStore.getState().nudge(e.shiftKey ? 5 : 1)
          break
        case 'e':
        case 'E':
          useLayoutStore.getState().toggleEdit()
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6': {
          const id = LAYOUT_ORDER[Number(e.key) - 1]
          if (id) {
            useLayoutStore.getState().setLayout(id)
            const route = useAppStore.getState().route
            if (route !== 'dashboard' && route !== 'replay') {
              useAppStore.getState().setRoute('dashboard')
            }
          }
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

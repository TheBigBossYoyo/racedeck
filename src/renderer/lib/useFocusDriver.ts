import { useMemo } from 'react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useStrategyStore } from '@renderer/store/strategyStore'
import { useSettingsStore } from '@renderer/store/settingsStore'

/**
 * The single "focus driver" every driver-centric widget follows: an explicit
 * clicked focus driver → explicit strategy selection → a favourite → the leader.
 * Reactive so the Pit-Now Simulator, Stint Planner, Pace Battle and Driver
 * Dossier all move together when you pick a driver anywhere.
 */
export function useFocusDriver(): number | null {
  const snapshot = useSessionStore((s) => s.snapshot)
  const focusDriver = useSessionStore((s) => s.focusDriver)
  const selected = useStrategyStore((s) => s.selectedDriver)
  const favorites = useSettingsStore((s) => s.favorites)

  return useMemo(() => {
    if (!snapshot || snapshot.timing.length === 0) return null
    const inField = (n: number | null) => n != null && snapshot.timing.some((t) => t.driverNumber === n)
    if (inField(focusDriver)) return focusDriver
    if (inField(selected)) return selected
    const fav = snapshot.timing.find((t) => favorites.includes(t.driverNumber))
    if (fav) return fav.driverNumber
    return snapshot.timing[0]?.driverNumber ?? null
  }, [snapshot, selected, focusDriver, favorites])
}

/** Focus a driver everywhere at once (strategy selection + session focus). */
export function pickDriver(n: number | null): void {
  useStrategyStore.getState().setSelectedDriver(n)
  useSessionStore.getState().setFocusDriver(n)
}

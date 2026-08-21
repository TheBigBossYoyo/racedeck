import type { TyreCompound } from '@shared/models'
import { tyreColorsFor } from '@shared/constants'
import { useSettingsStore } from '@renderer/store/settingsStore'

/**
 * The active tyre-compound palette for the user's colour-vision setting. In the
 * default mode this is the familiar Pirelli scheme; in a colour-blind mode it
 * returns a deficiency-appropriate palette. The compound letter is always shown
 * alongside, so compounds remain distinguishable regardless.
 */
export function useTyreColors(): Record<TyreCompound, string> {
  const vision = useSettingsStore((s) => s.theme.colorVision)
  return tyreColorsFor(vision)
}

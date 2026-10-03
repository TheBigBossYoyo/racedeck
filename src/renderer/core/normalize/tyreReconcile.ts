import type { CurrentTyre, DriverTyreStintHistory, TyreCompound, TyreStintRecord } from '@shared/models'

/**
 * Pure tyre-history reconciliation, neutral so `TyreRead` (an engine) can use it
 * without reaching into the provider layer. `providers/f1normalize` re-exports it.
 */

export interface TyreStintReconciliation {
  /** The most direct available statement of how the current tyre was fitted. */
  activeStint: TyreStintRecord | null
  /** True when TyreStintSeries has nothing yet and the caller must fall back. */
  inferred: boolean
  /** True when TyreStintSeries' active compound disagrees with TimingAppData/CurrentTyres. */
  disagreesWithAppData: boolean
}

/**
 * Reconcile a driver's `TyreStintSeries` history against the `TimingAppData`-
 * derived active stint and `CurrentTyres`' current-tyre statement.
 *
 * `TyreStintSeries` is F1's own direct statement of what tyre set ran, so its
 * active stint wins on disagreement — it is preferred over inference from
 * TimingAppData/CurrentTyres, never the other way around. Falls back to
 * `inferred: true` only when TyreStintSeries has not reported anything yet for
 * this driver (e.g. a live connect made before the feed's first keyframe).
 */
export function reconcileTyreHistory(
  history: DriverTyreStintHistory | undefined,
  appDataActive: { compound: TyreCompound | null; age: number | null },
  currentTyre: CurrentTyre | undefined
): TyreStintReconciliation {
  const activeStint =
    history && history.stints.length > 0 ? history.stints[history.stints.length - 1] : null
  if (!activeStint) return { activeStint: null, inferred: true, disagreesWithAppData: false }

  const appCompound = appDataActive.compound
  const currentCompound = currentTyre?.compound ?? null
  const disagreesWithAppData =
    (appCompound != null && appCompound !== 'UNKNOWN' && appCompound !== activeStint.compound) ||
    (currentCompound != null &&
      currentCompound !== 'UNKNOWN' &&
      currentCompound !== activeStint.compound)
  return { activeStint, inferred: false, disagreesWithAppData }
}

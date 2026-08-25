/**
 * Unified error/recovery classification (APP_IMPROVEMENT_ROADMAP.md P2 item 28).
 *
 * Not a rewrite of the underlying stores — `sessionStore.error`, `liveStore`'s
 * `LiveStatus`/`notice`, `syncStore`'s `FollowState`, and `AppInfo`'s DRM flags
 * are already reasonably informative on their own. This normalizes them into
 * one list so a viewer doesn't have to hunt across widgets to see what's
 * currently degraded, what still works, and what to do about it.
 */

export type StatusCategory =
  'provider' | 'auth' | 'archive' | 'live-socket' | 'telemetry-enrichment' | 'drm' | 'sync'

export type RecoveryActionId = 'sign-in' | 'reconnect' | 'recalibrate-sync' | 'retry-session'

export interface SystemStatusEntry {
  category: StatusCategory
  severity: 'info' | 'warning' | 'danger'
  message: string
  whatStillWorks: string | null
  recoveryActionId: RecoveryActionId | null
}

export interface SystemStatusInputs {
  sessionError: string | null
  liveStatus: { state: string; detail: string | null; subscription: boolean } | null
  loggedIn: boolean
  followStatus: 'following' | 'uncalibrated' | 'waiting' | 'needs-calibration' | 'off'
  followDetail: string | null
  drmCapable: boolean
  drmReady: boolean
  enrichmentIssue: string | null
}

/** Build the current list of degraded-state entries from the app's scattered status signals. */
export function buildSystemStatus(inputs: SystemStatusInputs): SystemStatusEntry[] {
  const entries: SystemStatusEntry[] = []

  if (inputs.sessionError) {
    entries.push({
      category: 'provider',
      severity: 'danger',
      message: inputs.sessionError,
      whatStillWorks: 'Switching sessions or providers should still work.',
      recoveryActionId: 'retry-session'
    })
  }

  if (inputs.liveStatus?.state === 'error') {
    entries.push({
      category: 'live-socket',
      severity: 'danger',
      message: inputs.liveStatus.detail ?? 'The live timing connection failed.',
      whatStillWorks: 'Archive/replay sessions remain fully usable.',
      recoveryActionId: 'reconnect'
    })
  }

  const subscriptionRejected = inputs.liveStatus?.detail
    ?.toLowerCase()
    .includes('subscription rejected')
  if (subscriptionRejected) {
    entries.push({
      category: 'auth',
      severity: 'warning',
      message: 'F1 TV session expired.',
      whatStillWorks: 'Public timing continues; car telemetry and positions need a fresh sign-in.',
      recoveryActionId: 'sign-in'
    })
  } else if (
    !inputs.loggedIn &&
    inputs.liveStatus?.state === 'connected' &&
    !inputs.liveStatus.subscription
  ) {
    entries.push({
      category: 'auth',
      severity: 'info',
      message: 'Not signed in to F1 TV.',
      whatStillWorks: 'Public timing continues; sign in for car telemetry and positions.',
      recoveryActionId: 'sign-in'
    })
  }

  if (inputs.followStatus !== 'following' && inputs.followStatus !== 'off' && inputs.followDetail) {
    entries.push({
      category: 'sync',
      severity: 'warning',
      message: inputs.followDetail,
      whatStillWorks: 'The dashboard keeps working; only TOD video-follow is affected.',
      recoveryActionId: 'recalibrate-sync'
    })
  }

  if (inputs.enrichmentIssue) {
    entries.push({
      category: 'telemetry-enrichment',
      severity: 'info',
      message: inputs.enrichmentIssue,
      whatStillWorks:
        'Core timing and the map remain fully usable; only extended telemetry/position enrichment is affected.',
      recoveryActionId: null
    })
  }

  if (inputs.drmCapable && !inputs.drmReady) {
    entries.push({
      category: 'drm',
      severity: 'info',
      message: 'Widevine has not provisioned on this build.',
      whatStillWorks: 'Companion-window or external TOD playback modes still work.',
      recoveryActionId: null
    })
  }

  return entries
}

import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { TooltipProvider } from '@renderer/components/ui/controls'
import { TitleBar } from '@renderer/components/shell/TitleBar'
import { Sidebar } from '@renderer/components/shell/Sidebar'
import { StatusBar } from '@renderer/components/shell/StatusBar'
import { VideoStatusBanner } from '@renderer/components/shell/VideoStatusBanner'
import { LiveConnectionBanner } from '@renderer/components/shell/LiveConnectionBanner'
import { RadioNotificationToast } from '@renderer/components/shell/RadioNotificationToast'
import { TrackStatusBanner } from '@renderer/components/shell/TrackStatusBanner'
import { DashboardView } from '@renderer/components/DashboardView'
import { useAppStore } from '@renderer/store/appStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { persist } from '@renderer/store/persist'
import { useSyncStore } from '@renderer/store/syncStore'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { useVideoStore } from '@renderer/store/videoStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useLiveStore } from '@renderer/store/liveStore'
import { useAlertStore } from '@renderer/store/alertStore'
import { useKeyboardShortcuts } from '@renderer/lib/useKeyboardShortcuts'
import { useSurfaceOcclusionGuard } from '@renderer/lib/useSurfaceOcclusionGuard'
import { useVoiceReadout } from '@renderer/lib/useSpeech'
import { CommandPalette } from '@renderer/components/shell/CommandPalette'
import { WelcomeTour } from '@renderer/components/shell/WelcomeTour'
import { useOnboardingStore } from '@renderer/store/onboardingStore'
import { useProfileStore } from '@renderer/store/profileStore'
import { useComparisonLibraryStore } from '@renderer/store/comparisonLibraryStore'
import { useRadioTranscriptStore } from '@renderer/store/radioTranscriptStore'
import { usePluginStore } from '@renderer/store/pluginStore'
import { errorMessage } from '@renderer/lib/errorMessage'
import { bridge, hasBridge } from '@renderer/lib/ipc'
import { STORE_NS } from '@shared/ipc-contract'

const ReplayView = lazy(() =>
  import('@renderer/components/ReplayView').then((module) => ({ default: module.ReplayView }))
)
const SettingsPage = lazy(() =>
  import('@renderer/components/SettingsPage').then((module) => ({ default: module.SettingsPage }))
)
const AboutPage = lazy(() =>
  import('@renderer/components/AboutPage').then((module) => ({ default: module.AboutPage }))
)
const ComparisonLibraryPage = lazy(() =>
  import('@renderer/components/ComparisonLibraryPage').then((module) => ({
    default: module.ComparisonLibraryPage
  }))
)

function RouteFallback() {
  return (
    <div className="m-3 flex-1 animate-pulse rounded-2xl border border-hairline/20 bg-white/[0.025] shadow-glass" />
  )
}

/** One-time app bootstrap: hydrate persisted state, load data, connect surfaces. */
export function useBootstrap() {
  // An error thrown inside the async IIFE never reaches an error boundary by itself; parking it
  // in state and rethrowing during render hands it to RootErrorBoundary (and its reset action).
  const [fatal, setFatal] = useState<Error | null>(null)
  if (fatal) throw fatal

  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      await persist.checkRecovery()
      await useSettingsStore.getState().hydrate()
      await Promise.all([
        useSyncStore.getState().hydrate(),
        useLayoutStore.getState().hydrate(),
        useProfileStore.getState().hydrate(),
        useComparisonLibraryStore.getState().hydrate(),
        useRadioTranscriptStore.getState().hydrate(),
        usePluginStore.getState().hydrate(),
        useAppStore.getState().init()
      ])
      if (cancelled) return
      useVideoStore.getState().connect()
      useLiveStore.getState().init()
      await useSessionStore.getState().init()
      // Keep the AlertEngine config in lockstep with settings.
      const applyAlerts = () =>
        useAlertStore.getState().setConfig(useSettingsStore.getState().alerts)
      applyAlerts()
      unsub = useSettingsStore.subscribe(applyAlerts)
      useAppStore.getState().setReady(true)
      void useOnboardingStore.getState().hydrate()
    })().catch((error: unknown) => {
      if (cancelled) return
      setFatal(error instanceof Error ? error : new Error(errorMessage(error)))
    })
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])
}

/** Wipes every persisted namespace (the Electron store, or localStorage outside the shell). */
export async function clearSavedData(): Promise<void> {
  const namespaces = Object.values(STORE_NS)
  if (hasBridge()) {
    const api = bridge()
    await Promise.all(namespaces.map((ns) => api.store.clearNamespace(ns)))
    return
  }
  try {
    const prefixes = namespaces.map((ns) => `${ns}:`)
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) stale.push(key)
    }
    for (const key of stale) localStorage.removeItem(key)
  } catch {
    /* storage unavailable: there is nothing persisted to clear */
  }
}

interface RootErrorBoundaryProps {
  children?: ReactNode
  /** Injectable so tests need not touch window.location. */
  onReload?: () => void
  /** Injectable for the same reason; defaults to {@link clearSavedData}. */
  onResetData?: () => Promise<void>
}

interface RootErrorBoundaryState {
  error: Error | null
  confirmingReset: boolean
  resetting: boolean
  resetError: string | null
}

/**
 * Last line of defence: a crash in any shell component (TitleBar, banners, StatusBar...)
 * would otherwise unmount the whole React tree to a blank window (see React #185 from
 * TrackStatusBanner). Per-widget crashes are isolated earlier by WidgetErrorBoundary.
 * Deliberately dependency-free (plain elements, no stores) so the fallback can't crash too.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    error: null,
    confirmingReset: false,
    resetting: false,
    resetError: null
  }

  static getDerivedStateFromError(error: unknown): Partial<RootErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(errorMessage(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RootErrorBoundary] app shell crashed:', error, info.componentStack)
  }

  private reload = (): void => (this.props.onReload ?? (() => window.location.reload()))()

  private askReset = (): void => this.setState({ confirmingReset: true, resetError: null })

  private cancelReset = (): void => this.setState({ confirmingReset: false })

  private confirmReset = async (): Promise<void> => {
    this.setState({ resetting: true, resetError: null })
    try {
      await (this.props.onResetData ?? clearSavedData)()
    } catch (e) {
      this.setState({ resetting: false, resetError: errorMessage(e) })
      return
    }
    this.reload()
  }

  render(): ReactNode {
    const { error, confirmingReset, resetting, resetError } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className="flex h-screen flex-col items-center justify-center gap-3 bg-bg-base p-6 text-center"
      >
        <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
        <p className="max-w-md text-sm text-fg-muted">
          RaceDeck hit an unexpected error and had to stop. Your saved settings and layouts are
          untouched. Reloading usually fixes it.
        </p>
        <p className="mono max-w-md break-words text-2xs text-fg-subtle">{error.message}</p>
        <button
          type="button"
          onClick={this.reload}
          className="rounded-md border border-hairline/40 px-3 py-1.5 text-sm text-fg hover:bg-white/5"
        >
          Reload RaceDeck
        </button>
        {confirmingReset ? (
          <div className="flex max-w-md flex-col items-center gap-2" role="group" aria-label="Confirm reset">
            <p className="text-sm text-fg-muted">
              This clears layouts, preferences and the saved AI key.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={this.confirmReset}
                disabled={resetting}
                className="rounded-md border border-danger/50 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Yes, reset and reload'}
              </button>
              <button
                type="button"
                onClick={this.cancelReset}
                disabled={resetting}
                className="rounded-md border border-hairline/40 px-3 py-1.5 text-sm text-fg hover:bg-white/5 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={this.askReset}
            className="rounded-md px-3 py-1.5 text-xs text-fg-subtle underline hover:text-danger"
          >
            Reset saved settings and reload
          </button>
        )}
        {resetError && (
          <p className="mono max-w-md break-words text-2xs text-danger">
            Could not reset saved data: {resetError}
          </p>
        )}
      </div>
    )
  }
}

function AppShell() {
  const route = useAppStore((s) => s.route)
  useBootstrap()
  useKeyboardShortcuts()
  useSurfaceOcclusionGuard()
  useVoiceReadout()

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-bg-base">
        <TitleBar />
        <div className="relative flex min-h-0 flex-1">
          <VideoStatusBanner />
          <LiveConnectionBanner />
          <TrackStatusBanner />
          <RadioNotificationToast />
          <Sidebar />
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {(route === 'dashboard' || route === 'strategy') && <DashboardView />}
            <Suspense fallback={<RouteFallback />}>
              {route === 'replay' && <ReplayView />}
              {route === 'compare' && <ComparisonLibraryPage />}
              {route === 'settings' && <SettingsPage />}
              {route === 'about' && <AboutPage />}
            </Suspense>
          </main>
        </div>
        <StatusBar />
        <CommandPalette />
        <WelcomeTour />
      </div>
    </TooltipProvider>
  )
}

export function App() {
  return (
    <RootErrorBoundary>
      <AppShell />
    </RootErrorBoundary>
  )
}

import { lazy, Suspense, useEffect } from 'react'
import { TooltipProvider } from '@renderer/components/ui/controls'
import { TitleBar } from '@renderer/components/shell/TitleBar'
import { Sidebar } from '@renderer/components/shell/Sidebar'
import { StatusBar } from '@renderer/components/shell/StatusBar'
import { VideoStatusBanner } from '@renderer/components/shell/VideoStatusBanner'
import { LiveConnectionBanner } from '@renderer/components/shell/LiveConnectionBanner'
import { DashboardView } from '@renderer/components/DashboardView'
import { useAppStore } from '@renderer/store/appStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
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

const ReplayView = lazy(() =>
  import('@renderer/components/ReplayView').then((module) => ({ default: module.ReplayView }))
)
const SettingsPage = lazy(() =>
  import('@renderer/components/SettingsPage').then((module) => ({ default: module.SettingsPage }))
)
const AboutPage = lazy(() =>
  import('@renderer/components/AboutPage').then((module) => ({ default: module.AboutPage }))
)

function RouteFallback() {
  return (
    <div className="m-3 flex-1 animate-pulse rounded-2xl border border-hairline/20 bg-white/[0.025] shadow-glass" />
  )
}

/** One-time app bootstrap: hydrate persisted state, load data, connect surfaces. */
function useBootstrap() {
  useEffect(() => {
    let unsub: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      await useSettingsStore.getState().hydrate()
      await Promise.all([
        useSyncStore.getState().hydrate(),
        useLayoutStore.getState().hydrate(),
        useAppStore.getState().init()
      ])
      if (cancelled) return
      useVideoStore.getState().connect()
      useLiveStore.getState().init()
      await useSessionStore.getState().init()
      // Keep the AlertEngine config in lockstep with settings.
      const applyAlerts = () => useAlertStore.getState().setConfig(useSettingsStore.getState().alerts)
      applyAlerts()
      unsub = useSettingsStore.subscribe(applyAlerts)
      useAppStore.getState().setReady(true)
      void useOnboardingStore.getState().hydrate()
    })()
    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])
}

export function App() {
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
          <Sidebar />
          <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {(route === 'dashboard' || route === 'strategy') && <DashboardView />}
            <Suspense fallback={<RouteFallback />}>
              {route === 'replay' && <ReplayView />}
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

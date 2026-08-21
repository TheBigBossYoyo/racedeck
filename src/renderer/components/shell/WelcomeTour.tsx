import { useEffect, useState, type ReactNode } from 'react'
import { Sparkles, LayoutGrid, MousePointerClick, Command, Radio, Clock, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useOnboardingStore } from '@renderer/store/onboardingStore'
import { cn } from '@renderer/lib/utils'

/**
 * WelcomeTour — a lightweight, skippable first-run tour. It introduces the few
 * things that make RaceDeck fast to drive (workspaces, focus, the command
 * palette, real F1 data, sync) as a sequence of cards. It never anchors to
 * specific DOM nodes (so it can't break as layouts change) and is a
 * `role="dialog"`, so the surface-occlusion guard keeps it above the TOD video.
 * Shown once; re-openable from the command palette.
 */

interface Step {
  icon: ReactNode
  title: string
  body: string
  hint?: string
}

const STEPS: Step[] = [
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: 'Welcome to RaceDeck',
    body: 'A broadcast + data command center: watch the race and read timing, strategy, the track map, win probability and more, side by side.',
    hint: 'The Demo Grand Prix is already running — press Space to play.'
  },
  {
    icon: <LayoutGrid className="h-5 w-5" />,
    title: 'Six pro workspaces',
    body: 'Switch between Broadcast + Data, Driver Focus, Strategy Wall, Qualifying Pro, Practice Lab and Minimal Watch. Toggle Edit to drag, resize and save your own.',
    hint: 'Keys 1–6 switch workspace · E toggles edit mode.'
  },
  {
    icon: <MousePointerClick className="h-5 w-5" />,
    title: 'One driver, everywhere',
    body: 'Click any driver — in the tower, on the map, anywhere — and the whole dashboard follows: dossier, pace battle, pit projection and strategy all focus that driver.',
    hint: 'Add or remove any panel from the Widgets palette in the command bar.'
  },
  {
    icon: <Command className="h-5 w-5" />,
    title: 'The command palette',
    body: 'Press Ctrl/⌘+K to jump anywhere: switch workspace, focus a driver, add a widget, control playback, or flip theme and accessibility modes — all from the keyboard.',
    hint: 'Try it: Ctrl/⌘+K, then type a driver name.'
  },
  {
    icon: <Radio className="h-5 w-5" />,
    title: 'Real F1 data',
    body: 'Select the F1 Live Timing provider to replay any past session from Formula 1’s open archive — no login. Open Go Live for the current session: timing is free, and signing in with F1 TV adds live telemetry and car positions.',
    hint: 'Replay and live timing are public; telemetry & positions need your own F1 TV subscription.'
  },
  {
    icon: <Clock className="h-5 w-5" />,
    title: 'Sync to your video',
    body: 'Broadcast is delayed, so RaceDeck decouples the data clock from the video. Mark an event you just saw and the whole dashboard jumps there; nudge the offset from the status bar anytime.',
    hint: 'You can reopen this tour from the command palette.'
  }
]

export function WelcomeTour() {
  const open = useOnboardingStore((s) => s.open)
  const dismiss = useOnboardingStore((s) => s.dismiss)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
      else if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1))
      else if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismiss])

  if (!open) return null

  const current = STEPS[step]
  const isLast = step === STEPS.length - 1

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to RaceDeck"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-hairline/30 bg-bg-overlay shadow-glass"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Close tour"
          className="no-drag absolute right-3 top-3 text-fg-subtle transition-colors hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 pb-5 pt-7">
          <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
            {current.icon}
          </div>
          <h2 className="text-base font-semibold text-fg">{current.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{current.body}</p>
          {current.hint && (
            <p className="mt-3 rounded-lg border border-hairline/20 bg-white/[0.02] px-3 py-2 text-2xs text-fg-subtle">
              {current.hint}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hairline/20 px-5 py-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn('h-1.5 rounded-full transition-all', i === step ? 'w-4 bg-accent' : 'w-1.5 bg-fg-subtle/40')}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => Math.max(s - 1, 0))}
                className="no-drag inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            {!isLast && (
              <button onClick={dismiss} className="no-drag rounded-lg px-2.5 py-1.5 text-xs text-fg-subtle transition-colors hover:text-fg">
                Skip
              </button>
            )}
            <button
              onClick={() => (isLast ? dismiss() : setStep((s) => Math.min(s + 1, STEPS.length - 1)))}
              className="no-drag inline-flex items-center gap-1 rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/30"
            >
              {isLast ? 'Get started' : 'Next'}
              {!isLast && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

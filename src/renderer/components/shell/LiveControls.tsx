import { useEffect } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Radio, ChevronDown, Plug, PlugZap, Loader2, ShieldCheck, Crown } from 'lucide-react'
import { useLiveStore } from '@renderer/store/liveStore'
import { liveDataTier } from '@shared/f1live'
import { Button, StatusDot, Badge } from '@renderer/components/ui/primitives'
import { cn } from '@renderer/lib/utils'

/**
 * LiveControls — the entry point for LIVE F1 timing.
 *
 * Timing itself is public and needs no login. An F1 TV subscription additionally
 * unlocks car telemetry and positions, which F1 gates on the live feed. Signing
 * in is therefore worthwhile but never required, and the UI says which of the two
 * the user is currently getting — proven by data arriving, not by a token being
 * present, since F1 withholds gated topics silently.
 */
export function LiveControls() {
  const { status, loggedIn, busy, init, openLogin, refreshLogin, connect, disconnect } =
    useLiveStore()

  useEffect(() => {
    init()
  }, [init])

  const state = status?.state ?? 'idle'
  const connected = state === 'connected'
  // A genuinely-live session — NOT merely "connected" (F1's feed replays the last
  // finished event when nothing is racing) and NOT "messages > 0" (heartbeats tick
  // even when idle). `status.live` is the authoritative signal from the socket.
  const live = connected && status?.live === true
  const waiting = connected && !live // connected to an idle feed, awaiting a session
  const errored = state === 'error'
  // Honest tier: 'full' only once gated feeds truly arrive; 'waiting' when we
  // sent a token but they haven't (usually an expired token — F1 rotates them
  // about weekly); 'public' on an anonymous live connection.
  const tier = liveDataTier(live, status?.subscription === true, status?.gatedData === true)
  const fullData = tier === 'full'
  const awaitingGated = tier === 'waiting'
  const tone =
    live ? 'good' : waiting ? 'warn' : errored ? 'danger' : state === 'connecting' ? 'accent' : 'neutral'

  return (
    <DropdownMenu.Root onOpenChange={(o) => o && void refreshLogin()}>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'no-drag inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-2xs font-medium transition-colors',
            live
              ? 'border-good/40 bg-good/10 text-good'
              : waiting
                ? 'border-warn/40 bg-warn/10 text-warn'
                : 'border-hairline/30 bg-black/20 text-fg-muted hover:border-hairline/60 hover:text-fg'
          )}
          title="Live F1 timing (F1 TV subscription adds telemetry & positions)"
        >
          <StatusDot tone={tone} pulse={live || state === 'connecting'} />
          <Radio className="h-3 w-3" />
          <span className="uppercase tracking-wide">
            {live ? 'Live' : waiting ? 'Waiting' : 'Go Live'}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-[100] w-80 animate-fade-in rounded-xl border border-hairline/40 bg-bg-overlay/95 p-3 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center gap-2">
            <Radio className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-fg">F1 Live Timing</span>
            {status && (
              <Badge tone={awaitingGated ? 'warn' : tone} className="ml-auto">
                {fullData
                  ? 'full data'
                  : awaitingGated
                    ? 'awaiting telemetry'
                    : live
                      ? 'public timing'
                      : waiting
                        ? 'no session'
                        : state}
              </Badge>
            )}
          </div>

          <p className="mb-2.5 text-2xs leading-snug text-fg-subtle">
            Timing is free and needs no login. Sign in with your{' '}
            <span className="font-semibold text-fg">F1 TV</span> subscription to add live car
            telemetry &amp; positions — the track map and Driver Tracker. You sign in on F1&apos;s own
            page; RaceDeck never sees your password.
          </p>

          {/* Step 1: sign in with F1 TV */}
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                loggedIn ? 'bg-good/20 text-good' : 'bg-accent/20 text-accent'
              )}
            >
              1
            </span>
            <Button
              size="sm"
              variant={loggedIn ? 'ghost' : 'default'}
              className="flex-1 justify-start"
              onClick={openLogin}
            >
              <Crown className={cn('h-3.5 w-3.5', loggedIn ? 'text-good' : 'text-amber-400')} />
              {loggedIn ? 'Signed in to F1 TV — reopen' : 'Sign in with F1 TV'}
            </Button>
          </div>

          {/* Step 2: connect */}
          <div className="flex items-center gap-2">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-bold text-fg-muted">
              2
            </span>
            {connected ? (
              <Button size="sm" variant="outline" className="flex-1 justify-start" onClick={disconnect}>
                <Plug className="h-3.5 w-3.5" /> Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                variant="solid"
                className="flex-1 justify-start"
                onClick={() => void connect()}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                {loggedIn ? 'Connect (full data)' : 'Connect (public timing)'}
              </Button>
            )}
          </div>

          {status?.detail && (
            <p
              className={cn(
                'mt-2.5 rounded-md border p-1.5 text-2xs leading-snug',
                errored
                  ? 'border-danger/25 bg-danger/5 text-danger/90'
                  : fullData
                    ? 'border-good/25 bg-good/5 text-good/90'
                    : 'border-hairline/25 bg-white/[0.03] text-fg-muted'
              )}
            >
              {fullData && <Crown className="mr-1 inline h-3 w-3 text-good" />}
              {status.sessionName ? <span className="font-semibold text-fg">{status.sessionName}</span> : null}
              {status.sessionName ? ' — ' : ''}
              {status.detail}
              {connected && status.messages > 0 ? ` (${status.messages} updates)` : ''}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-1.5 border-t border-hairline/20 pt-2 text-[10px] text-fg-subtle">
            <ShieldCheck className="h-3 w-3 text-good/70" />
            Your F1 login stays in Chromium · RaceDeck captures only your subscription token
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

import { Crown, RefreshCw, WifiOff, X } from 'lucide-react'
import { useLiveStore } from '@renderer/store/liveStore'
import { cn } from '@renderer/lib/utils'

export function LiveConnectionBanner() {
  const notice = useLiveStore((state) => state.notice)
  const busy = useLiveStore((state) => state.busy)
  const connect = useLiveStore((state) => state.connect)
  const openLogin = useLiveStore((state) => state.openLogin)
  const dismiss = useLiveStore((state) => state.dismissNotice)

  if (!notice) return null
  const authRequired = notice.title.includes('F1 TV')

  return (
    <div
      role="alert"
      className={cn(
        'pointer-events-auto fixed right-4 top-14 z-[85] flex w-[min(420px,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-bg-overlay/95 p-3 shadow-glass-lg backdrop-blur-xl animate-fade-in',
        notice.tone === 'danger'
          ? 'border-danger/40'
          : notice.tone === 'warning'
            ? 'border-warn/40'
            : 'border-accent/35'
      )}
    >
      {authRequired ? (
        <Crown className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
      ) : (
        <WifiOff className={cn('mt-0.5 h-4 w-4 shrink-0', notice.tone === 'danger' ? 'text-danger' : 'text-accent')} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-fg">{notice.title}</p>
        <p className="mt-0.5 text-2xs leading-snug text-fg-muted">{notice.detail}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => authRequired ? openLogin() : void connect()}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-2xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {authRequired ? <Crown className="h-3 w-3" /> : <RefreshCw className={cn('h-3 w-3', busy && 'animate-spin')} />}
          {authRequired ? 'Sign in again' : 'Retry connection'}
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss F1 Live notification"
        onClick={dismiss}
        className="rounded p-0.5 text-fg-subtle transition-colors hover:bg-white/5 hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

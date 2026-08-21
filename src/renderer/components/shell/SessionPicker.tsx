import { useState } from 'react'
import { ChevronDown, Loader2, MapPin, Calendar, ShieldAlert, Beaker } from 'lucide-react'
import { useSessionStore } from '@renderer/store/sessionStore'
import { Dialog, DialogTrigger, DialogContent, DialogClose } from '@renderer/components/ui/Dialog'
import { Segmented, Badge } from '@renderer/components/ui/primitives'
import { cn } from '@renderer/lib/utils'

export function SessionPicker() {
  const {
    providerId,
    catalog,
    sessions,
    sessionsLoading,
    loadingSession,
    currentSession,
    setProvider,
    selectSession,
    refreshSessions
  } = useSessionStore()
  const [open, setOpen] = useState(false)

  const providerOptions = catalog.map((c) => ({ value: c.id, label: c.label.split(' ')[0] }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          disabled={loadingSession}
          className="no-drag flex min-w-0 max-w-[160px] items-center gap-1.5 rounded-lg border border-hairline/30 bg-black/20 px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-hairline/60 hover:text-fg disabled:cursor-wait disabled:border-accent/30 disabled:text-accent min-[1800px]:max-w-[200px]"
        >
          {loadingSession && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
          <span className="truncate">
            {loadingSession
              ? 'Preparing session…'
              : currentSession
              ? `${currentSession.meetingName ?? currentSession.circuitShortName ?? 'Session'} · ${currentSession.name}`
              : 'Select session'}
          </span>
          {!loadingSession && <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />}
        </button>
      </DialogTrigger>
      <DialogContent
        title="Data source & session"
        description="Choose a provider and a session to load. Demo works fully offline."
      >
        <div className="border-b border-hairline/25 p-4">
          <Segmented
            size="md"
            value={providerId}
            options={providerOptions}
            onChange={(id) => {
              void setProvider(id)
            }}
          />
          {catalog
            .filter((c) => c.id === providerId)
            .map((c) => (
              <div key={c.id} className="mt-3 flex items-start gap-2 text-xs text-fg-muted">
                {c.riskLevel !== 'none' ? (
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
                ) : (
                  <Beaker className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                )}
                <p className="leading-snug">
                  {c.description}
                  {c.requiresSubscription && ' Requires your own subscription.'}
                </p>
              </div>
            ))}
        </div>

        <div className="max-h-[46vh] overflow-auto p-2">
          {sessionsLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-fg-muted">No sessions loaded.</p>
              <button
                onClick={() => void refreshSessions()}
                className="rounded-lg border border-accent/30 bg-accent/15 px-3 py-1.5 text-xs text-accent hover:bg-accent/25"
              >
                Fetch sessions
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {sessions.map((s, index) => {
                const active = currentSession?.id === s.id
                const latestAvailable = providerId === 'f1live' && index === 0
                return (
                  <DialogClose asChild key={s.id}>
                    <button
                      onClick={() => void selectSession(s.id)}
                      disabled={loadingSession}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                        active
                          ? 'border-accent/40 bg-accent/10'
                          : 'border-transparent hover:border-hairline/40 hover:bg-white/5'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-fg">
                            {s.meetingName ?? s.circuitShortName ?? s.location ?? 'Session'}
                          </span>
                          <Badge tone={s.type === 'race' ? 'accent' : 'neutral'}>{s.name}</Badge>
                          {latestAvailable && <Badge tone="neutral">Latest available</Badge>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-3 text-2xs text-fg-subtle">
                          {s.countryName && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {s.countryName}
                            </span>
                          )}
                          {s.dateStart && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(s.dateStart).toLocaleDateString()}
                            </span>
                          )}
                          {s.year && <span>{s.year}</span>}
                        </div>
                      </div>
                    </button>
                  </DialogClose>
                )
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

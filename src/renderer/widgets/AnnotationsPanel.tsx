import { useState } from 'react'
import { NotebookPen, Trash2, Plus } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Button } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useAnnotationsStore } from '@renderer/store/annotationsStore'
import { useFocusDriver } from '@renderer/lib/useFocusDriver'
import { formatDuration, cn, EMPTY_ARRAY } from '@renderer/lib/utils'

/**
 * User-authored session notes (APP_IMPROVEMENT_ROADMAP.md P3 item 34):
 * timestamped, optionally tied to a driver/lap/tag, exportable with the race
 * debrief (`DebriefBuilder.ts`).
 */
export function AnnotationsPanel() {
  const clock = useSessionStore((s) => s.clock)
  const currentLap = useSessionStore((s) => s.snapshot?.currentLap ?? null)
  const drivers = useSessionStore((s) => s.snapshot?.drivers ?? EMPTY_ARRAY)
  const focusDriver = useFocusDriver()
  const annotations = useAnnotationsStore((s) => s.annotations)
  const sessionId = useAnnotationsStore((s) => s.sessionId)
  const add = useAnnotationsStore((s) => s.add)
  const remove = useAnnotationsStore((s) => s.remove)

  const [text, setText] = useState('')
  const [tag, setTag] = useState('')
  const [linkDriver, setLinkDriver] = useState(true)

  const driverCode = (n: number | null) => drivers.find((d) => d.number === n)?.code ?? null

  const submit = () => {
    if (!text.trim()) return
    add({
      t: clock,
      driverNumber: linkDriver ? focusDriver : null,
      lapNumber: currentLap,
      tag: tag || null,
      text
    })
    setText('')
  }

  return (
    <WidgetFrame title="Notes" icon={<NotebookPen className="h-4 w-4" />}>
      {!sessionId ? (
        <EmptyState title="No session loaded" hint="Load a session to write notes." />
      ) : (
        <div className="flex h-full flex-col gap-2">
          <div className="rounded-lg border border-hairline/20 bg-white/[0.02] p-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
              }}
              placeholder={`Note at ${formatDuration(clock)}${currentLap != null ? ` (lap ${currentLap})` : ''}…`}
              spellCheck={false}
              rows={2}
              className="w-full resize-none rounded-md border border-hairline/30 bg-black/30 px-2 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
            />
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="tag (optional)"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-md border border-hairline/30 bg-black/30 px-2 py-1 text-2xs text-fg outline-none focus:border-accent/50"
              />
              {focusDriver != null && (
                <button
                  onClick={() => setLinkDriver((v) => !v)}
                  className={cn(
                    'shrink-0 rounded-md border px-1.5 py-1 text-2xs transition-colors',
                    linkDriver
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-hairline/25 text-fg-subtle hover:text-fg-muted'
                  )}
                  title={linkDriver ? 'Linked to focused driver' : 'Not linked to a driver'}
                >
                  {driverCode(focusDriver) ?? 'driver'}
                </button>
              )}
              <Button size="xs" variant="outline" onClick={submit} disabled={!text.trim()}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
          </div>

          {annotations.length === 0 ? (
            <EmptyState title="No notes yet" hint="Write one above at the current moment." />
          ) : (
            <div className="flex-1 space-y-1 overflow-y-auto">
              {annotations.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 rounded-lg border border-hairline/20 bg-white/[0.02] px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-fg-subtle">
                      <span className="tnum">{formatDuration(a.t)}</span>
                      {a.lapNumber != null && <span className="tnum">L{a.lapNumber}</span>}
                      {a.driverNumber != null && (
                        <span className="font-semibold text-fg-muted">
                          {driverCode(a.driverNumber) ?? `#${a.driverNumber}`}
                        </span>
                      )}
                      {a.tag && (
                        <span className="rounded bg-accent/10 px-1 text-accent">{a.tag}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-fg">{a.text}</p>
                  </div>
                  <button
                    onClick={() => remove(a.id)}
                    className="shrink-0 rounded p-1 text-fg-subtle hover:bg-white/5 hover:text-danger"
                    title="Delete note"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetFrame>
  )
}

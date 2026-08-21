import { Headphones, ShieldAlert, CloudRain, Timer, CircleDot, Swords, Volume2, VolumeX, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Badge, EmptyState } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useEngineerNotesStore } from '@renderer/store/engineerNotesStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { EngineerNote, NoteCategory } from '@renderer/core/engines/EngineerNotesEngine'
import { pickDriver } from '@renderer/lib/useFocusDriver'
import { formatDuration, cn } from '@renderer/lib/utils'

const CATEGORY_ICON: Record<NoteCategory, ReactNode> = {
  neutralisation: <ShieldAlert className="h-3.5 w-3.5" />,
  weather: <CloudRain className="h-3.5 w-3.5" />,
  undercut: <Timer className="h-3.5 w-3.5" />,
  'pit-window': <CircleDot className="h-3.5 w-3.5" />,
  battle: <Swords className="h-3.5 w-3.5" />
}

export function EngineerNotesPanel() {
  const notes = useEngineerNotesStore((s) => s.notes)
  const reset = useEngineerNotesStore((s) => s.reset)
  const hasSession = useSessionStore((s) => !!s.currentSession)
  const voiceEnabled = useSettingsStore((s) => s.voice.enabled)
  const setVoice = useSettingsStore((s) => s.setVoice)

  return (
    <WidgetFrame
      title="Engineer's Notes"
      icon={<Headphones />}
      subtitle="proactive · estimate"
      actions={
        <div className="flex items-center gap-1.5">
          {notes.length > 0 && <Badge tone="neutral">{notes.length}</Badge>}
          <button
            onClick={() => setVoice({ enabled: !voiceEnabled })}
            title={voiceEnabled ? 'Mute voice read-out' : 'Speak high-priority notes aloud'}
            aria-pressed={voiceEnabled}
            className={cn('no-drag transition-colors', voiceEnabled ? 'text-accent' : 'text-fg-subtle hover:text-fg')}
          >
            {voiceEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
          <button onClick={reset} title="Clear notes" className="no-drag text-fg-subtle hover:text-fg">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      {notes.length === 0 ? (
        <EmptyState
          icon={<Headphones />}
          title={hasSession ? 'Watching for strategy moments' : 'No session loaded'}
          hint={
            hasSession
              ? 'Undercut threats, pit windows, closing battles, safety-car stops and rain appear here as you play or scrub.'
              : undefined
          }
        />
      ) : (
        <ol className="space-y-1">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ol>
      )}
    </WidgetFrame>
  )
}

function NoteRow({ note }: { note: EngineerNote }) {
  const clickable = note.drivers.length > 0
  const high = note.priority === 'high'
  return (
    <li>
      <button
        onClick={() => clickable && pickDriver(note.drivers[0])}
        disabled={!clickable}
        className={cn(
          'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
          high ? 'bg-warn/10 hover:bg-warn/15' : 'hover:bg-white/[0.03]',
          !clickable && 'cursor-default'
        )}
      >
        <span className={cn('mt-0.5 shrink-0', high ? 'text-warn' : 'text-accent')}>{CATEGORY_ICON[note.category]}</span>
        <span className="min-w-0 flex-1 text-xs leading-snug text-fg">{note.text}</span>
        <span className="tnum mt-0.5 shrink-0 text-2xs text-fg-subtle">
          {note.lap != null ? `L${note.lap}` : formatDuration(note.at)}
        </span>
      </button>
    </li>
  )
}

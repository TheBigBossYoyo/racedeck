import { useState } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { Button } from '@renderer/components/ui/primitives'
import { Dialog, DialogTrigger, DialogContent } from '@renderer/components/ui/Dialog'
import { SettingsPersistError } from '@renderer/store/settingsStore'
import { describeError, isRecord } from '@renderer/store/persistWrite'
import { cn } from '@renderer/lib/utils'

type ParsedBackup = { ok: true; data: Record<string, unknown> } | { ok: false; message: string }

interface Status {
  tone: 'success' | 'error'
  message: string
}

/** Pure boundary check for pasted text: it must be a JSON object before the store sees it. */
export function parseBackupText(text: string): ParsedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { ok: false, message: `Not valid JSON (${describeError(error)}) — nothing was imported.` }
  }
  if (!isRecord(parsed)) {
    return { ok: false, message: 'A backup must be a JSON object ({ … }) — nothing was imported.' }
  }
  return { ok: true, data: parsed }
}

function importFailureMessage(error: unknown): string {
  const detail = describeError(error)
  if (error instanceof SettingsPersistError) {
    return `Settings were applied for this session but could not be saved: ${detail}. They will be lost on restart.`
  }
  return `Import failed: ${detail}`
}

export function BackupControls({
  exportAll,
  importAll
}: {
  exportAll: () => Record<string, unknown>
  importAll: (d: Record<string, unknown>) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status | null>(null)

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('the clipboard is unavailable')
      await navigator.clipboard.writeText(text)
      setStatus({ tone: 'success', message: 'Copied to clipboard' })
    } catch (error) {
      setStatus({ tone: 'error', message: `Could not copy to the clipboard: ${describeError(error)}` })
    }
  }

  const runImport = async () => {
    const parsed = parseBackupText(text)
    if (!parsed.ok) {
      setStatus({ tone: 'error', message: parsed.message })
      return
    }
    try {
      await importAll(parsed.data)
      setStatus({ tone: 'success', message: 'Imported successfully' })
    } catch (error) {
      console.error('[settings] Import failed', error)
      setStatus({ tone: 'error', message: importFailureMessage(error) })
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="md"
          onClick={() => {
            setText(JSON.stringify(exportAll(), null, 2))
            // The status belongs to the previous open; it would sit beside fresh export JSON.
            setStatus(null)
          }}
        >
          Export / import settings
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Backup settings"
        description="Copy this JSON to back up, or paste JSON and import."
      >
        <div className="p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-48 w-full resize-none rounded-lg border border-hairline/40 bg-black/40 p-2 font-mono text-2xs text-fg outline-none focus:border-accent/50"
          />
          {status && (
            <p
              role={status.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'mt-2 flex items-start gap-1 text-2xs',
                status.tone === 'error' ? 'text-danger' : 'text-good'
              )}
            >
              {status.tone === 'error' ? (
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              ) : (
                <Check className="mt-px h-3 w-3 shrink-0" />
              )}
              <span>{status.message}</span>
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => void copy()}>
              Copy
            </Button>
            <Button variant="solid" size="md" onClick={() => void runImport()}>
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

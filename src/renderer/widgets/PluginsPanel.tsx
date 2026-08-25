import { useState } from 'react'
import { Puzzle, Play, Trash2, Plus, Loader2 } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { EmptyState, Button, Badge } from '@renderer/components/ui/primitives'
import { useSessionStore } from '@renderer/store/sessionStore'
import { usePluginStore } from '@renderer/store/pluginStore'
import {
  PLUGIN_FEEDS,
  projectPluginSnapshot,
  validatePluginManifest,
  type PluginFeed
} from '@renderer/core/engines/PluginSnapshotApi'
import { runPlugin, type PluginRunResult } from '@renderer/lib/pluginRunner'
import { cn } from '@renderer/lib/utils'

const EXAMPLE_SOURCE = `// compute(snapshot) must return an object of string/number metrics.
function compute(snapshot) {
  var laps = snapshot.laps || []
  if (laps.length === 0) return { avgLapTime: 'no laps' }
  var sum = 0
  var n = 0
  for (var i = 0; i < laps.length; i++) {
    if (laps[i].lapTime != null) { sum += laps[i].lapTime; n++ }
  }
  return { avgLapTime: n > 0 ? (sum / n).toFixed(3) : 'n/a', sampledLaps: n }
}`

type RunState = 'running' | PluginRunResult

/**
 * Local, single-user plugin runner (APP_IMPROVEMENT_ROADMAP.md P3 item 36):
 * a plugin only ever receives a readonly, replay-bounded projection of the
 * current snapshot (`PluginSnapshotApi.ts`) inside a sandboxed Worker
 * (`pluginRunner.ts`) — never TOD credentials, DRM state, or live app state.
 */
export function PluginsPanel() {
  const snapshot = useSessionStore((s) => s.snapshot)
  const { plugins, add, remove } = usePluginStore()
  const [results, setResults] = useState<Record<string, RunState>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [source, setSource] = useState(EXAMPLE_SOURCE)
  const [feeds, setFeeds] = useState<Set<PluginFeed>>(new Set(['laps']))

  const toggleFeed = (f: PluginFeed) => {
    setFeeds((prev) => {
      const next = new Set(prev)
      if (next.has(f)) next.delete(f)
      else next.add(f)
      return next
    })
  }

  const savePlugin = () => {
    if (!name.trim() || !source.trim()) return
    add(name.trim(), source, [...feeds])
    setName('')
    setSource(EXAMPLE_SOURCE)
    setFeeds(new Set(['laps']))
    setShowAdd(false)
  }

  const run = async (id: string, pluginSource: string, requiredFeeds: PluginFeed[]) => {
    if (!snapshot) return
    const missing = validatePluginManifest({ id, name: id, requiredFeeds }, snapshot.availability)
    if (missing.length > 0) {
      setResults((r) => ({
        ...r,
        [id]: { error: `Missing feeds this session: ${missing.join(', ')}` }
      }))
      return
    }
    setResults((r) => ({ ...r, [id]: 'running' }))
    const projected = projectPluginSnapshot(snapshot, requiredFeeds)
    const result = await runPlugin(pluginSource, projected)
    setResults((r) => ({ ...r, [id]: result }))
  }

  return (
    <WidgetFrame
      title="Plugins"
      icon={<Puzzle className="h-4 w-4" />}
      actions={
        <Button size="xs" variant="outline" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="h-3 w-3" /> New
        </Button>
      }
    >
      <div className="flex h-full flex-col gap-2">
        {showAdd && (
          <div className="rounded-lg border border-hairline/20 bg-white/[0.02] p-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plugin name"
              spellCheck={false}
              className="w-full rounded-md border border-hairline/30 bg-black/30 px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {PLUGIN_FEEDS.map((f) => (
                <button
                  key={f}
                  onClick={() => toggleFeed(f)}
                  className={cn(
                    'rounded-md border px-1.5 py-0.5 text-2xs transition-colors',
                    feeds.has(f)
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-hairline/25 text-fg-subtle hover:text-fg-muted'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              rows={6}
              className="mono mt-1.5 w-full resize-none rounded-md border border-hairline/30 bg-black/30 px-2 py-1.5 text-2xs text-fg outline-none focus:border-accent/50"
            />
            <div className="mt-1.5 flex justify-end">
              <Button size="xs" variant="outline" onClick={savePlugin} disabled={!name.trim()}>
                Save plugin
              </Button>
            </div>
          </div>
        )}

        {plugins.length === 0 ? (
          <EmptyState
            title="No plugins yet"
            hint='Click "New" to add a local script — it only ever sees a readonly snapshot, never TOD credentials or DRM state.'
          />
        ) : (
          <div className="flex-1 space-y-1.5 overflow-y-auto">
            {plugins.map((p) => {
              const state = results[p.id]
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-hairline/20 bg-white/[0.02] p-2"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-fg">{p.name}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!snapshot || state === 'running'}
                        onClick={() => void run(p.id, p.source, p.requiredFeeds)}
                      >
                        {state === 'running' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Run
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => remove(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.requiredFeeds.map((f) => (
                      <Badge key={f} tone="neutral">
                        {f}
                      </Badge>
                    ))}
                  </div>
                  {state && state !== 'running' && (
                    <div className="mt-1.5 rounded-md border border-hairline/15 bg-black/20 p-1.5 text-2xs">
                      {'error' in state ? (
                        <span className="text-danger">{state.error}</span>
                      ) : (
                        <div className="space-y-0.5">
                          {Object.entries(state).map(([k, v]) => (
                            <div key={k} className="flex items-center justify-between gap-2">
                              <span className="text-fg-subtle">{k}</span>
                              <span className="tnum text-fg">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </WidgetFrame>
  )
}

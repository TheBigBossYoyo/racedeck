import { useState } from 'react'
import { BrainCircuit, Check, Eye, EyeOff, ExternalLink, Loader2, Zap } from 'lucide-react'
import { Button, Badge } from '@renderer/components/ui/primitives'
import { useSettingsStore } from '@renderer/store/settingsStore'
import {
  AI_PROVIDERS,
  AI_PROVIDER_ORDER,
  isAiConfigReady,
  maskKey,
  type AiProviderId
} from '@shared/ai'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { Section } from './Section'
import { Toggle } from './Toggle'
import { openAppLink } from './openAppLink'

type TestState = { state: 'idle' | 'testing' | 'ok' | 'error'; msg?: string; ms?: number }
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export function AiSection() {
  const ai = useSettingsStore((s) => s.ai)
  const setAi = useSettingsStore((s) => s.setAi)
  const saveAi = useSettingsStore((s) => s.saveAi)
  const openExternal = openAppLink
  const [showKey, setShowKey] = useState(false)
  const [test, setTest] = useState<TestState>({ state: 'idle' })
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const meta = AI_PROVIDERS[ai.provider]
  const ready = isAiConfigReady({ ...ai, enabled: true })

  const selectProvider = (id: AiProviderId) => {
    const m = AI_PROVIDERS[id]
    setAi({ provider: id, model: m.defaultModel, baseUrl: m.baseUrl })
    setTest({ state: 'idle' })
  }

  const runTest = async () => {
    if (!hasBridge())
      return setTest({ state: 'error', msg: 'Test only runs inside the desktop app.' })
    setTest({ state: 'testing' })
    const res = await bridge().ai.complete({
      config: { ...ai, enabled: true },
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      maxTokens: 5,
      temperature: 0
    })
    if (res.ok) setTest({ state: 'ok', msg: res.text.slice(0, 40), ms: res.latencyMs })
    else setTest({ state: 'error', msg: res.error ?? 'Request failed.' })
  }

  return (
    <Section
      icon={<BrainCircuit className="h-4 w-4" />}
      title="AI Race Engineer"
      desc="Bring your own AI key for natural-language strategy. Grounded in real timing — never invented."
    >
      <Toggle
        label="Enable AI Race Engineer"
        hint="Powers the AI briefing + ask-the-strategist panel."
        checked={ai.enabled}
        onChange={(v) => setAi({ enabled: v })}
      />

      <div className="mt-2">
        <label className="text-2xs uppercase tracking-wide text-fg-subtle">Provider</label>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {AI_PROVIDER_ORDER.map((id) => {
            const m = AI_PROVIDERS[id]
            const active = ai.provider === id
            return (
              <button
                key={id}
                onClick={() => selectProvider(id)}
                title={m.note}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                  active ? 'border-accent/50 bg-accent/10' : 'border-hairline/25 hover:bg-white/5'
                )}
              >
                <span className="flex w-full items-center gap-1">
                  <span
                    className={cn('text-xs font-semibold', active ? 'text-fg' : 'text-fg-muted')}
                  >
                    {m.label}
                  </span>
                  <Badge tone={m.free ? 'good' : 'neutral'} className="ml-auto">
                    {m.free ? 'free' : 'paid'}
                  </Badge>
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 flex items-start gap-1.5 text-2xs leading-relaxed text-fg-muted">
          <Zap className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
          {meta.note}
        </p>
      </div>

      {/* API key */}
      <div className="mt-2">
        <div className="flex items-center justify-between">
          <label className="text-2xs uppercase tracking-wide text-fg-subtle">
            API key{' '}
            {meta.editableBaseUrl && (
              <span className="normal-case text-fg-subtle">(optional for local)</span>
            )}
          </label>
          {meta.keyUrl && (
            <button
              onClick={() => openExternal(meta.keyUrl)}
              className="flex items-center gap-1 text-2xs text-accent hover:underline"
            >
              Get a key <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <input
            type={showKey ? 'text' : 'password'}
            value={ai.apiKey}
            spellCheck={false}
            autoComplete="off"
            placeholder={
              meta.editableBaseUrl ? 'leave blank for no-auth local endpoint' : 'paste your key'
            }
            onChange={(e) => {
              setAi({ apiKey: e.target.value })
              setTest({ state: 'idle' })
              setSaveState('dirty')
            }}
            className="mono min-w-0 flex-1 rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowKey((v) => !v)}
            title={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={saveState === 'saving'}
            onClick={async () => {
              setSaveState('saving')
              try {
                await saveAi()
                setSaveState('saved')
              } catch {
                setSaveState('error')
              }
            }}
          >
            {saveState === 'saving' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Save key
          </Button>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-2xs">
          <span className={ai.apiKey ? 'text-good' : 'text-fg-subtle'}>
            {ai.apiKey ? `Loaded locally: ${maskKey(ai.apiKey)}` : 'No key loaded'}
          </span>
          {saveState === 'dirty' && <span className="text-warn">· unsaved changes</span>}
          {saveState === 'saved' && <span className="text-good">· saved</span>}
          {saveState === 'error' && <span className="text-danger">· save failed</span>}
        </div>
      </div>

      {/* Base URL (custom / local only) */}
      {meta.editableBaseUrl && (
        <div className="mt-2">
          <label className="text-2xs uppercase tracking-wide text-fg-subtle">Base URL</label>
          <input
            value={ai.baseUrl}
            spellCheck={false}
            onChange={(e) => setAi({ baseUrl: e.target.value })}
            className="mono mt-1 w-full rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
          />
        </div>
      )}

      {/* Model */}
      <div className="mt-2">
        <label className="text-2xs uppercase tracking-wide text-fg-subtle">Model</label>
        <input
          value={ai.model}
          spellCheck={false}
          onChange={(e) => setAi({ model: e.target.value })}
          className="mono mt-1 w-full rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
        />
        {meta.models.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {meta.models.map((mdl) => (
              <button
                key={mdl}
                onClick={() => setAi({ model: mdl })}
                className={cn(
                  'mono rounded-md border px-1.5 py-0.5 text-2xs transition-colors',
                  ai.model === mdl
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-hairline/25 text-fg-subtle hover:text-fg-muted'
                )}
              >
                {mdl}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Test + status */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="md"
          disabled={test.state === 'testing' || !ready}
          onClick={runTest}
        >
          {test.state === 'testing' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          Test connection
        </Button>
        <Badge tone={ready ? 'good' : 'warn'}>{ready ? 'ready' : 'incomplete'}</Badge>
        {test.state === 'ok' && (
          <span className="flex items-center gap-1 text-2xs text-good">
            <Check className="h-3 w-3" /> Connected ({test.ms}ms)
          </span>
        )}
        {test.state === 'error' && <span className="text-2xs text-danger">{test.msg}</span>}
      </div>

      <p className="mt-3 rounded-md border border-hairline/20 bg-black/20 p-2 text-2xs leading-relaxed text-fg-subtle">
        Your key is stored locally on this device and sent only to the provider you choose, together
        with the on-screen timing context. It is never shared with TOD, RaceDeck, or any third
        party, and it is excluded from exported settings by default.
      </p>
    </Section>
  )
}

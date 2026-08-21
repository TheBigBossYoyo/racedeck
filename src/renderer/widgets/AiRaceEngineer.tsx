import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BrainCircuit, Sparkles, Send, RefreshCw, Settings2, AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { Button, Badge } from '@renderer/components/ui/primitives'
import { useStrategyStore } from '@renderer/store/strategyStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useAppStore } from '@renderer/store/appStore'
import { AI_PROVIDERS, isAiConfigReady } from '@shared/ai'
import { cn } from '@renderer/lib/utils'
import { useFocusDriver } from '@renderer/lib/useFocusDriver'

const SUGGESTIONS = [
  'Should the leader pit now?',
  'Where is the biggest undercut threat?',
  'Who is winning the strategy battle?',
  'What should I watch in the next 5 laps?'
]

/** Minimal, dependency-free renderer for the light markdown the models emit. */
function AiText({ text }: { text: string }) {
  const blocks = useMemo(() => text.split(/\n/).filter((l) => l.trim().length > 0), [text])
  return (
    <div className="space-y-1">
      {blocks.map((line, i) => {
        const bullet = /^\s*([-*•]|\d+\.)\s+/.exec(line)
        const content = bullet ? line.replace(/^\s*([-*•]|\d+\.)\s+/, '') : line
        const heading = /^#{1,3}\s+/.test(line)
        return (
          <div key={i} className={cn('flex gap-1.5 text-[12px] leading-snug', heading && 'mt-1')}>
            {bullet && <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-accent/70" />}
            <p className={cn('text-fg-muted', heading && 'font-semibold text-fg')}>
              {renderInline(content.replace(/^#{1,3}\s+/, ''))}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function renderInline(s: string): ReactNode[] {
  // Split on **bold** and `code`, keep delimiters.
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-fg">{p.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(p)) return <code key={i} className="mono rounded bg-black/40 px-1 text-[11px] text-accent">{p.slice(1, -1)}</code>
    return <span key={i}>{p}</span>
  })
}

function NotConfigured() {
  const setRoute = useAppStore((s) => s.setRoute)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-accent/10 text-accent">
        <BrainCircuit className="h-6 w-6" />
      </div>
      <div>
        <div className="text-sm font-semibold text-fg">Bring your own AI strategist</div>
        <p className="mx-auto mt-1 max-w-[280px] text-2xs leading-relaxed text-fg-muted">
          Connect a free API key (Google Gemini or Groq recommended) and RaceDeck turns the live
          timing into a natural-language race engineer — grounded in the real numbers, never invented.
        </p>
      </div>
      <Button variant="solid" size="md" onClick={() => setRoute('settings')}>
        <Settings2 className="h-4 w-4" /> Set up AI Race Engineer
      </Button>
      <p className="text-2xs text-fg-subtle">Free tiers available · your key stays on this device</p>
    </div>
  )
}

export function AiRaceEngineer() {
  const ai = useSettingsStore((s) => s.ai)
  const ready = isAiConfigReady(ai)
  const snapshot = useSessionStore((s) => s.snapshot)
  const focusDriver = useFocusDriver()

  const briefing = useStrategyStore((s) => s.briefing)
  const chat = useStrategyStore((s) => s.chat)
  const asking = useStrategyStore((s) => s.asking)
  const generateBriefing = useStrategyStore((s) => s.generateBriefing)
  const ask = useStrategyStore((s) => s.ask)
  const clearChat = useStrategyStore((s) => s.clearChat)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const focusCode = useMemo(() => {
    return focusDriver != null
      ? snapshot?.drivers.find((d) => d.number === focusDriver)?.code ?? null
      : null
  }, [snapshot, focusDriver])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat.length, asking, briefing.text])

  const providerLabel = AI_PROVIDERS[ai.provider]?.label ?? ai.provider

  const submit = () => {
    if (!input.trim() || asking) return
    void ask(input)
    setInput('')
  }

  return (
    <WidgetFrame
      title="AI Race Engineer"
      icon={<BrainCircuit />}
      subtitle={ready ? `${providerLabel} · ${ai.model}` : 'not connected'}
      actions={
        ready ? (
          <div className="flex items-center gap-1">
            {chat.length > 0 && (
              <Button variant="ghost" size="icon-sm" title="Clear chat" onClick={clearChat}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Badge tone="accent">
              <Sparkles className="h-3 w-3" /> grounded
            </Badge>
          </div>
        ) : null
      }
      bodyClassName="flex flex-col"
      noPadding
    >
      {!ready ? (
        <NotConfigured />
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-auto p-3">
            {/* Briefing card */}
            <div className="rounded-xl border border-accent/20 bg-accent/[0.04] p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
                  Strategy briefing{focusCode ? ` · ${focusCode}` : ''}
                </span>
                <Button
                  variant="subtle"
                  size="xs"
                  className="ml-auto"
                  disabled={briefing.loading || !snapshot}
                  onClick={() => void generateBriefing()}
                >
                  {briefing.loading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {briefing.text ? 'Refresh' : 'Generate'}
                </Button>
              </div>
              {briefing.loading ? (
                <ThinkingLine label="Reading the timing…" />
              ) : briefing.error ? (
                <ErrorLine message={briefing.error} />
              ) : briefing.text ? (
                <>
                  <AiText text={briefing.text} />
                  {briefing.model && (
                    <p className="mt-1.5 text-2xs text-fg-subtle">
                      {briefing.model} · {new Date(briefing.at ?? 0).toLocaleTimeString()} · estimate
                    </p>
                  )}
                </>
              ) : (
                <p className="text-2xs text-fg-muted">
                  Generate a live read of the current race moment — key battles, pit pressure, and
                  what to watch. Grounded in the on-screen timing.
                </p>
              )}
            </div>

            {/* Chat */}
            {chat.map((turn) => (
              <div
                key={turn.id}
                className={cn('flex', turn.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[88%] rounded-xl px-2.5 py-1.5',
                    turn.role === 'user'
                      ? 'bg-white/[0.06] text-[12px] text-fg'
                      : turn.error
                        ? 'border border-danger/25 bg-danger/5'
                        : 'border border-hairline/20 bg-white/[0.02]'
                  )}
                >
                  {turn.role === 'assistant' ? (
                    turn.error ? (
                      <ErrorLine message={turn.content} />
                    ) : (
                      <AiText text={turn.content} />
                    )
                  ) : (
                    <span>{turn.content}</span>
                  )}
                </div>
              </div>
            ))}
            {asking && (
              <div className="flex justify-start">
                <div className="rounded-xl border border-hairline/20 bg-white/[0.02] px-2.5 py-1.5">
                  <ThinkingLine label="Analysing…" />
                </div>
              </div>
            )}

            {chat.length === 0 && !asking && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void ask(s)}
                    className="rounded-full border border-hairline/30 px-2.5 py-1 text-2xs text-fg-muted transition-colors hover:border-accent/40 hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="flex items-center gap-1.5 border-t border-hairline/20 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Ask the strategist…"
              className="no-drag min-w-0 flex-1 rounded-lg border border-hairline/30 bg-black/30 px-2.5 py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent/50"
            />
            <Button variant="solid" size="icon" disabled={asking || !input.trim()} onClick={submit}>
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      )}
    </WidgetFrame>
  )
}

function ThinkingLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-fg-muted">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
      {label}
    </div>
  )
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-1.5 text-[11px] leading-snug text-danger/90">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

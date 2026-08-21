import { useState, type ReactNode } from 'react'
import {
  Tv,
  Bell,
  Star,
  Palette,
  Cpu,
  Database,
  LayoutGrid,
  DownloadCloud,
  Trash2,
  Check,
  BrainCircuit,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Zap,
  SlidersHorizontal,
  Trophy,
  Search,
  ShieldCheck
} from 'lucide-react'
import type { MarketEventSummary } from '@shared/market'
import { Button, Segmented, Badge } from '@renderer/components/ui/primitives'
import { Switch, Slider } from '@renderer/components/ui/controls'
import { Dialog, DialogTrigger, DialogContent } from '@renderer/components/ui/Dialog'
import { useSettingsStore, isModuleEnabled } from '@renderer/store/settingsStore'
import { useVideoStore } from '@renderer/store/videoStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { useLayoutStore } from '@renderer/store/layoutStore'
import { ACCENT_PRESETS } from '@shared/constants'
import { describeMode } from '@shared/video-fallback'
import { AI_PROVIDERS, AI_PROVIDER_ORDER, isAiConfigReady, maskKey, type AiProviderId } from '@shared/ai'
import { LAYOUT_PRESETS, WIDGET_CATALOG, type WidgetMeta } from '@renderer/core/engines/LayoutManager'
import type { AlertConfig } from '@renderer/core/engines/AlertEngine'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { cn, hexColor } from '@renderer/lib/utils'

function Section({
  icon,
  title,
  desc,
  children
}: {
  icon: ReactNode
  title: string
  desc?: string
  children: ReactNode
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
          {icon}
        </span>
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {desc && <p className="text-xs text-fg-muted">{desc}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function Toggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-xs font-medium text-fg">{label}</div>
        {hint && <div className="text-2xs text-fg-subtle">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

const ALERT_RULES: { key: keyof AlertConfig; label: string }[] = [
  { key: 'yellowFlag', label: 'Yellow flags' },
  { key: 'safetyCar', label: 'Safety Car / VSC' },
  { key: 'redFlag', label: 'Red flags' },
  { key: 'pitStop', label: 'Pit stops (favourites)' },
  { key: 'fastestLap', label: 'Fastest lap' },
  { key: 'weather', label: 'Weather / rain' },
  { key: 'intervalChange', label: 'Major interval change' },
  { key: 'penalty', label: 'Penalties / investigations' },
  { key: 'qualiElimination', label: 'Qualifying elimination risk' },
  { key: 'favoriteEvent', label: 'Any favourite-driver event' }
]

export function SettingsPage() {
  const { theme, setTheme, alerts, setAlerts, tod, setTod, performanceMode, setPerformanceMode, favorites, toggleFavorite, voice, setVoice, exportAll, importAll } =
    useSettingsStore()
  const video = useVideoStore((s) => s.state)
  const drivers = useSessionStore((s) => s.snapshot?.drivers ?? [])
  const catalog = useSessionStore((s) => s.catalog)
  const providerId = useSessionStore((s) => s.providerId)
  const setProvider = useSessionStore((s) => s.setProvider)
  const { savedLayouts, deleteSaved, loadSaved } = useLayoutStore()

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold text-fg">Settings</h1>
          <p className="text-sm text-fg-muted">Tune RaceDeck to your setup, broadcaster and taste.</p>
        </div>

        {/* TOD integration */}
        <Section icon={<Tv className="h-4 w-4" />} title="TOD integration" desc="How the TOD broadcast surface is presented.">
          <div className="mb-3 rounded-xl border border-hairline/25 bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-fg">{describeMode(video.mode).label}</span>
              <Badge tone={video.mode === 'embedded' ? 'good' : video.mode === 'companion' ? 'accent' : 'warn'}>
                {describeMode(video.mode).short}
              </Badge>
            </div>
            <p className="mt-1 text-2xs text-fg-muted">{describeMode(video.mode).blurb}</p>
            {video.fallbackReason && (
              <p className="mt-2 rounded-md border border-warn/20 bg-warn/5 p-2 text-2xs text-warn/90">
                {video.fallbackReason}
              </p>
            )}
            <div className="mt-2 grid grid-cols-3 gap-2 text-2xs">
              <Stat k="Widevine DRM" v={video.drmReady ? 'Ready' : 'Unavailable'} good={video.drmReady} />
              <Stat k="Embedded OK" v={video.embeddedSupported} />
              <Stat k="Playback" v={video.playbackActive} />
            </div>
          </div>
          <Toggle label="Auto-fallback to companion window" hint="If embedding is blocked, open a docked companion window automatically." checked={tod.autoFallback} onChange={(v) => setTod({ autoFallback: v })} />
          <div className="mt-2">
            <label className="text-2xs uppercase tracking-wide text-fg-subtle">TOD URL</label>
            <input
              value={tod.url}
              onChange={(e) => setTod({ url: e.target.value })}
              className="mt-1 w-full rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
            />
          </div>
        </Section>

        {/* AI Race Engineer */}
        <AiSection />

        {/* Win-odds market */}
        <MarketSection />

        {/* Modules */}
        <ModulesSection />

        {/* Appearance */}
        <Section icon={<Palette className="h-4 w-4" />} title="Appearance" desc="Theme, density and motion.">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-fg">Color scheme</span>
            <Segmented
              value={theme.mode}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'System' }
              ]}
              onChange={(v) => setTheme({ mode: v })}
            />
          </div>
          <div className="mb-3">
            <label className="text-2xs uppercase tracking-wide text-fg-subtle">Accent color</label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {Object.entries(ACCENT_PRESETS).map(([key, rgb]) => (
                <button
                  key={key}
                  onClick={() => setTheme({ accent: key as keyof typeof ACCENT_PRESETS })}
                  className={cn(
                    'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                    theme.accent === key ? 'border-white' : 'border-transparent'
                  )}
                  style={{ backgroundColor: `rgb(${rgb})` }}
                  title={key}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs font-medium text-fg">Density</span>
            <Segmented
              value={theme.density}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' }
              ]}
              onChange={(v) => setTheme({ density: v })}
            />
          </div>
          <Toggle label="Team-color highlights" checked={theme.teamColorMode} onChange={(v) => setTheme({ teamColorMode: v })} />
          <Toggle label="Reduce motion" hint="Disable heavy animations." checked={theme.reducedMotion} onChange={(v) => setTheme({ reducedMotion: v })} />
          <div className="flex items-center justify-between py-1.5">
            <div className="min-w-0 pr-2">
              <span className="text-xs font-medium text-fg">Colour vision</span>
              <p className="text-2xs text-fg-subtle">Colour-blind-safe tyre palettes. Compound letters always shown.</p>
            </div>
            <Segmented
              value={theme.colorVision}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'deuteranopia', label: 'Deuter', title: 'Deuteranopia (red-green)' },
                { value: 'protanopia', label: 'Protan', title: 'Protanopia (red-green)' },
                { value: 'tritanopia', label: 'Tritan', title: 'Tritanopia (blue-yellow)' }
              ]}
              onChange={(v) => setTheme({ colorVision: v })}
            />
          </div>
          <Toggle
            label="Voice read-out"
            hint="Speak high-priority Engineer's Notes (safety car, rain) aloud while playing. Local only."
            checked={voice.enabled}
            onChange={(v) => setVoice({ enabled: v })}
          />
          <div className="py-1.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-fg">Font scale</span>
              <span className="tnum text-2xs text-fg-muted">{Math.round(theme.fontScale * 100)}%</span>
            </div>
            <Slider min={0.85} max={1.3} step={0.05} value={[theme.fontScale]} onValueChange={([v]) => setTheme({ fontScale: v })} />
          </div>
        </Section>

        {/* Alerts */}
        <Section icon={<Bell className="h-4 w-4" />} title="Alerts" desc="Choose which events trigger alerts.">
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {ALERT_RULES.map((r) => (
              <Toggle
                key={r.key}
                label={r.label}
                checked={Boolean(alerts[r.key])}
                onChange={(v) => setAlerts({ [r.key]: v } as Partial<AlertConfig>)}
              />
            ))}
          </div>
          <div className="mt-2 py-1.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-fg">Interval change threshold</span>
              <span className="tnum text-2xs text-fg-muted">{alerts.intervalThresholdSec.toFixed(1)}s</span>
            </div>
            <Slider min={0.5} max={10} step={0.5} value={[alerts.intervalThresholdSec]} onValueChange={([v]) => setAlerts({ intervalThresholdSec: v })} />
          </div>
        </Section>

        {/* Favourites */}
        <Section icon={<Star className="h-4 w-4" />} title="Favourite drivers" desc="Focus alerts and strategy on these drivers.">
          {drivers.length === 0 ? (
            <p className="text-xs text-fg-subtle">Load a session to pick favourite drivers.</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {drivers.map((d) => {
                const fav = favorites.includes(d.number)
                return (
                  <button
                    key={d.number}
                    onClick={() => toggleFavorite(d.number)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors',
                      fav ? 'border-accent/40 bg-accent/10' : 'border-hairline/25 hover:bg-white/5'
                    )}
                  >
                    <span className="h-4 w-1 rounded-full" style={{ backgroundColor: hexColor(d.teamColour) }} />
                    <span className="text-xs font-bold text-fg">{d.code}</span>
                    <Star className={cn('ml-auto h-3.5 w-3.5', fav ? 'fill-accent text-accent' : 'text-fg-subtle')} />
                  </button>
                )
              })}
            </div>
          )}
        </Section>

        {/* Data source */}
        <Section icon={<Database className="h-4 w-4" />} title="Data source" desc="Where live/replay timing comes from.">
          <Segmented
            size="md"
            value={providerId}
            options={catalog.map((c) => ({ value: c.id, label: c.label.split(' ')[0] }))}
            onChange={(id) => void setProvider(id)}
          />
          {catalog
            .filter((c) => c.id === providerId)
            .map((c) => (
              <p key={c.id} className="mt-2 text-xs text-fg-muted">
                {c.description}
                {c.riskLevel !== 'none' && (
                  <Badge tone="warn" className="ml-2">
                    {c.riskLevel} risk
                  </Badge>
                )}
              </p>
            ))}
        </Section>

        {/* Layouts */}
        <Section icon={<LayoutGrid className="h-4 w-4" />} title="Saved layouts" desc="Your custom panel arrangements.">
          {savedLayouts.length === 0 ? (
            <p className="text-xs text-fg-subtle">No saved layouts. Save one from the dashboard command bar.</p>
          ) : (
            <div className="space-y-1.5">
              {savedLayouts.map((l) => (
                <div key={l.id} className="flex items-center gap-2 rounded-lg border border-hairline/25 px-3 py-2">
                  <span className="text-xs font-medium text-fg">{l.name}</span>
                  <Badge tone="neutral">{LAYOUT_PRESETS[l.base].name}</Badge>
                  <div className="ml-auto flex gap-1">
                    <Button size="xs" variant="outline" onClick={() => loadSaved(l.id)}>
                      Load
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => void deleteSaved(l.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Performance + backup */}
        <div className="grid gap-4 md:grid-cols-2">
          <Section icon={<Cpu className="h-4 w-4" />} title="Performance">
            <Toggle label="Performance mode" hint="Lower update rate & animations for low-power machines." checked={performanceMode} onChange={setPerformanceMode} />
          </Section>
          <Section icon={<DownloadCloud className="h-4 w-4" />} title="Backup">
            <BackupControls exportAll={exportAll} importAll={importAll} />
          </Section>
        </div>

        <p className="px-1 pb-2 text-2xs leading-relaxed text-fg-subtle">
          RaceDeck integrates TOD through a legal, user-authenticated browser surface only. It never
          bypasses DRM, extracts stream URLs, intercepts license keys, or reads your credentials.
        </p>
      </div>
    </div>
  )
}

const MODULE_GROUPS: { group: WidgetMeta['group']; label: string }[] = [
  { group: 'timing', label: 'Timing & track' },
  { group: 'strategy', label: 'Strategy & AI' },
  { group: 'charts', label: 'Charts' },
  { group: 'tools', label: 'Tools' }
]

const MODULE_DESC: Partial<Record<string, string>> = {
  'timing-tower': 'Live classification tower',
  'track-map': 'Positions around the lap',
  'race-control': 'Flags, SC, penalties feed',
  weather: 'Air/track temp, rain',
  'tyre-strategy': 'Stint & pit history bars',
  'gap-chart': 'Gap-to-leader over laps',
  'lap-time-chart': 'Lap-time trends',
  'position-trend': 'Position changes',
  'driver-comparison': 'Head-to-head deltas',
  telemetry: 'Speed/throttle/brake traces',
  'strategy-insights': 'Undercut, deg, battles',
  'pit-predictor': 'If they pit now: rejoin & delta',
  'stint-planner': 'Optimal remaining strategy',
  'pace-battle': 'Pace vs car ahead & behind',
  'driver-dossier': 'One driver, everything',
  'ai-engineer': 'AI strategy briefings + chat',
  'team-pace': 'Fastest team right now',
  'tyre-lab': 'Compound pace, deg & best tyre',
  'win-probability': 'Win/podium/points odds + market',
  'battle-radar': 'Live on-track fights & overtake trains',
  'race-story': 'Auto narrative of key moments',
  championship: 'Title-fight projection & standings',
  'engineer-notes': 'Proactive strategy prompts + voice',
  alerts: 'Event alert center',
  sync: 'Broadcast-delay wizard'
}

function MarketSection() {
  const market = useSettingsStore((s) => s.market)
  const setMarket = useSettingsStore((s) => s.setMarket)
  const openExternal = useVideoStore((s) => s.openExternal)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<MarketEventSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const runSearch = async () => {
    if (!hasBridge()) return setErr('Search only runs inside the desktop app.')
    setSearching(true)
    setErr(null)
    try {
      const res = await bridge().market.search(query)
      if (res.ok) setResults(res.events)
      else setErr(res.error ?? 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <Section
      icon={<Trophy className="h-4 w-4" />}
      title="Win-odds market"
      desc="Overlay public Polymarket win odds next to RaceDeck's own model. Optional and off by default."
    >
      <Toggle
        label="Show Polymarket win odds"
        hint="Auto-matches the current Grand Prix to a public winner market."
        checked={market.enabled}
        onChange={(v) => setMarket({ enabled: v })}
      />
      <Toggle
        label="Auto-refresh odds"
        hint="Poll for fresh prices during a live race (~every 45s)."
        checked={market.autoRefresh}
        onChange={(v) => setMarket({ autoRefresh: v })}
      />

      <div className="mt-2">
        <label className="text-2xs uppercase tracking-wide text-fg-subtle">
          Pin an event (optional)
        </label>
        <p className="mt-0.5 text-2xs text-fg-subtle">
          If auto-match picks the wrong race, paste a Polymarket event URL/slug or search below.
        </p>
        <input
          value={market.slugOverride}
          spellCheck={false}
          placeholder="e.g. f1-singapore-grand-prix-winner"
          onChange={(e) => setMarket({ slugOverride: e.target.value })}
          className="mono mt-1 w-full rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            value={query}
            spellCheck={false}
            placeholder="search events, e.g. British Grand Prix"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            className="min-w-0 flex-1 rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
          />
          <Button variant="outline" size="md" onClick={() => void runSearch()} disabled={searching || !query.trim()}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Search
          </Button>
        </div>
        {err && <p className="mt-1.5 text-2xs text-danger">{err}</p>}
        {results && (
          <div className="mt-1.5 space-y-1">
            {results.length === 0 && <p className="text-2xs text-fg-subtle">No winner markets found.</p>}
            {results.map((ev) => (
              <div key={ev.slug} className="flex items-center gap-2 rounded-lg border border-hairline/25 px-2 py-1.5">
                <StatusDotLite closed={ev.closed} />
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted">{ev.title}</span>
                <Button size="xs" variant="subtle" onClick={() => setMarket({ slugOverride: ev.slug })}>
                  {market.slugOverride === ev.slug ? 'Pinned' : 'Pin'}
                </Button>
              </div>
            ))}
          </div>
        )}
        {market.slugOverride && (
          <button
            onClick={() => openExternal(`https://polymarket.com/event/${market.slugOverride}`)}
            className="mt-1.5 flex items-center gap-1 text-2xs text-accent hover:underline"
          >
            Open pinned event on Polymarket <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>

      <p className="mt-3 flex items-start gap-1.5 rounded-md border border-hairline/20 bg-black/20 p-2 text-2xs leading-relaxed text-fg-subtle">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-good/70" />
        Odds are read-only public data from Polymarket. RaceDeck sends only the Grand-Prix name to
        look up the market — never your identity, TOD credentials, or any content. Prediction-market
        odds are opinion, not fact.
      </p>
    </Section>
  )
}

function StatusDotLite({ closed }: { closed: boolean }) {
  return (
    <span
      className={cn('h-1.5 w-1.5 shrink-0 rounded-full', closed ? 'bg-fg-subtle/40' : 'bg-good')}
      title={closed ? 'Resolved' : 'Live'}
    />
  )
}

function ModulesSection() {
  const modules = useSettingsStore((s) => s.modules)
  const setModule = useSettingsStore((s) => s.setModule)
  const setAllModules = useSettingsStore((s) => s.setAllModules)

  const enabledCount = (Object.values(WIDGET_CATALOG) as WidgetMeta[]).filter(
    (w) => w.key !== 'tod-video' && isModuleEnabled(modules, w.key)
  ).length
  const total = (Object.values(WIDGET_CATALOG) as WidgetMeta[]).filter((w) => w.key !== 'tod-video').length

  return (
    <Section
      icon={<SlidersHorizontal className="h-4 w-4" />}
      title="Modules"
      desc="Enable or disable any panel. Disabled panels are hidden everywhere and removed from the Widgets menu."
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Badge tone="accent">{enabledCount}/{total} on</Badge>
        <div className="ml-auto flex gap-1.5">
          <Button size="xs" variant="subtle" onClick={() => setAllModules(true)}>Enable all</Button>
          <Button size="xs" variant="subtle" onClick={() => setAllModules(false)}>Disable all</Button>
        </div>
      </div>
      {MODULE_GROUPS.map(({ group, label }) => {
        const items = (Object.values(WIDGET_CATALOG) as WidgetMeta[]).filter(
          (w) => w.group === group && w.key !== 'tod-video'
        )
        if (items.length === 0) return null
        return (
          <div key={group} className="mb-2.5">
            <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-fg-subtle">{label}</div>
            <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
              {items.map((w) => (
                <Toggle
                  key={w.key}
                  label={w.title}
                  hint={MODULE_DESC[w.key]}
                  checked={isModuleEnabled(modules, w.key)}
                  onChange={(v) => setModule(w.key, v)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </Section>
  )
}

type TestState = { state: 'idle' | 'testing' | 'ok' | 'error'; msg?: string; ms?: number }
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

function AiSection() {
  const ai = useSettingsStore((s) => s.ai)
  const setAi = useSettingsStore((s) => s.setAi)
  const saveAi = useSettingsStore((s) => s.saveAi)
  const openExternal = useVideoStore((s) => s.openExternal)
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
    if (!hasBridge()) return setTest({ state: 'error', msg: 'Test only runs inside the desktop app.' })
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
                  <span className={cn('text-xs font-semibold', active ? 'text-fg' : 'text-fg-muted')}>
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
            API key {meta.editableBaseUrl && <span className="normal-case text-fg-subtle">(optional for local)</span>}
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
            placeholder={meta.editableBaseUrl ? 'leave blank for no-auth local endpoint' : 'paste your key'}
            onChange={(e) => {
              setAi({ apiKey: e.target.value })
              setTest({ state: 'idle' })
              setSaveState('dirty')
            }}
            className="mono min-w-0 flex-1 rounded-lg border border-hairline/40 bg-black/30 px-3 py-1.5 text-xs text-fg outline-none focus:border-accent/50"
          />
          <Button variant="ghost" size="icon" onClick={() => setShowKey((v) => !v)} title={showKey ? 'Hide' : 'Show'}>
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
            {saveState === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
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
        <Button variant="outline" size="md" disabled={test.state === 'testing' || !ready} onClick={runTest}>
          {test.state === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
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
        with the on-screen timing context. It is never shared with TOD, RaceDeck, or any third party,
        and it is excluded from exported settings by default.
      </p>
    </Section>
  )
}

function Stat({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="rounded-md border border-hairline/20 bg-black/20 px-2 py-1">
      <div className="text-fg-subtle">{k}</div>
      <div className={cn('font-semibold capitalize', good ? 'text-good' : 'text-fg')}>{v}</div>
    </div>
  )
}

function BackupControls({
  exportAll,
  importAll
}: {
  exportAll: () => Record<string, unknown>
  importAll: (d: Record<string, unknown>) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="md" onClick={() => setText(JSON.stringify(exportAll(), null, 2))}>
          Export / import settings
        </Button>
      </DialogTrigger>
      <DialogContent title="Backup settings" description="Copy this JSON to back up, or paste JSON and import.">
        <div className="p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            className="h-48 w-full resize-none rounded-lg border border-hairline/40 bg-black/40 p-2 font-mono text-2xs text-fg outline-none focus:border-accent/50"
          />
          {status && <p className="mt-2 flex items-center gap-1 text-2xs text-good"><Check className="h-3 w-3" /> {status}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                void navigator.clipboard?.writeText(text)
                setStatus('Copied to clipboard')
              }}
            >
              Copy
            </Button>
            <Button
              variant="solid"
              size="md"
              onClick={async () => {
                try {
                  await importAll(JSON.parse(text))
                  setStatus('Imported successfully')
                } catch {
                  setStatus('Invalid JSON')
                }
              }}
            >
              Import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

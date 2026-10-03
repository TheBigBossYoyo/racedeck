import { useState } from 'react'
import { Loader2, ExternalLink, Trophy, Search, ShieldCheck } from 'lucide-react'
import type { MarketEventSummary } from '@shared/market'
import { Button } from '@renderer/components/ui/primitives'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { hasBridge, bridge } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { Section } from './Section'
import { Toggle } from './Toggle'
import { openAppLink } from './openAppLink'

export function MarketSection() {
  const market = useSettingsStore((s) => s.market)
  const setMarket = useSettingsStore((s) => s.setMarket)
  const openExternal = openAppLink
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
          <Button
            variant="outline"
            size="md"
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            Search
          </Button>
        </div>
        {err && <p className="mt-1.5 text-2xs text-danger">{err}</p>}
        {results && (
          <div className="mt-1.5 space-y-1">
            {results.length === 0 && (
              <p className="text-2xs text-fg-subtle">No winner markets found.</p>
            )}
            {results.map((ev) => (
              <div
                key={ev.slug}
                className="flex items-center gap-2 rounded-lg border border-hairline/25 px-2 py-1.5"
              >
                <StatusDotLite closed={ev.closed} />
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted">{ev.title}</span>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => setMarket({ slugOverride: ev.slug })}
                >
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

import { Star } from 'lucide-react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { cn, EMPTY_ARRAY, hexColor } from '@renderer/lib/utils'
import { Section } from './Section'

export function FavouritesSection() {
  const { favorites, toggleFavorite } = useSettingsStore()
  const drivers = useSessionStore((s) => s.snapshot?.drivers ?? EMPTY_ARRAY)

  return (
    <Section
      icon={<Star className="h-4 w-4" />}
      title="Favourite drivers"
      desc="Focus alerts and strategy on these drivers."
    >
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
                <span
                  className="h-4 w-1 rounded-full"
                  style={{ backgroundColor: hexColor(d.teamColour) }}
                />
                <span className="text-xs font-bold text-fg">{d.code}</span>
                <Star
                  className={cn(
                    'ml-auto h-3.5 w-3.5',
                    fav ? 'fill-accent text-accent' : 'text-fg-subtle'
                  )}
                />
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}

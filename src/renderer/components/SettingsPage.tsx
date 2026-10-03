import { AiSection } from './settings/AiSection'
import { AlertsSection } from './settings/AlertsSection'
import { AppearanceSection } from './settings/AppearanceSection'
import { DataSourceSection } from './settings/DataSourceSection'
import { FavouritesSection } from './settings/FavouritesSection'
import { LayoutsSection } from './settings/LayoutsSection'
import { MarketSection } from './settings/MarketSection'
import { ModulesSection } from './settings/ModulesSection'
import { PerformanceBackupSection } from './settings/PerformanceBackupSection'
import { ProfilesSection } from './settings/ProfilesSection'
import { TodSection } from './settings/TodSection'
import { UnitsSection } from './settings/UnitsSection'

export function SettingsPage() {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <div>
          <h1 className="text-xl font-bold text-fg">Settings</h1>
          <p className="text-sm text-fg-muted">
            Tune RaceDeck to your setup, broadcaster and taste.
          </p>
        </div>

        {/* TOD integration */}
        <TodSection />

        {/* AI Race Engineer */}
        <AiSection />

        {/* Win-odds market */}
        <MarketSection />

        {/* Modules */}
        <ModulesSection />

        {/* Appearance */}
        <AppearanceSection />

        {/* Units */}
        <UnitsSection />

        {/* Alerts */}
        <AlertsSection />

        {/* Race-watch profiles */}
        <ProfilesSection />

        {/* Favourites */}
        <FavouritesSection />

        {/* Data source */}
        <DataSourceSection />

        {/* Layouts */}
        <LayoutsSection />

        {/* Performance + backup */}
        <PerformanceBackupSection />

        <p className="px-1 pb-2 text-2xs leading-relaxed text-fg-subtle">
          RaceDeck integrates TOD through a legal, user-authenticated browser surface only. It never
          bypasses DRM, extracts stream URLs, intercepts license keys, or reads your credentials.
        </p>
      </div>
    </div>
  )
}

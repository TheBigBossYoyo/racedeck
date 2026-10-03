import { Cpu, DownloadCloud } from 'lucide-react'
import { BackupControls } from '@renderer/components/BackupControls'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { Section } from './Section'
import { Toggle } from './Toggle'

export function PerformanceBackupSection() {
  const { performanceMode, setPerformanceMode, exportAll, importAll } = useSettingsStore()

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section icon={<Cpu className="h-4 w-4" />} title="Performance">
        <Toggle
          label="Performance mode"
          hint="Lower update rate & animations for low-power machines."
          checked={performanceMode}
          onChange={setPerformanceMode}
        />
      </Section>
      <Section icon={<DownloadCloud className="h-4 w-4" />} title="Backup">
        <BackupControls exportAll={exportAll} importAll={importAll} />
      </Section>
    </div>
  )
}

import { CommandBar } from '@renderer/components/shell/CommandBar'
import { GridLayoutHost } from '@renderer/components/dashboard/GridLayoutHost'

export function DashboardView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CommandBar />
      <div className="min-h-0 flex-1">
        <GridLayoutHost />
      </div>
    </div>
  )
}

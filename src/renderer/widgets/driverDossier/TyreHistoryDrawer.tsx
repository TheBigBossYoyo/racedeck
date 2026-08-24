import { useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { TyrePill } from '@renderer/components/ui/primitives'
import type { TyreStintRecord } from '@shared/models'

/**
 * Expandable list of a driver's prior tyre stints, sourced from F1's own
 * `TyreStintSeries` feed (see `f1normalize.buildTyreStintHistory`) — a direct
 * feed statement of which set ran each stint, not a reconstruction.
 */
export function TyreHistoryDrawer({ stints }: { readonly stints: readonly TyreStintRecord[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle hover:text-fg-muted"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <History className="h-3 w-3" />
        Set history ({stints.length})
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {stints.map((stint) => (
            <div
              key={stint.stintNumber}
              className="flex items-center gap-2 rounded-md border border-hairline/15 bg-black/20 px-2 py-1 text-[10px]"
            >
              <span className="tnum text-fg-subtle">#{stint.stintNumber}</span>
              <TyrePill compound={stint.compound} size="sm" />
              <span className="text-fg-muted">
                {stint.isNew ? 'new' : `used - ${stint.ageAtStart}L before fit`}
              </span>
              <span className="tnum ml-auto text-fg-subtle">{stint.totalLaps}L total</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

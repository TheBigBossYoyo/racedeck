import { AlertTriangle, CircleDashed } from 'lucide-react'
import { ProvenanceBadge, TyrePill } from '@renderer/components/ui/primitives'
import { Sparkline } from '@renderer/components/ui/Sparkline'
import type { TyreReadModel } from '@renderer/core/engines/TyreRead'
import type { SectorDegradationPoint } from '@renderer/core/engines/SectorDegradation'
import { TyreHistoryDrawer } from '@renderer/widgets/driverDossier/TyreHistoryDrawer'
import { cn } from '@renderer/lib/utils'

const HEAVY_SECTOR_DEGRADATION = 0.05

function sectorChipText(point: SectorDegradationPoint): string {
  if (point.slopeSecPerLap == null) return `S${point.sector} —`
  if (Math.abs(point.slopeSecPerLap) < 0.01) return `S${point.sector} flat`
  const sign = point.slopeSecPerLap >= 0 ? '+' : ''
  return `S${point.sector} ${sign}${point.slopeSecPerLap.toFixed(2)}s/lap`
}

function SectorDegradationRow({ sectors }: { readonly sectors: SectorDegradationPoint[] }) {
  if (sectors.every((s) => s.slopeSecPerLap == null)) return null
  return (
    <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-hairline/15 bg-black/20 px-2 py-1 text-[10px]">
      <span className="text-[9px] uppercase tracking-wide text-fg-subtle">Sectors</span>
      <div className="ml-auto flex items-center gap-2">
        {sectors.map((s) => (
          <span
            key={s.sector}
            className={cn(
              'tnum',
              s.slopeSecPerLap == null
                ? 'text-fg-subtle'
                : s.slopeSecPerLap > HEAVY_SECTOR_DEGRADATION
                  ? 'text-warn'
                  : 'text-fg-muted'
            )}
            title={
              s.deltaToBestSec != null
                ? `${s.deltaToBestSec >= 0 ? '+' : ''}${s.deltaToBestSec.toFixed(2)}s vs own best S${s.sector}`
                : undefined
            }
          >
            {sectorChipText(s)}
          </span>
        ))}
      </div>
    </div>
  )
}

const CONDITION_META: Record<
  NonNullable<TyreReadModel['condition']>,
  { readonly label: string; readonly tone: string; readonly blurb: string }
> = {
  fresh: {
    label: 'Fresh',
    tone: 'text-good',
    blurb: 'Only a couple of laps on this set - no meaningful wear trend yet.'
  },
  steady: {
    label: 'Holding on',
    tone: 'text-good',
    blurb: 'Lap times are essentially flat across this stint - the set is not dropping away.'
  },
  working: {
    label: 'Working',
    tone: 'text-warn',
    blurb: 'A real but manageable drop-off across this stint.'
  },
  spent: {
    label: 'Dropping off',
    tone: 'text-danger',
    blurb: 'Lap times are falling away quickly on this set.'
  }
}

const BLOCKER_TEXT: Record<'traffic' | 'insufficient-laps', string> = {
  traffic:
    'Held up within a second of the car ahead - this pace is traffic, not the tyre, so no wear trend is claimed.',
  'insufficient-laps': 'Not enough clean laps on this set yet to read a wear trend.'
}

const CONTAMINATION_REASON_TEXT: Record<
  NonNullable<TyreReadModel['contaminationReasons']>[number],
  string
> = {
  'close-traffic': 'held up within a second of the car ahead',
  train: 'running in a train of cars',
  'lapped-traffic': 'a lap down',
  'pit-interaction': 'a car ahead/behind is entering or leaving the pits',
  neutralized: 'the field is bunched under Safety Car/VSC',
  'sector-yellow': 'an active sector yellow nearby'
}

function contaminationBlurb(
  reasons: readonly TyreReadModel['contaminationReasons'][number][]
): string {
  if (reasons.length === 0) return BLOCKER_TEXT.traffic
  const parts = reasons.map((r) => CONTAMINATION_REASON_TEXT[r])
  return `This lap is ${parts.join(' and ')} — this pace is not a clean tyre read.`
}

function TyreStat({
  label,
  value,
  tone
}: {
  readonly label: string
  readonly value: string
  readonly tone?: string
}) {
  return (
    <div className="rounded-lg border border-hairline/15 bg-black/20 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className={cn('tnum text-xs font-semibold', tone ?? 'text-fg')}>{value}</div>
    </div>
  )
}

export function TyrePanel({
  read,
  sectors
}: {
  readonly read: TyreReadModel
  readonly sectors?: SectorDegradationPoint[]
}) {
  const condition = read.condition ? CONDITION_META[read.condition] : null
  const blocker = !read.degradationBlocker
    ? null
    : read.degradationBlocker === 'traffic'
      ? contaminationBlurb(read.contaminationReasons)
      : BLOCKER_TEXT[read.degradationBlocker]
  const vsField =
    read.degradationPerLap != null && read.fieldDegradationPerLap != null
      ? read.degradationPerLap - read.fieldDegradationPerLap
      : null

  const degradationTone =
    read.degradationPerLap == null
      ? 'text-fg-subtle'
      : read.degradationPerLap > 0.14
        ? 'text-danger'
        : read.degradationPerLap > 0.06
          ? 'text-warn'
          : 'text-good'

  return (
    <div className="rounded-lg border border-hairline/25 bg-white/[0.02] p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-muted">
          <CircleDashed className="h-3.5 w-3.5" /> Tyre
          <TyrePill compound={read.compound} size="sm" />
        </span>
        {condition && (
          <span className={cn('text-2xs font-bold', condition.tone)} title={condition.blurb}>
            {condition.label}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <TyreStat
          label="Set age"
          value={read.setAge != null ? `${read.setAge}L` : '-'}
          tone={read.usedSet ? 'text-warn' : undefined}
        />
        <TyreStat label="This stint" value={read.stintLaps != null ? `${read.stintLaps}L` : '-'} />
        <TyreStat
          label="Deg"
          value={
            read.degradationPerLap != null
              ? `${read.degradationPerLap >= 0 ? '+' : ''}${read.degradationPerLap.toFixed(3)}`
              : '-'
          }
          tone={degradationTone}
        />
      </div>

      {sectors && sectors.length > 0 && <SectorDegradationRow sectors={sectors} />}

      {read.sparklineLaps.length >= 2 && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-hairline/15 bg-black/20 px-2 py-1">
          <span className="text-[9px] uppercase tracking-wide text-fg-subtle">Trend</span>
          <Sparkline
            values={read.sparklineLaps.map((l) => l.correctedSec)}
            tone={degradationTone.replace('text-', 'stroke-')}
            width={72}
            height={20}
            className="ml-auto"
          />
        </div>
      )}

      {read.usedSet && (
        <div className="mt-1.5 flex items-start gap-1.5">
          <p className="text-[10px] leading-snug text-warn/90">
            {read.setLabel ?? 'Used set'} - used, {read.priorStintLaps ?? read.setAge}L before fit.
          </p>
          <ProvenanceBadge
            provenance={read.ageIsDirect ? 'feed-derived' : 'insufficient'}
            detail={
              read.ageIsDirect
                ? "Direct from F1's TyreStintSeries feed"
                : 'TyreStintSeries has not reported this driver yet - age inferred from TimingAppData'
            }
          />
        </div>
      )}

      {read.stintHistory && read.stintHistory.length > 1 && (
        <TyreHistoryDrawer stints={read.stintHistory} />
      )}

      {read.degradationPerLap != null ? (
        <div className="mt-1.5 space-y-0.5 text-[10px] leading-snug text-fg-muted">
          {read.latestLapLossSec != null && (
            <p>
              Latest clean lap is{' '}
              <span className="tnum font-semibold text-fg">
                {read.latestLapLossSec.toFixed(2)}s
              </span>{' '}
              slower than the start of this trend
              <span className="text-fg-subtle"> ({read.slopeSampleLaps} clean laps)</span>.
            </p>
          )}
          {vsField != null && (
            <p
              title={
                read.fieldDegradationMeasured
                  ? undefined
                  : 'The field figure is estimated - no measured laps on this compound yet.'
              }
            >
              {Math.abs(vsField) < 0.01 ? (
                <>
                  In line with the field on this compound
                  {read.fieldDegradationMeasured ? '' : ' (estimated)'}.
                </>
              ) : (
                <>
                  <span
                    className={cn('tnum font-semibold', vsField > 0 ? 'text-warn' : 'text-good')}
                  >
                    {vsField > 0 ? '+' : ''}
                    {vsField.toFixed(3)}s/lap
                  </span>{' '}
                  {vsField > 0 ? 'worse' : 'better'} than the field on this compound
                  {read.fieldDegradationMeasured ? '' : ' (estimated)'}.
                </>
              )}
            </p>
          )}
        </div>
      ) : (
        blocker && (
          <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-fg-subtle">
            <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" />
            {blocker}
          </p>
        )
      )}
    </div>
  )
}

import { AlertTriangle, CircleDashed } from 'lucide-react'
import { ProvenanceBadge, TyrePill } from '@renderer/components/ui/primitives'
import { Chart, gridBase, tooltipBase, cssVar } from '@renderer/lib/echarts'
import type { EChartsCoreOption } from 'echarts/core'
import type { TyreReadModel } from '@renderer/core/engines/TyreRead'
import type { SectorDegradationPoint } from '@renderer/core/engines/SectorDegradation'
import { TyreHistoryDrawer } from '@renderer/widgets/driverDossier/TyreHistoryDrawer'
import { cn, formatLapTime } from '@renderer/lib/utils'

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
    <div className="mb-1.5">
      <div className="mb-1 text-[9px] uppercase tracking-wide text-fg-subtle">
        Sector degradation
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {sectors.map((s) => {
          const heavy = s.slopeSecPerLap != null && s.slopeSecPerLap > HEAVY_SECTOR_DEGRADATION
          return (
            <div
              key={s.sector}
              className={cn(
                'rounded-lg border px-2 py-1 text-center text-[10px] font-semibold',
                s.slopeSecPerLap == null
                  ? 'border-hairline/15 bg-black/20 text-fg-subtle'
                  : heavy
                    ? 'border-warn/30 bg-warn/10 text-warn'
                    : 'border-hairline/15 bg-white/[0.03] text-fg-muted'
              )}
              title={
                s.deltaToBestSec != null
                  ? `${s.deltaToBestSec >= 0 ? '+' : ''}${s.deltaToBestSec.toFixed(2)}s vs own best S${s.sector}`
                  : undefined
              }
            >
              {sectorChipText(s)}
              {heavy && <span className="sr-only"> (heavy degradation)</span>}
            </div>
          )
        })}
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

const TONE_TO_CSS_VAR: Record<string, string> = {
  'text-danger': '--danger',
  'text-warn': '--warn',
  'text-good': '--good',
  'text-fg-subtle': '--fg-subtle'
}

/** Real axis-scaled trend chart (echarts) replacing a scale-less sparkline — same charting library the other chart widgets already use. */
function buildTrendChartOption(
  laps: readonly { lapNumber: number; correctedSec: number }[],
  tone: string
): EChartsCoreOption {
  const color = cssVar(TONE_TO_CSS_VAR[tone] ?? '--fg-subtle')
  return {
    grid: { ...gridBase, left: 56, right: 10, top: 10, bottom: 22 },
    tooltip: {
      ...tooltipBase,
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params
        const value = (p as { value: [number, number] }).value
        return `Lap ${value[0]}<br/><span style="color:${color}">●</span> ${formatLapTime(value[1])}`
      }
    },
    xAxis: {
      type: 'value',
      name: 'Lap',
      nameLocation: 'middle',
      nameGap: 16,
      min: 'dataMin',
      max: 'dataMax',
      axisLabel: { formatter: '{value}', fontSize: 9 }
    },
    yAxis: {
      type: 'value',
      scale: true,
      // Fixed at 3 ticks (not echarts' default auto-count) — the plot area is
      // compact (dossier real estate), and "1:31.800"-style labels collide
      // into unreadable overlap once more than a handful are drawn.
      splitNumber: 3,
      axisLabel: { formatter: (val: number) => formatLapTime(val), fontSize: 9 }
    },
    series: [
      {
        type: 'line',
        data: laps.map((l) => [l.lapNumber, l.correctedSec]),
        itemStyle: { color },
        lineStyle: { width: 2, color },
        showSymbol: true,
        symbolSize: 5
      }
    ]
  }
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

      {sectors && sectors.length > 0 && <SectorDegradationRow sectors={sectors} />}

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

      {read.sparklineLaps.length >= 2 && (
        <div className="mt-1.5 rounded-lg border border-hairline/15 bg-black/20 px-1.5 pb-1 pt-1.5">
          <div className="mb-0.5 px-0.5 text-[9px] uppercase tracking-wide text-fg-subtle">
            Trend — fuel-corrected lap time
          </div>
          <div className="h-32">
            <Chart option={buildTrendChartOption(read.sparklineLaps, degradationTone)} />
          </div>
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

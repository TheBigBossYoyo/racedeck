import type { RaceSnapshot } from '@renderer/core/providers/types'
import type { AiMessage } from '@shared/ai'
import type { PitPrediction } from './StrategyEngine'

/**
 * StrategyContext — turns the CURRENT, REAL race snapshot (plus the deterministic
 * pit prediction) into a compact factual brief for the AI Race Engineer.
 *
 * The whole point: the model reasons over *these* numbers instead of inventing
 * them. Everything here is pure and unit-tested, and the system prompt forces the
 * model to stay grounded, concede uncertainty, and label projections as estimates.
 */

function fmt(n: number | null | undefined, digits = 1, unit = ''): string {
  if (n == null || !isFinite(n)) return '—'
  return `${n.toFixed(digits)}${unit}`
}

function gapText(g: number | '+1 LAP' | null): string {
  if (g === '+1 LAP') return '+1 LAP'
  if (typeof g === 'number') return `+${g.toFixed(1)}s`
  return '—'
}

function lapTime(sec: number | null): string {
  if (sec == null || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(3)
  return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`
}

/** Human-readable race/session phase from the snapshot's track status + lap counter. */
function racePhaseText(snapshot: RaceSnapshot): string {
  const { trackStatus, currentLap, totalLaps } = snapshot
  const lap =
    currentLap != null
      ? totalLaps ? `Lap ${currentLap}/${totalLaps}` : `Lap ${currentLap}`
      : null
  switch (trackStatus) {
    case 'CLEAR':
      return lap ? `${lap} green` : 'Green flag'
    case 'YELLOW':
      return lap ? `Yellow flag · ${lap}` : 'Yellow flag'
    case 'VSC':
      return lap ? `Virtual Safety Car · ${lap}` : 'Virtual Safety Car'
    case 'SAFETY_CAR':
      return lap ? `Safety Car deployed · ${lap}` : 'Safety Car deployed'
    case 'RED':
      return 'Red flag · session stopped'
    default:
      return lap ?? 'Racing'
  }
}

/** Short label for a battery deployment mode (2026 power-unit terminology). */
function deployLabel(mode: string): string {
  // OVERTAKE = Overtake Mode (2026 successor to DRS)
  return mode
}

/**
 * Build the battery/energy-state lines for the AI context.
 * Returns a single honest "unavailable" note when no driver in the top-N has
 * battery data; otherwise a per-focus-driver call-out plus a field summary.
 */
function buildErsLines(
  timing: RaceSnapshot['timing'],
  focusDriver: number | null,
  codeOf: (n: number) => string,
  topN: number
): string {
  const relevant = timing.slice(0, topN)
  const withEnergy = relevant.filter((t) => t.energyPct != null)

  if (withEnergy.length === 0) {
    return 'BATTERY: State-of-charge data not available for this source.'
  }

  const parts: string[] = []

  // Focus driver call-out
  if (focusDriver != null) {
    const fd = timing.find((t) => t.driverNumber === focusDriver)
    if (fd && fd.energyPct != null) {
      const mode = fd.deployMode ? ` ${deployLabel(fd.deployMode)}` : ''
      const estimate = fd.energyIsEstimate ? '~' : ''
      parts.push(`BATTERY (${codeOf(focusDriver)}): ${estimate}${fd.energyPct.toFixed(0)}%${mode}`)
    }
  }

  // Compact field summary for top N with energy data
  const summary = withEnergy
    .map((t) => {
      const mode = t.deployMode ? `/${deployLabel(t.deployMode)}` : ''
       return `${codeOf(t.driverNumber)} ${t.energyIsEstimate ? '~' : ''}${t.energyPct!.toFixed(0)}%${mode}`
    })
    .join(', ')
  parts.push(`ENERGY LEVELS: ${summary}`)

  return parts.join('\n')
}

/** A short, human summary line for a pit prediction (reused by UI + AI context). */
export function pitPredictionSummary(p: PitPrediction): string {
  if (!p.available) return p.reason ?? 'No projection available.'
  const parts = [
    `${p.code}: pit now → ~P${p.projectedPosition}`,
    p.positionsLost != null
      ? p.positionsLost > 0
        ? `(${p.positionsLost} lost)`
        : p.positionsLost < 0
          ? `(${-p.positionsLost} gained)`
          : '(net even)'
      : '',
    p.rejoinAhead ? `behind ${p.rejoinAhead.code}` : 'in clear air',
    `· pit loss ~${fmt(p.pitLossSec, 0, 's')}`
  ]
  return parts.filter(Boolean).join(' ')
}

/**
 * Build the grounded, factual context block. Includes session state, weather,
 * the classification (top N + focus driver), and the pit projection.
 */
export function buildRaceContext(
  snapshot: RaceSnapshot,
  opts: {
    focusDriver?: number | null
    prediction?: PitPrediction | null
    topN?: number
    /** Pre-computed team-pace / tyre analytics block (see AnalyticsEngine). */
    analytics?: string
  } = {}
): string {
  const { focusDriver = null, prediction = null, topN = 12, analytics = '' } = opts
  const codeOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.code ?? `#${n}`
  const teamOf = (n: number) => snapshot.drivers.find((d) => d.number === n)?.teamName ?? '—'

  const lines: string[] = []

  // ── Session header ──
  const s = snapshot.session
  const lapInfo =
    snapshot.currentLap != null
      ? `Lap ${snapshot.currentLap}${snapshot.totalLaps ? `/${snapshot.totalLaps}` : ''}`
      : 'Lap —'
  lines.push(
    `SESSION: ${s.meetingName ?? s.circuitName ?? 'Grand Prix'} — ${s.name} (${s.type}). ${lapInfo}. Track status: ${snapshot.trackStatus}.`
  )

  // ── Race phase (human-readable) ──
  lines.push(`RACE PHASE: ${racePhaseText(snapshot)}`)

  if (snapshot.weather) {
    const w = snapshot.weather
    lines.push(
      `WEATHER: air ${fmt(w.airTemp, 0, '°C')}, track ${fmt(w.trackTemp, 0, '°C')}, ${w.rainfall ? 'RAIN falling' : 'dry'}, wind ${fmt(w.windSpeed, 1, ' m/s')}.`
    )
  }

  // ── Battery / energy state ──
  lines.push(buildErsLines(snapshot.timing, focusDriver, codeOf, topN))

  // ── Classification ──
  const rows = snapshot.timing.slice(0, topN)
  const focusRow =
    focusDriver != null && !rows.some((r) => r.driverNumber === focusDriver)
      ? snapshot.timing.find((t) => t.driverNumber === focusDriver)
      : null

  lines.push('CLASSIFICATION (pos | driver | team | gap | interval | tyre(age) | last | stops):')
  const toRow = (t: (typeof snapshot.timing)[number]) => {
    const flags = [
      t.isFastestLap ? 'FL' : '',
      t.penalty ? `PEN ${t.penalty}` : '',
      t.underInvestigation ? 'INV' : '',
      t.inPit ? 'IN PIT' : '',
      t.retired ? 'OUT' : ''
    ]
      .filter(Boolean)
      .join(',')
    return `  P${t.position ?? '—'} ${codeOf(t.driverNumber)} | ${teamOf(t.driverNumber)} | ${gapText(t.gapToLeader)} | int ${gapText(t.intervalAhead)} | ${t.compound ?? '—'}(${t.stintAge ?? '—'}) | ${lapTime(t.lastLap)} | ${t.pitStops ?? 0}${flags ? ` | ${flags}` : ''}`
  }
  for (const t of rows) lines.push(toRow(t))
  if (focusRow) lines.push(toRow(focusRow))

  // ── Recent race control ──
  const rc = snapshot.raceControl.slice(-4)
  if (rc.length) {
    lines.push('RECENT RACE CONTROL:')
    for (const m of rc) lines.push(`  - ${m.message}`)
  }

  // ── Pit projection (deterministic) ──
  if (prediction && prediction.available) {
    const p = prediction
    lines.push(`PIT PROJECTION for ${p.code} (deterministic estimate, others hold station):`)
    lines.push(`  - Currently P${p.currentPosition}, gap to leader ${fmt(p.currentGapToLeader, 1, 's')}.`)
    lines.push(
      `  - Pit loss used: ~${fmt(p.pitLossSec, 0, 's')}${p.underNeutralization ? ' (SC/VSC discounted)' : ''}.`
    )
    lines.push(
      `  - If pits NOW → rejoins ~P${p.projectedPosition} (${p.positionsLost! > 0 ? `${p.positionsLost} lost` : p.positionsLost! < 0 ? `${-p.positionsLost!} gained` : 'net even'}), ${p.rejoinAhead ? `right behind ${p.rejoinAhead.code} (+${fmt(p.gapToChaseAheadSec, 1, 's')} to chase)` : 'in clear air'}.`
    )
    if (p.traffic.length) {
      lines.push(
        `  - Rejoin traffic: ${p.traffic.map((c) => `${c.code} ${c.relativeToRejoin < 0 ? '' : '+'}${c.relativeToRejoin.toFixed(1)}s ${c.compound ?? '?'}(${c.stintAge ?? '?'})`).join(', ')}.`
      )
    }
    if (p.intervalToCarAheadSec != null && p.carAhead != null) {
      lines.push(
        `  - Undercut vs ${codeOf(p.carAhead)} (${fmt(p.intervalToCarAheadSec, 1, 's')} ahead): net ~${fmt(p.undercutNetSec, 1, 's')} → ${p.undercutViable ? 'projected to WORK' : 'projected to fall short'}.`
      )
    }
    if (p.degradationSlope != null) {
      lines.push(`  - Tyre degradation trend: ~+${fmt(p.degradationSlope, 2, 's')}/lap.`)
    }
    lines.push(`  - Engine verdict: ${p.verdict} (${p.confidence} confidence). ${p.rationale.join(' ')}`)
  }

  // ── Team pace + tyre analytics (deterministic) ──
  if (analytics.trim()) lines.push(analytics.trim())

  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are RaceDeck's AI Race Engineer — a sharp, calm Formula 1 strategy analyst embedded in a live timing dashboard.

RULES:
- Reason ONLY from the DATA CONTEXT provided. Never invent lap times, gaps, positions, or events that are not in the data.
- The "PIT PROJECTION" numbers are deterministic estimates from RaceDeck's engine. Trust them as the factual basis; you may interpret and add racecraft, but do not contradict the arithmetic.
- Everything about the future is an ESTIMATE. Say so. Never state a prediction as certainty.
- Be concise and specific. Use driver codes (e.g. VER, NOR). Prefer concrete numbers from the context.
- If the data is insufficient to answer, say what's missing rather than guessing.
- Never discuss anything about bypassing DRM, streams, or the video feed. You only analyse timing/strategy data.
- Format with short paragraphs or tight bullet points. No preamble like "As an AI".
- RACE PHASE shows the current flag/neutralisation status. Safety Car and VSC periods compress pit-loss costs dramatically — always factor the live phase into stop-window advice.
- When ENERGY LEVELS appear in context, incorporate them: HARVEST = building charge; BALANCED = neutral; DEPLOY = normal electrical deployment; BOOST = driver-controlled Boost Mode; OVERTAKE = the separate within-1s Overtake Mode aid that replaced DRS. A leading ~ means RaceDeck estimated state-of-charge from throttle/braking patterns, not real battery telemetry. Do not present estimates as measured data or invent energy states.`

/** Messages for a proactive strategic briefing of the current moment. */
export function buildBriefingMessages(context: string, focusCode?: string | null): AiMessage[] {
  const ask = focusCode
    ? `Give a punchy strategic briefing centred on ${focusCode}: their current situation, the pit-now decision, undercut/overcut risk, and what to watch next. 4-6 bullet points max.`
    : `Give a punchy strategic briefing of this moment: the key battles, who's under pit pressure, undercut/overcut windows, and what to watch next. 4-6 bullet points max.`
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `DATA CONTEXT:\n${context}\n\n${ask}` }
  ]
}

/** Messages for a free-form user question, grounded in the same context. */
export function buildQuestionMessages(
  context: string,
  question: string,
  history: AiMessage[] = []
): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `DATA CONTEXT (current race state):\n${context}` },
    ...history,
    { role: 'user', content: question }
  ]
}

export { SYSTEM_PROMPT }

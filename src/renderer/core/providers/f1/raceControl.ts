import type { RaceControlMessage, TimingEntry } from '@shared/models'
import type { F1StreamPoint } from '@shared/f1live'
import { indexedToArray } from '@shared/f1live'
import { normalizeFlag, raceControlSeverity } from '../normalize'
import { numOrNull, rec } from './shared'

/** Project issued penalties/investigations from Race Control onto timing rows. */
export function applyRaceControlState(
  entries: TimingEntry[],
  messages: RaceControlMessage[]
): void {
  const byDriver = new Map(entries.map((e) => [e.driverNumber, e]))
  const investigations = new Set<number>()
  const sanctions = new Map<number, { active: Array<number | 'DT' | 'SG'> }>()
  const ordered = messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => compareRaceControlMessages(a.message, b.message) || a.index - b.index)
  for (const { message } of ordered) {
    const text = message.message.toUpperCase()
    const driverNumbers = extractDriverNumbers(text, message.driverNumber).filter((driverNumber) =>
      byDriver.has(driverNumber)
    )
    if (driverNumbers.length === 0) continue

    if (isResolvedInvestigationMessage(text)) {
      driverNumbers.forEach((driverNumber) => investigations.delete(driverNumber))
    } else if (isActiveInvestigationMessage(text)) {
      driverNumbers.forEach((driverNumber) => investigations.add(driverNumber))
    }

    if (text.includes('PENALTY SERVED')) {
      const penaltySeconds = parseTimePenaltySeconds(text)
      if (text.includes('DRIVE THROUGH PENALTY')) {
        driverNumbers.forEach((driverNumber) => retireSanction(sanctions, driverNumber, 'DT'))
      } else if (isStopGoPenaltyMessage(text)) {
        driverNumbers.forEach((driverNumber) => retireSanction(sanctions, driverNumber, 'SG'))
      } else if (penaltySeconds != null) {
        driverNumbers.forEach((driverNumber) =>
          retireSanction(sanctions, driverNumber, penaltySeconds)
        )
      } else {
        driverNumbers.forEach((driverNumber) => retireLatestSanction(sanctions, driverNumber))
      }
      continue
    }

    const penaltySeconds = parseTimePenaltySeconds(text)
    if (penaltySeconds != null) {
      driverNumbers.forEach((driverNumber) => {
        addSanction(sanctions, driverNumber, penaltySeconds)
        investigations.delete(driverNumber)
      })
    } else if (text.includes('DRIVE THROUGH PENALTY')) {
      driverNumbers.forEach((driverNumber) => {
        addSanction(sanctions, driverNumber, 'DT')
        investigations.delete(driverNumber)
      })
    } else if (isStopGoPenaltyMessage(text)) {
      driverNumbers.forEach((driverNumber) => {
        addSanction(sanctions, driverNumber, 'SG')
        investigations.delete(driverNumber)
      })
    }
  }
  for (const entry of entries) {
    entry.underInvestigation = investigations.has(entry.driverNumber)
    const sanction = sanctions.get(entry.driverNumber)
    if (!sanction) continue
    const seconds = sanction.active
      .filter((token): token is number => typeof token === 'number')
      .reduce((total, value) => total + value, 0)
    const labels = new Set(
      sanction.active.filter((token): token is 'DT' | 'SG' => token === 'DT' || token === 'SG')
    )
    const penalty = [seconds > 0 ? `${seconds}s` : '', ...labels].filter(Boolean).join(' · ')
    entry.penalty = penalty.length > 0 ? penalty : null
  }
}

function compareRaceControlMessages(a: RaceControlMessage, b: RaceControlMessage): number {
  const aDate = Date.parse(a.date)
  const bDate = Date.parse(b.date)
  if (!Number.isNaN(aDate) && !Number.isNaN(bDate) && aDate !== bDate) return aDate - bDate
  if (a.sessionTime != null && b.sessionTime != null && a.sessionTime !== b.sessionTime)
    return a.sessionTime - b.sessionTime
  if (!Number.isNaN(aDate) && Number.isNaN(bDate)) return -1
  if (Number.isNaN(aDate) && !Number.isNaN(bDate)) return 1
  return 0
}

function isResolvedInvestigationMessage(message: string): boolean {
  return (
    message.includes('NO FURTHER INVESTIGATION') ||
    message.includes('NO FURTHER ACTION') ||
    message.includes('NOT INVESTIGATED')
  )
}

function isActiveInvestigationMessage(message: string): boolean {
  return (
    /\bNOTED\b/.test(message) ||
    message.includes('UNDER INVESTIGATION') ||
    message.includes('WILL BE INVESTIGATED AFTER THE RACE')
  )
}

function isStopGoPenaltyMessage(message: string): boolean {
  return /STOP(?:\s|-)?(?:AND(?:\s|-)?)?GO PENALTY/.test(message)
}

function addSanction(
  sanctions: Map<number, { active: Array<number | 'DT' | 'SG'> }>,
  driverNumber: number,
  sanction: number | 'DT' | 'SG'
): void {
  const state = sanctions.get(driverNumber) ?? { active: [] }
  state.active.push(sanction)
  sanctions.set(driverNumber, state)
}

function retireSanction(
  sanctions: Map<number, { active: Array<number | 'DT' | 'SG'> }>,
  driverNumber: number,
  sanction: number | 'DT' | 'SG'
): void {
  const state = sanctions.get(driverNumber)
  if (!state) return
  const index = state.active.lastIndexOf(sanction)
  if (index < 0) return
  state.active.splice(index, 1)
  if (state.active.length === 0) sanctions.delete(driverNumber)
}

function retireLatestSanction(
  sanctions: Map<number, { active: Array<number | 'DT' | 'SG'> }>,
  driverNumber: number
): void {
  const state = sanctions.get(driverNumber)
  if (!state) return
  state.active.pop()
  if (state.active.length === 0) sanctions.delete(driverNumber)
}

function extractDriverNumbers(message: string, driverNumber: number | null): number[] {
  const numbers = new Set<number>()
  if (driverNumber != null) numbers.add(driverNumber)
  for (const match of message.matchAll(/\bCAR\s+(\d{1,2})\b/gi)) {
    numbers.add(Number(match[1]))
  }
  for (const match of message.matchAll(/\b(\d{1,2})\s*\([A-Z]{3}\)/gi)) {
    numbers.add(Number(match[1]))
  }
  return [...numbers]
}

function extractCarNumber(message: string): number | null {
  return extractDriverNumbers(message, null)[0] ?? null
}

function parseTimePenaltySeconds(message: string): number | null {
  if (!message.includes('PENALTY')) return null
  const match = /\b(\d+)\s*(?:SECOND|SECONDS|SEC|S)\b/i.exec(message)
  return match ? Number(match[1]) : null
}

// ── series: race control ─────────────────────────────────────────────────────────

/** Accumulate race-control messages with timecode ≤ tMax into sorted models. */
export function collectRaceControl(points: F1StreamPoint[], tMax: number): RaceControlMessage[] {
  const byKey = new Map<string, RaceControlMessage>()
  let auto = 0
  for (const p of points) {
    if (p.t > tMax) break
    const msgs = rec(p.d).Messages
    const list = Array.isArray(msgs) ? msgs : indexedToArray(msgs)
    const keys = Array.isArray(msgs)
      ? msgs.map((_, i) => `arr-${i}`)
      : Object.keys(rec(msgs)).filter((k) => /^\d+$/.test(k))
    list.forEach((raw, i) => {
      const m = rec(raw)
      const flag = normalizeFlag(m.Flag as string)
      const key = keys[i] ?? `auto-${auto++}`
      byKey.set(key, {
        id: `rc-${key}`,
        date: (m.Utc as string) ?? new Date(p.t * 1000).toISOString(),
        sessionTime: p.t,
        category: (m.Category as string) ?? 'Other',
        message: (m.Message as string) ?? '',
        flag,
        scope: (m.Scope as string) ?? null,
        sector: numOrNull(m.Sector),
        driverNumber: numOrNull(m.RacingNumber),
        lapNumber: numOrNull(m.Lap),
        severity: raceControlSeverity(m.Category as string, flag, m.Message as string)
      })
    })
  }
  const ordered = [...byKey.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const semantic = new Map<string, RaceControlMessage>()
  for (const message of ordered) {
    const key = raceControlSemanticKey(message)
    if (!semantic.has(key)) semantic.set(key, { ...message, id: `rc-${stableKey(key)}` })
  }
  return [...semantic.values()]
}

function raceControlSemanticKey(message: RaceControlMessage): string {
  if (message.flag === 'BLUE' || /\bBLUE FLAG\b/i.test(message.message)) {
    const car = message.driverNumber ?? extractCarNumber(message.message)
    // F1 may repeat an unchanged blue flag every few seconds. Collapse only for
    // the same target and lap; a new driver or lap remains a distinct event.
    return `blue|${car ?? 'field'}|${message.lapNumber ?? 'unknown'}|${message.scope ?? ''}|${message.sector ?? ''}`
  }
  return [
    message.date,
    message.category,
    message.flag,
    message.driverNumber ?? '',
    message.lapNumber ?? '',
    message.message.trim().toUpperCase()
  ].join('|')
}

function stableKey(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

import { describe, it, expect } from 'vitest'
import { DemoProvider } from '@renderer/core/providers/DemoProvider'
import { StrategyEngine } from '@renderer/core/engines/StrategyEngine'
import {
  buildRaceContext,
  buildBriefingMessages,
  buildQuestionMessages,
  pitPredictionSummary
} from '@renderer/core/engines/StrategyContext'
import { isAiConfigReady, maskKey, defaultAiConfig, AI_PROVIDERS } from '@shared/ai'
import type { RaceSnapshot } from '@renderer/core/providers/types'

const provider = new DemoProvider()
const snapshot = provider.getSnapshotAt(provider.getDuration() * 0.5)
const prediction = StrategyEngine.predictPitStop(snapshot, 4, provider.getDriverLaps(4))

describe('buildRaceContext', () => {
  it('includes session, classification and a real driver code', () => {
    const ctx = buildRaceContext(snapshot)
    expect(ctx).toContain('SESSION:')
    expect(ctx).toContain('CLASSIFICATION')
    expect(ctx).toContain('VER') // Verstappen is in the demo grid
  })

  it('embeds the deterministic pit projection only when provided', () => {
    expect(buildRaceContext(snapshot, { focusDriver: 4, prediction })).toContain('PIT PROJECTION')
    expect(buildRaceContext(snapshot)).not.toContain('PIT PROJECTION')
  })

  it('never invents numbers — the projection block echoes the engine verdict', () => {
    const ctx = buildRaceContext(snapshot, { focusDriver: 4, prediction })
    expect(ctx).toContain(prediction.verdict)
  })
})

describe('buildRaceContext — ERS & phase', () => {
  it('always includes a RACE PHASE line', () => {
    const ctx = buildRaceContext(snapshot)
    expect(ctx).toContain('RACE PHASE:')
  })

  it('emits human-readable Safety Car phase label with lap info', () => {
    const scSnap: RaceSnapshot = { ...snapshot, trackStatus: 'SAFETY_CAR', currentLap: 20, totalLaps: 52 }
    const ctx = buildRaceContext(scSnap)
    expect(ctx).toContain('Safety Car deployed')
    expect(ctx).toContain('Lap 20/52')
  })

  it('emits Virtual Safety Car label', () => {
    const vscSnap: RaceSnapshot = { ...snapshot, trackStatus: 'VSC', currentLap: 35, totalLaps: 52 }
    const ctx = buildRaceContext(vscSnap)
    expect(ctx).toContain('Virtual Safety Car')
    expect(ctx).toContain('Lap 35/52')
  })

  it('emits red flag label', () => {
    const redSnap: RaceSnapshot = { ...snapshot, trackStatus: 'RED' }
    const ctx = buildRaceContext(redSnap)
    expect(ctx).toContain('Red flag')
  })

  it('emits green-flag lap label on CLEAR status', () => {
    const greenSnap: RaceSnapshot = { ...snapshot, trackStatus: 'CLEAR', currentLap: 32, totalLaps: 52 }
    const ctx = buildRaceContext(greenSnap)
    expect(ctx).toContain('RACE PHASE:')
    expect(ctx).toContain('Lap 32/52')
    expect(ctx).toContain('green')
  })

  it('includes ENERGY LEVELS when energyPct is present', () => {
    const withEnergy: RaceSnapshot = {
      ...snapshot,
      timing: snapshot.timing.map((t) => ({ ...t, energyPct: 75, deployMode: 'DEPLOY' as const }))
    }
    const ctx = buildRaceContext(withEnergy)
    expect(ctx).toContain('ENERGY LEVELS:')
    expect(ctx).toContain('75%')
    expect(ctx).not.toContain('State-of-charge data not available')
  })

  it('includes deploy mode in energy levels', () => {
    const withModes: RaceSnapshot = {
      ...snapshot,
      timing: snapshot.timing.map((t) => ({ ...t, energyPct: 80, deployMode: 'HARVEST' as const }))
    }
    const ctx = buildRaceContext(withModes)
    expect(ctx).toContain('HARVEST')
  })

  it('shows focused driver battery call-out line when energyPct is present', () => {
    const withEnergy: RaceSnapshot = {
      ...snapshot,
      timing: snapshot.timing.map((t) => ({
        ...t,
        energyPct: t.driverNumber === 4 ? 61 : 78,
        deployMode: 'BALANCED' as const
      }))
    }
    const ctx = buildRaceContext(withEnergy, { focusDriver: 4 })
    expect(ctx).toContain('BATTERY (')
    expect(ctx).toContain('61%')
  })

  it('OVERTAKE mode label appears for Overtake Mode', () => {
    const overtakeSnap: RaceSnapshot = {
      ...snapshot,
      timing: snapshot.timing.map((t) => ({ ...t, energyPct: 45, deployMode: 'OVERTAKE' as const }))
    }
    const ctx = buildRaceContext(overtakeSnap)
    expect(ctx).toContain('OVERTAKE')
  })

  it('keeps Boost distinct from Overtake Mode', () => {
    const boostSnap: RaceSnapshot = {
      ...snapshot,
      timing: snapshot.timing.map((t) => ({
        ...t,
        energyPct: 52,
        deployMode: 'BOOST' as const,
        energyIsEstimate: true
      }))
    }
    const ctx = buildRaceContext(boostSnap)
    expect(ctx).toContain('~52%/BOOST')
    expect(ctx).not.toContain('~52%/OVERTAKE')
  })

  it('emits honest unavailable note when all energyPct are null', () => {
    const noEnergy: RaceSnapshot = {
      ...snapshot,
      timing: snapshot.timing.map((t) => ({ ...t, energyPct: null, deployMode: null }))
    }
    const ctx = buildRaceContext(noEnergy)
    expect(ctx).toContain('State-of-charge data not available')
    expect(ctx).not.toContain('ENERGY LEVELS')
  })

  it('has no focus-driver battery line when all energyPct are null', () => {
    const noEnergy: RaceSnapshot = {
      ...snapshot,
      timing: snapshot.timing.map((t) => ({ ...t, energyPct: null, deployMode: null }))
    }
    const ctx = buildRaceContext(noEnergy, { focusDriver: 4 })
    expect(ctx).not.toContain('BATTERY (')
  })
})

describe('AI message construction', () => {
  it('briefing messages lead with a grounding system prompt', () => {
    const msgs = buildBriefingMessages('CTX', 'NOR')
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Race Engineer')
    expect(msgs[1].content).toContain('CTX')
    expect(msgs[1].content).toContain('NOR')
  })

  it('question messages keep history and end on the user question', () => {
    const history = [
      { role: 'user' as const, content: 'prior q' },
      { role: 'assistant' as const, content: 'prior a' }
    ]
    const msgs = buildQuestionMessages('CTX', 'Should VER pit?', history)
    expect(msgs[0].role).toBe('system')
    expect(msgs.some((m: (typeof msgs)[number]) => m.content === 'prior a')).toBe(true)
    expect(msgs[msgs.length - 1].content).toBe('Should VER pit?')
  })

  it('system prompt includes battery modes and race phase guidance', () => {
    const msgs = buildBriefingMessages('CTX')
    const sys = msgs[0].content
    expect(sys).toContain('RACE PHASE')
    expect(sys).toContain('ENERGY LEVELS')
    expect(sys).toContain('Overtake Mode')
    expect(sys).toContain('BOOST')
  })
})

describe('pitPredictionSummary', () => {
  it('summarizes an available projection with a projected position', () => {
    expect(pitPredictionSummary(prediction)).toMatch(/pit now → ~P\d+/)
  })
})

describe('isAiConfigReady', () => {
  it('is false by default (disabled, no key)', () => {
    expect(isAiConfigReady(defaultAiConfig())).toBe(false)
  })

  it('is true once a hosted provider is enabled with a key + model', () => {
    const cfg = {
      ...defaultAiConfig(),
      enabled: true,
      apiKey: 'AIza-xxxxxxxx',
      model: AI_PROVIDERS.gemini.defaultModel
    }
    expect(isAiConfigReady(cfg)).toBe(true)
  })

  it('allows a keyless local/custom endpoint', () => {
    const meta = AI_PROVIDERS.custom
    const cfg = {
      provider: 'custom' as const,
      enabled: true,
      apiKey: '',
      model: 'llama3.1',
      baseUrl: meta.baseUrl
    }
    expect(isAiConfigReady(cfg)).toBe(true)
  })
})

describe('maskKey', () => {
  it('redacts the middle of a key and blanks short/empty values', () => {
    expect(maskKey('AIzaSyABCDEFGH1234')).toBe('AIza••••1234')
    expect(maskKey('')).toBe('')
    expect(maskKey('short')).toBe('••••')
  })
})

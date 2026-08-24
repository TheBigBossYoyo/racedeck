import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TyrePanel } from '@renderer/widgets/driverDossier/TyrePanel'
import type { TyreReadModel } from '@renderer/core/engines/TyreRead'

afterEach(cleanup)

function tyreRead(overrides: Partial<TyreReadModel> = {}): TyreReadModel {
  return {
    compound: 'MEDIUM',
    setAge: 10,
    stintLaps: 8,
    usedSet: false,
    degradationPerLap: 0.1,
    degradationBlocker: null,
    slopeSampleLaps: 6,
    condition: 'working',
    latestLapLossSec: 0.5,
    fieldDegradationPerLap: 0.1,
    fieldDegradationMeasured: false,
    setLabel: null,
    priorStintLaps: null,
    ageIsDirect: false,
    stintHistory: null,
    sparklineLaps: [],
    ...overrides
  }
}

describe('TyrePanel provenance', () => {
  it('shows estimated provenance when the driver is in line with an estimated field model', () => {
    render(createElement(TyrePanel, { read: tyreRead() }))

    expect(screen.getByText(/in line with the field.*estimated/i)).toBeVisible()
  })
})

describe('TyrePanel used-set read', () => {
  it('renders the direct TyreStintSeries reading as "<set label> - used, <N>L before fit" with a feed-derived badge', () => {
    render(
      createElement(TyrePanel, {
        read: tyreRead({
          setAge: 8,
          stintLaps: 8,
          usedSet: true,
          setLabel: 'M2',
          priorStintLaps: 8,
          ageIsDirect: true
        })
      })
    )

    expect(screen.getByText(/M2 - used, 8L before fit\./)).toBeVisible()
    expect(screen.getByText('feed')).toBeVisible()
  })

  it('marks an inferred (non-TyreStintSeries) reading with an insufficient-provenance badge', () => {
    render(
      createElement(TyrePanel, {
        read: tyreRead({
          setAge: 14,
          stintLaps: 6,
          usedSet: true,
          setLabel: null,
          priorStintLaps: 8,
          ageIsDirect: false
        })
      })
    )

    expect(screen.getByText(/Used set - used, 8L before fit\./)).toBeVisible()
    expect(screen.getByText('insufficient')).toBeVisible()
  })

  it('shows an expandable set-history drawer when more than one stint is known', () => {
    render(
      createElement(TyrePanel, {
        read: tyreRead({
          stintHistory: [
            { stintNumber: 1, compound: 'SOFT', isNew: true, ageAtStart: 0, totalLaps: 15 },
            { stintNumber: 2, compound: 'MEDIUM', isNew: false, ageAtStart: 8, totalLaps: 8 }
          ]
        })
      })
    )

    expect(screen.getByText('Set history (2)')).toBeVisible()
  })

  it('hides the set-history drawer with only one known stint', () => {
    render(
      createElement(TyrePanel, {
        read: tyreRead({
          stintHistory: [
            { stintNumber: 1, compound: 'MEDIUM', isNew: true, ageAtStart: 0, totalLaps: 8 }
          ]
        })
      })
    )

    expect(screen.queryByText(/Set history/)).toBeNull()
  })
})

describe('TyrePanel sparkline', () => {
  it('renders the trend sparkline when at least 2 clean laps are known', () => {
    render(
      createElement(TyrePanel, {
        read: tyreRead({
          sparklineLaps: [
            { lapNumber: 20, correctedSec: 90.1 },
            { lapNumber: 21, correctedSec: 90.4 },
            { lapNumber: 22, correctedSec: 90.9 }
          ]
        })
      })
    )

    expect(screen.getByText('Trend')).toBeVisible()
  })

  it('omits the trend row with fewer than 2 clean laps', () => {
    render(createElement(TyrePanel, { read: tyreRead({ sparklineLaps: [] }) }))

    expect(screen.queryByText('Trend')).toBeNull()
  })
})

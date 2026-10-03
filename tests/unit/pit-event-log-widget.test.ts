import { createElement } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WIDGET_CATALOG, defaultPanelFor } from '@renderer/core/engines/LayoutManager'
import { WidgetRenderer } from '@renderer/components/dashboard/widgetRegistry'
import { PitEventLogPanel } from '@renderer/widgets/PitEventLogPanel'
import { normalizeModules } from '@renderer/store/settingsStore'
import { useSessionStore } from '@renderer/store/sessionStore'
import { raceAt } from './fixtures/pit-log-race'

function showSnapshotAt(clock: number): void {
  act(() => {
    useSessionStore.setState({
      snapshot: raceAt(clock),
      clock,
      currentSession: { id: 's1' } as never
    })
  })
}

describe('pit-log widget wiring', () => {
  it('is registered in the catalog with a sensible default footprint', () => {
    const meta = WIDGET_CATALOG['pit-log']
    expect(meta.title).toBe('Pit Stop Log')
    expect(meta.group).toBe('strategy')
    const panel = defaultPanelFor('pit-log')
    expect(panel.x + panel.w).toBeLessThanOrEqual(12)
    expect(panel.w).toBeGreaterThanOrEqual(panel.minW ?? 1)
    expect(panel.h).toBeGreaterThanOrEqual(panel.minH ?? 1)
  })

  it('is enabled by default in the module toggles', () => {
    expect(normalizeModules(undefined)['pit-log']).toBe(true)
  })
})

describe('PitEventLogPanel', () => {
  beforeEach(() => {
    useSessionStore.setState({ snapshot: null, clock: 0, currentSession: { id: 's1' } as never })
  })
  afterEach(cleanup)

  it('says so when no session is loaded', () => {
    render(createElement(PitEventLogPanel))
    expect(screen.getByText('No session loaded')).toBeTruthy()
  })

  it('shows an empty state before the first stop', () => {
    showSnapshotAt(900)
    render(createElement(PitEventLogPanel))
    expect(screen.getByText('No pit stops yet')).toBeTruthy()
  })

  it('lists stops newest first, with a dash for a duration that was never measured', () => {
    showSnapshotAt(2100)
    render(createElement(PitEventLogPanel))
    const rows = within(screen.getByRole('list', { name: /pit stops/i })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('D44')
    expect(rows[0].textContent).toContain('L20')
    expect(rows[0].textContent).not.toMatch(/\d\.\ds/)
    expect(rows[0].textContent).toContain('—')
    expect(rows[1].textContent).toContain('D1')
    expect(rows[1].textContent).toContain('24.3s')
  })

  it('flags a car that is in the pits right now with text, not just colour', () => {
    showSnapshotAt(2010)
    render(createElement(PitEventLogPanel))
    const rows = within(screen.getByRole('list', { name: /pit stops/i })).getAllByRole('listitem')
    expect(rows[0].textContent).toContain('D44')
    expect(rows[0].textContent).toMatch(/in pit/i)
  })

  it('drops rows again when the replay is scrubbed back', () => {
    showSnapshotAt(2100)
    render(createElement(PitEventLogPanel))
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    showSnapshotAt(1100)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    showSnapshotAt(900)
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText('No pit stops yet')).toBeTruthy()
  })
})

describe('WidgetRenderer', () => {
  afterEach(cleanup)

  it('lazy-loads the pit log widget by its key', async () => {
    showSnapshotAt(1100)
    render(createElement(WidgetRenderer, { widgetKey: 'pit-log' }))
    expect(await screen.findByRole('region', { name: 'Pit Stop Log' })).toBeTruthy()
  })
})

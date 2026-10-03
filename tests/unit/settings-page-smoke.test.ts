import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '@renderer/components/SettingsPage'

const SECTION_HEADINGS = [
  'TOD integration',
  'AI Race Engineer',
  'Win-odds market',
  'Modules',
  'Appearance',
  'Units',
  'Alerts',
  'Race-watch profiles',
  'Favourite drivers',
  'Data source',
  'Saved layouts',
  'Performance',
  'Backup'
]

describe('SettingsPage smoke render', () => {
  beforeEach(() => {
    // Radix Switch/Slider measure themselves; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders the page title and every section heading in order', () => {
    render(createElement(SettingsPage))

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(headings).toEqual(SECTION_HEADINGS)
  })

  it('renders each section body, not just its heading', () => {
    render(createElement(SettingsPage))

    // TOD integration
    expect(screen.getByText('Auto-fallback to companion window')).toBeInTheDocument()
    expect(screen.getByText('Widevine DRM')).toBeInTheDocument()
    // AI Race Engineer
    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save key/i })).toBeInTheDocument()
    // Win-odds market
    expect(screen.getByText('Show Polymarket win odds')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument()
    // Modules
    expect(screen.getByRole('button', { name: 'Enable all' })).toBeInTheDocument()
    expect(screen.getByText('Timing & track')).toBeInTheDocument()
    expect(screen.getByText('Live classification tower')).toBeInTheDocument()
    // Appearance
    expect(screen.getByText('Color scheme')).toBeInTheDocument()
    expect(screen.getByText('Font scale')).toBeInTheDocument()
    // Units
    expect(screen.getByText('Temperature')).toBeInTheDocument()
    // Alerts
    expect(screen.getByText('Yellow flags')).toBeInTheDocument()
    expect(screen.getByText('Interval change threshold')).toBeInTheDocument()
    // Race-watch profiles
    expect(screen.getByText('Auto-apply on session load')).toBeInTheDocument()
    // Favourite drivers / Data source / Saved layouts (empty states)
    expect(screen.getByText('Load a session to pick favourite drivers.')).toBeInTheDocument()
    expect(screen.getByText(/No saved layouts/)).toBeInTheDocument()
    // Performance + Backup
    expect(screen.getByText('Performance mode')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export \/ import settings/i })).toBeInTheDocument()
    // Legal footer
    expect(screen.getByText(/never bypasses DRM/)).toBeInTheDocument()
  })
})

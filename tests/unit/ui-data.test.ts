import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { ErsBar } from '@renderer/components/ui/ErsGauge'
import { TyrePill } from '@renderer/components/ui/primitives'

afterEach(cleanup)

describe('timing data cells', () => {
  it('shows an honest battery/mode unavailable cell instead of disappearing', () => {
    render(createElement(ErsBar, { pct: null, mode: null }))
    expect(screen.getByTitle(/Battery and deployment unavailable/)).toHaveTextContent('BAT — · MODE —')
  })

  it('labels estimated battery deployment and tyre age explicitly', () => {
    render(createElement('div', null,
      createElement(ErsBar, { pct: 64, mode: 'DEPLOY', estimate: true }),
      createElement(TyrePill, { compound: 'MEDIUM', age: 9, size: 'sm' })
    ))
    expect(screen.getByTitle(/Battery ~64% · Deploying · estimated/)).toHaveTextContent('~64%')
    expect(screen.getByTitle('9 laps on this tyre')).toHaveTextContent('L9')
  })
})

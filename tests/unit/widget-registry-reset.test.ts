import { createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const behaviour = vi.hoisted(() => ({ throwOnRender: false, renders: 0 }))

vi.mock('@renderer/widgets/WeatherPanel', () => ({
  WeatherPanel: () => {
    behaviour.renders++
    if (behaviour.throwOnRender) throw new Error('bad tick')
    return createElement('div', null, 'weather ok')
  }
}))

import { WidgetRenderer } from '@renderer/components/dashboard/widgetRegistry'
import { useSessionStore } from '@renderer/store/sessionStore'

function setClock(clock: number, sessionId = 's1'): void {
  act(() => {
    useSessionStore.setState({
      clock,
      currentSession: { id: sessionId } as never
    })
  })
}

describe('WidgetRenderer crash recovery', () => {
  beforeEach(() => {
    behaviour.throwOnRender = false
    behaviour.renders = 0
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    useSessionStore.setState({ clock: 10, currentSession: { id: 's1' } as never })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('recovers on its own once the session clock moves on and the widget stops throwing', () => {
    behaviour.throwOnRender = true
    render(createElement(WidgetRenderer, { widgetKey: 'weather' }))
    expect(screen.getByText(/crashed/i)).toBeTruthy()

    behaviour.throwOnRender = false
    setClock(11)

    expect(screen.getByText('weather ok')).toBeTruthy()
  })

  it('recovers when the session changes, even at the same clock value', () => {
    behaviour.throwOnRender = true
    render(createElement(WidgetRenderer, { widgetKey: 'weather' }))
    behaviour.throwOnRender = false

    setClock(10, 's2')

    expect(screen.getByText('weather ok')).toBeTruthy()
  })

  it('does not retry a still-broken widget on sub-second clock ticks', () => {
    behaviour.throwOnRender = true
    render(createElement(WidgetRenderer, { widgetKey: 'weather' }))
    const rendersAfterCrash = behaviour.renders

    for (const t of [10.1, 10.25, 10.5, 10.75, 10.99]) setClock(t)

    expect(behaviour.renders).toBe(rendersAfterCrash)
  })

  it('does not re-render a healthy widget when only the clock ticks', () => {
    render(createElement(WidgetRenderer, { widgetKey: 'weather' }))
    const rendersAfterMount = behaviour.renders

    for (const t of [10.1, 10.5, 11, 12, 13.4]) setClock(t)

    expect(behaviour.renders).toBe(rendersAfterMount)
  })
})

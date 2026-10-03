import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WidgetErrorBoundary } from '@renderer/components/dashboard/WidgetErrorBoundary'
import { RootErrorBoundary, useBootstrap } from '@renderer/App'
import { STORE_NS } from '@shared/ipc-contract'
import type { RaceDeckApi } from '@shared/ipc-contract'
import { persist } from '@renderer/store/persist'

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('kaboom')
  return createElement('div', null, 'ok')
}

/** A widget that throws while `tick` is odd, so a later tick can recover it. */
function TickHost({ initialTick, useKeys }: { initialTick: number; useKeys: boolean }) {
  const [tick, setTick] = useState(initialTick)
  return createElement(
    'div',
    null,
    createElement('button', { onClick: () => setTick((t) => t + 1) }, 'next tick'),
    createElement(
      WidgetErrorBoundary,
      { widgetKey: 'alerts', resetKeys: useKeys ? [tick] : undefined },
      createElement(Boom, { shouldThrow: tick % 2 === 1 })
    )
  )
}

const CRASHED = 'This widget crashed and has been isolated.'

describe('WidgetErrorBoundary resetKeys', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('recovers automatically when a reset key changes and the child no longer throws', () => {
    render(createElement(TickHost, { initialTick: 1, useKeys: true }))
    expect(screen.getByText(CRASHED)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'next tick' }))

    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.queryByText(CRASHED)).not.toBeInTheDocument()
  })

  it('stays isolated when the keys are unchanged', () => {
    const { rerender } = render(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts', resetKeys: [1, 'a'] },
        createElement(Boom, { shouldThrow: true })
      )
    )
    rerender(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts', resetKeys: [1, 'a'] },
        createElement(Boom, { shouldThrow: false })
      )
    )
    expect(screen.getByText(CRASHED)).toBeInTheDocument()
  })

  it('without resetKeys, a later tick does not auto-recover (only Retry does)', () => {
    render(createElement(TickHost, { initialTick: 1, useKeys: false }))
    fireEvent.click(screen.getByRole('button', { name: 'next tick' }))
    expect(screen.getByText(CRASHED)).toBeInTheDocument()
  })

  it('does not loop when the keys change in the same update that throws', () => {
    const { rerender } = render(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts', resetKeys: [1] },
        createElement(Boom, { shouldThrow: false })
      )
    )
    rerender(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts', resetKeys: [2] },
        createElement(Boom, { shouldThrow: true })
      )
    )
    expect(screen.getByText(CRASHED)).toBeInTheDocument()
  })

  it('treats a changed keys-array length as a change', () => {
    const { rerender } = render(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts', resetKeys: [1] },
        createElement(Boom, { shouldThrow: true })
      )
    )
    rerender(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts', resetKeys: [1, 2] },
        createElement(Boom, { shouldThrow: false })
      )
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})

describe('RootErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders children when nothing crashed', () => {
    render(createElement(RootErrorBoundary, null, createElement(Boom, { shouldThrow: false })))
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('shows a friendly fallback with the error message and a reload button on a crash', () => {
    const onReload = vi.fn()
    render(
      createElement(
        RootErrorBoundary,
        { onReload },
        createElement(Boom, { shouldThrow: true })
      )
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText('kaboom')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reload RaceDeck' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('reports the crash to console.error with context', () => {
    render(createElement(RootErrorBoundary, null, createElement(Boom, { shouldThrow: true })))
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RootErrorBoundary]'),
      expect.any(Error),
      expect.anything()
    )
  })

  it('handles a non-Error throw without rendering "undefined"', () => {
    function ThrowString(): never {
      throw 'plain string failure'
    }
    render(createElement(RootErrorBoundary, null, createElement(ThrowString)))
    expect(screen.getByText('plain string failure')).toBeInTheDocument()
  })

  it('stays out of the way of an inner widget boundary', () => {
    render(
      createElement(
        RootErrorBoundary,
        null,
        createElement(
          WidgetErrorBoundary,
          { widgetKey: 'alerts' },
          createElement(Boom, { shouldThrow: true })
        ),
        createElement('div', null, 'sibling still alive')
      )
    )
    expect(screen.getByText('sibling still alive')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})


describe('RootErrorBoundary recovery from bad saved data', () => {
  const clearNamespace = vi.fn(async () => undefined)

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    clearNamespace.mockClear()
    ;(window as Window).racedeck = { store: { clearNamespace } } as unknown as RaceDeckApi
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    delete (window as Partial<Window>).racedeck
  })

  function crashed(onReload = vi.fn()) {
    render(
      createElement(RootErrorBoundary, { onReload }, createElement(Boom, { shouldThrow: true }))
    )
    return onReload
  }

  it('asks for confirmation first and clears nothing until it is given', () => {
    const onReload = crashed()
    fireEvent.click(screen.getByRole('button', { name: 'Reset saved settings and reload' }))

    expect(
      screen.getByText('This clears layouts, preferences and the saved AI key.')
    ).toBeInTheDocument()
    expect(clearNamespace).not.toHaveBeenCalled()
    expect(onReload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(clearNamespace).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Reset saved settings and reload' })).toBeInTheDocument()
  })

  it('clears every store namespace after confirmation, then reloads', async () => {
    const onReload = crashed()
    fireEvent.click(screen.getByRole('button', { name: 'Reset saved settings and reload' }))
    fireEvent.click(screen.getByRole('button', { name: /yes, reset/i }))

    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))
    const cleared = clearNamespace.mock.calls.map((c) => (c as unknown as [string])[0]).sort()
    expect(cleared).toEqual(Object.values(STORE_NS).sort())
  })

  it('does not reload, and says why, when clearing fails', async () => {
    clearNamespace.mockRejectedValueOnce(new Error('disk locked'))
    const onReload = crashed()
    fireEvent.click(screen.getByRole('button', { name: 'Reset saved settings and reload' }))
    fireEvent.click(screen.getByRole('button', { name: /yes, reset/i }))

    expect(await screen.findByText(/disk locked/)).toBeInTheDocument()
    expect(onReload).not.toHaveBeenCalled()
  })

  it('falls back to clearing localStorage outside Electron', async () => {
    delete (window as Partial<Window>).racedeck
    localStorage.setItem(`${STORE_NS.SETTINGS}:ai`, '{"apiKey":"x"}')
    localStorage.setItem(`${STORE_NS.LAYOUTS}:main`, '{}')
    localStorage.setItem('unrelated', 'keep')
    const onReload = crashed()
    fireEvent.click(screen.getByRole('button', { name: 'Reset saved settings and reload' }))
    fireEvent.click(screen.getByRole('button', { name: /yes, reset/i }))

    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem(`${STORE_NS.SETTINGS}:ai`)).toBeNull()
    expect(localStorage.getItem(`${STORE_NS.LAYOUTS}:main`)).toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
  })

  it('catches an async bootstrap failure and shows the fallback instead of a half-started app', async () => {
    vi.spyOn(persist, 'checkRecovery').mockRejectedValue(new Error('bad saved layout'))
    function Probe() {
      useBootstrap()
      return createElement('div', null, 'booting')
    }
    render(createElement(RootErrorBoundary, null, createElement(Probe)))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('bad saved layout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset saved settings and reload' })).toBeInTheDocument()
  })
})

describe('WidgetErrorBoundary with non-Error throws', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('still shows the fallback (not an empty render) when a widget throws null', () => {
    function ThrowNull(): never {
      // eslint-disable-next-line no-throw-literal
      throw null
    }
    render(
      createElement(WidgetErrorBoundary, { widgetKey: 'alerts' }, createElement(ThrowNull))
    )
    expect(screen.getByText(CRASHED)).toBeInTheDocument()
  })
})

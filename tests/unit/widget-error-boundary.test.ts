import { createElement, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WidgetErrorBoundary } from '@renderer/components/dashboard/WidgetErrorBoundary'

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('kaboom')
  return createElement('div', null, 'ok')
}

/** Lets a single test toggle whether the child throws, to exercise Retry. */
function BoomHost({ initialThrow }: { initialThrow: boolean }) {
  const [shouldThrow, setShouldThrow] = useState(initialThrow)
  return createElement(
    'div',
    null,
    createElement('button', { onClick: () => setShouldThrow(false) }, 'stop throwing'),
    createElement(
      WidgetErrorBoundary,
      { widgetKey: 'alerts' },
      createElement(Boom, { shouldThrow })
    )
  )
}

describe('WidgetErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders children normally when there is no error', () => {
    render(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts' },
        createElement(Boom, { shouldThrow: false })
      )
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('isolates a crash instead of throwing past the boundary, showing the widget title', () => {
    render(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts' },
        createElement(Boom, { shouldThrow: true })
      )
    )
    expect(screen.getByText('Alert Center')).toBeInTheDocument()
    expect(screen.getByText('This widget crashed and has been isolated.')).toBeInTheDocument()
    expect(screen.getByText('kaboom')).toBeInTheDocument()
  })

  it('logs the crash with widget context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      createElement(
        WidgetErrorBoundary,
        { widgetKey: 'alerts' },
        createElement(Boom, { shouldThrow: true })
      )
    )
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('"alerts" crashed'),
      expect.any(Error),
      expect.anything()
    )
  })

  it('recovers when Retry is clicked and the underlying error condition is gone', () => {
    render(createElement(BoomHost, { initialThrow: true }))
    expect(screen.getByText('This widget crashed and has been isolated.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'stop throwing' }))
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.queryByText('This widget crashed and has been isolated.')).not.toBeInTheDocument()
  })
})

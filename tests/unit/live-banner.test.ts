import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { LiveConnectionBanner } from '@renderer/components/shell/LiveConnectionBanner'
import { useLiveStore } from '@renderer/store/liveStore'

describe('LiveConnectionBanner', () => {
  beforeEach(() => {
    useLiveStore.setState({ busy: false, notice: null })
  })

  it('shows an unexpected live disconnect globally and can dismiss it', () => {
    useLiveStore.setState({
      notice: {
        tone: 'danger',
        title: 'F1 Live connection lost',
        detail: 'closed (1006)'
      }
    })
    render(createElement(LiveConnectionBanner))

    expect(screen.getByRole('alert')).toHaveTextContent('F1 Live connection lost')
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss F1 Live notification' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('offers sign-in again when the F1 TV session expires', () => {
    useLiveStore.setState({
      notice: {
        tone: 'warning',
        title: 'F1 TV session expired',
        detail: 'Full live data is unavailable.'
      }
    })
    render(createElement(LiveConnectionBanner))
    expect(screen.getByRole('button', { name: 'Sign in again' })).toBeVisible()
  })
})

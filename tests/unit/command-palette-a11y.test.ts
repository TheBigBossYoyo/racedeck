import { createElement, Fragment } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CommandPalette } from '@renderer/components/shell/CommandPalette'
import { useAppStore } from '@renderer/store/appStore'

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

function mount() {
  render(
    createElement(
      Fragment,
      null,
      createElement('button', { type: 'button' }, 'Opener'),
      createElement(CommandPalette)
    )
  )
  const opener = screen.getByRole('button', { name: 'Opener' })
  opener.focus()
  return opener
}

function openPalette() {
  act(() => {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  })
  return screen.getByRole('dialog', { name: 'Command palette' })
}

beforeEach(() => {
  useAppStore.setState({ route: 'dashboard' })
})

afterEach(() => {
  cleanup()
})

describe('CommandPalette keyboard model', () => {
  it('focuses the search field on open', () => {
    mount()
    openPalette()
    expect(screen.getByRole('combobox', { name: 'Search commands' })).toHaveFocus()
  })

  it('closes on Escape from the input', () => {
    mount()
    openPalette()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape from anywhere inside the dialog, not only the input', () => {
    mount()
    const dialog = openPalette()
    const option = within(dialog).getAllByRole('option')[0]
    fireEvent.keyDown(option, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Ctrl+K while open', () => {
    mount()
    openPalette()
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes when the backdrop is clicked', () => {
    mount()
    const dialog = openPalette()
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('CommandPalette listbox pattern', () => {
  it('leaves the input as the only tab stop: options are not focusable and hold no buttons', () => {
    mount()
    const dialog = openPalette()
    const options = within(dialog).getAllByRole('option')
    expect(options.length).toBeGreaterThan(3)
    expect(within(dialog).getAllByRole('listbox')).toHaveLength(1)
    expect(dialog.querySelectorAll(TABBABLE)).toHaveLength(1)
    expect(dialog.querySelectorAll(TABBABLE)[0]).toBe(screen.getByRole('combobox'))
    for (const option of options) {
      expect(option.querySelector('button, a, input, [tabindex]')).toBeNull()
      expect(option).not.toHaveAttribute('tabindex')
    }
  })

  it('exposes the input as a combobox that owns the listbox and points at the active option', () => {
    mount()
    const dialog = openPalette()
    const input = screen.getByRole('combobox')
    const listbox = within(dialog).getByRole('listbox')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    const options = within(dialog).getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length)
  })

  it('ArrowDown/ArrowUp move the active option without moving DOM focus', () => {
    mount()
    const dialog = openPalette()
    const input = screen.getByRole('combobox')
    const options = () => within(dialog).getAllByRole('option')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options()[1].id)
    expect(input).toHaveFocus()

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('Enter runs the active option and closes the palette', () => {
    mount()
    const dialog = openPalette()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Go to Settings' } })
    expect(within(dialog).getAllByRole('option')[0]).toHaveTextContent('Go to Settings')

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(useAppStore.getState().route).toBe('settings')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('clicking an option runs it', () => {
    mount()
    const dialog = openPalette()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Go to About' } })
    fireEvent.click(within(dialog).getAllByRole('option')[0])
    expect(useAppStore.getState().route).toBe('about')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports an empty result set without a dangling listbox reference', () => {
    mount()
    openPalette()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'zzzznope' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No matching command.')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    // Enter with nothing to run must not throw or close.
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the active option clamped after the results shrink', () => {
    mount()
    const dialog = openPalette()
    const input = screen.getByRole('combobox')
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.change(input, { target: { value: 'Go to' } })
    const options = within(dialog).getAllByRole('option')
    expect(options.filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })
})

describe('CommandPalette focus management', () => {
  it('traps Tab inside the dialog', () => {
    mount()
    const dialog = openPalette()
    const input = screen.getByRole('combobox')
    for (const shiftKey of [false, true]) {
      const notPrevented = fireEvent.keyDown(input, { key: 'Tab', shiftKey })
      expect(notPrevented).toBe(false)
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('pulls focus back if it lands outside the dialog while open', () => {
    const opener = mount()
    const dialog = openPalette()
    act(() => opener.focus())
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('returns focus to the element that opened it on Escape', () => {
    const opener = mount()
    openPalette()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(opener).toHaveFocus()
  })

  it('returns focus to the opener after a command runs', () => {
    const opener = mount()
    openPalette()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Theme: Light' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('returns focus to the opener when toggled closed with Ctrl+K', () => {
    const opener = mount()
    openPalette()
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(opener).toHaveFocus()
  })

  it('does not throw when the opener left the document while the palette was open', () => {
    // Outside React's tree so removing it cannot upset the renderer's own unmount.
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    render(createElement(CommandPalette))
    opener.focus()
    openPalette()
    opener.remove()
    expect(() => fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })).not.toThrow()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { WidgetFrame } from '@renderer/components/ui/WidgetFrame'
import { useSettingsStore } from '@renderer/store/settingsStore'

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ performanceMode: false })
})

const frame = () => screen.getByRole('region', { name: 'Test panel' })
const renderFrame = () =>
  render(createElement(WidgetFrame, { title: 'Test panel' }, createElement('p', null, 'body')))

describe('WidgetFrame performance mode', () => {
  it('keeps the full glass panel (with its backdrop blur) by default', () => {
    useSettingsStore.setState({ performanceMode: false })
    renderFrame()
    expect(frame().classList.contains('glass')).toBe(true)
    expect(frame().classList.contains('glass-flat')).toBe(false)
  })

  it('drops the backdrop blur when performance mode is on, keeping everything else', () => {
    useSettingsStore.setState({ performanceMode: true })
    renderFrame()
    expect(frame().classList.contains('glass')).toBe(true)
    expect(frame().classList.contains('glass-flat')).toBe(true)
    expect(frame().className).toContain('rounded-2xl')
    expect(screen.getByText('body')).toBeVisible()
  })

  it('follows the setting live', () => {
    useSettingsStore.setState({ performanceMode: false })
    renderFrame()
    act(() => useSettingsStore.setState({ performanceMode: true }))
    expect(frame().classList.contains('glass-flat')).toBe(true)
    act(() => useSettingsStore.setState({ performanceMode: false }))
    expect(frame().classList.contains('glass-flat')).toBe(false)
  })

  it('has a stylesheet rule for glass-flat that removes the blur, after .glass', () => {
    const css = readFileSync(resolve('src/renderer/styles/globals.css'), 'utf8')
    const glass = css.indexOf('.glass {')
    const flat = css.indexOf('.glass.glass-flat {')
    expect(glass).toBeGreaterThan(-1)
    expect(flat).toBeGreaterThan(glass)
    const block = css.slice(flat, css.indexOf('}', flat))
    expect(block).toContain('backdrop-filter: none')
    expect(block).toContain('-webkit-backdrop-filter: none')
  })
})

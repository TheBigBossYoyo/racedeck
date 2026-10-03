import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupControls, parseBackupText } from '@renderer/components/BackupControls'
import { SettingsPersistError } from '@renderer/store/settingsStore'

const EXPORTED = { theme: { mode: 'dark' } }

function openDialog(importAll: (d: Record<string, unknown>) => Promise<void>) {
  render(createElement(BackupControls, { exportAll: () => EXPORTED, importAll }))
  fireEvent.click(screen.getByRole('button', { name: /export \/ import settings/i }))
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

function typeAndImport(box: HTMLTextAreaElement, text: string): void {
  fireEvent.change(box, { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
}

describe('parseBackupText', () => {
  it('returns the parsed object for a JSON object', () => {
    expect(parseBackupText('{"a":1}')).toEqual({ ok: true, data: { a: 1 } })
  })

  it('reports malformed JSON and non-object JSON differently', () => {
    const malformed = parseBackupText('{nope')
    const array = parseBackupText('[1,2]')
    expect(malformed).toMatchObject({ ok: false })
    expect(array).toMatchObject({ ok: false })
    expect((malformed as { message: string }).message).toMatch(/not valid JSON/i)
    expect((array as { message: string }).message).toMatch(/JSON object/i)
    for (const text of ['null', '7', '"str"', '']) {
      expect(parseBackupText(text).ok).toBe(false)
    }
  })
})

describe('BackupControls import status', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows success as a status, not an alert', async () => {
    const importAll = vi.fn().mockResolvedValue(undefined)
    typeAndImport(openDialog(importAll), '{"theme":{}}')

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Imported successfully')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(importAll).toHaveBeenCalledWith({ theme: {} })
  })

  it('reports invalid JSON as an error without calling importAll', async () => {
    const importAll = vi.fn()
    typeAndImport(openDialog(importAll), '{nope')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not valid JSON/i)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(importAll).not.toHaveBeenCalled()
  })

  it('reports a non-object backup as an error without calling importAll', async () => {
    const importAll = vi.fn()
    typeAndImport(openDialog(importAll), '[1,2,3]')

    expect(await screen.findByRole('alert')).toHaveTextContent(/JSON object/i)
    expect(importAll).not.toHaveBeenCalled()
  })

  it('does not call an import failure "Invalid JSON"', async () => {
    const importAll = vi.fn().mockRejectedValue(new Error('backup is broken'))
    typeAndImport(openDialog(importAll), '{"theme":{}}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('backup is broken')
    expect(alert).not.toHaveTextContent(/invalid json/i)
    expect(screen.queryByText(/imported successfully/i)).not.toBeInTheDocument()
  })

  it('says settings were applied but not saved when persistence failed', async () => {
    const importAll = vi.fn().mockRejectedValue(new SettingsPersistError('disk full'))
    typeAndImport(openDialog(importAll), '{"theme":{}}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not be saved/i)
    expect(alert).toHaveTextContent('disk full')
    expect(screen.queryByText(/imported successfully/i)).not.toBeInTheDocument()
  })

  it('reports a failed copy instead of claiming it copied', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }
    })
    openDialog(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not copy/i)
    expect(screen.queryByText(/copied to clipboard/i)).not.toBeInTheDocument()
  })

  it('confirms a successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    openDialog(vi.fn())
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/copied to clipboard/i))
    expect(writeText).toHaveBeenCalled()
  })
})

describe('BackupControls status is per-open', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not show a stale failure beside a freshly exported backup after reopening', async () => {
    const importAll = vi.fn().mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    typeAndImport(openDialog(importAll), '{"theme":{}}')
    expect(await screen.findByRole('alert')).toHaveTextContent(/import failed/i)

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /export \/ import settings/i }))
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    expect(JSON.parse(box.value)).toEqual(EXPORTED)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

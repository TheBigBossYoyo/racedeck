import { describe, it, expect, vi } from 'vitest'
import { filterCommands, type Command } from '@renderer/components/shell/CommandPalette'

const noop = vi.fn()
function cmd(id: string, label: string, group: string, keywords?: string): Command {
  return { id, label, group, keywords, run: noop }
}

const commands: Command[] = [
  cmd('go-settings', 'Go to Settings', 'Go to'),
  cmd('layout-strategy-wall', 'Workspace: Strategy Wall', 'Workspace', 'layout switch'),
  cmd('play', 'Play', 'Playback', 'space start stop'),
  cmd('vision-deuteranopia', 'Colour-blind: deuteranopia', 'Accessibility', 'colour blind tyre'),
  cmd('focus-1', 'Focus VER — Max Verstappen', 'Focus driver', '1 Red Bull'),
  cmd('add-track-map', 'Add Track Map', 'Add widget', 'panel insert')
]

describe('filterCommands', () => {
  it('returns everything in order for an empty query', () => {
    expect(filterCommands(commands, '')).toEqual(commands)
    expect(filterCommands(commands, '   ')).toEqual(commands)
  })

  it('matches by label substring', () => {
    const results = filterCommands(commands, 'track')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('add-track-map')
  })

  it('ranks a prefix/label match above a keyword-only match', () => {
    const results = filterCommands(commands, 'play')
    expect(results[0].id).toBe('play')
  })

  it('matches on keywords when the label does not contain the query', () => {
    const results = filterCommands(commands, 'red bull')
    expect(results.map((r) => r.id)).toContain('focus-1')
  })

  it('finds accessibility commands by intent words', () => {
    const results = filterCommands(commands, 'colour blind')
    expect(results.map((r) => r.id)).toContain('vision-deuteranopia')
  })

  it('returns nothing for an unmatched query', () => {
    expect(filterCommands(commands, 'zzzznope')).toEqual([])
  })
})

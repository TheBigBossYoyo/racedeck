import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mutationsMayChangeOverlays,
  useSurfaceOcclusionGuard
} from '@renderer/lib/useSurfaceOcclusionGuard'
import { useVideoStore } from '@renderer/store/videoStore'

function Host() {
  useSurfaceOcclusionGuard()
  return null
}

// The observer callback is a microtask that then schedules the (mocked, timer-based)
// animation frame, so wait two macrotasks for the frame to have run.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const flush = async () => {
  await tick()
  await tick()
}

function overlay(role: string): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', role)
  return el
}

describe('useSurfaceOcclusionGuard', () => {
  const setSuppressed = vi.fn()

  beforeEach(() => {
    setSuppressed.mockClear()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return window.setTimeout(() => cb(performance.now()), 0)
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => window.clearTimeout(id))
    useVideoStore.setState({ setSurfaceSuppressed: setSuppressed })
  })

  afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it.each(['dialog', 'alertdialog', 'menu', 'listbox'])(
    'suppresses the surface while a %s is mounted and restores it on removal',
    async (role) => {
      render(createElement(Host))
      expect(setSuppressed).toHaveBeenLastCalledWith(false)

      const el = overlay(role)
      document.body.appendChild(el)
      await flush()
      expect(setSuppressed).toHaveBeenLastCalledWith(true)

      el.remove()
      await flush()
      expect(setSuppressed).toHaveBeenLastCalledWith(false)
    }
  )

  it('catches an overlay nested inside a freshly added wrapper (portal roots)', async () => {
    render(createElement(Host))
    const wrapper = document.createElement('div')
    const inner = document.createElement('section')
    inner.appendChild(overlay('dialog'))
    wrapper.appendChild(inner)
    document.body.appendChild(wrapper)
    await flush()
    expect(setSuppressed).toHaveBeenLastCalledWith(true)

    wrapper.remove()
    await flush()
    expect(setSuppressed).toHaveBeenLastCalledWith(false)
  })

  it('catches an overlay that mounts deep inside the existing app tree (inline dialogs)', async () => {
    const root = document.createElement('div')
    const deep = document.createElement('div')
    root.appendChild(deep)
    document.body.appendChild(root)
    render(createElement(Host))

    deep.appendChild(overlay('dialog'))
    await flush()
    expect(setSuppressed).toHaveBeenLastCalledWith(true)
  })

  it('does not rescan the document for unrelated mutations, and ignores tooltips', async () => {
    render(createElement(Host))
    const querySpy = vi.spyOn(document, 'querySelector')
    for (let i = 0; i < 20; i++) {
      const row = document.createElement('div')
      row.textContent = `row ${i}`
      document.body.appendChild(row)
    }
    document.body.appendChild(overlay('tooltip'))
    await flush()
    expect(querySpy).not.toHaveBeenCalled()
    expect(setSuppressed).toHaveBeenLastCalledWith(false)
  })
})

describe('mutationsMayChangeOverlays', () => {
  const record = (added: Node[], removed: Node[] = []): MutationRecord =>
    ({ addedNodes: added, removedNodes: removed }) as unknown as MutationRecord

  it('ignores text nodes and plain elements', () => {
    expect(mutationsMayChangeOverlays([record([document.createTextNode('x'), document.createElement('p')])])).toBe(false)
    expect(mutationsMayChangeOverlays([])).toBe(false)
  })

  it('flags added or removed overlay subtrees', () => {
    expect(mutationsMayChangeOverlays([record([overlay('menu')])])).toBe(true)
    expect(mutationsMayChangeOverlays([record([], [overlay('listbox')])])).toBe(true)
    const wrap = document.createElement('div')
    wrap.appendChild(overlay('alertdialog'))
    expect(mutationsMayChangeOverlays([record([document.createElement('p'), wrap])])).toBe(true)
  })
})

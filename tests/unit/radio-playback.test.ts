import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRadioPlaybackStore } from '../../src/renderer/store/radioPlaybackStore'

describe('radioPlaybackStore', () => {
  beforeEach(() => {
    useRadioPlaybackStore.setState({ playingUrl: null, audio: null })
    // jsdom's HTMLMediaElement.play() throws "not implemented" by default.
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useRadioPlaybackStore.setState({ playingUrl: null, audio: null })
  })

  it('plays a clip and toggling the same url again stops it', async () => {
    useRadioPlaybackStore.getState().toggle('https://livetiming.formula1.com/clip.mp3')
    await Promise.resolve()
    expect(useRadioPlaybackStore.getState().playingUrl).toBe(
      'https://livetiming.formula1.com/clip.mp3'
    )

    useRadioPlaybackStore.getState().toggle('https://livetiming.formula1.com/clip.mp3')
    expect(useRadioPlaybackStore.getState().playingUrl).toBeNull()
  })

  it('resets state (without throwing) when the clip fails to load, e.g. a blocked cross-origin request', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('blocked', 'NotAllowedError')
    )

    useRadioPlaybackStore.getState().toggle('https://livetiming.formula1.com/clip.mp3')
    expect(useRadioPlaybackStore.getState().playingUrl).toBe(
      'https://livetiming.formula1.com/clip.mp3'
    )

    return Promise.resolve().then(() => {
      expect(useRadioPlaybackStore.getState().playingUrl).toBeNull()
      expect(errorSpy).toHaveBeenCalled()
    })
  })
})

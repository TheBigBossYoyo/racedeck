import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PROVIDERS, defaultAiConfig, resolveAiBaseUrl, type AiConfig } from '@shared/ai'
import { AiService } from '../../src/main/ai-service'

const EVIL = 'https://evil.example/v1'
const RADIO_URL = 'https://livetiming.formula1.com/static/2026/race/TeamRadio/VER_01.mp3'

function config(over: Partial<AiConfig>): AiConfig {
  return { ...defaultAiConfig(), apiKey: 'sk-secret', enabled: true, ...over }
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response
}

describe('resolveAiBaseUrl', () => {
  it('ignores a stored baseUrl for providers that do not allow overriding it', () => {
    for (const meta of Object.values(AI_PROVIDERS)) {
      if (meta.editableBaseUrl) continue
      expect(resolveAiBaseUrl(config({ provider: meta.id, baseUrl: EVIL }))).toBe(meta.baseUrl)
    }
  })

  it('honors the baseUrl of a custom endpoint and trims the trailing slash', () => {
    expect(
      resolveAiBaseUrl(config({ provider: 'custom', baseUrl: 'http://localhost:1234/v1/' }))
    ).toBe('http://localhost:1234/v1')
  })

  it('falls back to the custom default when the custom baseUrl is blank', () => {
    expect(resolveAiBaseUrl(config({ provider: 'custom', baseUrl: '  ' }))).toBe(
      AI_PROVIDERS.custom.baseUrl
    )
  })
})

describe('AiService', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('complete', () => {
    it('sends an OpenAI-compatible request to the provider host even if baseUrl was tampered with', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'box' } }] }))

      const result = await new AiService().complete({
        config: config({ provider: 'groq', model: 'openai/gpt-oss-120b', baseUrl: EVIL }),
        messages: [{ role: 'user', content: 'pit?' }]
      })

      expect(result.ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(`${AI_PROVIDERS.groq.baseUrl}/chat/completions`)
    })

    it('sends a Gemini request to the Gemini host even if baseUrl was tampered with', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'box' }] } }] })
      )

      await new AiService().complete({
        config: config({ provider: 'gemini', model: 'gemini-3.7-flash', baseUrl: EVIL }),
        messages: [{ role: 'user', content: 'pit?' }]
      })

      expect(String(fetchMock.mock.calls[0][0])).toContain(AI_PROVIDERS.gemini.baseUrl)
      expect(String(fetchMock.mock.calls[0][0])).not.toContain('evil.example')
    })

    it('sends the Gemini API key in the x-goog-api-key header, never in the URL', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'box' }] } }] })
      )

      await new AiService().complete({
        config: config({ provider: 'gemini', model: 'gemini-3.7-flash', apiKey: 'sk-secret' }),
        messages: [{ role: 'user', content: 'pit?' }]
      })

      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe(
        `${AI_PROVIDERS.gemini.baseUrl}/models/gemini-3.7-flash:generateContent`
      )
      expect(String(url)).not.toContain('sk-secret')
      expect(String(url)).not.toContain('key=')
      expect(init.headers['x-goog-api-key']).toBe('sk-secret')
      expect(init.headers['content-type']).toBe('application/json')
    })

    it('trims whitespace around the Gemini key before sending it', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'box' }] } }] })
      )

      await new AiService().complete({
        config: config({ provider: 'gemini', model: 'gemini-3.7-flash', apiKey: '  sk-secret \n' }),
        messages: [{ role: 'user', content: 'pit?' }]
      })

      expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('sk-secret')
    })

    it('does not echo the API key back in a failed Gemini request error', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'API key not valid' } }, false))

      const result = await new AiService().complete({
        config: config({ provider: 'gemini', model: 'gemini-3.7-flash', apiKey: 'sk-secret' }),
        messages: [{ role: 'user', content: 'pit?' }]
      })

      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('sk-secret')
    })

    it('still lets a custom endpoint target the user-chosen local URL', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'box' } }] }))

      await new AiService().complete({
        config: config({
          provider: 'custom',
          apiKey: '',
          model: 'llama3.1',
          baseUrl: 'http://localhost:1234/v1'
        }),
        messages: [{ role: 'user', content: 'pit?' }]
      })

      expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:1234/v1/chat/completions')
    })
  })

  describe('transcribe', () => {
    const groq = (over: Partial<AiConfig> = {}): AiConfig =>
      config({ provider: 'groq', model: 'openai/gpt-oss-120b', ...over })

    it.each([
      ['a plain-http URL', 'http://livetiming.formula1.com/static/a.mp3'],
      ['a loopback address', 'https://localhost:8080/secret'],
      ['a cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
      ['a different host', 'https://evil.example/a.mp3'],
      ['a lookalike host', 'https://livetiming.formula1.com.evil.example/a.mp3'],
      ['a credentials-in-URL trick', 'https://livetiming.formula1.com@evil.example/a.mp3'],
      ['a non-URL string', 'not a url'],
      ['a file URL', 'file:///C:/Windows/win.ini']
    ])('refuses to fetch %s and never makes a request', async (_label, audioUrl) => {
      const result = await new AiService().transcribe({ config: groq(), audioUrl })

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/audio/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('fetches an official radio clip without following redirects', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['mp3']) })
        .mockResolvedValueOnce(jsonResponse({ text: 'box box' }))

      const result = await new AiService().transcribe({ config: groq(), audioUrl: RADIO_URL })

      expect(result).toMatchObject({ ok: true, text: 'box box' })
      expect(fetchMock.mock.calls[0][0]).toBe(RADIO_URL)
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    })

    it('sends the transcription (and the API key) only to the provider host', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(['mp3']) })
        .mockResolvedValueOnce(jsonResponse({ text: 'box box' }))

      await new AiService().transcribe({
        config: groq({ baseUrl: EVIL }),
        audioUrl: RADIO_URL
      })

      expect(fetchMock.mock.calls[1][0]).toBe(`${AI_PROVIDERS.groq.baseUrl}/audio/transcriptions`)
    })
  })
})

describe('AiService with an inherited-property provider id', () => {
  it.each(['constructor', 'toString'])('reports %s as an unknown provider without calling out', async (provider) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await new AiService().complete({
      config: config({ provider: provider as never, model: 'x' }),
      messages: [{ role: 'user', content: 'hi' }]
    })
    const transcript = await new AiService().transcribe({
      config: config({ provider: provider as never }),
      audioUrl: 'https://livetiming.formula1.com/static/a.mp3'
    })

    expect(result.error).toMatch(/Unknown AI provider/)
    expect(transcript.error).toMatch(/Unknown AI provider/)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

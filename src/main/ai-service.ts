import {
  getAiProvider,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiConfig,
  type AiMessage,
  type AiTranscriptionRequest,
  type AiTranscriptionResult,
  isTrustedRadioUrl,
  resolveAiBaseUrl
} from '@shared/ai'

/**
 * AiService (main process) — performs the actual HTTP call to the user's chosen
 * AI endpoint. Running in the main process (not the renderer) keeps the request
 * off the untrusted TOD surface and lets us set a hard timeout.
 *
 * It supports two request shapes:
 *   • Google Gemini  (generateContent REST)
 *   • OpenAI-compatible /chat/completions (Groq, OpenRouter, DeepSeek, OpenAI, Ollama…)
 *
 * It NEVER sees or touches TOD credentials or protected media — only the plain
 * race-strategy text the renderer sends, plus the user's own API key.
 */

const REQUEST_TIMEOUT_MS = 45_000

export class AiService {
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const started = Date.now()
    const { config } = req
    const meta = getAiProvider(config.provider)
    const result = (over: Partial<AiCompletionResult>): AiCompletionResult => ({
      ok: false,
      text: '',
      error: null,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - started,
      ...over
    })

    if (!meta) return result({ error: `Unknown AI provider: ${config.provider}` })
    const needsKey = !meta.editableBaseUrl
    if (needsKey && !config.apiKey.trim()) {
      return result({ error: 'No API key configured. Add one in Settings → AI Race Engineer.' })
    }
    if (!config.model.trim()) return result({ error: 'No model selected.' })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const text =
        meta.kind === 'gemini'
          ? await this.callGemini(req, controller.signal)
          : await this.callOpenAiCompatible(req, controller.signal)
      return result({ ok: true, text: text.trim(), latencyMs: Date.now() - started })
    } catch (err) {
      const message =
        (err as Error)?.name === 'AbortError'
          ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
          : (err as Error)?.message || 'Unknown AI request error.'
      return result({ error: message, latencyMs: Date.now() - started })
    } finally {
      clearTimeout(timeout)
    }
  }

  // ── Gemini (generateContent) ───────────────────────────────────────────────
  private async callGemini(req: AiCompletionRequest, signal: AbortSignal): Promise<string> {
    const { config, messages, temperature = 0.4, maxTokens = 900 } = req
    const base = resolveAiBaseUrl(config)
    // The key travels in a header, not the query string: URLs end up in proxy and
    // server logs, error messages and crash reports; headers do not.
    const url = `${base}/models/${encodeURIComponent(config.model)}:generateContent`

    const systemText = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m: AiMessage) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

    const body = {
      contents,
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      generationConfig: { temperature, maxOutputTokens: maxTokens }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey.trim() },
      body: JSON.stringify(body),
      signal
    })
    const json = (await res.json().catch(() => null)) as GeminiResponse | null
    if (!res.ok) {
      throw new Error(this.errorText(res.status, json?.error?.message))
    }
    const cand = json?.candidates?.[0]
    if (cand?.finishReason === 'SAFETY') {
      throw new Error('The model blocked this response (safety filter).')
    }
    // Explicit boundary checks past 2 levels deep (CODING_STYLE.md "Nullable
    // data handling") — this is untrusted third-party API response shape.
    const content = cand?.content
    const parts = content?.parts
    const text = (parts ?? []).map((p) => p.text ?? '').join('')
    if (!text.trim()) throw new Error('Model returned an empty response.')
    return text
  }

  // ── OpenAI-compatible (/chat/completions) ──────────────────────────────────
  private async callOpenAiCompatible(
    req: AiCompletionRequest,
    signal: AbortSignal
  ): Promise<string> {
    const { config, messages, temperature = 0.4, maxTokens = 900 } = req
    const url = `${resolveAiBaseUrl(config)}/chat/completions`

    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (config.apiKey.trim()) headers.authorization = `Bearer ${config.apiKey.trim()}`
    if (config.provider === 'openrouter') {
      // OpenRouter attribution headers (optional but recommended).
      headers['HTTP-Referer'] = 'https://racedeck.app'
      headers['X-Title'] = 'RaceDeck'
    }

    const body = {
      model: config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature,
      max_tokens: maxTokens,
      stream: false
    }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    const json = (await res.json().catch(() => null)) as OpenAiResponse | null
    if (!res.ok) {
      throw new Error(this.errorText(res.status, json?.error?.message))
    }
    const text = json?.choices?.[0]?.message?.content ?? ''
    if (!text.trim()) throw new Error('Model returned an empty response.')
    return text
  }

  /**
   * Transcribe a team-radio clip via the provider's OpenAI-compatible
   * /audio/transcriptions endpoint. Only `groq` and `openai` currently
   * declare `supportsTranscription`; the renderer gates the UI on that flag,
   * but this also re-checks it so a stray IPC call can't hit an endpoint
   * that doesn't serve this route.
   */
  async transcribe(req: AiTranscriptionRequest): Promise<AiTranscriptionResult> {
    const { config, audioUrl } = req
    const meta = getAiProvider(config.provider)
    if (!meta) return { ok: false, text: '', error: `Unknown AI provider: ${config.provider}` }
    if (!meta.supportsTranscription || !meta.transcriptionModel) {
      return { ok: false, text: '', error: `${meta.label} does not support transcription.` }
    }
    if (!config.apiKey.trim()) {
      return {
        ok: false,
        text: '',
        error: 'No API key configured. Add one in Settings → AI Race Engineer.'
      }
    }
    // The renderer supplies this URL, but the fetch runs in the privileged main
    // process — so only official live-timing clips may be requested (no
    // localhost / LAN / metadata hosts), and redirects off that host are refused.
    if (!isTrustedRadioUrl(audioUrl)) {
      return {
        ok: false,
        text: '',
        error: 'Could not fetch the audio clip: it is not an official team-radio URL.'
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const audioRes = await fetch(audioUrl, { signal: controller.signal, redirect: 'error' })
      if (!audioRes.ok) {
        return {
          ok: false,
          text: '',
          error: `Could not fetch the audio clip (${audioRes.status}).`
        }
      }
      const audioBlob = await audioRes.blob()

      const form = new FormData()
      form.append('file', audioBlob, 'radio.mp3')
      form.append('model', meta.transcriptionModel)

      const res = await fetch(`${resolveAiBaseUrl(config)}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey.trim()}` },
        body: form,
        signal: controller.signal
      })
      const json = (await res.json().catch(() => null)) as TranscriptionResponse | null
      if (!res.ok) {
        return { ok: false, text: '', error: this.errorText(res.status, json?.error?.message) }
      }
      const text = json?.text ?? ''
      if (!text.trim()) return { ok: false, text: '', error: 'Model returned an empty transcript.' }
      return { ok: true, text: text.trim(), error: null }
    } catch (err) {
      const message =
        (err as Error)?.name === 'AbortError'
          ? `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`
          : (err as Error)?.message || 'Unknown transcription error.'
      return { ok: false, text: '', error: message }
    } finally {
      clearTimeout(timeout)
    }
  }

  private errorText(status: number, providerMessage?: string): string {
    const hint =
      status === 401 || status === 403
        ? 'Check your API key.'
        : status === 404
          ? 'Check the model name / base URL.'
          : status === 429
            ? 'Rate limit reached — wait a moment or switch model.'
            : ''
    return [`AI request failed (${status}).`, providerMessage, hint].filter(Boolean).join(' ')
  }
}

// ── Minimal response shapes (only the fields we read) ──────────────────────────
interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  error?: { message?: string }
}
interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}
interface TranscriptionResponse {
  text?: string
  error?: { message?: string }
}

export type { AiConfig }

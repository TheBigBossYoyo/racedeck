/**
 * AI Race Engineer — shared, provider-agnostic types + registry.
 *
 * RaceDeck talks to a *user-supplied* AI endpoint using the user's own API key.
 * Two request shapes cover essentially the whole free/low-cost landscape:
 *   • `gemini`  → Google Generative Language REST (free tier, recommended)
 *   • `openai`  → any OpenAI-compatible /chat/completions endpoint
 *                 (Groq, OpenRouter, DeepSeek, OpenAI, Ollama, LM Studio, …)
 *
 * The key never touches TOD or any protected content — it is only used to POST
 * the (real, deterministic) race context to the model the user chose.
 */

export type AiProviderId = 'gemini' | 'groq' | 'openrouter' | 'deepseek' | 'openai' | 'custom'

export type AiRequestKind = 'gemini' | 'openai'

export interface AiProviderMeta {
  id: AiProviderId
  label: string
  /** True when a genuinely free tier / free models are available. */
  free: boolean
  kind: AiRequestKind
  baseUrl: string
  defaultModel: string
  models: string[]
  /** Where the user creates a key. */
  keyUrl: string
  note: string
  /** Custom endpoints let the user override the base URL. */
  editableBaseUrl?: boolean
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderMeta> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    free: true,
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Recommended. Generous free tier via Google AI Studio — no credit card, fast Flash models.'
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    free: true,
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'],
    keyUrl: 'https://console.groq.com/keys',
    note: 'Free and extremely fast inference of open models (Llama, GPT-OSS). Great for live sessions.'
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    free: true,
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    models: [
      'meta-llama/llama-3.3-70b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'deepseek/deepseek-chat-v3-0324:free'
    ],
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Single key, many models — several marked ":free". Rate-limited but no cost.'
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    free: false,
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'Very low cost (not free). Strong reasoning; reasoner model is good for strategy.'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    free: false,
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'o4-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Paid. Reliable quality if you already have an account.'
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    free: true,
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    models: [],
    keyUrl: '',
    note: 'Any OpenAI-compatible endpoint — Ollama, LM Studio, vLLM. 100% local & private.',
    editableBaseUrl: true
  }
}

export const AI_PROVIDER_ORDER: AiProviderId[] = [
  'gemini',
  'groq',
  'openrouter',
  'deepseek',
  'openai',
  'custom'
]

export interface AiConfig {
  provider: AiProviderId
  apiKey: string
  model: string
  /** Effective base URL (used for `custom`, otherwise the provider default). */
  baseUrl: string
  enabled: boolean
}

export function defaultAiConfig(): AiConfig {
  const p = AI_PROVIDERS.gemini
  return { provider: p.id, apiKey: '', model: p.defaultModel, baseUrl: p.baseUrl, enabled: false }
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiCompletionRequest {
  config: AiConfig
  messages: AiMessage[]
  temperature?: number
  maxTokens?: number
}

export interface AiCompletionResult {
  ok: boolean
  text: string
  error: string | null
  provider: AiProviderId
  model: string
  latencyMs: number
}

/** True when the config has everything needed to make a call. */
export function isAiConfigReady(config: AiConfig): boolean {
  if (!config.enabled) return false
  const meta = AI_PROVIDERS[config.provider]
  const needsKey = !meta.editableBaseUrl // local/custom endpoints may not need a key
  if (needsKey && !config.apiKey.trim()) return false
  return Boolean(config.model.trim() && config.baseUrl.trim())
}

/** Redact a key for display, keeping only a short prefix/suffix. */
export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 8) return k ? '••••' : ''
  return `${k.slice(0, 4)}••••${k.slice(-4)}`
}

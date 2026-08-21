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
    // Google retired the 1.5 family (404s) and shut down 2.0 Flash / Flash-Lite
    // on 2026-06-01, which had left every model here dead — on the DEFAULT
    // provider. 3.7 Flash is the current stable Flash model.
    defaultModel: 'gemini-3.7-flash',
    models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Recommended. Generous free tier via Google AI Studio — no credit card, fast Flash models.'
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    free: true,
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Groq decommissioned llama-3.3-70b-versatile and llama-3.1-8b-instant on
    // 2026-08-16; requests to either now fail. Their documented successors are
    // openai/gpt-oss-120b (flagship) and openai/gpt-oss-20b (faster), with
    // qwen/qwen3.6-27b as the other suggested replacement for the 70B.
    defaultModel: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'],
    keyUrl: 'https://console.groq.com/keys',
    note: 'Free and extremely fast inference of open models (GPT-OSS, Qwen). Great for live sessions.'
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    free: true,
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    // OpenRouter's ":free" catalogue ROTATES — models come and go within months,
    // and all three previously listed here had already been withdrawn. Verified
    // live against https://openrouter.ai/api/v1/models, which is public and the
    // right place to re-check when one stops answering.
    defaultModel: 'nvidia/nemotron-3.5-lightning:free',
    models: [
      'nvidia/nemotron-3.5-lightning:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'google/gemma-4-31b-it:free'
    ],
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Single key, many models — several marked ":free". Rate-limited but no cost; the free list rotates.'
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
    // gpt-4o-mini is kept as the default because it is long-lived and still
    // served; the 5.x minis are the current generation.
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5-mini'],
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

/**
 * Models a provider has RETIRED, mapped to the successor it documents.
 *
 * Changing a provider's `defaultModel` does not help anyone who already picked a
 * model: the stored setting wins over the default at hydration, so a user stays
 * pinned to an ID the provider no longer serves and every request fails. Keyed by
 * provider because the same family name means different IDs on different hosts.
 *
 * Groq decommissioned its Llama 3.x endpoints on 2026-08-16 and names GPT-OSS as
 * the replacement for both. Its retired Qwen 3-32B maps to the flagship too.
 */
const RETIRED_MODELS: Partial<Record<AiProviderId, Record<string, string>>> = {
  gemini: {
    'gemini-2.0-flash': 'gemini-3.7-flash',
    'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
    'gemini-2.0-flash-001': 'gemini-3.7-flash',
    'gemini-1.5-flash': 'gemini-3.7-flash',
    'gemini-1.5-flash-8b': 'gemini-3.5-flash-lite',
    'gemini-1.5-pro': 'gemini-3.7-flash'
  },
  groq: {
    'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
    'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
    'qwen/qwen3-32b': 'openai/gpt-oss-120b',
    'gemma2-9b-it': 'openai/gpt-oss-20b',
    'deepseek-r1-distill-llama-70b': 'openai/gpt-oss-120b',
    'mistral-saba-24b': 'qwen/qwen3.6-27b',
    'moonshotai/kimi-k2-instruct-0905': 'openai/gpt-oss-120b',
    'meta-llama/llama-4-maverick-17b-128e-instruct': 'openai/gpt-oss-120b'
  }
}

/**
 * Move a stored config off a model its provider has retired. Returns the config
 * unchanged when nothing is stale, so callers can apply it unconditionally.
 * Never touches `custom`, where the user's own endpoint defines what is valid.
 */
export function migrateAiConfig(config: AiConfig): AiConfig {
  if (config.provider === 'custom') return config
  const replacement = RETIRED_MODELS[config.provider]?.[config.model]
  if (!replacement) return config
  return { ...config, model: replacement }
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

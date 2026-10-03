import {
  AI_PROVIDERS,
  type AiCompletionRequest,
  type AiConfig,
  type AiMessage,
  type AiProviderId,
  type AiTranscriptionRequest
} from '@shared/ai'
import {
  STORE_NS,
  type DebriefFormat,
  type SetVideoModeRequest,
  type SurfaceBounds
} from '@shared/ipc-contract'
import type { MarketHistoryRequest, MarketWinnerRequest } from '@shared/market'
import type { VideoMode } from '@shared/models'

/**
 * Argument validators for the renderer -> main IPC surface.
 *
 * The renderer is the less-trusted side of this bridge: anything it sends is
 * checked here, at the boundary, so a malformed (or hostile) payload becomes a
 * clear rejection instead of a TypeError deep inside a privileged handler. Every
 * validator either returns a freshly-built, typed value (never the caller's
 * object, so unknown fields cannot ride along) or throws.
 */

export const MAX_STORE_KEY_LENGTH = 512
export const MAX_STORE_VALUE_BYTES = 5 * 1024 * 1024
export const MAX_DEBRIEF_BYTES = 10 * 1024 * 1024

const MAX_URL_LENGTH = 2048
const MAX_FILE_NAME_LENGTH = 200
const MAX_AI_MESSAGES = 64
const MAX_AI_MESSAGE_CHARS = 200_000
const MAX_AI_TOTAL_CHARS = 500_000
const MAX_AI_TOKENS = 65_536
const MAX_BOUNDS_MAGNITUDE = 100_000
const MIN_F1_YEAR = 1950
const MAX_F1_YEAR = 2100

/** '.' would let a key nest into another path (`ns.a.b`), so it is escaped. */
const DOT_ESCAPE = '%2E'

const STORE_NAMESPACES: ReadonlySet<string> = new Set(Object.values(STORE_NS))
const VIDEO_MODES: ReadonlySet<string> = new Set<VideoMode>([
  'embedded',
  'companion',
  'external',
  'none'
])
const AI_ROLES: ReadonlySet<string> = new Set<AiMessage['role']>(['system', 'user', 'assistant'])
const DEBRIEF_FORMATS: ReadonlySet<string> = new Set<DebriefFormat>(['md', 'json'])

function fail(message: string): never {
  throw new Error(`Invalid IPC request: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${what} must be an object.`)
  return value
}

function requireString(value: unknown, what: string, maxLength: number): string {
  if (typeof value !== 'string') fail(`${what} must be a string.`)
  if (value.length > maxLength) fail(`${what} is too long (max ${maxLength} characters).`)
  return value
}

// ── Persistence ──────────────────────────────────────────────────────────────

export function validateStoreNamespace(namespace: unknown): string {
  if (typeof namespace !== 'string' || !STORE_NAMESPACES.has(namespace)) {
    fail('unknown store namespace.')
  }
  return namespace
}

/**
 * The key to use in the store for a renderer-supplied key. persistence.ts joins
 * `namespace.key` as a dot-path, so a raw '.' would nest data, and a `__` key
 * could reach internal entries like `__meta`. Dots are escaped rather than
 * rejected: real keys never need them today, but a session id or archive path
 * might, and refusing to persist those would silently lose user data.
 */
export function toStorageKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0) fail('store key must be a non-empty string.')
  if (key.length > MAX_STORE_KEY_LENGTH) fail('store key is too long.')
  if (key.startsWith('__')) fail('store keys starting with "__" are reserved.')
  return key.replace(/\./g, DOT_ESCAPE)
}

export function validateStoreValue(value: unknown): unknown {
  if (value === undefined) fail('store value must not be undefined (use delete instead).')
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    fail('store value could not be serialized to JSON.')
  }
  if (serialized === undefined) fail('store value could not be serialized to JSON.')
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STORE_VALUE_BYTES) {
    fail(`store value is too large (exceeds ${MAX_STORE_VALUE_BYTES / (1024 * 1024)} MB).`)
  }
  return value
}

// ── AI ───────────────────────────────────────────────────────────────────────

function validateAiConfig(raw: unknown): AiConfig {
  const config = requireRecord(raw, 'AI config')
  const provider = config.provider
  // Own-property check: `AI_PROVIDERS['constructor']` is truthy on a plain object.
  if (typeof provider !== 'string' || !Object.hasOwn(AI_PROVIDERS, provider)) {
    fail('unknown AI provider.')
  }
  return {
    provider: provider as AiProviderId,
    apiKey: requireString(config.apiKey, 'AI apiKey', 4096),
    model: requireString(config.model, 'AI model', 512),
    baseUrl: requireString(config.baseUrl ?? '', 'AI baseUrl', MAX_URL_LENGTH),
    enabled: config.enabled === true
  }
}

function validateAiMessages(raw: unknown): AiMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('AI messages must be a non-empty array.')
  if (raw.length > MAX_AI_MESSAGES) fail(`too many AI messages (max ${MAX_AI_MESSAGES}).`)
  let total = 0
  return raw.map((item: unknown) => {
    const message = requireRecord(item, 'AI message')
    const role = message.role
    if (typeof role !== 'string' || !AI_ROLES.has(role)) fail('unknown AI message role.')
    const content = requireString(message.content, 'AI message content', MAX_AI_MESSAGE_CHARS)
    total += content.length
    if (total > MAX_AI_TOTAL_CHARS) fail('AI messages are too large in total.')
    return { role: role as AiMessage['role'], content }
  })
}

function optionalNumber(value: unknown, what: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${what} must be a finite number between ${min} and ${max}.`)
  }
  return value
}

export function validateAiCompletionRequest(raw: unknown): AiCompletionRequest {
  const req = requireRecord(raw, 'AI request')
  const temperature = optionalNumber(req.temperature, 'temperature', 0, 2)
  const maxTokens = optionalNumber(req.maxTokens, 'maxTokens', 1, MAX_AI_TOKENS)
  if (maxTokens !== undefined && !Number.isInteger(maxTokens)) fail('maxTokens must be an integer.')
  return {
    config: validateAiConfig(req.config),
    messages: validateAiMessages(req.messages),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens })
  }
}

export function validateAiTranscriptionRequest(raw: unknown): AiTranscriptionRequest {
  const req = requireRecord(raw, 'AI transcription request')
  return {
    config: validateAiConfig(req.config),
    audioUrl: requireString(req.audioUrl, 'audioUrl', MAX_URL_LENGTH)
  }
}

// ── Prediction market ────────────────────────────────────────────────────────

/** Generous ceilings: the service trims to its own, tighter limits. */
const MAX_MARKET_TEXT_LENGTH = 500
const MAX_MARKET_TOKEN_LENGTH = 300
const MAX_MARKET_INTERVAL_LENGTH = 20
const MAX_MARKET_NUMBER = 1e13

function optionalString(value: unknown, what: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : requireString(value, what, maxLength)
}

export function validateMarketSearchQuery(raw: unknown): string {
  return requireString(raw, 'query', MAX_MARKET_TEXT_LENGTH)
}

export function validateMarketWinnerRequest(raw: unknown): MarketWinnerRequest {
  const req = requireRecord(raw, 'market winner request')
  const query = optionalString(req.query, 'query', MAX_MARKET_TEXT_LENGTH)
  const slug = optionalString(req.slug, 'slug', MAX_MARKET_TEXT_LENGTH)
  const targetDateMs = optionalNumber(req.targetDateMs, 'targetDateMs', 0, MAX_MARKET_NUMBER)
  return {
    ...(query === undefined ? {} : { query }),
    ...(slug === undefined ? {} : { slug }),
    ...(targetDateMs === undefined ? {} : { targetDateMs })
  }
}

export function validateMarketHistoryRequest(raw: unknown): MarketHistoryRequest {
  const req = requireRecord(raw, 'market history request')
  const interval = optionalString(req.interval, 'interval', MAX_MARKET_INTERVAL_LENGTH)
  const fidelity = optionalNumber(req.fidelity, 'fidelity', 0, MAX_MARKET_NUMBER)
  const startTs = optionalNumber(req.startTs, 'startTs', 0, MAX_MARKET_NUMBER)
  const endTs = optionalNumber(req.endTs, 'endTs', 0, MAX_MARKET_NUMBER)
  return {
    yesTokenId: requireString(req.yesTokenId, 'yesTokenId', MAX_MARKET_TOKEN_LENGTH),
    ...(interval === undefined ? {} : { interval }),
    ...(fidelity === undefined ? {} : { fidelity }),
    ...(startTs === undefined ? {} : { startTs }),
    ...(endTs === undefined ? {} : { endTs })
  }
}

// ── Video surface ────────────────────────────────────────────────────────────

export function validateVideoMode(mode: unknown): VideoMode {
  if (typeof mode !== 'string' || !VIDEO_MODES.has(mode)) fail('unknown video mode.')
  return mode as VideoMode
}

function boundedFinite(value: unknown, min: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > MAX_BOUNDS_MAGNITUDE
  ) {
    fail('surface bounds must be finite numbers in a sane range.')
  }
  return value
}

export function validateSurfaceBounds(raw: unknown): SurfaceBounds {
  if (!isRecord(raw)) fail('surface bounds must be an object.')
  return {
    x: boundedFinite(raw.x, -MAX_BOUNDS_MAGNITUDE),
    y: boundedFinite(raw.y, -MAX_BOUNDS_MAGNITUDE),
    width: boundedFinite(raw.width, 0),
    height: boundedFinite(raw.height, 0)
  }
}

export function validateVideoSetMode(raw: unknown): SetVideoModeRequest {
  const req = requireRecord(raw, 'video mode request')
  const out: SetVideoModeRequest = { mode: validateVideoMode(req.mode) }
  if (req.url !== undefined) out.url = requireString(req.url, 'video url', MAX_URL_LENGTH)
  if (req.bounds !== undefined) out.bounds = validateSurfaceBounds(req.bounds)
  if (req.autoFallback !== undefined) {
    if (typeof req.autoFallback !== 'boolean') fail('autoFallback must be a boolean.')
    out.autoFallback = req.autoFallback
  }
  return out
}

export function validateVisible(value: unknown): boolean {
  if (typeof value !== 'boolean') fail('visibility must be a boolean.')
  return value
}

export function validateOptionalUrl(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, 'url', MAX_URL_LENGTH)
}

export function validateUrl(value: unknown): string {
  return requireString(value, 'url', MAX_URL_LENGTH)
}

// ── Export dialogs ───────────────────────────────────────────────────────────

/**
 * A suggested file name only seeds the save dialog, but it is joined onto a
 * directory, so separators and reserved characters are stripped rather than
 * trusted. Returns undefined when nothing usable is left.
 */
export function validateSafeFileName(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  const name = requireString(raw, 'file name', MAX_FILE_NAME_LENGTH)
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[._\s]+/, '')
  return /[^_\s]/.test(cleaned) ? cleaned : undefined
}

export function validateDebriefExport(
  content: unknown,
  format: unknown,
  defaultName: unknown
): { content: string; format: DebriefFormat; defaultName: string | undefined } {
  if (typeof content !== 'string') fail('debrief content must be a string.')
  if (typeof format !== 'string' || !DEBRIEF_FORMATS.has(format)) fail('unknown debrief format.')
  if (Buffer.byteLength(content, 'utf8') > MAX_DEBRIEF_BYTES) {
    fail(`debrief is too large (exceeds ${MAX_DEBRIEF_BYTES / (1024 * 1024)} MB).`)
  }
  return {
    content,
    format: format as DebriefFormat,
    defaultName: validateSafeFileName(defaultName)
  }
}

// ── F1 feeds ─────────────────────────────────────────────────────────────────

export function validateF1Year(year: unknown): number {
  if (
    typeof year !== 'number' ||
    !Number.isInteger(year) ||
    year < MIN_F1_YEAR ||
    year > MAX_F1_YEAR
  ) {
    fail('F1 year must be a plausible season.')
  }
  return year
}

export function validateF1LiveCursors(
  cursors: unknown,
  generation: unknown
): { cursors: Record<string, number> | undefined; generation: number | undefined } {
  if (generation !== undefined && (typeof generation !== 'number' || !Number.isFinite(generation))) {
    fail('live generation must be a finite number.')
  }
  if (cursors === undefined) return { cursors: undefined, generation }
  const map = requireRecord(cursors, 'live cursors')
  const out: Record<string, number> = {}
  for (const [topic, position] of Object.entries(map)) {
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      fail('live cursors must map topics to finite numbers.')
    }
    out[topic] = position
  }
  return { cursors: out, generation }
}

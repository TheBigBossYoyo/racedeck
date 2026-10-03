/**
 * Field-level encryption for the AI API key stored in `settings/ai`.
 *
 * On disk the record carries `apiKeyEnc` (base64 of a safeStorage ciphertext);
 * the renderer only ever sees the plaintext `apiKey` shape, so it needs no
 * changes. Ciphertext is bound to the OS user (DPAPI on Windows), which is why
 * a failed decryption is treated as "no key" but never as a reason to erase it.
 */

/** The subset of Electron's `safeStorage` this module needs. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface OpenedRecord {
  /** Renderer-facing value: plaintext `apiKey`, no `apiKeyEnc`. */
  value: unknown
  /** Encrypted form of a legacy plaintext record, to write back; null when nothing to migrate. */
  rewrite: unknown | null
}

const LABEL = 'settings/ai'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class AiKeyVault {
  /** Warnings/errors already emitted, so a hot read path cannot flood the log. */
  private readonly reported = new Set<string>()

  constructor(private readonly cipher: SecretCipher) {}

  /** The record to persist for a caller-supplied config; `existing` is what is on disk now. */
  seal(value: unknown, existing: unknown): unknown {
    if (!isRecord(value)) return value
    // apiKeyEnc is internal: a caller-supplied one is never trusted or stored.
    const { apiKey, apiKeyEnc: _ignored, ...rest } = value
    const key = typeof apiKey === 'string' ? apiKey : ''

    if (!key) {
      const kept = this.undecryptableCiphertext(existing)
      return kept ? { ...rest, apiKey: '', apiKeyEnc: kept } : { ...rest, apiKey: '' }
    }
    const encrypted = this.encrypt(key)
    return encrypted ? { ...rest, apiKeyEnc: encrypted } : { ...rest, apiKey: key }
  }

  /** Turn a stored record into the renderer-facing value, flagging legacy plaintext for re-encryption. */
  open(stored: unknown): OpenedRecord {
    if (!isRecord(stored)) return { value: stored, rewrite: null }
    const { apiKey, apiKeyEnc, ...rest } = stored

    // A non-empty plaintext key wins: it is either a pre-encryption record or
    // one written while encryption was unavailable, so it is newer than any
    // ciphertext beside it.
    if (typeof apiKey === 'string' && apiKey) {
      const encrypted = this.encrypt(apiKey)
      return { value: { ...rest, apiKey }, rewrite: encrypted ? { ...rest, apiKeyEnc: encrypted } : null }
    }
    if (typeof apiKeyEnc === 'string' && apiKeyEnc) {
      const key = this.decrypt(apiKeyEnc)
      if (key === null) {
        this.reportOnce('decrypt', 'error', `Could not decrypt the stored ${LABEL} apiKey (different OS user/profile or damaged data); returning an empty key and leaving the stored ciphertext untouched.`)
        return { value: { ...rest, apiKey: '' }, rewrite: null }
      }
      return { value: { ...rest, apiKey: key }, rewrite: null }
    }
    return { value: { ...rest, apiKey: '' }, rewrite: null }
  }

  /** Base64 ciphertext, or null when encryption is unavailable/failed (caller keeps plaintext). */
  private encrypt(plain: string): string | null {
    if (!this.available()) return null
    try {
      const encrypted = this.cipher.encryptString(plain)
      // Never trade a working key for one we cannot read back.
      if (this.cipher.decryptString(encrypted) !== plain) throw new Error('round-trip mismatch')
      return encrypted.toString('base64')
    } catch (err) {
      this.reportOnce('encrypt', 'error', `Could not encrypt the ${LABEL} apiKey; storing it unencrypted instead: ${reason(err)}`)
      return null
    }
  }

  /** Plaintext, or null on any failure. Logging is the caller's job. */
  private decrypt(encoded: string): string | null {
    if (!this.available()) return null
    try {
      const plain: unknown = this.cipher.decryptString(Buffer.from(encoded, 'base64'))
      return typeof plain === 'string' ? plain : null
    } catch {
      return null
    }
  }

  /** Ciphertext on disk that this process cannot read and that no visible plaintext key supersedes. */
  private undecryptableCiphertext(existing: unknown): string | null {
    if (!isRecord(existing)) return null
    const { apiKey, apiKeyEnc } = existing
    if (typeof apiKey === 'string' && apiKey) return null
    if (typeof apiKeyEnc !== 'string' || !apiKeyEnc) return null
    return this.decrypt(apiKeyEnc) === null ? apiKeyEnc : null
  }

  private available(): boolean {
    let ok = false
    try {
      ok = this.cipher.isEncryptionAvailable()
    } catch {
      ok = false
    }
    if (!ok) {
      this.reportOnce('unavailable', 'warn', `OS-level encryption is unavailable; ${LABEL} apiKey is stored in plaintext.`)
    }
    return ok
  }

  private reportOnce(id: string, level: 'warn' | 'error', message: string): void {
    if (this.reported.has(id)) return
    this.reported.add(id)
    console[level](`[persistence] ${message}`)
  }
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error'
}

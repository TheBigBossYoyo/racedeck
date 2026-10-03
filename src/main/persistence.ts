import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import Store from 'electron-store'
import { STORE_NS, type StoreRecovery } from '@shared/ipc-contract'
import { backupIfCorrupt } from './config-recovery'
import { AiKeyVault, isRecord, type SecretCipher } from './secret-storage'

const STORE_NAME = 'racedeck'
/** The one entry whose `apiKey` is encrypted at rest. */
const AI_NAMESPACE = STORE_NS.SETTINGS
const AI_KEY = 'ai'

/**
 * Electron's safeStorage, resolved at call time: it is only usable after the
 * app 'ready' event, but PersistenceLayer is constructed at module load.
 */
const electronCipher: SecretCipher = {
  isEncryptionAvailable: () => safeStorage?.isEncryptionAvailable() ?? false,
  encryptString: (plainText) => safeStorage.encryptString(plainText),
  decryptString: (encrypted) => safeStorage.decryptString(encrypted)
}

/**
 * PersistenceLayer — thin, namespaced wrapper over electron-store.
 *
 * Data is organized by namespace (settings, layouts, sync, favorites, alerts)
 * so the renderer can read/write coherent groups. electron-store is used for
 * MVP robustness (pure JSON, cross-platform, no native rebuild). The rest of
 * the app only sees this interface, so swapping in SQLite later is localized
 * to this file + the IPC handlers.
 *
 * The AI API key (`settings/ai`) is encrypted with the OS keystore on disk but
 * exposed as plaintext `apiKey` through get/all; see secret-storage.ts.
 */
export class PersistenceLayer {
  private store: Store<Record<string, unknown>>
  private readonly vault: AiKeyVault
  /** Set when an unreadable config file was moved aside at launch. */
  readonly recovery: StoreRecovery | null

  /** `cwd` overrides the default userData directory; `safeStorage` the OS cipher (both used by tests). */
  constructor(options: { cwd?: string; safeStorage?: SecretCipher } = {}) {
    const cwd = options.cwd ?? app.getPath('userData')
    this.vault = new AiKeyVault(options.safeStorage ?? electronCipher)
    // Must run before the store opens: constructing it overwrites a corrupt
    // file with defaults, which would destroy the user's only copy.
    this.recovery = backupIfCorrupt(join(cwd, `${STORE_NAME}.json`))
    this.store = new Store<Record<string, unknown>>({
      name: STORE_NAME,
      cwd,
      // Schema-less on purpose; the renderer owns typed shapes. We keep a
      // version marker for future migrations.
      defaults: { __meta: { version: 1 } },
      // electron-store re-reads and JSON.parses the config file on every
      // access (not just construction). Without this, a corrupted file
      // throws a SyntaxError straight out of `new Store(...)` at app boot,
      // before any window or IPC handler exists — an unrecoverable crash.
      // This makes a malformed file reset to defaults instead, matching the
      // renderer-side persist.ts fallback behavior for the same failure mode.
      clearInvalidConfig: true
    })
  }

  private path(namespace: string, key: string): string {
    // nanoid/layout ids never contain '.', so dot-notation nesting is safe.
    return `${namespace}.${key}`
  }

  private isSecretEntry(namespace: string, key: string): boolean {
    return namespace === AI_NAMESPACE && key === AI_KEY
  }

  /** Decrypt a stored AI record, re-writing a legacy plaintext one as ciphertext. */
  private openAiRecord(stored: unknown): unknown {
    const { value, rewrite } = this.vault.open(stored)
    if (rewrite !== null) {
      try {
        this.store.set(this.path(AI_NAMESPACE, AI_KEY), rewrite)
      } catch (err) {
        console.error('[persistence] Could not re-write settings/ai encrypted; plaintext key remains on disk:', err)
      }
    }
    return value
  }

  get<T = unknown>(namespace: string, key: string): T | null {
    const value = this.store.get(this.path(namespace, key))
    if (value === undefined) return null
    return (this.isSecretEntry(namespace, key) ? this.openAiRecord(value) : value) as T
  }

  set(namespace: string, key: string, value: unknown): void {
    const path = this.path(namespace, key)
    const stored = this.isSecretEntry(namespace, key) ? this.vault.seal(value, this.store.get(path)) : value
    this.store.set(path, stored)
  }

  delete(namespace: string, key: string): void {
    this.store.delete(this.path(namespace, key) as string)
  }

  all<T = Record<string, unknown>>(namespace: string): T {
    const value = this.store.get(namespace)
    if (value === undefined) return {} as T
    if (namespace === AI_NAMESPACE && isRecord(value) && AI_KEY in value) {
      return { ...value, [AI_KEY]: this.openAiRecord(value[AI_KEY]) } as T
    }
    return value as T
  }

  clearNamespace(namespace: string): void {
    this.store.delete(namespace as string)
  }

  get filePath(): string {
    return this.store.path
  }
}

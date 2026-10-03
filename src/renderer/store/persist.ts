import { hasBridge, bridge } from '@renderer/lib/ipc'
import { usePersistStatusStore } from './persistStatusStore'

/**
 * Persistence adapter used by the stores. In the Electron shell it routes to the
 * main-process electron-store via IPC. Outside Electron (unit tests, isolated
 * renderer) it falls back to localStorage, then to an in-memory Map — so the app
 * and its tests work everywhere. Layout/sync persistence tests exercise this.
 */

const mem = new Map<string, string>()

function ls(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Logs and tracks a corrupted persisted entry instead of failing silently. */
function reportCorruption(namespace: string, key: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[persist] Corrupted JSON for ${namespace}:${key} — ${message}`)
  usePersistStatusStore.getState().reportCorruption(namespace, key, message)
}

export const persist = {
  async get<T = unknown>(namespace: string, key: string): Promise<T | null> {
    if (hasBridge()) return bridge().store.get<T>(namespace, key)
    const raw = ls()?.getItem(`${namespace}:${key}`) ?? mem.get(`${namespace}:${key}`) ?? null
    if (raw == null) return null
    try {
      return JSON.parse(raw) as T
    } catch (e) {
      reportCorruption(namespace, key, e)
      return null
    }
  },

  async set(namespace: string, key: string, value: unknown): Promise<void> {
    if (hasBridge()) {
      await bridge().store.set(namespace, key, value)
      return
    }
    const raw = JSON.stringify(value)
    mem.set(`${namespace}:${key}`, raw)
    ls()?.setItem(`${namespace}:${key}`, raw)
  },

  async remove(namespace: string, key: string): Promise<void> {
    if (hasBridge()) {
      await bridge().store.delete(namespace, key)
      return
    }
    mem.delete(`${namespace}:${key}`)
    ls()?.removeItem(`${namespace}:${key}`)
  },

  async all<T = Record<string, unknown>>(namespace: string): Promise<T> {
    if (hasBridge()) return bridge().store.all<T>(namespace)
    // Fallback: reconstruct from prefixed keys.
    const out: Record<string, unknown> = {}
    const prefix = `${namespace}:`
    const store = ls()
    if (store) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i)
        if (k?.startsWith(prefix)) {
          try {
            out[k.slice(prefix.length)] = JSON.parse(store.getItem(k) as string)
          } catch (e) {
            reportCorruption(namespace, k.slice(prefix.length), e)
          }
        }
      }
    }
    for (const [k, v] of mem) {
      if (k.startsWith(prefix)) {
        try {
          out[k.slice(prefix.length)] = JSON.parse(v)
        } catch (e) {
          reportCorruption(namespace, k.slice(prefix.length), e)
        }
      }
    }
    return out as T
  },

  /**
   * In Electron the file is parsed in the main process, so a corrupt one never
   * reaches `get`/`all`; main sets it aside at launch and this surfaces that.
   * A failure here is logged, never thrown — it must not block app boot.
   */
  async checkRecovery(): Promise<void> {
    if (!hasBridge()) return
    try {
      const recovery = await bridge().store.recovery()
      if (recovery) usePersistStatusStore.getState().reportRecovery(recovery.backupPath)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[persist] Could not check for a recovered config file — ${message}`)
    }
  },

  /** Removes every entry currently flagged as corrupted and clears the warning. */
  async resetCorrupted(): Promise<void> {
    const corruptions = usePersistStatusStore.getState().corruptions
    await Promise.all(corruptions.map((c) => this.remove(c.namespace, c.key)))
    usePersistStatusStore.getState().clearAll()
  },

  /** Test-only: clear the in-memory fallback. */
  __resetMemory(): void {
    mem.clear()
  }
}

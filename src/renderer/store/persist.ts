import { hasBridge, bridge } from '@renderer/lib/ipc'

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

export const persist = {
  async get<T = unknown>(namespace: string, key: string): Promise<T | null> {
    if (hasBridge()) return bridge().store.get<T>(namespace, key)
    const raw = ls()?.getItem(`${namespace}:${key}`) ?? mem.get(`${namespace}:${key}`) ?? null
    if (raw == null) return null
    try {
      return JSON.parse(raw) as T
    } catch {
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
          } catch {
            /* skip */
          }
        }
      }
    }
    for (const [k, v] of mem) {
      if (k.startsWith(prefix)) {
        try {
          out[k.slice(prefix.length)] = JSON.parse(v)
        } catch {
          /* skip */
        }
      }
    }
    return out as T
  },

  /** Test-only: clear the in-memory fallback. */
  __resetMemory(): void {
    mem.clear()
  }
}

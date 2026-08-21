import Store from 'electron-store'

/**
 * PersistenceLayer — thin, namespaced wrapper over electron-store.
 *
 * Data is organized by namespace (settings, layouts, sync, favorites, alerts)
 * so the renderer can read/write coherent groups. electron-store is used for
 * MVP robustness (pure JSON, cross-platform, no native rebuild). The rest of
 * the app only sees this interface, so swapping in SQLite later is localized
 * to this file + the IPC handlers.
 */
export class PersistenceLayer {
  private store: Store<Record<string, unknown>>

  constructor() {
    this.store = new Store<Record<string, unknown>>({
      name: 'racedeck',
      // Schema-less on purpose; the renderer owns typed shapes. We keep a
      // version marker for future migrations.
      defaults: { __meta: { version: 1 } }
    })
  }

  private path(namespace: string, key: string): string {
    // nanoid/layout ids never contain '.', so dot-notation nesting is safe.
    return `${namespace}.${key}`
  }

  get<T = unknown>(namespace: string, key: string): T | null {
    const value = this.store.get(this.path(namespace, key))
    return (value === undefined ? null : (value as T))
  }

  set(namespace: string, key: string, value: unknown): void {
    this.store.set(this.path(namespace, key), value)
  }

  delete(namespace: string, key: string): void {
    this.store.delete(this.path(namespace, key) as string)
  }

  all<T = Record<string, unknown>>(namespace: string): T {
    const value = this.store.get(namespace)
    return (value === undefined ? ({} as T) : (value as T))
  }

  clearNamespace(namespace: string): void {
    this.store.delete(namespace as string)
  }

  get filePath(): string {
    return this.store.path
  }
}

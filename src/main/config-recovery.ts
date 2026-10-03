import { constants, copyFileSync, existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { StoreRecovery } from '@shared/ipc-contract'

/** electron-store needs a JSON object at the top level; anything else is unusable. */
function isJsonObject(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/** `racedeck.corrupt-<ts>.json`, with a numeric suffix if that name is taken. */
function freeBackupPath(filePath: string, stamp: number): string {
  const ext = extname(filePath)
  const stem = basename(filePath, ext)
  const base = join(dirname(filePath), `${stem}.corrupt-${stamp}`)
  let candidate = `${base}${ext}`
  for (let n = 1; existsSync(candidate); n++) candidate = `${base}-${n}${ext}`
  return candidate
}

/** The fs operations that can fail while setting a file aside; injectable so tests can fail them. */
export interface RecoveryFsOps {
  renameSync: (from: string, to: string) => void
  copyFileSync: (from: string, to: string, mode?: number) => void
}

const REAL_FS_OPS: RecoveryFsOps = { renameSync, copyFileSync }

/**
 * Sets aside an unreadable config file BEFORE electron-store opens it.
 *
 * `clearInvalidConfig` alone is not enough: on construction the store replaces a
 * corrupt file with fresh defaults, destroying the only copy of the user's
 * layouts, sync offsets and AI settings. Moving it aside first keeps that data
 * recoverable and gives the UI something concrete to point at.
 *
 * Returns null when there is nothing to recover: no file, an empty file, a
 * healthy file, or when the file could be neither renamed NOR copied aside (logged;
 * the store then resets it as before).
 *
 * A rename can fail when Windows antivirus or backup software holds the file open.
 * A copy usually still works then, so it is the fallback: the original stays in
 * place (the store resets it) but the user's data survives in the backup.
 */
export function backupIfCorrupt(
  filePath: string,
  now: () => number = Date.now,
  fs: RecoveryFsOps = REAL_FS_OPS
): StoreRecovery | null {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  if (raw.trim() === '' || isJsonObject(raw)) return null

  const backupPath = freeBackupPath(filePath, now())
  try {
    fs.renameSync(filePath, backupPath)
    return { backupPath }
  } catch (renameErr) {
    console.warn(
      `[persistence] Could not rename corrupt config ${filePath}; copying it aside instead:`,
      renameErr
    )
  }
  try {
    fs.copyFileSync(filePath, backupPath, constants.COPYFILE_EXCL)
    return { backupPath }
  } catch (copyErr) {
    // Never leave a truncated backup that could be mistaken for the real thing.
    if ((copyErr as NodeJS.ErrnoException).code !== 'EEXIST') {
      try {
        rmSync(backupPath, { force: true })
      } catch {
        /* best effort; the failure below is what matters */
      }
    }
    console.error(`[persistence] Could not set aside corrupt config ${filePath}:`, copyErr)
    return null
  }
}

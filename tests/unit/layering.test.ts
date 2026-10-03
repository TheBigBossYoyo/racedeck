// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Import-direction rules for the renderer core (IMPROVEMENT_OPPORTUNITIES.md item #7):
 *
 *   shared  <-  renderer/core/model  <-  engines, normalize  <-  providers  <-  stores/widgets
 *
 * Providers sit ABOVE the neutral model; engines depend only on the model (and on each
 * other). These tests read the source text (no bundler), so they see `import type` and
 * `export ... from` edges exactly like value imports, and both alias and relative paths.
 */

const REPO = resolve(__dirname, '..', '..')
const SRC = join(REPO, 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Repo-relative posix path, e.g. `src/renderer/core/engines/FuelModel.ts`. */
function repoPath(abs: string): string {
  return relative(REPO, abs).split(sep).join('/')
}

/** Every module specifier a file pulls in: import / export-from / bare import / import(). */
function extractSpecifiers(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  const staticRe = /(?:^|[\s;}])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const re of [staticRe, dynamicRe]) {
    for (let m = re.exec(text); m; m = re.exec(text)) found.push(m[1])
  }
  return found
}

/**
 * The repo-relative path a specifier points at (extension-less), or null for a bare
 * package name. Handles the `@renderer/`, `@shared/`, `@/` aliases and relative paths.
 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith('@renderer/')) return 'src/renderer/' + spec.slice('@renderer/'.length)
  if (spec.startsWith('@shared/')) return 'src/shared/' + spec.slice('@shared/'.length)
  if (spec.startsWith('@/')) return 'src/renderer/' + spec.slice(2)
  if (spec.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromFile), spec))
  return null
}

interface Edge {
  from: string
  to: string
  spec: string
}

const files = walk(SRC).map(repoPath)
const edges: Edge[] = []
for (const from of files) {
  const source = readFileSync(join(REPO, from), 'utf8')
  for (const spec of extractSpecifiers(source)) {
    const to = resolveSpecifier(from, spec)
    if (to) edges.push({ from, to, spec })
  }
}

const inDir = (path: string, dir: string): boolean => path === dir || path.startsWith(dir + '/')

/** Edges from a file matching `fromDir` to a target under any of `toDirs`. */
function violations(fromDir: string, toDirs: string[], allow: Allow[] = []): Edge[] {
  return edges.filter(
    (e) =>
      inDir(e.from, fromDir) &&
      toDirs.some((d) => inDir(e.to, d)) &&
      !allow.some((a) => a.from === e.from && inDir(e.to, a.to))
  )
}

function describeOffenders(rule: string, offenders: Edge[]): string {
  const lines = offenders.map((e) => `  ${e.from}  imports  '${e.spec}'`)
  return `${rule}\n${lines.join('\n')}`
}

interface Allow {
  from: string
  to: string
  /** Why this could not be removed. */
  reason: string
}

const ENGINES = 'src/renderer/core/engines'
const PROVIDERS = 'src/renderer/core/providers'
const MODEL = 'src/renderer/core/model'
const STORE = 'src/renderer/store'

// Provider -> store imports that could not be removed. Keep this list short and justified.
const PROVIDER_STORE_ALLOWLIST: Allow[] = [
  {
    from: 'src/renderer/core/providers/f1/persistTrackPathStorage.ts',
    to: 'src/renderer/store/persist',
    reason:
      'The persist-backed TrackPathCacheStorage. DataProviderManager injects it, and it is the ' +
      "F1LiveProvider constructor's default so a bare `new F1LiveProvider()` (used by many " +
      'tests that mock persist) keeps caching. Remove with the default once callers inject.'
  }
]

describe('layering: import direction', () => {
  it('scans a non-trivial source tree (guards against a vacuous pass)', () => {
    expect(files.filter((f) => inDir(f, ENGINES)).length).toBeGreaterThan(20)
    expect(files.filter((f) => inDir(f, PROVIDERS)).length).toBeGreaterThan(20)
    expect(files.filter((f) => inDir(f, MODEL)).length).toBeGreaterThan(0)
    expect(files.filter((f) => inDir(f, 'src/shared')).length).toBeGreaterThan(0)
    expect(edges.length).toBeGreaterThan(500)
  })

  it('(a) engines never import from the provider layer', () => {
    const offenders = violations(ENGINES, [PROVIDERS])
    expect(
      offenders,
      describeOffenders(
        'Engines must depend on the neutral model (@renderer/core/model/*) or ' +
          '@renderer/core/normalize/*, never on providers:',
        offenders
      )
    ).toEqual([])
  })

  it('(b) providers never import a store (except the allowlisted adapter)', () => {
    const offenders = violations(PROVIDERS, [STORE], PROVIDER_STORE_ALLOWLIST)
    expect(
      offenders,
      describeOffenders(
        'Providers must take persistence through an injected interface, not import a store:',
        offenders
      )
    ).toEqual([])
  })

  it('(b) every provider->store allowlist entry is still needed', () => {
    const stale = PROVIDER_STORE_ALLOWLIST.filter(
      (a) => !edges.some((e) => e.from === a.from && inDir(e.to, a.to))
    )
    expect(
      stale.map((a) => a.from),
      'Remove these allowlist entries: the import they excused is gone.'
    ).toEqual([])
  })

  it('(c) the neutral model imports nothing from providers, engines, stores or components', () => {
    const offenders = violations(MODEL, [
      PROVIDERS,
      ENGINES,
      STORE,
      'src/renderer/components',
      'src/renderer/widgets',
      'src/renderer/core/DataProviderManager'
    ])
    expect(
      offenders,
      describeOffenders(
        'core/model may depend only on @shared and itself:',
        offenders
      )
    ).toEqual([])
  })

  it('(d) src/shared imports nothing from src/renderer or src/main', () => {
    const offenders = violations('src/shared', ['src/renderer', 'src/main'])
    expect(
      offenders,
      describeOffenders('src/shared is the process-neutral contract layer:', offenders)
    ).toEqual([])
  })

  it('(e) src/renderer imports nothing from src/main', () => {
    const offenders = violations('src/renderer', ['src/main'])
    expect(
      offenders,
      describeOffenders(
        'The renderer talks to the main process only through the preload bridge / @shared:',
        offenders
      )
    ).toEqual([])
  })
})

describe('layering: specifier parsing', () => {
  it('sees value, type-only, re-export, bare and dynamic imports across lines', () => {
    const source = [
      "import { a } from '@renderer/core/providers/types'",
      "import type { B } from '../providers/types'",
      'import {',
      '  c,',
      '  type D',
      "} from '@renderer/store/persist'",
      "export { e } from './x'",
      "export type { F } from '@shared/models'",
      "export * from '../../store/foo'",
      "import '@shared/side-effect'",
      "const lazy = () => import('@renderer/store/lazy')",
      "// import { ignored } from '@renderer/store/comment'",
      "/* import { alsoIgnored } from '@renderer/store/block' */"
    ].join('\n')
    expect(extractSpecifiers(source)).toEqual([
      '@renderer/core/providers/types',
      '../providers/types',
      '@renderer/store/persist',
      './x',
      '@shared/models',
      '../../store/foo',
      '@shared/side-effect',
      '@renderer/store/lazy'
    ])
  })

  it('resolves aliases and relative paths to repo paths', () => {
    const from = 'src/renderer/core/engines/FuelModel.ts'
    expect(resolveSpecifier(from, '@renderer/core/providers/types')).toBe(
      'src/renderer/core/providers/types'
    )
    expect(resolveSpecifier(from, '../providers/types')).toBe('src/renderer/core/providers/types')
    expect(resolveSpecifier(from, '@/store/persist')).toBe('src/renderer/store/persist')
    expect(resolveSpecifier(from, '@shared/models')).toBe('src/shared/models')
    expect(resolveSpecifier(from, '../../../main/index')).toBe('src/main/index')
    expect(resolveSpecifier(from, 'react')).toBeNull()
  })
})

// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve('src/renderer/styles/globals.css'), 'utf8')
const rule = css.match(/:where\(([^)]*\)?[^)]*)\):focus-visible\s*\{([^}]*)\}/s)

describe('global :focus-visible rule', () => {
  it('exists and draws a visible outline', () => {
    expect(rule).not.toBeNull()
    expect(rule?.[2]).toMatch(/outline:\s*2px solid/)
  })

  it('is wrapped in :where() so component rings stay at least as specific', () => {
    expect(css).toMatch(/:where\([^{]*\):focus-visible\s*\{/)
  })

  it('skips tabindex="-1" elements, which are focused from code rather than by tabbing', () => {
    expect(rule?.[1]).toContain(":not([tabindex='-1'])")
  })
})

describe('global :focus-visible rule cascade placement', () => {
  /** Names of the at-rule blocks enclosing `index` (outermost first). */
  function enclosingAtRules(index: number): string[] {
    const stack: string[] = []
    let start = 0
    for (let i = 0; i < index; i++) {
      if (css[i] === '{') {
        stack.push(css.slice(start, i).trim())
        start = i + 1
      } else if (css[i] === '}') {
        stack.pop()
        start = i + 1
      } else if (css[i] === ';') {
        start = i + 1
      }
    }
    return stack
  }

  it('lives inside @layer base so unlayered/utility outline-none classes are not beaten by it', () => {
    const at = css.search(/:where\([^{]*\):focus-visible\s*\{/)
    expect(at).toBeGreaterThan(-1)
    expect(enclosingAtRules(at)).toEqual(['@layer base'])
  })

  it('does not claim to be an unlayered rule in its comment', () => {
    expect(css).toMatch(/@layer base[^]*Keyboard-only focus ring/)
  })
})

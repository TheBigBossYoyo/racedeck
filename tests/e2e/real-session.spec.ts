import { test, expect, _electron as electron } from '@playwright/test'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const electronExecutable = createRequire(__filename)('electron') as string

test('loads a real official F1 session without freezing or closing', async () => {
  test.skip(process.env.RACEDECK_REAL_SESSION_QA !== '1', 'Opt-in network/load regression')
  test.setTimeout(480_000)

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [join(process.cwd(), 'out', 'main', 'index.js')]
  })
  try {
    await app.firstWindow()
    const window = app.windows().find((page) => /(?:out\/renderer|localhost)/i.test(page.url())) ?? app.windows()[0]
    if (!window) throw new Error('RaceDeck renderer window did not open.')
    const errors: string[] = []
    window.on('pageerror', (error) => errors.push(error.message))

    await window.waitForSelector('#root')
    // Dismiss the first-run welcome tour if it appears.
    await window
      .getByRole('dialog', { name: 'Welcome to RaceDeck' })
      .getByLabel('Close tour')
      .click({ timeout: 6_000 })
      .catch(() => undefined)
    await window.getByRole('button', { name: /RaceDeck Demo Grand Prix|Select session/i }).click()
    await window.getByRole('button', { name: 'F1', exact: true }).click()
    const latest = window.getByText('Latest available', { exact: true }).first()
    await expect(latest).toBeVisible({ timeout: 45_000 })

    const sessionButton = latest.locator('xpath=ancestor::button[1]')
    const started = Date.now()
    await sessionButton.click()
    await expect(window.getByText('Preparing session…', { exact: true })).toBeVisible({ timeout: 5_000 })
    await expect(window.getByText('Preparing session…', { exact: true })).toBeHidden({ timeout: 210_000 })

    await expect(window.getByText('Timing Tower', { exact: false }).first()).toBeVisible()
    await expect(window.getByText('No timing data', { exact: true })).toBeHidden()
    await expect(window.getByRole('button', { name: /^Focus / }).first()).toBeVisible()
    const coreLoadMs = Date.now() - started
    console.log(`[real-session] core timing ready in ${coreLoadMs}ms`)

    await expect(window.getByText('Live positions', { exact: true })).toBeVisible({ timeout: 180_000 })
    await expect(window.locator('svg g[role="button"][aria-label*="position "]').first()).toBeVisible()
    const mapLoadMs = Date.now() - started
    console.log(`[real-session] track map ready in ${mapLoadMs}ms`)

    const telemetryDot = window.getByText('TELEM', { exact: true }).locator('xpath=preceding-sibling::span[1]')
    // Fine-grained polling: at 1s intervals the poll itself inflated the
    // measured milestone by up to a second.
    await expect.poll(
      async () => (await telemetryDot.getAttribute('class')) ?? '',
      { timeout: 240_000, intervals: [250, 500, 1_000] }
    ).toContain('bg-good')
    console.log(`[real-session] high-rate enrichment ready in ${Date.now() - started}ms`)

    await window.getByRole('button', { name: /^Focus / }).first().click()
    await window.keyboard.press('2')
    const telemetryPanel = window
      .getByText('Telemetry', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"glass")][1]')
    await expect(telemetryPanel.getByText('No traces', { exact: true })).toBeHidden({ timeout: 15_000 })
    await expect(telemetryPanel.locator('canvas').first()).toBeVisible()

    expect(errors).toEqual([])
    // Absolute download time varies with the public CDN/network. These generous
    // ceilings still catch hangs; the relative gate proves map staging itself.
    expect(coreLoadMs).toBeLessThan(120_000)
    expect(mapLoadMs).toBeLessThan(180_000)
    expect(mapLoadMs - coreLoadMs).toBeLessThan(90_000)
  } finally {
    await app.close()
  }
})

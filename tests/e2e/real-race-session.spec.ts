import { test, expect, _electron as electron } from '@playwright/test'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const electronExecutable = createRequire(__filename)('electron') as string

/**
 * APP_IMPROVEMENT_ROADMAP.md P0 item 3: "Add real-race UI regression scenarios,
 * not qualifying-only archive QA". `real-session.spec.ts` always picks "Latest
 * available", which is frequently qualifying or practice — this spec explicitly
 * selects a session badged "Race" instead, so pit-cycle, stop-rule, traffic-
 * suppression and battery-estimate logic (which only meaningfully exercises
 * during a race) gets a real end-to-end pass.
 *
 * Real session content is unpredictable at write-time (we don't know which
 * driver is in traffic, who has a penalty, etc. on the next run), so assertions
 * are structural: every surface must reach one of its well-defined, honestly-
 * labelled states — never a blank, broken or misleadingly bare reading.
 */
test('loads a real Race session and exercises race-only strategy/provenance surfaces', async () => {
  test.skip(process.env.RACEDECK_REAL_SESSION_QA !== '1', 'Opt-in network/load regression')
  test.setTimeout(480_000)

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: [join(process.cwd(), 'out', 'main', 'index.js')]
  })
  try {
    await app.firstWindow()
    const window =
      app.windows().find((page) => /(?:out\/renderer|localhost)/i.test(page.url())) ??
      app.windows()[0]
    if (!window) throw new Error('RaceDeck renderer window did not open.')
    const errors: string[] = []
    window.on('pageerror', (error) => errors.push(error.message))

    await window.waitForSelector('#root')
    await window
      .getByRole('dialog', { name: 'Welcome to RaceDeck' })
      .getByLabel('Close tour')
      .click({ timeout: 6_000 })
      .catch(() => undefined)
    await window.getByRole('button', { name: /RaceDeck Demo Grand Prix|Select session/i }).click()
    await window.getByRole('button', { name: 'F1', exact: true }).click()

    // Deliberately NOT "Latest available" — that badge only marks the newest
    // session regardless of type, which is often qualifying or practice.
    const raceBadge = window.getByText('Race', { exact: true }).first()
    await expect(raceBadge).toBeVisible({ timeout: 45_000 })
    const sessionButton = raceBadge.locator('xpath=ancestor::button[1]')
    await sessionButton.click()
    await expect(window.getByText('Preparing session…', { exact: true })).toBeVisible({
      timeout: 5_000
    })
    await expect(window.getByText('Preparing session…', { exact: true })).toBeHidden({
      timeout: 210_000
    })

    await expect(window.getByText('Timing Tower', { exact: false }).first()).toBeVisible()
    await expect(window.getByText('No timing data', { exact: true })).toBeHidden()
    const focusButton = window.getByRole('button', { name: /^Focus / }).first()
    await expect(focusButton).toBeVisible()

    // Strategy Wall (shortcut 3) brings Driver Dossier, Pit-Now Simulator and
    // Stint Planner into view together for one focused driver.
    await focusButton.click()
    await window.keyboard.press('3')

    const dossierPanel = window
      .getByText('Driver Dossier', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"glass")][1]')
    await expect(dossierPanel).toBeVisible({ timeout: 15_000 })

    // Tyre read: whatever the real state is, it must land on one of the
    // documented condition labels or blocker explanations — never a blank or
    // fabricated wear trend (the roadmap's "traffic suppresses false
    // degradation" concern, checked structurally rather than for one specific
    // driver/lap that would make this test flaky run to run).
    await expect(
      dossierPanel.getByText(
        /Fresh|Holding on|Working|Dropping off|Held up within a second|Not enough clean laps/
      )
    ).toBeVisible({ timeout: 30_000 })

    // Battery: always an honest provenance marker, never a bare percentage.
    await expect(dossierPanel.getByText(/est\.|Battery unavailable/)).toBeVisible({
      timeout: 30_000
    })

    // Pit-Now Simulator: a verdict from the fixed, documented set.
    const pitNowPanel = window
      .getByText('Pit-Now Simulator', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"glass")][1]')
    await expect(pitNowPanel).toBeVisible()
    await expect(
      pitNowPanel.getByText(/BOX NOW|UNDERCUT NOW|BOX SOON|PREPARE|STAY OUT/)
    ).toBeVisible({ timeout: 30_000 })

    // Stint Planner: reaches a determinate stop-rule read (satisfied, or a
    // stated number of stops still required) rather than staying stuck
    // "Building the pit window" — the roadmap's "pending stop debt" surface.
    const stintPlannerPanel = window
      .getByText('Stint Planner', { exact: true })
      .locator('xpath=ancestor::div[contains(@class,"glass")][1]')
    await expect(stintPlannerPanel).toBeVisible()
    await expect(
      stintPlannerPanel.getByText(/stop rule satisfied|stops? still required/)
    ).toBeVisible({ timeout: 90_000 })

    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

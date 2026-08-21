import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const electronExecutable = createRequire(__filename)('electron') as string

/**
 * End-to-end smoke test. Requires a production build first:
 *   npm run build && npm run test:e2e
 *
 * It launches the packaged main entry, verifies the shell renders, and switches
 * a layout — without ever touching the TOD / DRM surface.
 */
let app: ElectronApplication
let mainWindow: Page

test.beforeAll(async () => {
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [join(process.cwd(), 'out', 'main', 'index.js')]
  })
  await app.firstWindow()
  await new Promise((resolve) => setTimeout(resolve, 500))
  mainWindow = app.windows().find((page) => /(?:out\/renderer|localhost)/i.test(page.url())) ?? app.windows()[0]
  if (!mainWindow) throw new Error('RaceDeck renderer window did not open.')
  mainWindow.on('pageerror', (error) => console.error('[renderer pageerror]', error.message))
  mainWindow.on('console', (message) => {
    if (message.type() === 'error') console.error('[renderer console]', message.text())
  })
  await mainWindow.waitForSelector('#root')
  // Dismiss the first-run welcome tour if it appears (it's shown once per device).
  await mainWindow
    .getByRole('dialog', { name: 'Welcome to RaceDeck' })
    .getByLabel('Close tour')
    .click({ timeout: 6_000 })
    .catch(() => undefined)
})

test.afterAll(async () => {
  await app?.close()
})

test('boots and renders the RaceDeck shell', async () => {
  const window = mainWindow
  await expect(window.locator('#root')).toBeVisible()
  // Brand wordmark ("Race" + "Deck") — .first() because the wordmark text can
  // also appear in body copy (strict-mode safety).
  await expect(window.getByText('Deck', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
})

test('loads the demo session into the timing tower', async () => {
  const window = mainWindow
  await window.waitForTimeout(1_000)
  await window.keyboard.press('1')
  await expect(window.getByTitle('Reset layout to preset')).toBeVisible()
  await window.getByTitle('Reset layout to preset').click()
  // The demo provider lands mid-race, so the timing tower header should appear.
  await expect(window.getByText('Timing Tower', { exact: false }).first()).toBeVisible({
    timeout: 20_000
  })
  // And the demo session should surface driver codes (VER leads the sim).
  await expect(window.getByText('VER', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
})

test('shows readable battery mode, tyre age and one credible fastest lap in Broadcast + Data', async () => {
  const window = mainWindow
  await window.keyboard.press('1')
  await window.getByTitle('Reset layout to preset').click()
  const timingTitle = window.getByText('Timing Tower', { exact: true })
  const timingWidget = timingTitle.locator('xpath=ancestor::div[contains(@class,"glass")][1]')

  const batteryCells = timingWidget.locator('[title^="Battery"]')
  await expect(batteryCells.first()).toBeVisible()
  expect(await batteryCells.count()).toBeGreaterThan(0)

  const tyreAges = timingWidget.locator('[title$="laps on this tyre"]')
  await expect(tyreAges.first()).toBeVisible()
  await expect(tyreAges.first()).toHaveText(/^L\d+$/)

  await expect(timingWidget.getByText('FL', { exact: true })).toHaveCount(1)
  const firstRow = timingWidget.getByRole('button').filter({ hasText: 'VER' }).first()
  expect(await firstRow.evaluate((row) => row.scrollWidth <= row.clientWidth + 1)).toBe(true)

  const focusButton = timingWidget.getByRole('button', { name: 'Focus VER' })
  await focusButton.focus()
  await expect(focusButton).toBeFocused()
  await window.keyboard.press('Enter')
  const favoriteButton = timingWidget.getByRole('button', {
    name: /^(?:Add VER to|Remove VER from) favorites$/
  })
  const favoriteLabelBefore = await favoriteButton.getAttribute('aria-label')
  await favoriteButton.focus()
  await expect(favoriteButton).toBeFocused()
  await window.keyboard.press('Enter')
  await expect(favoriteButton).not.toHaveAttribute('aria-label', favoriteLabelBefore ?? '')
})

test('aligns dashboard data directly from the race-start sync wizard', async () => {
  const window = mainWindow
  await window.keyboard.press('1')
  await window.getByTitle('Reset layout to preset').click()
  const syncTitle = window.getByText('Sync Controller', { exact: true })
  await syncTitle.scrollIntoViewIfNeeded()
  const syncWidget = syncTitle.locator('xpath=ancestor::div[contains(@class,"glass")][1]')

  await syncWidget.getByRole('button', { name: '+1s' }).click()
  await expect(syncWidget.getByTestId('sync-data-shift')).toHaveText('+1.0s')

  await syncWidget.getByRole('button', { name: 'Start', exact: true }).click()
  await syncWidget.getByTestId('sync-mark-event').click()

  await expect(syncWidget.getByTestId('sync-data-shift')).toHaveText('+0.0s')
  await expect(window.getByTitle('Pause')).toBeVisible()
  await expect
    .poll(async () => {
      const text = await window.getByTestId('effective-data-time').textContent()
      const [minutes, seconds] = (text ?? '').split(':').map(Number)
      return minutes * 60 + seconds
    })
    .toBeLessThan(60)
})

test('renders a coherent Strategy Wall and stays conservative at race start', async () => {
  const window = mainWindow
  await window.keyboard.press('3')
  await window.getByTitle('Reset layout to preset').click()
  await window.waitForTimeout(500)

  for (const title of ['Timing Tower', 'Driver Dossier', 'Pit-Now Simulator', 'Strategy Insights']) {
    await expect(window.getByText(title, { exact: true })).toBeVisible()
  }

  const dossierTitle = window.getByText('Driver Dossier', { exact: true })
  const dossierWidget = dossierTitle.locator('xpath=ancestor::div[contains(@class,"glass")][1]')
  const dossierPia = dossierWidget.getByRole('button').filter({ hasText: 'PIA' }).first()
  await dossierPia.click()
  await expect(dossierPia).toHaveAttribute('aria-pressed', 'true')
  const pitTitleForFocus = window.getByText('Pit-Now Simulator', { exact: true })
  const pitWidgetForFocus = pitTitleForFocus.locator('xpath=ancestor::div[contains(@class,"glass")][1]')
  await expect(pitWidgetForFocus.getByRole('button').filter({ hasText: 'PIA' }).first()).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  const timingTitleForFocus = window.getByText('Timing Tower', { exact: true })
  const timingWidgetForFocus = timingTitleForFocus.locator('xpath=ancestor::div[contains(@class,"glass")][1]')
  await timingWidgetForFocus.getByRole('button').filter({ hasText: 'NOR' }).first().click()
  await expect(pitWidgetForFocus.getByRole('button').filter({ hasText: 'NOR' }).first()).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  const items = window.locator('.react-grid-item')
  await expect(items).toHaveCount(10)
  const boxes = await items.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        title: element.querySelector('header')?.textContent?.trim() ?? 'unknown widget',
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      }
    })
  )
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const overlapWidth = Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left)
      const overlapHeight = Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top)
      expect(overlapWidth > 1 && overlapHeight > 1, `${boxes[a].title} overlaps ${boxes[b].title}`).toBe(false)
    }
  }

  const winTitle = window.getByText('Win Probability', { exact: true })
  await winTitle.scrollIntoViewIfNeeded()
  const winWidget = winTitle.locator('xpath=ancestor::div[contains(@class,"glass")][1]')
  await expect(winWidget.getByText(/(LOW|MEDIUM|HIGH) · \d+%/)).toBeVisible()

  const transport = window.getByRole('slider').first()
  await transport.press('Home')
  const pitTitle = window.getByText('Pit-Now Simulator', { exact: true })
  await pitTitle.scrollIntoViewIfNeeded()
  const pitWidget = pitTitle.locator('xpath=ancestor::div[contains(@class,"glass")][1]')
  await expect(pitWidget.getByText('STAY OUT', { exact: true })).toBeVisible({ timeout: 10_000 })

  const plannerTitle = window.getByText('Stint Planner', { exact: true })
  await plannerTitle.scrollIntoViewIfNeeded()
  const plannerWidget = plannerTitle.locator('xpath=ancestor::div[contains(@class,"glass")][1]')
  await expect(plannerWidget.getByText('Building the pit window', { exact: true })).toBeVisible()
})

test('opens the Practice Lab and keeps upgrades at the bottom of Qualifying Pro', async () => {
  const window = mainWindow
  await window.keyboard.press('5')
  await window.getByTitle('Reset layout to preset').click()
  await expect(window.getByText('Practice Run Board', { exact: true })).toBeVisible()
  await expect(window.getByText('Practice Driver Watch', { exact: true })).toBeVisible()
  await expect(window.getByText('Weekend Upgrades', { exact: true })).toBeVisible()
  await expect(window.locator('.react-grid-item')).toHaveCount(11)

  await window.keyboard.press('4')
  await window.getByTitle('Reset layout to preset').click()
  const upgrades = window.getByText('Weekend Upgrades', { exact: true })
  await upgrades.scrollIntoViewIfNeeded()
  await expect(upgrades).toBeVisible()
  const upgradeItem = upgrades.locator('xpath=ancestor::div[contains(@class,"react-grid-item")][1]')
  const otherItems = window.locator('.react-grid-item').filter({ hasNot: upgrades })
  const upgradeTop = (await upgradeItem.boundingBox())?.y ?? 0
  const otherBottoms = await otherItems.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().bottom)
  )
  expect(upgradeTop).toBeGreaterThanOrEqual(Math.max(...otherBottoms) - 1)
})

test('loads closed-market replay history through the real Electron IPC', async () => {
  const window = mainWindow
  const targetDateMs = Date.parse('2025-07-06T14:00:00Z')
  const result = await window.evaluate(async ({ targetDateMs }) => {
    const winner = await window.racedeck.market.winner({
      query: 'British Grand Prix',
      targetDateMs
    })
    const token = winner.outcomes.find((outcome) => outcome.yesTokenId)?.yesTokenId
    if (!winner.ok || !token) return { winner, history: null }
    const targetUnix = Math.trunc(targetDateMs / 1000)
    const history = await window.racedeck.market.history({
      yesTokenId: token,
      startTs: targetUnix - 7 * 24 * 60 * 60,
      endTs: targetUnix + 24 * 60 * 60,
      fidelity: 30
    })
    return { winner, history }
  }, { targetDateMs })

  expect(result.winner.ok, result.winner.error ?? 'Winner market lookup failed').toBe(true)
  expect(result.winner.event?.closed).toBe(true)
  expect(result.history?.ok, result.history?.error ?? 'Replay history request failed').toBe(true)
  expect(result.history?.points.length).toBeGreaterThan(0)
})

test('parses official FIA weekend upgrades through the public practice IPC', async () => {
  const window = mainWindow
  const result = await window.evaluate(() => window.racedeck.practice.briefing({
    year: 2025,
    meetingName: 'British Grand Prix',
    countryName: 'Great Britain',
    dateStart: '2025-07-04T11:30:00Z',
    drivers: []
  }))
  expect(result.ok, result.error ?? 'Practice briefing failed').toBe(true)
  expect(result.upgradeDocumentUrl).toContain('api.fia.com')
  expect(result.upgrades.length).toBeGreaterThanOrEqual(8)
  expect(result.upgrades.some((upgrade) => upgrade.components.length > 0)).toBe(true)
  expect(result.upgrades.some((upgrade) => upgrade.noUpdates)).toBe(true)
})

test('starts TOD in embedded mode when Widevine is ready', async () => {
  const window = mainWindow
  await expect
    .poll(
      () => window.evaluate(async () => (await window.racedeck.video.getState()).mode),
      { timeout: 20_000 }
    )
    .toBe('embedded')
})

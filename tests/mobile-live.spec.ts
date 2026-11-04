import { expect, test, type Locator, type Page } from '@playwright/test'
import { LIVE_POLICY_VERSION, applicableRules } from '../shared/reviewPolicy.mjs'
import { sourceFingerprint } from '../shared/aiSnapshot.mjs'

test.use({ browserName: 'webkit' })

// Local deterministic responses only: these layout checks never call a paid model.
async function mockReview(page: Page) {
  await page.route('**/v1/ai/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 })
    if (path === '/v1/ai/health') return route.fulfill({ json: {
      available: true, imageEditingAvailable: false, budgetAvailable: true,
      reviewModel: 'mock-claude', imageModel: 'mock-openai',
    } })
    expect(path).toBe('/v1/ai/reviews')
    const body = request.postDataJSON()
    const checks = applicableRules(body.scope).map(rule => ({
      id: rule.id, label: rule.label, category: rule.category,
      applicability: rule.applicability,
      status: rule.applicability === 'not-applicable' ? 'not-applicable' : 'pass',
      evidence: `${rule.label}: deterministic browser fixture.`,
      rationale: 'Local layout test response.', sources: [],
    }))
    return route.fulfill({ status: 201, json: {
      id: body.requestId, policyVersion: LIVE_POLICY_VERSION, model: 'mock-claude',
      submissionId: body.submissionId, versionId: body.versionId,
      sourceFingerprint: sourceFingerprint(body), sourceImageHash: 'mock-image',
      checkedAt: new Date().toISOString(), summary: 'All applicable fixture checks passed.',
      assetRelevant: true, checks, suggestedCopy: null,
      canApprove: true, canSuggestFix: false, canCreateConcept: false,
    } })
  })
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  const dialog = page.getByRole('dialog')
  if (await dialog.count()) {
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  }
}

async function touchTarget(control: Locator) {
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.width).toBeGreaterThanOrEqual(44)
}

for (const width of [1440, 390, 375, 320]) {
  const phone = width < 600
  test.describe(`WebKit ${width}px`, () => {
    test.use({ viewport: { width, height: phone ? 844 : 1000 }, isMobile: phone, hasTouch: phone })

    test('role selection, review, full-size asset, and upload remain usable', async ({ page, browser }, testInfo) => {
      expect(browser.browserType().name()).toBe('webkit')
      await mockReview(page)
      await page.goto('./')
      await expect(page.getByLabel('Viewing as')).toHaveCount(0)
      await page.getByRole('button', { name: 'All submissions', exact: true }).click()
      await page.getByRole('button', { name: /Everyday, a little more rewarding CP-1040/ }).click()
      const label = page.locator('.persona-switcher label > span')
      expect(await label.evaluate(element => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return range.getClientRects().length
      })).toBe(1)
      await expect(page.getByLabel('Viewing as')).toHaveValue('Alex Morgan')
      if (phone) await touchTarget(page.getByLabel('Viewing as'))
      await noHorizontalOverflow(page)
      await page.screenshot({ path: testInfo.outputPath('review-layout.png'), fullPage: true })

      const fullSize = page.getByRole('button', { name: 'Full size', exact: true })
      if (phone) await touchTarget(fullSize)
      await fullSize.focus()
      await fullSize.press('Enter')
      await expect(page.getByRole('dialog', { name: 'Asset CP-1040 · v1' })).toBeVisible()
      await noHorizontalOverflow(page)
      if (phone) await touchTarget(page.getByRole('button', { name: 'Close dialog', exact: true }))
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
      await expect(fullSize).toBeFocused()

      const run = page.getByRole('button', { name: 'Run AI review', exact: true })
      if (phone) await touchTarget(run)
      await run.click()
      await expect(page.getByRole('heading', { name: 'All applicable checks passed', exact: true })).toBeVisible()
      if (phone) await touchTarget(page.getByRole('button', { name: 'Approve v1', exact: true }))
      await page.locator('.lr-checks summary').first().click()
      await expect(page.locator('.lr-check-body').first()).toContainText('deterministic browser fixture')
      await noHorizontalOverflow(page)

      await page.getByLabel('Viewing as').selectOption('Maya Chen')
      await expect(page.getByRole('heading', { name: 'Your creative submissions', exact: true })).toBeVisible()
      await expect(label).toHaveCSS('white-space', 'nowrap')
      if (phone) await touchTarget(page.getByLabel('Viewing as'))
      await noHorizontalOverflow(page)
      await page.getByRole('button', { name: 'New submission', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'New submission', exact: true })
      await dialog.getByLabel('Creative image (optional)').setInputFiles('tests/fixtures/02-personal-loan-needs-copy-fix.png')
      await expect(dialog.getByAltText('Selected creative preview')).toBeVisible()
      await dialog.getByLabel('Campaign name').fill(`Phone review ${width}`)
      await dialog.getByLabel('Jurisdiction').selectOption('Other US jurisdiction')
      if (phone) {
        for (const control of await dialog.getByRole('combobox').all()) await touchTarget(control)
        await touchTarget(dialog.getByRole('button', { name: 'Submit for review', exact: true }))
      }
      await noHorizontalOverflow(page)
      await dialog.getByRole('button', { name: 'Submit for review', exact: true }).click()
      const card = page.getByRole('article', { name: new RegExp(`Phone review ${width}`) })
      await expect(card).toBeVisible()
      const switchToReviewer = card.getByRole('button', { name: 'Switch to reviewer', exact: true })
      if (phone) await touchTarget(switchToReviewer)
      await noHorizontalOverflow(page)
      await switchToReviewer.click()
      await expect(page.getByLabel('Viewing as')).toHaveValue('Alex Morgan')
      await expect(page.getByRole('heading', { name: 'Ready for AI review', exact: true })).toBeVisible()
      await noHorizontalOverflow(page)
    })
  })
}

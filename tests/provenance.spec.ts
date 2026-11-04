import { expect, test } from '@playwright/test'
import { applicableRules, LIVE_POLICY_VERSION } from '../shared/reviewPolicy.mjs'
import { sourceFingerprint } from '../shared/aiSnapshot.mjs'
import { createHash } from 'node:crypto'

for (const width of [390, 1440]) {
  test(`numbered image evidence stays on the reviewed pixels at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/v1/ai/reviews', async route => {
      const body = route.request().postDataJSON()
      await route.fulfill({ status: 201, json: {
        id: body.requestId, policyVersion: LIVE_POLICY_VERSION, model: 'test-model', submissionId: body.submissionId,
        versionId: body.versionId, sourceFingerprint: sourceFingerprint(body), sourceImageHash: createHash('sha256').update(Buffer.from(body.assetImage.split(',')[1], 'base64')).digest('hex'), checkedAt: new Date().toISOString(),
        summary: 'Replace the visible guarantee.', assetRelevant: true, canApprove: false, canSuggestFix: true, canCreateConcept: false, suggestedCopy: null,
        checks: applicableRules(body.scope).map(rule => ({ ...rule,
          status: rule.id === 'misleading-claim' ? 'fail' : rule.applicability === 'not-applicable' ? 'not-applicable' : 'pass',
          evidence: rule.id === 'misleading-claim' ? 'Guaranteed approval appears in the headline.' : 'Visible fixture evidence.', rationale: 'Fixture only.',
          regions: rule.id === 'misleading-claim' ? [{ quote: 'Guaranteed approval', x: .1, y: .4, width: .8, height: .1 }] : [],
        })),
      } })
    })
    await page.goto('./?workspace')
    await page.getByRole('button', { name: 'New submission', exact: true }).click()
    const dialog = page.getByRole('dialog')
    if (width === 390) {
      await dialog.getByLabel('Creative image (optional)').setInputFiles('tests/fixtures/02-personal-loan-needs-copy-fix.png')
      await expect(dialog.getByAltText('Selected creative preview')).toBeVisible()
    } else {
      await dialog.getByLabel('Creative copy', { exact: true }).fill('Guaranteed approval\n\nExplore a personal loan with ClearPath.\n\nSubject to credit approval. Rates and terms depend on your credit profile.\n\nExplore options')
    }
    await dialog.getByLabel('Campaign name').fill('Provenance regression')
    await dialog.getByLabel('Jurisdiction').selectOption('Other US jurisdiction')
    await dialog.getByRole('button', { name: 'Submit for review', exact: true }).click()
    await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
    const image = page.locator('.lr-asset-stage .lr-evidence-image')
    const region = image.locator('.lr-evidence-region')
    await expect(region).toBeVisible()
    const bounds = await image.boundingBox(); const rect = await region.boundingBox()
    expect(Math.abs(rect!.x - bounds!.x - bounds!.width * .1)).toBeLessThan(1)
    expect(Math.abs(rect!.y - bounds!.y - bounds!.height * .4)).toBeLessThan(1)
    expect(Math.abs(rect!.width - bounds!.width * .8)).toBeLessThan(1)
    await page.getByLabel('Show text locations').uncheck()
    await expect(region).toHaveCount(0)
    await page.getByRole('button', { name: '1 Locate “Guaranteed approval”' }).click()
    await expect(page.getByRole('dialog').locator('.lr-evidence-region.active')).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('button', { name: '1 Guaranteed approval' })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    if (width === 1440) {
      const reviewedRaster = await image.locator('img').getAttribute('src')
      await page.setViewportSize({ width: 390, height: 900 })
      await page.reload()
      await page.getByText('Provenance regression', { exact: true }).click()
      await expect(image.locator('img')).toHaveAttribute('src', reviewedRaster!)
      await expect(region).toBeVisible()
      await page.route('**/v1/ai/edits', async route => {
        expect(route.request().postDataJSON().assetImage).toBe(reviewedRaster)
        await route.fulfill({ status: 503, json: { error: 'Stopped after verifying the exact source pixels.', code: 'test_boundary' } })
      })
      await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Stopped after verifying the exact source pixels.')
    }
    await page.getByText(width === 390 ? 'Edit supplied text and intended use' : 'Edit creative copy and intended use', { exact: true }).click()
    await page.getByRole('textbox', { name: width === 390 ? 'Supplied text' : 'Creative copy', exact: true }).fill('Changed text needs a fresh review')
    await expect(page.locator('.lr-evidence-region')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('developer usage is collapsed and fetched only on request, with estimates separate from reservations', async ({ page }) => {
  let calls = 0
  await page.route('**/v1/ai/usage', route => {
    calls++
    return route.fulfill({ json: { scope: 'demo-only', currency: 'USD', estimatedUsd: .1432, trackedCalls: 3, untrackedCalls: 7, totalCalls: 10,
      providers: [{ provider: 'Anthropic', model: 'test-model', estimatedUsd: .1432, trackedCalls: 3, untrackedCalls: 7, totalCalls: 10 }],
      budget: { reservedUsd: 4.25, protectedUsd: 2.05, limitUsd: 30, accounting: 'usage-with-conservative-reserves', expiresAt: '2026-11-05T03:10:00Z', providers: [{ provider: 'Anthropic', protectedUsd: 1.05, limitUsd: 15 }, { provider: 'OpenAI', protectedUsd: 1, limitUsd: 15 }] },
      limits: { review: { perMinute: 10, perHour: 60, perDay: 240 }, edit: { perMinute: 2, perHour: 10, perDay: 40 }, concurrent: 3, expiresAt: '2026-11-04T15:10:00Z' }, pricingVerifiedAt: '2026-11-03', note: 'Demo only' } })
  })
  await page.goto('./?workspace')
  const spoiler = page.locator('.developer-usage')
  await expect(spoiler).not.toHaveAttribute('open')
  expect(calls).toBe(0)
  await spoiler.locator('summary').click()
  await expect(spoiler.locator('dd').filter({ hasText: '$0.1432' })).toHaveCount(2)
  await expect(spoiler).toContainText('7 earlier or incomplete calls')
  await expect(spoiler).toContainText('Budget protected: $2.05 / $30.00')
  await expect(spoiler).toContainText('Anthropic: $1.05 protected / $15.00 limit')
  await expect(spoiler).toContainText('OpenAI: $1.00 protected / $15.00 limit')
  await expect(spoiler).toContainText('240 reviews and 40 image requests per rolling 24 hours')
  await expect(spoiler).toContainText('Higher rates end')
  await expect(spoiler).toContainText('unpriced calls retain their full reserve')
  await expect(spoiler).toContainText('not your account-wide balance')
  await spoiler.getByRole('button', { name: 'Refresh usage' }).click()
  expect(calls).toBe(2)
})

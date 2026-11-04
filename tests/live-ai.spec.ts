import { expect, test, webkit, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { CALIFORNIA_DISCLOSURE, LIVE_POLICY_VERSION, applicableRules } from '../shared/reviewPolicy.mjs'
import { sourceFingerprint } from '../shared/aiSnapshot.mjs'

type Outcome = 'pass' | 'fix' | 'irrelevant'
type MockState = { reviews: any[]; edits: any[]; reports: Map<string, any> }
const sourceImage = 'tests/fixtures/02-personal-loan-needs-copy-fix.png'
const correctedCopy = {
  headline: 'Explore your next step',
  body: 'Find personal loan options for your plans.',
  disclosure: 'Subject to credit approval. Rates and terms depend on your credit profile.',
  cta: 'Explore options',
}

// These mocks exercise the browser workflow and bindings. They do not call or
// validate either paid model, and cannot claim that the fixture pixels comply.
async function mockAI(page: Page, outcome: Outcome = 'pass', transformReport = (report: any) => report, editedImageOverride?: string) {
  const state: MockState = { reviews: [], edits: [], reports: new Map() }
  const editedImage = editedImageOverride ?? `data:image/png;base64,${(await readFile('public/creative/loan-fixed.png')).toString('base64')}`
  await page.route('**/v1/ai/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 })
    if (path === '/v1/ai/health') return route.fulfill({ json: {
      available: true, imageEditingAvailable: true, budgetAvailable: true,
      reviewModel: 'mock-claude', imageModel: 'mock-openai',
    } })
    const body = request.postDataJSON()
    if (path === '/v1/ai/reviews') {
      state.reviews.push(body)
      const initial = body.versionId === 1
      const irrelevant = initial && outcome === 'irrelevant'
      const failing = initial && outcome === 'fix'
      const checks = applicableRules(body.scope).map(rule => {
        const status = rule.applicability === 'unknown' ? 'needs-review'
          : rule.applicability === 'not-applicable' ? 'not-applicable'
            : irrelevant ? 'needs-review'
              : failing && rule.id === 'misleading-claim' ? 'fail' : 'pass'
        return { id: rule.id, label: rule.label, category: rule.category,
          applicability: rule.applicability, status,
          evidence: status === 'needs-review' ? rule.reason : `${rule.label}: fixture evidence.`,
          rationale: 'Deterministic browser test response.',
          ...(status === 'fail' || status === 'needs-review' ? { fix: 'Replace the unsupported claim with a conditional invitation.' } : {}),
          // Deliberately untrusted: the client must replace generated sources.
          sources: [{ id: 'fake', url: 'https://example.invalid/model-invented-source' }],
        }
      })
      const known = checks.every(check => check.applicability !== 'unknown')
      const report = { id: body.requestId, policyVersion: LIVE_POLICY_VERSION,
        model: 'mock-claude', submissionId: body.submissionId,
        versionId: body.versionId, sourceFingerprint: sourceFingerprint(body),
        sourceImageHash: createHash('sha256').update(Buffer.from(body.assetImage.split(',')[1], 'base64')).digest('hex'), checkedAt: new Date().toISOString(),
        summary: irrelevant ? 'This unrelated screenshot is not the recorded marketing asset.'
          : failing ? 'Replace the approval guarantee.' : 'All applicable fixture checks passed.',
        assetRelevant: !irrelevant, checks,
        suggestedCopy: failing || irrelevant ? correctedCopy : null,
        canApprove: !irrelevant && checks.every(check => ['pass', 'not-applicable'].includes(check.status)),
        canSuggestFix: known && failing, canCreateConcept: known && irrelevant,
      }
      state.reports.set(report.id, report)
      return route.fulfill({ status: 201, json: transformReport(report) })
    }
    if (path === '/v1/ai/edits') {
      state.edits.push(body)
      const report = state.reports.get(body.reviewId)
      expect(report).toBeDefined()
      expect(sourceFingerprint(body)).toBe(report.sourceFingerprint)
      return route.fulfill({ status: 201, json: {
        id: body.requestId, reviewId: report.id, submissionId: body.submissionId,
        versionId: body.versionId, sourceFingerprint: report.sourceFingerprint,
        sourceImageHash: report.sourceImageHash, assetImage: editedImage,
        proposedCopy: correctedCopy, requiresReview: true,
        provenance: { model: 'mock-openai', mode: body.mode, createdAt: new Date().toISOString() },
      } })
    }
    throw new Error(`Unexpected AI request: ${request.method()} ${path}`)
  })
  return state
}

async function submitImage(page: Page, title: string, jurisdiction = 'Other US jurisdiction', imageFile: string | { name: string; mimeType: string; buffer: Buffer } = sourceImage) {
  await page.goto('./')
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveCount(0)
  await page.getByRole('button', { name: 'New submission', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Creative image (optional)').setInputFiles(imageFile)
  await expect(dialog.getByAltText('Selected creative preview')).toBeVisible()
  await dialog.getByLabel('Campaign name').fill(title)
  await dialog.getByLabel('Jurisdiction').selectOption(jurisdiction)
  await dialog.getByRole('button', { name: 'Submit for review', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveValue('Alex Morgan')
  await expect(page.getByRole('heading', { name: 'Ready for AI review' })).toBeVisible()
}

async function storedItem(page: Page, title: string) {
  return page.evaluate(title => JSON.parse(localStorage.getItem('clearpath-relay-v1')!).find((item: any) => item.title === title), title)
}

test('image-only upload reviews actual pixels, uses shipped source links, and approves its exact version', async ({ page }) => {
  const ai = await mockAI(page)
  await submitImage(page, 'Image-only clean submission')
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toBeVisible()
  expect(ai.reviews).toHaveLength(1)
  expect(ai.reviews[0].assetImage).toMatch(/^data:image\/jpeg;base64,/)
  expect(ai.reviews[0].content.headline).toBe('')
  expect(ai.reviews[0].content.body).toBe('')
  expect(ai.reviews[0].scope.affiliatePartner).toBe('None')
  await page.locator('.lr-checks details').filter({ hasText: 'Claims and approval language' }).locator('summary').click()
  await expect(page.getByRole('link', { name: 'FTC guidance: truthful and substantiated advertising', exact: false })).toHaveAttribute('href', 'https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business')
  await expect(page.locator('a[href*="model-invented-source"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Approve v1', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'v1 is approved', exact: true })).toBeVisible()
  const item = await storedItem(page, 'Image-only clean submission')
  expect(item.status).toBe('Approved')
  expect(item.approvedVersionId).toBe(1)
  expect(item.liveReview.sourceFingerprint).toBe(sourceFingerprint(ai.reviews[0]))
  await expect(page.getByText('Slack preview only. No real message was sent.')).toBeVisible()
})

test('failed artwork is corrected, reviewed again, pre-approved, then accepted by its creative owner', async ({ page }) => {
  const ai = await mockAI(page, 'fix')
  const title = 'Correct then accept'
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Recheck revised asset', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Pre-approve/ })).toHaveCount(0)
  const revised = await storedItem(page, title)
  expect(revised.versions).toHaveLength(2)
  expect(revised.liveReview).toBeUndefined()
  expect(revised.approvedVersionId).toBeUndefined()
  expect(revised.versions[1].content.image).not.toBe(revised.versions[0].content.image)
  expect(ai.edits[0].mode).toBe('correction')
  await page.getByRole('button', { name: 'Recheck revised asset', exact: true }).click()
  await page.getByRole('button', { name: 'Pre-approve & send to creative', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Waiting for creative’s response', exact: true })).toBeVisible()
  expect((await storedItem(page, title)).approvedVersionId).toBeUndefined()
  await page.getByRole('button', { name: 'View as Maya', exact: true }).click()
  await expect(page.getByLabel('Viewing as')).toHaveValue('Maya Chen')
  const card = page.getByRole('article', { name: new RegExp(title) })
  await card.getByRole('button', { name: 'Accept v2', exact: true }).click()
  await expect(card.getByText('v2 is approved for this exact asset and intended use.')).toBeVisible()
  const accepted = await storedItem(page, title)
  expect(accepted.approvedVersionId).toBe(2)
  expect(accepted.status).toBe('Approved')
  expect(ai.reviews.map(body => body.versionId)).toEqual([1, 2])
  expect(accepted.events.at(-1).actor).toBe('Maya Chen (demo persona)')
})

test('California disclosure follows the normal correction flow and scope changes invalidate its review', async ({ page }) => {
  // Deterministic transport fixtures verify the flow. Separate live validation
  // notes record observed provider outcomes and any limits on generation.
  const ai = await mockAI(page, 'pass', report => {
    if (report.versionId === 1) {
      report.checks = report.checks.map((check: any) => check.id === 'state-review'
        ? { ...check, status: 'fail', evidence: 'The California offer disclosure is absent.',
          rationale: 'CP-CA-01 applies to the selected California audience.',
          fix: `Add: ${CALIFORNIA_DISCLOSURE}` } : check)
      report.canApprove = false
      report.canSuggestFix = true
      report.summary = 'Add the California offer disclosure.'
      report.suggestedCopy = { ...correctedCopy, disclosure: `${correctedCopy.disclosure} ${CALIFORNIA_DISCLOSURE}` }
    }
    return report
  })
  await submitImage(page, 'California disclosure demo', 'California', 'public/examples/california-missing-disclosure.jpg')
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toHaveCount(0)
  const finding = page.locator('.lr-checks details').filter({ hasText: 'California offer disclosure' })
  await expect(finding).toHaveAttribute('open', '')
  await expect(finding).toContainText(CALIFORNIA_DISCLOSURE)
  await expect(finding.getByRole('link')).toHaveAttribute('href', '?guidelines#state-review')
  await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Recheck revised asset', exact: true })).toBeVisible()
  expect(ai.edits[0].scope.jurisdiction).toBe('California')
  expect(ai.edits[0].mode).toBe('correction')
  await expect(page.getByRole('button', { name: /Pre-approve/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Recheck revised asset', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pre-approve & send to creative', exact: true })).toBeVisible()
  expect(ai.reviews.map(request => request.versionId)).toEqual([1, 2])
  await page.locator('.lr-editor summary').click()
  await page.getByRole('combobox', { name: 'Jurisdiction', exact: true }).selectOption('Other US jurisdiction')
  await page.getByRole('button', { name: 'Save new version', exact: true }).click()
  await expect(page.getByRole('button', { name: /Pre-approve/ })).toHaveCount(0)
  const item = await storedItem(page, 'California disclosure demo')
  expect(item.liveReview).toBeUndefined()
})

test('irrelevant source stays rejected and the same correction action creates a replacement needing review', async ({ page }) => {
  const ai = await mockAI(page, 'irrelevant')
  const title = 'Irrelevant upload replacement'
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'The uploaded image is not the intended ad' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Recheck revised asset', exact: true })).toBeVisible()
  expect(ai.edits[0].mode).toBe('replacement-concept')
  const item = await storedItem(page, title)
  expect(item.liveReviews[0].assetRelevant).toBe(false)
  expect(item.versions[1].aiGeneration.mode).toBe('replacement-concept')
  expect(item.liveReview).toBeUndefined()
  expect(item.approvedVersionId).toBeUndefined()
  await page.getByRole('button', { name: 'Recheck revised asset', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pre-approve & send to creative', exact: true })).toBeVisible()
})

test('return comments reach the owner and an uploaded revision returns to Alex with a fresh version', async ({ page }) => {
  await mockAI(page)
  const title = 'Creative revision upload'
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Return without AI review', exact: true }).click()
  await page.getByLabel('Comments for creative').fill('Replace the guarantee in the artwork and keep the disclosure legible.')
  await page.getByRole('button', { name: 'Return with comments', exact: true }).click()
  await page.getByRole('button', { name: 'View as Maya', exact: true }).click()
  const card = page.getByRole('article', { name: new RegExp(title) })
  await expect(card.getByText('Replace the guarantee in the artwork and keep the disclosure legible.')).toBeVisible()
  await card.getByRole('button', { name: 'Upload revision', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Creative owner')).toBeDisabled()
  await dialog.getByLabel('Replacement image (optional)').setInputFiles('public/creative/loan-fixed.png')
  await expect(dialog.getByAltText('Selected creative preview')).toBeVisible()
  await dialog.getByRole('button', { name: 'Resubmit for review', exact: true }).click()
  await card.getByRole('button', { name: 'Switch to reviewer', exact: true }).click()
  await expect(page.getByLabel('Viewing as')).toHaveValue('Alex Morgan')
  await expect(page.getByRole('button', { name: 'Run AI review', exact: true })).toBeVisible()
  const item = await storedItem(page, title)
  expect(item.versions).toHaveLength(2)
  expect(item.status).toBe('Needs review')
  expect(item.versions[1].author).toBe('Maya Chen')
  expect(item.versions[1].content.image).not.toBe(item.versions[0].content.image)
  expect(item.comments[0].versionId).toBe(1)
  expect(item.approvedVersionId).toBeUndefined()
})

test('unknown jurisdiction cannot clear and changing scope invalidates the previous assessment', async ({ page }) => {
  const ai = await mockAI(page)
  const title = 'Unknown jurisdiction gate'
  await submitImage(page, title, 'Unspecified')
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await expect(page.getByText('Select the intended jurisdiction before deciding whether the California offer disclosure applies.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toHaveCount(0)
  await page.locator('.lr-editor summary').click()
  await page.getByRole('combobox', { name: 'Jurisdiction', exact: true }).selectOption('California')
  await expect(page.getByRole('button', { name: 'Run a new AI assessment' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save new version', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run AI review', exact: true })).toBeVisible()
  const item = await storedItem(page, title)
  expect(item.liveReview).toBeUndefined()
  expect(item.liveReviews).toHaveLength(1)
  expect(item.versions[1].scope.jurisdiction).toBe('California')
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pre-approve & send to creative', exact: true })).toBeVisible()
  expect(ai.reviews[1].scope.jurisdiction).toBe('California')
})

test('mobile live review and persona controls fit a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await mockAI(page, 'fix')
  await submitImage(page, 'Mobile live review')
  await expect(page.getByLabel('Viewing as')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Prepare correction', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Recheck revised asset', exact: true })).toBeVisible()
  await page.getByLabel('Asset version').selectOption('1')
  await expect(page.getByRole('button', { name: 'Return to current v2', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recheck revised asset', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('a mismatched AI report never becomes a current review or approval action', async ({ page }) => {
  await mockAI(page, 'pass', report => ({ ...report, versionId: report.versionId + 1 }))
  const title = 'Mismatched provider response'
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('The provider returned an incomplete or mismatched review. Nothing was approved.')
  await expect(page.getByRole('button', { name: 'Approve v1', exact: true })).toHaveCount(0)
  expect((await storedItem(page, title)).liveReview).toBeUndefined()
  expect((await storedItem(page, title)).status).toBe('Needs review')
})

test('live workspace protects unsaved edits when switching demo personas after leaving the beginner walkthrough', async ({ page }) => {
  await mockAI(page)
  await page.goto('./')
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveCount(0)
  await page.getByRole('button', { name: 'All submissions', exact: true }).click()
  await page.getByRole('button', { name: /Everyday, a little more rewarding CP-1040/ }).click()
  await page.locator('.lr-editor summary').click()
  const audience = page.getByRole('textbox', { name: 'Audience', exact: true })
  await audience.fill('Unsaved audience change')
  const dismissed = page.waitForEvent('dialog')
  const switchAttempt = page.getByRole('combobox', { name: 'Viewing as' }).selectOption('Maya Chen')
  const warning = await dismissed
  expect(warning.message()).toMatch(/Discard.*unsaved/i)
  await warning.dismiss()
  await switchAttempt
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveValue('Alex Morgan')
  await expect(audience).toHaveValue('Unsaved audience change')
  await expect(page.getByRole('button', { name: 'Save new version', exact: true })).toBeVisible()
})

test('live Slack binds generated pixels and scope and cannot accept a superseded version', async ({ page }) => {
  const ai = await mockAI(page, 'fix')
  const endpoint = 'https://clearpath-relay-demo.cfireborn.workers.dev'
  const title = 'Slack exact current version'
  const token = 'mock-session-token-'.repeat(4)
  const proposalId = '11111111-2222-4333-8444-555555555555'
  const state = { sent: [] as any[], retired: false }
  let proposal: any
  await page.addInitScript(({ endpoint, token }) => {
    sessionStorage.setItem('clearpath-live-slack-v1', JSON.stringify({ endpoint,
      session: { token, expiresAt: new Date(Date.now() + 3600000).toISOString(), channel: 'Mock owner channel' },
      links: {}, notifications: {},
    }))
  }, { endpoint, token })
  await page.route(`${endpoint}/v1/proposals**`, async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 })
    expect(request.headers().authorization).toBe(`Bearer ${token}`)
    if (request.method() === 'POST' && path === '/v1/proposals') {
      const body = request.postDataJSON()
      state.sent.push(body)
      proposal = { id: proposalId, status: 'pending', delivery: 'sent',
        sourceSnapshot: { submissionId: body.submissionId, assetVersion: body.assetVersion },
        slackMessageUrl: 'https://app.slack.com/archives/C_MOCK/p123',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        feedback: null, decidedAt: null, decidedBy: null,
        recipient: { owner: body.owner, displayName: 'Mock creative', isProxy: true, slackUserId: 'U123456789' },
      }
      return route.fulfill({ status: 201, json: proposal })
    }
    if (request.method() === 'POST' && path.endsWith('/supersede')) {
      state.retired = true
      // An acceptance racing with retirement must stay attached to v2.
      return route.fulfill({ json: { ...proposal, status: 'accepted', decidedBy: 'U123456789' } })
    }
    if (request.method() === 'GET' && path === `/v1/proposals/${proposalId}`)
      return route.fulfill({ json: proposal })
    throw new Error(`Unexpected mock Slack request: ${request.method()} ${path}`)
  })
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
  await page.getByRole('button', { name: 'Recheck revised asset', exact: true }).click()
  await page.getByRole('button', { name: 'Pre-approve & send to creative', exact: true }).click()
  await expect.poll(() => state.sent.length).toBe(1)
  const waiting = await storedItem(page, title)
  expect(state.sent[0].assetVersion).toEqual({ id: 2, content: waiting.versions[1].content, scope: waiting.versions[1].scope })
  expect(state.sent[0].assetImage).toMatch(/^data:image\/png;base64,/)
  expect(state.sent[0].assetVersion.content.image).toBe(ai.reviews[1].content.image)
  expect(state.sent[0].rationale).toContain('What changed from v1:')
  expect(state.sent[0].rationale).toContain('Replace the unsupported claim with a conditional invitation.')
  expect(state.sent[0].rationale).toContain('Reviewed v2')
  await page.getByRole('button', { name: 'View as Maya', exact: true }).click()
  const card = page.getByRole('article', { name: new RegExp(title) })
  await expect(card.getByRole('link', { name: 'Respond in Slack' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Accept v2', exact: true })).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Viewing as' }).selectOption('Alex Morgan')
  await page.getByRole('button', { name: new RegExp(`${title} CP-`) }).click()
  await page.locator('.lr-editor summary').click()
  await page.getByRole('textbox', { name: 'Placement', exact: true }).fill('Different paid-social placement')
  await page.getByRole('button', { name: 'Save new version', exact: true }).click()
  await expect.poll(() => state.retired).toBe(true)
  const changed = await storedItem(page, title)
  expect(changed.status).toBe('Needs review')
  expect(changed.versions).toHaveLength(3)
  expect(changed.approvedVersionId).toBeUndefined()
  expect(changed.liveReview).toBeUndefined()
  await expect(page.getByRole('button', { name: 'Run AI review', exact: true })).toBeVisible()
})

test('Slack correction rationale retains original and latest instructions and labels shortened history', async ({ page }) => {
  await mockAI(page, 'fix', report => report.versionId < 5 ? {
    ...report, canApprove: false, canSuggestFix: true, suggestedCopy: correctedCopy,
    checks: report.checks.map((check: any) => check.id === 'misleading-claim'
      ? { ...check, status: 'fail', fix: 'Revise the wording before approval.' } : check),
  } : report)
  const endpoint = 'https://clearpath-relay-demo.cfireborn.workers.dev'
  const token = 'mock-correction-history-session-token'
  let sent: any
  let proposal: any
  await page.addInitScript(({ endpoint, token }) => {
    sessionStorage.setItem('clearpath-live-slack-v1', JSON.stringify({ endpoint,
      session: { token, expiresAt: new Date(Date.now() + 3600000).toISOString(), channel: 'Mock owner channel' },
      links: {}, notifications: {},
    }))
  }, { endpoint, token })
  await page.route(`${endpoint}/v1/proposals**`, async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204 })
    if (route.request().method() === 'POST') {
      sent = route.request().postDataJSON()
      proposal = { id: '11111111-2222-4333-8444-555555555555', status: 'pending', delivery: 'sent',
        sourceSnapshot: { submissionId: sent.submissionId, assetVersion: sent.assetVersion },
        slackMessageUrl: 'https://app.slack.com/archives/C_MOCK/p123',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        feedback: null, decidedAt: null, decidedBy: null,
        recipient: { owner: sent.owner, displayName: 'Mock creative', isProxy: true, slackUserId: 'U123456789' },
      }
      return route.fulfill({ status: 201, json: proposal })
    }
    return route.fulfill({ json: proposal })
  })
  const title = 'Bounded correction history'
  const instructions = [
    `Original correction: remove the approval guarantee. ${'Keep the original product and valid disclosures. '.repeat(22)}`.trim(),
    'Intermediate correction: restore the brand colors.',
    'Penultimate correction: give the disclosure enough room.',
    `Latest correction: correct the final wording. ${'Keep the full disclosure legible inside the canvas. '.repeat(22)}`.trim(),
  ]
  expect(instructions[0].length).toBeGreaterThan(900)
  expect(instructions[3].length).toBeGreaterThan(900)
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  for (const instruction of instructions) {
    await page.getByLabel('Comments for creative').fill(instruction)
    await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
    await page.getByRole('button', { name: 'Recheck revised asset', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Pre-approve & send to creative', exact: true }).click()
  await expect.poll(() => sent?.rationale).toBeTruthy()
  expect(sent.rationale.length).toBeLessThanOrEqual(1500)
  expect(sent.rationale).toContain('What changed from v1: Original correction: remove the approval guarantee.')
  expect(sent.rationale).toContain('What changed from v3: Penultimate correction: give the disclosure enough room.')
  expect(sent.rationale).toContain('What changed from v4: Latest correction: correct the final wording.')
  expect(sent.rationale).not.toContain('What changed from v2:')
  expect(sent.rationale.match(/\[shortened; full text in History\]/g)).toHaveLength(2)
  expect(sent.rationale).toContain('1 intermediate correction note omitted; full instructions are in History.')
  expect(sent.rationale).toContain('Reviewed v5')
  const item = await storedItem(page, title)
  expect(item.comments.filter((comment: any) => comment.field === 'AI correction instructions').map((comment: any) => comment.text)).toEqual(instructions)
})

async function canvasFixtures(page: Page, smallOutput = false) {
  await page.goto('./')
  return page.evaluate(small => {
    const source = document.createElement('canvas')
    source.width = 801; source.height = 1001
    const sourceContext = source.getContext('2d')!
    sourceContext.fillStyle = '#225344'; sourceContext.fillRect(0, 0, 801, 1001)
    const generated = document.createElement('canvas')
    generated.width = small ? 100 : 1024; generated.height = small ? 100 : 1536
    const context = generated.getContext('2d')!
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, generated.width, generated.height)
    for (const [color, x, y] of [['#ff0000', 0, 0], ['#00ff00', 960, 0], ['#0000ff', 0, 1472], ['#000000', 960, 1472]] as const) {
      context.fillStyle = color; context.fillRect(x, y, 64, 64)
    }
    return { source: source.toDataURL('image/png'), generated: generated.toDataURL('image/png') }
  }, smallOutput)
}

for (const browserName of ['chromium', 'webkit'] as const) {
  test.describe(`correction canvas in ${browserName}`, () => {
    test('keeps odd source dimensions and all four corners through repeated corrections and re-review', async ({ browser: defaultBrowser }, testInfo) => {
      const browser = browserName === 'webkit' ? await webkit.launch() : defaultBrowser
      const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
      const page = await context.newPage()
      try {
        expect(browser.browserType().name()).toBe(browserName)
        const pixels = await canvasFixtures(page)
        const ai = await mockAI(page, 'fix', report => report.versionId === 2 ? {
          ...report, canApprove: false, canSuggestFix: true, suggestedCopy: correctedCopy,
          checks: report.checks.map((check: any) => check.id === 'misleading-claim' ? { ...check, status: 'fail', fix: 'Correct the remaining wording.' } : check),
        } : report, pixels.generated)
        const title = 'Keep the reviewed canvas'
        await submitImage(page, title, 'Other US jurisdiction', { name: 'odd-canvas.png', mimeType: 'image/png', buffer: Buffer.from(pixels.source.split(',')[1], 'base64') })
        await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
        for (const versionId of [2, 3]) {
          await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Recheck revised asset', exact: true })).toBeVisible()
          const canvas = await page.evaluate(async title => {
            const item = JSON.parse(localStorage.getItem('clearpath-relay-v1')!).find((item: any) => item.title === title)
            const reference = item.versions.at(-1).content.image
            const dataUrl = localStorage.getItem(`clearpath-upload:${reference.slice(7)}`)!
            const image = new Image(); image.src = dataUrl; await image.decode()
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
            const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
            // Expected corner positions for the complete 2:3 result inside an
            // 801x1001 frame. Cropping or independent-axis stretching moves them.
            const corners = [[88, 20], [713, 20], [88, 980], [713, 980], [10, 500]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3))
            return { width: image.naturalWidth, height: image.naturalHeight, dataUrl, corners }
          }, title)
          expect([canvas.width, canvas.height]).toEqual([801, 1001])
          for (const [index, expected] of [[0, [255, 0, 0]], [1, [0, 255, 0]], [2, [0, 0, 255]], [3, [0, 0, 0]], [4, [246, 244, 235]]] as const) {
            canvas.corners[index].forEach((value, channel) => expect(Math.abs(value - expected[channel])).toBeLessThan(12))
          }
          await page.getByRole('button', { name: 'Recheck revised asset', exact: true }).click()
          expect(ai.reviews.at(-1).versionId).toBe(versionId)
          expect(ai.reviews.at(-1).assetImage).toBe(canvas.dataUrl)
          await expect.poll(async () => (await storedItem(page, title)).liveReview?.sourceImageHash).toBe(createHash('sha256').update(Buffer.from(canvas.dataUrl.split(',')[1], 'base64')).digest('hex'))
        }
      } finally {
        await context.close()
        if (browserName === 'webkit') await browser.close()
      }
    })
  })
}

test('undersized generated pixels are not enlarged or saved as a correction', async ({ page }) => {
  const pixels = await canvasFixtures(page, true)
  await mockAI(page, 'fix', report => report, pixels.generated)
  const title = 'Do not enlarge a tiny correction'
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  const original = await storedItem(page, title)
  await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('without cropping or enlargement')
  const unchanged = await storedItem(page, title)
  expect(unchanged.versions).toEqual(original.versions)
  expect(unchanged.approvedVersionId).toBeUndefined()
})

test('oversized encoding preserves the original instead of silently reducing correction dimensions', async ({ page }) => {
  await mockAI(page, 'fix')
  const title = 'Do not shrink to meet storage limits'
  await submitImage(page, title)
  await page.getByRole('button', { name: 'Run AI review', exact: true }).click()
  const original = await storedItem(page, title)
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,' + 'A'.repeat(500000)
  })
  await page.getByRole('button', { name: 'Prepare correction', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('too detailed to save at the original dimensions')
  expect((await storedItem(page, title)).versions).toEqual(original.versions)
})

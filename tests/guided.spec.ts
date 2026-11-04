import { expect, test, type Page } from '@playwright/test'

const errors = new WeakMap<Page, string[]>()
const aiRequests = new WeakMap<Page, string[]>()

async function oneAction(page: Page, name: string) {
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveCount(0)
  const primary = page.locator('.gr-primary:visible')
  await expect(primary).toHaveCount(1)
  await expect(primary).toHaveAccessibleName(name)
}

async function record(page: Page, id: string) {
  return page.evaluate(id => JSON.parse(localStorage.getItem('clearpath-relay-v1') || '[]').find((item: { id: string }) => item.id === id), id)
}

async function approveClean(page: Page) {
  await oneAction(page, 'Check submission')
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Ready on the first pass' })).toBeVisible()
  await oneAction(page, 'Approve v1 & notify Sofia')
  await page.getByRole('button', { name: 'Approve v1 & notify Sofia' }).click()
  await expect(page.getByRole('heading', { name: 'v1 is approved' })).toBeVisible()
}

async function openLoan(page: Page) {
  await approveClean(page)
  await page.getByRole('button', { name: 'Continue to next example' }).click()
  await expect(page.getByRole('heading', { name: 'Personal loans · Instagram feed · portrait creative for review', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
}

async function fixLoan(page: Page) {
  await openLoan(page)
  await oneAction(page, 'Submit feedback & draft a fix')
  await page.getByRole('button', { name: 'Submit feedback & draft a fix' }).click()
  await expect(page.getByRole('heading', { name: 'The small fix clears the checks' })).toBeVisible()
  await oneAction(page, 'Pre-approve & send to Maya')
  await page.getByRole('button', { name: 'Pre-approve & send to Maya' }).click()
  await oneAction(page, 'Simulate Maya accepting in Slack')
}

async function openMortgage(page: Page) {
  await fixLoan(page)
  await page.getByRole('button', { name: 'Simulate Maya accepting in Slack' }).click()
  await expect(page.getByText('Acceptance received. The exact version is approved.')).toBeVisible()
  await oneAction(page, 'Continue to next example')
  await page.getByRole('button', { name: 'Continue to next example' }).click()
  await expect(page.getByRole('heading', { name: 'Mortgage prequalification · Homewise · landing-page hero for review', exact: true })).toBeVisible()
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual((await page.viewportSize())!.width)
}

test.beforeEach(async ({ page }) => {
  errors.set(page, [])
  aiRequests.set(page, [])
  page.on('pageerror', error => errors.get(page)!.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/v1/ai/')) aiRequests.get(page)!.push(request.url())
  })
  await page.route('**/v1/ai/**', route => route.abort())
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Marketing review' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveCount(0)
  await expect(page.locator('.gr-demo-badge')).toContainText('Prepared examples')
})

test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([])
  expect(aiRequests.get(page)).toEqual([])
})

test('guided review remains usable with a clear warning when browser storage is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Browser denied storage access.', 'SecurityError') },
    })
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Marketing review' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Saved demo data could not be read')
  await oneAction(page, 'Check submission')
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Browser storage is unavailable. Changes work in this tab but may not survive a refresh.')
  await page.getByRole('button', { name: 'Approve v1 & notify Sofia' }).click()
  await expect(page.getByRole('heading', { name: 'v1 is approved' })).toBeVisible()
  await oneAction(page, 'Continue to next example')
})

test('default three-card walkthrough stays prepared without AI requests or persona switching, then opens the live workspace', async ({ page }) => {
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/guided-desktop-start.png', fullPage: true })
  await expect(page.getByRole('button', { name: /A small, clear fix/ })).toBeDisabled()
  await approveClean(page)
  await oneAction(page, 'Continue to next example')
  await expect(page.getByText('Slack preview · no message sent', { exact: true })).toBeVisible()
  await expect(page.getByText('Informational notification · no acceptance needed')).toBeVisible()
  const clean = await record(page, 'CP-1040')
  expect(clean.approvedVersionId).toBe(1)
  expect(clean.versions).toHaveLength(1)
  expect(clean.checkReport.canApprove).toBe(true)
  expect(clean.checkReport.checks.every((check: { status: string }) => ['pass', 'not-applicable'].includes(check.status))).toBe(true)
  const trail = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Decision trail' }) })
  await trail.locator('summary').click()
  await expect(trail.locator('ol')).toHaveJSProperty('reversed', true)
  await expect(trail.locator('li').first()).toContainText(clean.events.at(-1).text)
  await expect(trail.locator('li').last()).toContainText(clean.events[0].text)
  await expect(trail.locator('li')).toHaveCount(clean.events.length)
  await trail.locator('summary').click()
  await page.getByRole('button', { name: 'Continue to next example' }).click()
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  const feedback = await page.getByRole('textbox').inputValue()
  await page.getByRole('button', { name: 'Submit feedback & draft a fix' }).click()
  await oneAction(page, 'Pre-approve & send to Maya')
  await expect(page.getByRole('button', { name: 'Pre-approve & send to Maya' })).toBeFocused()
  const loan = await record(page, 'CP-1042')
  expect(loan.versions).toHaveLength(2)
  expect(loan.status).toBe('Needs review')
  expect(loan.approvedVersionId).toBeUndefined()
  expect(loan.versions[0].content.headline).toBe('Big plans. Guaranteed approval.')
  expect(loan.generationRequests[0].feedback).toBe(feedback)
  expect(loan.generationRequests[0].prompt).toContain('Original exact asset')
  expect(loan.comments.some((comment: { field: string }) => comment.field === 'Spec · misleading-claim')).toBe(true)
  await page.getByRole('button', { name: 'Pre-approve & send to Maya' }).click()
  await oneAction(page, 'Simulate Maya accepting in Slack')
  await page.getByRole('button', { name: 'Simulate Maya accepting in Slack' }).click()
  await page.getByRole('button', { name: 'Continue to next example' }).click()
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await page.getByRole('button', { name: 'Submit feedback & draft a fix' }).click()
  await oneAction(page, 'Return to Jordan for revision')
  await expect(page.locator('.gr-asset-stage img')).toHaveAttribute('src', /creative\/mortgage-fixed\.png$/)
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/guided-desktop-revision.png', fullPage: true })
  const mortgage = await record(page, 'CP-1041')
  expect(mortgage.checkReport.canApprove).toBe(false)
  expect(mortgage.checkReport.checks.filter((check: { status: string }) => check.status === 'needs-review').map((check: { id: string }) => check.id)).toEqual(['state-review', 'affiliate-identity'])
  expect(mortgage.versions[1].scope.audience).toContain('California')
  await page.getByRole('button', { name: 'Compare with original' }).click()
  await expect(page.locator('.gr-asset-stage img')).toHaveAttribute('src', /creative\/mortgage-original\.png$/)
  await page.getByRole('button', { name: 'Show suggested version' }).click()
  await page.getByRole('button', { name: 'Return to Jordan for revision' }).click()
  await oneAction(page, 'Simulate marketing acknowledging')
  expect((await record(page, 'CP-1041')).approvedVersionId).toBeUndefined()
  await page.getByRole('button', { name: 'Simulate marketing acknowledging' }).click()
  await oneAction(page, 'Explore all submissions')
  await expect(page.getByText('3 of 3 complete')).toBeVisible()
  expect(aiRequests.get(page)).toEqual([])
  await page.getByRole('button', { name: 'Explore all submissions' }).click()
  await expect(page.getByRole('heading', { name: 'All submissions', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveValue('Alex Morgan')
  await page.getByRole('button', { name: /A little breathing room CP-1042/ }).click()
  await expect(page.locator('.lr-page')).toBeVisible()
  await expect(page.getByRole('region', { name: 'AI review' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toBeVisible()
})

test('unsupported intended use stays blocked and returns to its owner without a prepared draft', async ({ page }) => {
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('clearpath-relay-v1')!)
    const item = items.find((item: { id: string }) => item.id === 'CP-1040')
    item.versions[0].scope.product = 'Unreviewed business credit'
    item.versions[0].scope.audience = 'Unknown jurisdiction'
    localStorage.setItem('clearpath-relay-v1', JSON.stringify(items))
  })
  await page.reload()
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await expect(page.getByRole('button', { name: /Approve v1/ })).toHaveCount(0)
  await oneAction(page, 'Return to Sofia for revision')
  await page.getByRole('button', { name: 'Return to Sofia for revision' }).click()
  const item = await record(page, 'CP-1040')
  expect(item.status).toBe('Revision requested')
  expect(item.approvedVersionId).toBeUndefined()
  expect(item.checkReport.canApprove).toBe(false)
  expect(item.versions).toHaveLength(1)
  expect(item.generationRequests ?? []).toHaveLength(0)
})

test('reviewer can return the original with specific feedback and no generated version', async ({ page }) => {
  await openLoan(page)
  await page.getByRole('textbox').fill('Please remove the unconditional approval claim and confirm the eligibility qualifier with the campaign owner.')
  await page.getByText('Need marketing to handle the revision?', { exact: true }).click()
  await page.getByRole('button', { name: 'Return without a suggested fix' }).click()
  await oneAction(page, 'Simulate marketing acknowledging')
  const item = await record(page, 'CP-1042')
  expect(item.status).toBe('Revision requested')
  expect(item.versions).toHaveLength(1)
  expect(item.generationRequests ?? []).toHaveLength(0)
  expect(item.decisionNote).toContain('confirm the eligibility qualifier')
  expect(item.comments.some((comment: { field: string }) => comment.field === 'Spec · misleading-claim')).toBe(true)
})

test('pending and received preview handoffs survive reload without restarting the walkthrough', async ({ page }) => {
  await fixLoan(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Personal loans · Instagram feed · portrait creative for review', exact: true })).toBeVisible()
  await expect(page.getByText('Message preview ready', { exact: true })).toBeVisible()
  await oneAction(page, 'Simulate Maya accepting in Slack')
  await page.getByRole('button', { name: 'Simulate Maya accepting in Slack' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Personal loans · Instagram feed · portrait creative for review', exact: true })).toBeVisible()
  await expect(page.getByText('Acceptance received. The exact version is approved.')).toBeVisible()
  await oneAction(page, 'Continue to next example')
})

test('390px walkthrough keeps one primary action and shows both actual creative images', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await noOverflow(page)
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/guided-mobile-start.png', fullPage: true })
  await openMortgage(page)
  const heading = page.getByRole('heading', { name: 'Mortgage prequalification · Homewise · landing-page hero for review', exact: true })
  await expect(heading).toBeFocused()
  const headingBounds = await heading.boundingBox()
  expect(headingBounds!.y).toBeGreaterThanOrEqual(0)
  expect(headingBounds!.y + headingBounds!.height).toBeLessThan(844)
  await noOverflow(page)
  await expect(page.locator('.gr-asset-stage img')).toHaveJSProperty('complete', true)
  expect(await page.locator('.gr-asset-stage img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await page.getByRole('button', { name: 'Submit feedback & draft a fix' }).click()
  await oneAction(page, 'Return to Jordan for revision')
  await expect(page.getByRole('button', { name: 'Return to Jordan for revision' })).toBeFocused()
  await expect(page.locator('.gr-asset-stage img')).toHaveAttribute('src', /mortgage-fixed\.png$/)
  await noOverflow(page)
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/guided-mobile-revision.png', fullPage: true })
  await page.getByRole('button', { name: 'Return to Jordan for revision' }).click()
  await page.getByRole('button', { name: 'Simulate marketing acknowledging' }).click()
  await oneAction(page, 'Explore all submissions')
  await noOverflow(page)
})

test('320px transitions reveal results, keep the full creative reachable, and orient workspace navigation', async ({ page }) => {
  // The explicit query retains the original prepared workspace for this legacy navigation regression.
  await page.goto('./?prepared')
  await page.setViewportSize({ width: 320, height: 568 })
  await approveClean(page)
  const next = page.getByRole('button', { name: 'Continue to next example' })
  await expect(next).toBeFocused()
  await expect(next).toBeInViewport({ ratio: 1 })
  await next.click()
  const bounds = await page.locator('.gr-asset-stage').evaluate(stage => {
    const asset = stage.querySelector('.asset')!.getBoundingClientRect()
    const container = stage.getBoundingClientRect()
    return { top: asset.top - container.top, bottom: container.bottom - asset.bottom }
  })
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.bottom).toBeGreaterThanOrEqual(0)
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  const result = page.getByRole('heading', { name: '2 items need attention' })
  await expect(result).toBeFocused()
  await expect(result).toBeInViewport({ ratio: 1 })
  await page.getByRole('button', { name: 'All submissions', exact: true }).click()
  await expect(page.locator('h1')).toBeFocused()
  await expect(page.locator('h1')).toBeInViewport({ ratio: 1 })
  await page.getByRole('button', { name: /A little breathing room CP-1042/ }).click()
  await expect(page.locator('h1')).toBeFocused()
  await expect(page.locator('h1')).toBeInViewport({ ratio: 1 })
  await page.getByRole('button', { name: 'Try an example fix' }).click()
  await page.getByRole('button', { name: 'Use this as my starting point' }).click()
  const compare = page.getByRole('tab', { name: 'Compare versions', exact: true })
  await expect(compare).toBeFocused()
  await expect(compare).toBeInViewport({ ratio: 0.99 }) // Allow subpixel rounding at the tab border.
  await noOverflow(page)
})

test('mocked live notifications show delivery separately and require an actual receipt before continuing', async ({ page }) => {
  const appOrigin = new URL(page.url()).origin
  const external: string[] = []
  const token = '2'.repeat(64)
  const notices = new Map<string, any>()
  const sent: any[] = []
  let acknowledge = false
  let reviewerDelivered = false
  let receiptPolls = 0
  const reviewer = { owner: 'Alex Morgan', slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true, channelId: 'C44444444', channelName: 'relay-alex-morgan-compliance' }
  let releaseDelivery!: () => void
  const holdDelivery = new Promise<void>(resolve => { releaseDelivery = resolve })
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/v1/')) {
      if (url.origin === appOrigin) return route.continue()
      external.push(url.href); return route.abort()
    }
    const headers = { 'access-control-allow-origin': appOrigin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/v1/sessions') return route.fulfill({ status: 201, headers, json: { token, expiresAt: new Date(Date.now() + 3600000).toISOString(), channel: '#relay-test' } })
    expect(request.headers().authorization).toBe(`Bearer ${token}`)
    if (url.pathname === '/v1/notifications') {
      const body = request.postDataJSON(); sent.push(body)
      const id = body.kind === 'approved' ? '11111111-2222-4333-8444-555555555555' : '22222222-2222-4333-8444-555555555555'
      const now = new Date().toISOString()
      const notice = { id, kind: body.kind, status: body.kind === 'approved' ? 'noted' : 'awaiting_acknowledgment', delivery: 'sent', sourceSnapshot: { submissionId: body.submissionId, assetVersion: body.assetVersion }, recipient: { owner: body.owner, slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true, channelId: body.kind === 'approved' ? 'C22222222' : 'C11111111', channelName: body.kind === 'approved' ? 'relay-sofia-patel-marketing' : 'relay-maya-chen-marketing' }, reviewerNotification: body.kind === 'approved' ? null : { recipient: reviewer, delivery: 'not_sent', slackMessageUrl: null }, slackMessageUrl: `https://app.slack.com/archives/C_TEST/${id}`, createdAt: now, updatedAt: now, acknowledgedAt: null, acknowledgedBy: null }
      notices.set(id, notice)
      if (body.kind === 'approved') await holdDelivery
      return route.fulfill({ status: 201, headers, json: notice })
    }
    const notice = notices.get(url.pathname.split('/').at(-1)!)
    if (request.method() === 'GET' && notice) {
      receiptPolls++
      return route.fulfill({ status: 200, headers, json: acknowledge ? { ...notice, status: 'acknowledged', acknowledgedBy: 'U123456789', acknowledgedAt: new Date().toISOString(), reviewerNotification: { recipient: reviewer, delivery: reviewerDelivered ? 'sent' : 'sending', slackMessageUrl: reviewerDelivered ? 'https://app.slack.com/archives/C44444444/p123456000001' : null } } : notice })
    }
    throw new Error(`Unexpected mocked request ${request.method()} ${url.pathname}`)
  })
  await page.getByRole('button', { name: 'Slack preview', exact: true }).click()
  await page.getByLabel('Private setup code').fill('dummy-private-test-code')
  await page.getByRole('button', { name: 'Connect live Slack', exact: true }).click()
  await page.getByRole('button', { name: 'Continue with live Slack' }).click()
  await approveClean(page)
  await expect(page.getByText('Sending…', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to next example' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /A small, clear fix/ })).toBeDisabled()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]).toMatchObject({ kind: 'approved', submissionId: 'CP-1040', owner: 'Sofia Patel', assetVersion: { id: 1 } })
  expect(sent[0].assetImage).toMatch(/^data:image\/png;base64,/)
  releaseDelivery()
  await expect(page.getByText('Sent to #relay-sofia-patel-marketing', { exact: true })).toBeVisible()
  await oneAction(page, 'Continue to next example')
  await expect(page.getByRole('button', { name: 'Continue to next example' })).toBeFocused()
  await page.getByRole('button', { name: 'Continue to next example' }).click()
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await page.getByText('Need marketing to handle the revision?', { exact: true }).click()
  await page.getByRole('button', { name: 'Return without a suggested fix' }).click()
  await expect(page.getByText('Sent to #relay-maya-chen-marketing', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to next example' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Simulate marketing acknowledging' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /A revision with context/ })).toBeDisabled()
  expect(sent[1]).toMatchObject({ kind: 'revision_requested', submissionId: 'CP-1042', owner: 'Maya Chen', assetVersion: { id: 1 } })
  acknowledge = true
  await expect(page.getByText('Marketing acknowledged the revision request.', { exact: false })).toBeVisible({ timeout: 10000 })
  await oneAction(page, 'Continue to next example')
  await expect(page.getByRole('button', { name: 'Continue to next example' })).toBeFocused()
  await expect(page.getByText('The response is saved. Notifying Alex Morgan in #relay-alex-morgan-compliance…')).toBeVisible()
  const beforeReturn = receiptPolls
  reviewerDelivered = true
  await expect(page.getByText('Response delivered to Alex Morgan in #relay-alex-morgan-compliance.')).toBeVisible({ timeout: 10000 })
  expect(receiptPolls).toBeGreaterThan(beforeReturn)
  await expect(page.getByRole('link', { name: 'View reviewer update' })).toHaveAttribute('href', 'https://app.slack.com/archives/C44444444/p123456000001')
  expect((await record(page, 'CP-1042')).status).toBe('Revision requested')
  expect((await record(page, 'CP-1042')).approvedVersionId).toBeUndefined()
  expect(external).toEqual([])
})

test('a mocked Slack change request surfaces creative feedback and opens the same review for revision', async ({ page }) => {
  const appOrigin = new URL(page.url()).origin
  const external: string[] = []
  const token = '3'.repeat(64)
  const proposalId = '33333333-2222-4333-8444-555555555555'
  const creativeFeedback = 'Please keep “move forward” in the headline so this placement matches the campaign.'
  let proposal: any
  let requestsChanges = false
  let sends = 0
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/v1/')) {
      if (url.origin === appOrigin) return route.continue()
      external.push(url.href); return route.abort()
    }
    const headers = { 'access-control-allow-origin': appOrigin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/v1/sessions') return route.fulfill({ status: 201, headers, json: { token, expiresAt: new Date(Date.now() + 3600000).toISOString(), channel: '#relay-test' } })
    expect(request.headers().authorization).toBe(`Bearer ${token}`)
    if (url.pathname === '/v1/notifications') {
      const body = request.postDataJSON()
      expect(body).toMatchObject({ kind: 'approved', submissionId: 'CP-1040', owner: 'Sofia Patel' })
      const now = new Date().toISOString()
      return route.fulfill({ status: 201, headers, json: {
        id: '44444444-2222-4333-8444-555555555555', kind: 'approved', status: 'noted', delivery: 'sent',
        sourceSnapshot: { submissionId: body.submissionId, assetVersion: body.assetVersion },
        recipient: { owner: body.owner, slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true },
        slackMessageUrl: 'https://app.slack.com/archives/C_TEST/p1234567890000000', createdAt: now, updatedAt: now, acknowledgedAt: null, acknowledgedBy: null,
      } })
    }
    if (url.pathname === '/v1/proposals') {
      const body = request.postDataJSON()
      expect(body).toMatchObject({ submissionId: 'CP-1042', owner: 'Maya Chen', assetVersion: { id: 2, content: { headline: 'A little breathing room.' } } })
      sends += 1
      const now = new Date().toISOString()
      proposal = {
        id: proposalId, status: 'pending', delivery: 'sent', sourceSnapshot: { submissionId: body.submissionId, assetVersion: body.assetVersion },
        slackMessageUrl: 'https://app.slack.com/archives/C_TEST/p1234567890000001', createdAt: now, updatedAt: now,
        feedback: null, decidedAt: null, decidedBy: null,
        recipient: { owner: body.owner, slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true },
      }
      return route.fulfill({ status: 201, headers, json: proposal })
    }
    if (url.pathname === `/v1/proposals/${proposalId}` && request.method() === 'GET') return route.fulfill({ status: 200, headers, json: requestsChanges ? {
      ...proposal, status: 'changes_requested', feedback: creativeFeedback, decidedBy: 'U123456789', decidedAt: new Date().toISOString(),
      reviewerNotification: { recipient: { owner: 'Alex Morgan', slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true, channelId: 'C44444444', channelName: 'relay-alex-morgan-compliance' }, delivery: 'failed', slackMessageUrl: null },
    } : proposal })
    throw new Error(`Unexpected mocked request ${request.method()} ${url.pathname}`)
  })
  await page.getByRole('button', { name: 'Slack preview', exact: true }).click()
  await page.getByLabel('Private setup code').fill('dummy-private-test-code')
  await page.getByRole('button', { name: 'Connect live Slack', exact: true }).click()
  await page.getByRole('button', { name: 'Continue with live Slack' }).click()
  await approveClean(page)
  await page.getByRole('button', { name: 'Continue to next example' }).click()
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await page.getByRole('button', { name: 'Submit feedback & draft a fix' }).click()
  await page.getByRole('button', { name: 'Pre-approve & send to Maya' }).click()
  await expect(page.getByText('Sent to #relay-test', { exact: true })).toBeVisible()
  requestsChanges = true
  await expect(page.getByRole('heading', { name: 'Creative requested changes', exact: true })).toBeVisible({ timeout: 10000 })
  await expect(page.getByLabel('Slack activity').getByText(creativeFeedback, { exact: true })).toBeVisible()
  await expect(page.getByText('The response is saved. Delivery to Alex Morgan in #relay-alex-morgan-compliance failed.')).toBeVisible()
  await oneAction(page, 'Review requested changes')
  await expect(page.getByRole('button', { name: 'Pre-approve & send to Maya' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue to next example' })).toHaveCount(0)
  const item = await record(page, 'CP-1042')
  expect(item.status).toBe('Changes requested')
  expect(item.approvedVersionId).toBeUndefined()
  expect(item.proposalVersionId).toBeUndefined()
  expect(item.versions).toHaveLength(2)
  expect(item.comments.at(-1)).toMatchObject({ field: 'Creative feedback', text: creativeFeedback, versionId: 2, author: 'Slack member U123456789' })
  await page.getByRole('button', { name: 'Review requested changes' }).click()
  await expect(page.getByRole('heading', { name: 'Personal loans · Instagram feed · portrait creative for review', exact: true })).toBeVisible()
  await expect(page.locator('.lr-page')).toBeVisible()
  await expect(page.locator('.lr-context')).toContainText(creativeFeedback)
  await expect(page.getByText('Current asset · v2', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Run AI review', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveValue('Alex Morgan')
  await expect(page.getByRole('button', { name: 'Queue', exact: true })).toBeVisible()
  expect(sends).toBe(1)
  expect(external).toEqual([])
})

test('restarting the walkthrough retires its sample handoff and preserves unrelated pending Slack work', async ({ page }) => {
  const appOrigin = new URL(page.url()).origin
  const external: string[] = []
  const token = '4'.repeat(64)
  const loanProposalId = '55555555-2222-4333-8444-555555555555'
  const otherProposalId = '66666666-2222-4333-8444-555555555555'
  const proposals = new Map<string, any>()
  const polls = new Map<string, number>()
  const retired: string[] = []
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/v1/')) {
      if (url.origin === appOrigin) return route.continue()
      external.push(url.href); return route.abort()
    }
    const headers = { 'access-control-allow-origin': appOrigin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/v1/sessions') return route.fulfill({ status: 201, headers, json: { token, expiresAt: new Date(Date.now() + 3600000).toISOString(), channel: '#relay-test' } })
    expect(request.headers().authorization).toBe(`Bearer ${token}`)
    const match = url.pathname.match(/^\/v1\/proposals\/([a-f0-9-]+)(\/supersede)?$/)
    const proposal = match && proposals.get(match[1])
    if (proposal && request.method() === 'GET' && !match![2]) {
      polls.set(proposal.id, (polls.get(proposal.id) || 0) + 1)
      return route.fulfill({ status: 200, headers, json: proposal })
    }
    if (proposal && request.method() === 'POST' && match![2]) {
      retired.push(proposal.id)
      const updated = { ...proposal, status: 'superseded', updatedAt: new Date().toISOString() }
      proposals.set(proposal.id, updated)
      return route.fulfill({ status: 200, headers, json: updated })
    }
    throw new Error(`Unexpected mocked request ${request.method()} ${url.pathname}`)
  })
  await fixLoan(page)
  await page.getByRole('button', { name: 'Slack preview', exact: true }).click()
  await page.getByLabel('Private setup code').fill('dummy-private-test-code')
  await page.getByRole('button', { name: 'Connect live Slack', exact: true }).click()
  await page.getByRole('button', { name: 'Continue with live Slack' }).click()
  const seeded = await page.evaluate(({ loanProposalId, otherProposalId }) => {
    const items = JSON.parse(localStorage.getItem('clearpath-relay-v1')!)
    const connection = JSON.parse(sessionStorage.getItem('clearpath-live-slack-v1')!)
    const pending = []
    for (const [id, proposalId] of [['CP-1042', loanProposalId], ['CP-1039', otherProposalId]]) {
      const item = items.find((item: { id: string }) => item.id === id)
      const version = item.versions.at(-1)
      const decision = [...item.events].reverse().find((event: { text: string }) => event.text.startsWith('Pre-approved'))
      if (!decision || item.status !== 'With creative' || item.proposalVersionId !== version.id) throw new Error(`Invalid pending fixture ${id}`)
      const request = { clientRequestId: crypto.randomUUID(), submissionId: id, title: item.title, reviewer: item.reviewer, owner: item.owner,
        assetVersion: { id: version.id, content: version.content, scope: version.scope }, originalContent: item.versions[0].content, rationale: item.decisionNote }
      const now = new Date().toISOString()
      const proposal = { id: proposalId, status: 'pending', delivery: 'sent', sourceSnapshot: { submissionId: id, assetVersion: request.assetVersion },
        slackMessageUrl: `https://app.slack.com/archives/C_TEST/${proposalId}`, createdAt: now, updatedAt: now, feedback: null, decidedAt: null, decidedBy: null }
      connection.links[id] = { request, decisionEventId: decision.id, proposal, applied: false, stale: false }
      pending.push(proposal)
    }
    sessionStorage.setItem('clearpath-live-slack-v1', JSON.stringify(connection))
    return { pending, unrelated: items.find((item: { id: string }) => item.id === 'CP-1039') }
  }, { loanProposalId, otherProposalId })
  for (const proposal of seeded.pending) proposals.set(proposal.id, proposal)
  await page.reload()
  await expect(page.getByText('Sent to #relay-test', { exact: true })).toBeVisible()
  await expect.poll(() => (polls.get(loanProposalId) || 0) > 0 && (polls.get(otherProposalId) || 0) > 0).toBe(true)
  expect(retired).toEqual([])
  const previousOtherPolls = polls.get(otherProposalId)!
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Restart walkthrough' }).click()
  await expect(page.getByRole('heading', { name: 'Credit cards · Monthly newsletter · hero for review', exact: true })).toBeVisible()
  await expect.poll(() => retired).toEqual([loanProposalId])
  await expect.poll(() => polls.get(otherProposalId) || 0, { timeout: 10000 }).toBeGreaterThan(previousOtherPolls)
  for (const id of ['CP-1040', 'CP-1042', 'CP-1041']) {
    const item = await record(page, id)
    expect(item.status).toBe('Needs review')
    expect(item.versions).toHaveLength(1)
    expect(item.proposalVersionId).toBeUndefined()
    expect(item.approvedVersionId).toBeUndefined()
  }
  expect(await record(page, 'CP-1039')).toEqual(seeded.unrelated)
  const survivingLink = await page.evaluate(() => JSON.parse(sessionStorage.getItem('clearpath-live-slack-v1')!).links['CP-1039'])
  expect(survivingLink.stale).toBe(false)
  expect(survivingLink.proposal.status).toBe('pending')
  expect(survivingLink.retirement).toBeUndefined()
  expect(proposals.get(otherProposalId).status).toBe('pending')
  expect(retired).toEqual([loanProposalId])
  await oneAction(page, 'Check submission')
  await page.getByRole('button', { name: 'Check submission', exact: true }).click()
  await oneAction(page, 'Approve v1 & notify Sofia')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Restart walkthrough' }).click()
  await oneAction(page, 'Check submission')
  await expect(page.locator('.gr-check-state')).toHaveText(Array(5).fill('To check'))
  expect((await record(page, 'CP-1040')).checkReport).toBeUndefined()
  expect(await record(page, 'CP-1039')).toEqual(seeded.unrelated)
  expect(retired).toEqual([loanProposalId])
  expect(external).toEqual([])
})

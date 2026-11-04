import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import type { SlackProposal } from '../src/slack'

const rationale = 'Removed the guaranteed approval claim and clarified eligibility while keeping the campaign voice.'

async function proposeLoan(page: Page) {
  await page.getByRole('button', { name: /A little breathing room CP-1042/ }).click()
  await expect(page.getByText('A prepared example, not a live AI call.')).toBeVisible()
  await page.getByRole('button', { name: 'Try an example fix' }).click()
  await page.getByRole('button', { name: 'Use this as my starting point' }).click()
  await expect(page.getByRole('tab', { name: 'Compare versions' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'Pre-approve & hand off' }).click()
  const decision = page.getByRole('dialog')
  await expect(decision.getByRole('button', { name: 'Pre-approve this version', exact: true })).toBeDisabled()
  await decision.getByLabel('What changed, and why?').fill(rationale)
  await decision.getByLabel('I reviewed this exact version and its intended use.').check()
  await decision.getByRole('button', { name: 'Pre-approve this version', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('It doesn’t send a Slack message.')
  await expect(page.getByRole('dialog')).toContainText('PRE-APPROVED BY ALEX MORGAN · V2')
}

async function readLoan(page: Page) {
  return page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('clearpath-relay-v1') || '[]')
    return items.find((item: { id: string }) => item.id === 'CP-1042')
  })
}

async function expectNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    overflowing: [...document.querySelectorAll('body *')].map(element => ({
      element: `${element.tagName}.${element.className}`,
      right: Math.round(element.getBoundingClientRect().right),
    })).filter(element => element.right > innerWidth + 1).slice(0, 8),
  }))
  expect(layout.width, JSON.stringify(layout.overflowing)).toBeLessThanOrEqual(layout.viewport)
}

test.beforeEach(async ({ page }) => {
  await page.goto('./?workspace&prepared')
  await expect(page.getByRole('heading', { name: 'Review queue', exact: true })).toBeVisible()
})

test('a reviewer fix reaches exact-version approval, survives reload, and exports its record', async ({ page }) => {
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/e2e-desktop-queue.png', fullPage: true })
  await proposeLoan(page)
  await page.getByRole('button', { name: 'Accept this version', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('v2 and its intended use are now approved.')
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await expect(page.getByText('v2 is approved for launch.')).toBeVisible()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.getByText(`Pre-approved v2 and its intended use. Awaiting creative acceptance. Rationale: ${rationale}`, { exact: true })).toBeVisible()
  await expect(page.getByText('Accepted the compliance adjustment. v2 is approved for its recorded intended use.', { exact: true })).toBeVisible()
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/e2e-desktop-approved.png', fullPage: true })
  const stored = await readLoan(page)
  expect(stored.status).toBe('Approved')
  expect(stored.approvedVersionId).toBe(2)
  expect(stored.proposalVersionId).toBeUndefined()
  expect(stored.versions[0].content.headline).toBe('Big plans. Guaranteed approval.')
  expect(stored.versions[1].content.headline).toBe('A little breathing room.')
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: /^Approved/ }).click()
  await expect(page.getByRole('button', { name: /A little breathing room CP-1042/ })).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await downloaded
  expect(file.suggestedFilename()).toBe('clearpath-review-queue.csv')
  const csv = await readFile((await file.path())!, 'utf8')
  expect(csv).toContain('"CP-1042","A little breathing room","Approved","Maya Chen","Alex Morgan"')
  expect(csv).toContain('"2","2","","Personal loans"')
  expect(csv).toContain(rationale)
  expect(csv).not.toContain('"CP-1041"')
})

test('creative feedback withdraws preapproval and returns an actionable note to compliance', async ({ page }) => {
  await proposeLoan(page)
  await page.getByRole('button', { name: 'Request a change', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send feedback' })).toBeDisabled()
  const feedback = 'Please preserve the phrase breathing room in the CTA too.'
  await page.getByLabel('What would you like changed?').fill(feedback)
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.getByRole('dialog')).toContainText('Back with compliance.')
  await expect(page.getByRole('button', { name: 'Accept this version', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await expect(page.getByText('Creative asked for an adjustment.')).toBeVisible()
  await expect(page.getByText(feedback, { exact: true })).toBeVisible()
  const stored = await readLoan(page)
  expect(stored.status).toBe('Changes requested')
  expect(stored.proposalVersionId).toBeUndefined()
  expect(stored.approvedVersionId).toBeUndefined()
  expect(stored.comments.at(-1)).toMatchObject({ author: 'Maya Chen', versionId: 2, text: feedback })
})

test('a creative counter-edit creates a new unapproved revision and keeps the reviewed version', async ({ page }) => {
  await proposeLoan(page)
  await page.getByRole('button', { name: 'Request a change', exact: true }).click()
  await page.getByLabel('What would you like changed?').fill('Keep the campaign language about moving forward.')
  await page.getByLabel('Suggest a different headline').check()
  await page.getByLabel('Your proposed headline').fill('A little room to move forward.')
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await expect(page.getByRole('dialog')).toContainText('Back with compliance.')
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  const stored = await readLoan(page)
  expect(stored.status).toBe('Needs review')
  expect(stored.proposalVersionId).toBeUndefined()
  expect(stored.approvedVersionId).toBeUndefined()
  expect(stored.versions).toHaveLength(3)
  expect(stored.versions[1].content.headline).toBe('A little breathing room.')
  expect(stored.versions[2]).toMatchObject({ id: 3, author: 'Maya Chen', content: { headline: 'A little room to move forward.' } })
  await expect(page.getByRole('button', { name: 'Pre-approve & hand off' })).toBeVisible()
  await expect(page.getByText('v2 is approved for launch.')).toHaveCount(0)
})

test('a creative headline counter-edit removes the old raster while preserving the reviewed image version', async ({ page }) => {
  await page.getByRole('button', { name: /Room for your next chapter CP-1041/ }).click()
  await page.getByRole('button', { name: 'Try an example fix' }).click()
  await page.getByRole('button', { name: 'Use this as my starting point' }).click()
  await page.getByRole('button', { name: 'Pre-approve & hand off' }).click()
  const decision = page.getByRole('dialog')
  await decision.getByLabel('What changed, and why?').fill('Reviewed the prepared creative and recorded intended use for this counter-edit regression.')
  await decision.getByLabel('I reviewed this exact version and its intended use.').check()
  await decision.getByRole('button', { name: 'Pre-approve this version', exact: true }).click()
  await page.getByRole('button', { name: 'Request a change', exact: true }).click()
  await page.getByLabel('What would you like changed?').fill('Please keep our campaign headline while retaining the clearer prequalification explanation.')
  await page.getByLabel('Suggest a different headline').check()
  await page.getByLabel('Your proposed headline').fill('A home for your next chapter.')
  await page.getByRole('button', { name: 'Send feedback' }).click()
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('clearpath-relay-v1')!).find((item: { id: string }) => item.id === 'CP-1041'))
  expect(stored.status).toBe('Needs review')
  expect(stored.approvedVersionId).toBeUndefined()
  expect(stored.proposalVersionId).toBeUndefined()
  expect(stored.versions).toHaveLength(3)
  expect(stored.versions[1].content.image).toBe('creative/mortgage-fixed.png')
  expect(stored.versions[1].content.headline).toBe('Your next chapter starts here.')
  expect(stored.versions[2].content.image).toBeUndefined()
  expect(stored.versions[2].content.headline).toBe('A home for your next chapter.')
  await page.getByRole('tab', { name: 'Asset & edits', exact: true }).click()
  await expect(page.locator('.asset-workspace .asset-image')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'A home for your next chapter.', exact: true })).toBeVisible()
})

test('changing the scope of an approved asset invalidates approval while retaining its previous use', async ({ page }) => {
  await proposeLoan(page)
  await page.getByRole('button', { name: 'Accept this version', exact: true }).click()
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await page.getByRole('tab', { name: 'Asset & edits' }).click()
  await page.getByRole('button', { name: 'Edit scope' }).click()
  await page.getByRole('dialog').getByLabel('placement', { exact: true }).fill('Instagram Stories · vertical 9:16')
  await page.getByRole('button', { name: 'Use this scope' }).click()
  await page.getByRole('button', { name: 'Edit copy', exact: true }).click()
  await page.getByRole('button', { name: 'Save new version' }).click()
  await expect(page.getByText('v2 is approved for launch.')).toHaveCount(0)
  const stored = await readLoan(page)
  expect(stored.status).toBe('Needs review')
  expect(stored.approvedVersionId).toBeUndefined()
  expect(stored.versions[1].scope.placement).toBe('Instagram feed · portrait creative')
  expect(stored.versions[2].scope.placement).toBe('Instagram Stories · vertical 9:16')
})

test('new submissions preserve submitted content, context, and ownership without an invented AI example', async ({ page }) => {
  await page.getByRole('button', { name: 'New submission' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Submit for review' })).toBeDisabled()
  await dialog.getByLabel('Campaign name').fill('Autumn card campaign')
  await dialog.getByLabel('Creative owner').selectOption('Sofia Patel')
  await dialog.getByRole('combobox', { name: 'Product', exact: true }).selectOption('Credit cards')
  await dialog.getByRole('combobox', { name: 'Channel', exact: true }).selectOption('Email')
  await dialog.getByLabel('Audience').fill('US adults · existing customers')
  await dialog.getByLabel('Placement').fill('November customer newsletter')
  await dialog.getByLabel('Creative copy', { exact: true }).fill('Headline\nMore possibilities in your everyday.\n\nBody copy\nExplore a card designed around everyday purchases.\n\nDisclosure\nSubject to credit approval. Terms apply.\n\nCall to action\nExplore your options')
  await dialog.getByRole('button', { name: 'Submit for review' }).click()
  await expect(page.getByRole('heading', { name: 'Credit cards · November customer newsletter for review', exact: true })).toBeVisible()
  await expect(page.getByText('Review the creative and its intended use, then edit the copy or approve the original.', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Assigned reviewer')).toHaveValue('Alex Morgan')
  await expect(page.getByText('November customer newsletter', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Queue', exact: true }).click()
  await page.getByLabel('Search submissions').fill('Autumn card campaign')
  await expect(page.locator('.submission-row')).toHaveCount(1)
  await expect(page.locator('.submission-row')).toContainText('Needs review')
  await page.reload()
  await page.getByLabel('Search submissions').fill('Autumn card campaign')
  await expect(page.locator('.submission-row')).toHaveCount(1)
})

test('whole-asset commenting can be followed by editing without losing the workspace', async ({ page }) => {
  await page.getByRole('button', { name: /A little breathing room CP-1042/ }).click()
  await page.getByRole('button', { name: /^Comments/ }).click()
  await page.getByLabel('Comment on').selectOption('Asset')
  await page.getByLabel('Your note').fill('Keep the warm, optimistic overall tone.')
  await page.getByRole('button', { name: 'Add comment' }).click()
  await page.getByRole('button', { name: 'Edit copy', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Edit creative copy' })).toBeVisible()
  await expect(page.getByRole('textbox')).toBeVisible()
})

test('unsaved edits cannot enter a handoff and reviewer reassignment preserves decision attribution', async ({ page }) => {
  await proposeLoan(page)
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await page.getByRole('button', { name: 'Edit copy', exact: true }).click()
  await page.getByRole('textbox', { name: 'Creative copy', exact: true }).fill('An unreviewed replacement headline.')
  await page.getByRole('button', { name: 'Open creative’s handoff' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Save or discard your unsaved changes')
  await page.getByRole('button', { name: 'Discard unsaved edits' }).click()
  await page.getByLabel('Assigned reviewer').selectOption('Sam Rivera')
  await page.getByRole('button', { name: 'Open creative’s handoff' }).click()
  await expect(page.getByRole('dialog')).toContainText('PRE-APPROVED BY ALEX MORGAN · V2')
  await page.getByRole('button', { name: 'Accept this version', exact: true }).click()
  const stored = await readLoan(page)
  expect(stored.approvedVersionId).toBe(2)
  expect(stored.versions[1].content.headline).toBe('A little breathing room.')
})

test('sidebar navigation requires an explicit choice before discarding an unsaved draft', async ({ page }) => {
  await page.getByRole('button', { name: /A little breathing room CP-1042/ }).click()
  await page.getByRole('button', { name: 'Edit copy', exact: true }).click()
  const headline = page.getByRole('textbox', { name: 'Creative copy', exact: true })
  await headline.fill('Campaign headline in progress.')
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('navigation').getByRole('button', { name: 'Review guidelines', exact: true }).click()
  await expect(headline).toHaveValue('Campaign headline in progress.')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('navigation').getByRole('button', { name: 'Review guidelines', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review guidelines', exact: true })).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: /^Review queue/ }).click()
  await page.getByRole('button', { name: /A little breathing room CP-1042/ }).click()
  await expect(page.getByRole('button', { name: 'Big plans. Guaranteed approval.', exact: true })).toBeVisible()
})

test('dialog keyboard navigation excludes background controls and Escape restores its trigger', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'New submission' })
  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Campaign name')).toBeFocused()
  for (let index = 0; index < 17; index++) {
    await page.keyboard.press('Tab')
    // Native Chromium briefly focuses BODY at the browser-chrome boundary.
    // No background page control may become focused while the modal is open.
    expect(await dialog.evaluate(element => document.activeElement === document.body || element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await opener.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('the 390px workflow is usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'New submission' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const firstRow = page.getByRole('button', { name: /A little breathing room CP-1042/ })
  const rowBounds = await firstRow.boundingBox()
  const titleBounds = await firstRow.locator('.submission-title').boundingBox()
  expect(titleBounds!.width, 'Mobile titles should use the row, not an empty desktop column').toBeGreaterThan(rowBounds!.width * 0.7)
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/e2e-mobile-queue.png', fullPage: true })
  await proposeLoan(page)
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ path: '.capture/e2e-mobile-handoff.png', fullPage: false })
  await expectNoHorizontalOverflow(page)
  const dialog = page.getByRole('dialog')
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: 'Accept this version', exact: true }).click()
  await expect(dialog).toContainText('Accepted. You’re ready to go.')
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await expect(page.getByText('v2 is approved for launch.')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('mobile navigation reaches waiting work and reset requires confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await proposeLoan(page)
  await page.getByRole('button', { name: 'Accept this version', exact: true }).click()
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^With creative/ }).click()
  await expect(page.getByRole('heading', { name: 'With creative', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'With creative', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: /A fresh start, on your terms/ })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sample data' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Keep my work' }).click()
  expect((await readLoan(page)).status).toBe('Approved')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sample data' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Reset sample data', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review queue', exact: true })).toBeVisible()
  const restored = await readLoan(page)
  expect(restored.status).toBe('Needs review')
  expect(restored.versions).toHaveLength(1)
  expect(restored.approvedVersionId).toBeUndefined()
  await expectNoHorizontalOverflow(page)
})

test('a mocked live Slack decision applies the exact sent version and preserves intervening comments', async ({ page }) => {
  const setupCode = 'private-test-code-never-a-real-credential'
  const sessionToken = '1'.repeat(64)
  const proposalId = '11111111-2222-4333-8444-555555555555'
  const appOrigin = new URL(page.url()).origin
  let proposal: SlackProposal | undefined
  let accepted = false
  let reviewerDelivered = false
  const reviewer = { owner: 'Alex Morgan', slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true, channelId: 'C44444444', channelName: 'relay-alex-morgan-compliance' }
  let sends = 0
  let polls = 0
  const unexpectedExternal: string[] = []

  // Every nonlocal request is fulfilled or aborted; this test never contacts Slack or the Worker.
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/v1/')) {
      if (url.origin === appOrigin) return route.continue()
      unexpectedExternal.push(url.origin + url.pathname)
      return route.abort()
    }
    const headers = {
      'access-control-allow-origin': appOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (url.pathname === '/v1/sessions') {
      expect(request.method()).toBe('POST')
      expect(request.headers().authorization).toBe(`Bearer ${setupCode}`)
      return route.fulfill({ status: 201, headers, json: {
        token: sessionToken,
        expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
        channel: '#relay-test',
      } })
    }
    expect(request.headers().authorization).toBe(`Bearer ${sessionToken}`)
    if (url.pathname === '/v1/proposals') {
      expect(request.method()).toBe('POST')
      sends += 1
      const body = request.postDataJSON()
      expect(body).toMatchObject({
        submissionId: 'CP-1042', reviewer: 'Alex Morgan', owner: 'Maya Chen', rationale,
        assetVersion: { id: 2, content: { headline: 'A little breathing room.' }, scope: {
          product: 'Personal loans', audience: 'US adults · existing customers',
          channel: 'Paid social', placement: 'Instagram feed · portrait creative',
        } },
        originalContent: { headline: 'Big plans. Guaranteed approval.' },
      })
      expect(body.clientRequestId).toMatch(/^[a-f0-9-]{36}$/)
      expect(body.assetImage).toMatch(/^data:image\/png;base64,/)
      const previewBytes = Buffer.from(body.assetImage.split(',')[1], 'base64')
      expect([...previewBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(previewBytes.readUInt32BE(16)).toBe(690)
      expect(previewBytes.readUInt32BE(20)).toBeGreaterThan(200)
      expect(previewBytes.length).toBeLessThanOrEqual(500 * 1024)
      const now = new Date().toISOString()
      proposal = {
        id: proposalId, status: 'pending', delivery: 'sent',
        sourceSnapshot: { submissionId: body.submissionId, assetVersion: body.assetVersion },
        slackMessageUrl: 'https://app.slack.com/archives/C_TEST/p1234567890000000',
        createdAt: now, updatedAt: now, feedback: null, decidedAt: null, decidedBy: null,
        recipient: { owner: 'Maya Chen', slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true, channelId: 'C11111111', channelName: 'relay-maya-chen-marketing' },
        reviewerNotification: { recipient: reviewer, delivery: 'not_sent', slackMessageUrl: null },
      }
      return route.fulfill({ status: 201, headers, json: proposal })
    }
    if (url.pathname === `/v1/proposals/${proposalId}`) {
      expect(request.method()).toBe('GET')
      polls += 1
      return route.fulfill({ status: 200, headers, json: accepted ? {
        ...proposal, status: 'accepted', decidedAt: new Date().toISOString(), decidedBy: 'U_TEST_CREATIVE',
        reviewerNotification: { recipient: reviewer, delivery: reviewerDelivered ? 'sent' : 'sending', slackMessageUrl: reviewerDelivered ? 'https://app.slack.com/archives/C44444444/p123456000001' : null },
      } : proposal })
    }
    throw new Error(`Unexpected mocked API request: ${request.method()} ${url.pathname}`)
  })

  await proposeLoan(page)
  await page.getByText('Connect live Slack', { exact: true }).click()
  await page.getByLabel('Private setup code').fill(setupCode)
  await page.getByRole('button', { name: 'Connect this browser' }).click()
  await expect(page.getByText('Live Slack connected', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Send pre-approved fix' }).click()
  await expect(page.getByText('Sent to Slack. Waiting for creative’s decision; this page updates automatically.')).toBeVisible()
  await expect(page.getByText('Marketing channel: #relay-maya-chen-marketing')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Accept this version', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Request a change', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Open actual Slack message' })).toHaveAttribute('href', 'https://app.slack.com/archives/C_TEST/p1234567890000000')
  expect(await page.evaluate(() => sessionStorage.getItem('clearpath-live-slack-v1'))).not.toContain(setupCode)
  await page.getByRole('button', { name: 'Back to workspace' }).click()
  await page.getByRole('button', { name: /^Comments/ }).click()
  await page.getByLabel('Your note').fill('Keep the already-reviewed placement when launching.')
  await page.getByRole('button', { name: 'Add comment' }).click()
  await page.getByRole('button', { name: 'Queue', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Review queue', exact: true })).toBeVisible()
  accepted = true
  await expect.poll(async () => (await readLoan(page))?.status, { timeout: 10000 }).toBe('Approved')
  const beforeReturn = polls
  reviewerDelivered = true
  await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem('clearpath-live-slack-v1')!).links['CP-1042'].proposal.reviewerNotification.delivery), { timeout: 10000 }).toBe('sent')
  expect(polls).toBeGreaterThan(beforeReturn)
  const stored = await readLoan(page)
  expect(stored.approvedVersionId).toBe(2)
  expect(stored.versions).toHaveLength(2)
  expect(stored.comments.at(-1).text).toBe('Keep the already-reviewed placement when launching.')
  expect(stored.events.filter((event: { actor: string }) => event.actor === 'Slack member U_TEST_CREATIVE')).toHaveLength(1)
  expect(sends).toBe(1)
  expect(polls).toBeGreaterThan(0)
  expect(unexpectedExternal).toEqual([])
  await page.getByRole('navigation').getByRole('button', { name: /^Approved/ }).click()
  await page.getByRole('button', { name: /A little breathing room CP-1042/ }).click()
  await expect(page.getByText('Response delivered to Alex Morgan in #relay-alex-morgan-compliance.')).toBeVisible()
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  await expect(page.getByText('Slack member U_TEST_CREATIVE', { exact: true })).toBeVisible()
  await expect(page.getByText('Accepted the compliance adjustment. v2 is approved for its recorded intended use.', { exact: true })).toBeVisible()
})

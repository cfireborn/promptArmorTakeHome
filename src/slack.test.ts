import { afterEach, describe, expect, it, vi } from 'vitest'
import { addComment, approveOriginal, currentVersion, preapprove, requestChanges, returnForRevision, saveDraft, type AssetContent } from './domain'
import { seedSubmissions } from './seed'
import { applySlackDecision, canNotifySlack, canSendToSlack, matchesCurrentHandoff, matchesNotification, matchesSlackSnapshot, supersedeSlackProposal, reviewerNoticePending, slackChannelName, type SlackLink, type SlackNotificationLink, type SlackProposal } from './slack'

function fixture() {
  const item = preapprove(seedSubmissions()[0], 'Claim and disclosure reviewed for this placement.')
  const version = currentVersion(item)
  const proposal: SlackProposal = {
    id: 'a1234567-1234-1234-1234-123456789012', status: 'accepted', delivery: 'sent',
    sourceSnapshot: { submissionId: item.id, assetVersion: { id: version.id, content: { ...version.content }, scope: { ...version.scope } } },
    slackMessageUrl: 'https://app.slack.com/archives/C123/p123456',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    feedback: null, decidedAt: new Date().toISOString(), decidedBy: 'U12345',
  }
  return { item, proposal }
}

describe('Slack decisions match the whole approved snapshot', () => {
  it('applies an exact accepted snapshot and preserves the real Slack identity', () => {
    const { item, proposal } = fixture()
    const result = applySlackDecision(item, proposal)
    expect(result?.status).toBe('Approved')
    expect(result?.approvedVersionId).toBe(currentVersion(item).id)
    expect(result?.events.at(-1)?.actor).toBe('Slack member U12345')
    expect(item.status).toBe('With creative')
    expect(applySlackDecision(result!, proposal)).toBeNull()
  })

  it('preserves comments made while a Slack response was in flight', () => {
    const { item, proposal } = fixture()
    const latest = addComment(item, 'Confirmed the placement with marketing.', 'Placement')
    const result = applySlackDecision(latest, proposal)
    expect(result?.comments).toEqual(latest.comments)
    expect(result?.events).toHaveLength(latest.events.length + 1)
  })

  it.each(['headline', 'body', 'disclosure', 'cta', 'art'] as (keyof AssetContent)[])(
    'rejects a response when %s differs even with the same version ID', (key) => {
      const { item, proposal } = fixture()
      proposal.sourceSnapshot.assetVersion.content[key] = (key === 'art' ? 'card' : 'Different text') as never
      expect(matchesSlackSnapshot(item, proposal.sourceSnapshot)).toBe(false)
      expect(applySlackDecision(item, proposal)).toBeNull()
    },
  )

  it.each(['product', 'audience', 'channel', 'placement'] as const)(
    'rejects a response when intended-use %s differs', (key) => {
      const { item, proposal } = fixture()
      proposal.sourceSnapshot.assetVersion.scope[key] = 'Changed use'
      expect(matchesSlackSnapshot(item, proposal.sourceSnapshot)).toBe(false)
      expect(applySlackDecision(item, proposal)).toBeNull()
    },
  )

  it.each(['jurisdiction', 'affiliatePartner'] as const)('rejects Slack responses for changed %s', key => {
    const { item, proposal } = fixture()
    Object.assign(proposal.sourceSnapshot.assetVersion.scope, { [key]: key === 'jurisdiction' ? 'California' : 'Homewise' })
    expect(matchesSlackSnapshot(item, proposal.sourceSnapshot)).toBe(false)
    expect(applySlackDecision(item, proposal)).toBeNull()
  })

  it('binds generated images and palette while treating absent defaults consistently', () => {
    const { item, proposal } = fixture()
    proposal.sourceSnapshot.assetVersion.content.image = currentVersion(item).content.image ?? ''
    proposal.sourceSnapshot.assetVersion.content.palette = currentVersion(item).content.palette ?? 'brand'
    expect(matchesSlackSnapshot(item, proposal.sourceSnapshot)).toBe(true)
    proposal.sourceSnapshot.assetVersion.content.image = '/creative/changed.png'
    expect(applySlackDecision(item, proposal)).toBeNull()
    proposal.sourceSnapshot.assetVersion.content.image = currentVersion(item).content.image
    proposal.sourceSnapshot.assetVersion.content.palette = currentVersion(item).content.palette === 'off-brand' ? 'brand' : 'off-brand'
    expect(applySlackDecision(item, proposal)).toBeNull()
  })

  it('rejects another submission or version and requires a current proposal', () => {
    const { item, proposal } = fixture()
    expect(applySlackDecision({ ...item, id: 'OTHER' }, proposal)).toBeNull()
    const version = currentVersion(item)
    const edited = saveDraft(item, version.content, version.scope, 'New version')
    expect(applySlackDecision(edited, proposal)).toBeNull()
    expect(applySlackDecision(preapprove(edited, 'Reviewed again.'), proposal)).toBeNull()
    expect(applySlackDecision({ ...item, proposalVersionId: 999 }, proposal)).toBeNull()
  })

  it.each(['sending', 'failed', 'uncertain'] as const)('never applies a %s delivery', delivery => {
    const { item, proposal } = fixture()
    expect(applySlackDecision(item, { ...proposal, delivery })).toBeNull()
  })

  it('requires an identified decision and nonempty rejection feedback', () => {
    const { item, proposal } = fixture()
    expect(applySlackDecision(item, { ...proposal, decidedBy: null })).toBeNull()
    expect(applySlackDecision(item, { ...proposal, status: 'pending' })).toBeNull()
    expect(applySlackDecision(item, { ...proposal, status: 'superseded' })).toBeNull()
    expect(applySlackDecision(item, { ...proposal, status: 'changes_requested', feedback: ' ' })).toBeNull()
    const returned = applySlackDecision(item, { ...proposal, status: 'changes_requested', feedback: 'Keep our original CTA.' })
    expect(returned?.status).toBe('Changes requested')
    expect(returned?.comments.at(-1)).toMatchObject({ author: 'Slack member U12345', text: 'Keep our original CTA.', versionId: currentVersion(item).id })
  })

  it('only enables sending a pre-approved current version with rationale', () => {
    const { item } = fixture()
    expect(canSendToSlack(item)).toBe(true)
    expect(canSendToSlack({ ...item, status: 'Needs review' })).toBe(false)
    expect(canSendToSlack({ ...item, proposalVersionId: undefined })).toBe(false)
    expect(canSendToSlack({ ...item, decisionNote: '' })).toBe(false)
  })

  it('distinguishes a new compliance handoff after creative rejects the same asset version', () => {
    const { item, proposal } = fixture()
    const link: SlackLink = {
      decisionEventId: item.events.at(-1)!.id,
      request: {
        clientRequestId: 'original-request', submissionId: item.id, title: item.title,
        reviewer: item.reviewer, owner: item.owner, assetVersion: proposal.sourceSnapshot.assetVersion,
        originalContent: item.versions[0].content, rationale: item.decisionNote!,
      },
      proposal, applied: false, stale: false,
    }
    expect(matchesCurrentHandoff(item, link)).toBe(true)
    expect(matchesCurrentHandoff(addComment(item, 'Follow-up context', 'Asset'), link)).toBe(true)
    const rejected = requestChanges(item, 'Can you explain the disclosure?')
    const next = preapprove(rejected, 'The disclosure is necessary; the original adjustment is ready.')
    expect(currentVersion(next).id).toBe(currentVersion(item).id)
    expect(matchesSlackSnapshot(next, proposal.sourceSnapshot)).toBe(true)
    expect(matchesCurrentHandoff(next, link)).toBe(false)
    expect(matchesCurrentHandoff(next, { ...link, decisionEventId: next.events.at(-1)!.id })).toBe(true)
    expect(matchesCurrentHandoff(item, { ...link, decisionEventId: undefined })).toBe(false)
  })
})

describe('owner notifications', () => {
  it('requires the matching saved review outcome and never sends a revision as a proposal', () => {
    const { item } = fixture()
    const approved = { ...item, status: 'Approved' as const, approvedVersionId: currentVersion(item).id }
    const revision = { ...item, status: 'Revision requested' as const }
    expect(canNotifySlack(approved, 'approved')).toBe(true)
    expect(canNotifySlack({ ...approved, approvedVersionId: 999 }, 'approved')).toBe(false)
    expect(canNotifySlack(approved, 'revision_requested')).toBe(false)
    expect(canNotifySlack(revision, 'revision_requested')).toBe(true)
    expect(canNotifySlack(revision, 'approved')).toBe(false)
    expect(canNotifySlack(item, 'approved')).toBe(false)
    expect(canNotifySlack(item, 'revision_requested')).toBe(false)
    expect(canSendToSlack(revision)).toBe(false)
  })

  it('binds an owner notification to its original owner and exact asset version', () => {
    const item = returnForRevision(seedSubmissions()[0], 'Fix the disclosure.')
    const link: SlackNotificationLink = { decisionEventId: item.events.at(-1)!.id, request: {
      clientRequestId: 'notification-request', submissionId: item.id, title: item.title,
      reviewer: item.reviewer, owner: item.owner, assetVersion: currentVersion(item),
      kind: 'revision_requested', note: 'Fix the disclosure.',
    } }
    expect(matchesNotification(item, link)).toBe(true)
    expect(matchesNotification({ ...item, owner: 'Someone else' }, link)).toBe(false)
    const current = currentVersion(item)
    expect(matchesNotification(saveDraft(item, current.content, current.scope, 'New revision'), link)).toBe(false)
    expect(matchesNotification(addComment(item, 'Extra context', 'Asset'), link)).toBe(true)
    const newDecision = returnForRevision({ ...item, status: 'Needs review' }, 'Fix the disclosure.')
    expect(matchesNotification(newDecision, link)).toBe(false)
    const approved = approveOriginal({ ...item, status: 'Needs review' }, 'Now approved.')
    expect(matchesNotification(approved, link)).toBe(false)
    expect(matchesNotification(item, { ...link, decisionEventId: undefined })).toBe(false)
  })
})

describe('retiring stale Slack proposals', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('uses the private capability and the idempotent supersede endpoint', async () => {
    const { proposal } = fixture()
    const retired = { ...proposal, status: 'superseded' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(retired)))
    vi.stubGlobal('fetch', fetchMock)
    expect(await supersedeSlackProposal(proposal.id, 'private-capability')).toEqual(retired)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(new RegExp(`/v1/proposals/${proposal.id}/supersede$`))
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}', keepalive: true, headers: { Authorization: 'Bearer private-capability' } })
  })

  it('preserves a decision that won before retirement reached the server', async () => {
    const { proposal } = fixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(proposal))))
    expect((await supersedeSlackProposal(proposal.id, 'private-capability')).status).toBe('accepted')
  })

  it('bounds network retries to three attempts', async () => {
    vi.useFakeTimers()
    const { proposal } = fixture()
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Offline'))
    vi.stubGlobal('fetch', fetchMock)
    const result = supersedeSlackProposal(proposal.id, 'private-capability').catch(error => error)
    await vi.runAllTimersAsync()
    expect(await result).toBeInstanceOf(TypeError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry an expired capability', async () => {
    const { proposal } = fixture()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Connection expired.' }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(supersedeSlackProposal(proposal.id, 'private-capability')).rejects.toThrow('Connection expired.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})


describe('person-channel delivery', () => {
  const recipient = { owner: 'Alex Morgan', slackUserId: 'U123456789', displayName: 'Charlie', isProxy: true, channelId: 'C12345678', channelName: 'relay-alex-morgan-compliance' }

  it('uses the delivered destination ahead of an older connection fallback', () => {
    expect(slackChannelName(recipient, '#relay-demo')).toBe('#relay-alex-morgan-compliance')
    expect(slackChannelName({ ...recipient, channelName: null }, '#relay-demo')).toBe('C12345678')
    expect(slackChannelName(undefined, '#relay-demo')).toBe('#relay-demo')
  })

  it('keeps polling reviewer delivery after applying a decision, but not missing or terminal notices', () => {
    const { proposal } = fixture()
    expect(reviewerNoticePending(proposal)).toBe(false)
    for (const delivery of ['not_sent', 'sending'] as const) {
      const pending = { ...proposal, reviewerNotification: { recipient, delivery, slackMessageUrl: null } }
      expect(reviewerNoticePending(pending)).toBe(true)
      expect(reviewerNoticePending({ ...pending, status: 'changes_requested' })).toBe(true)
      expect(reviewerNoticePending({ ...pending, status: 'pending' })).toBe(false)
      expect(reviewerNoticePending({ ...pending, status: 'superseded' })).toBe(false)
    }
    for (const delivery of ['sent', 'failed', 'uncertain'] as const) {
      expect(reviewerNoticePending({ ...proposal, reviewerNotification: { recipient, delivery, slackMessageUrl: null } })).toBe(false)
    }
  })
})

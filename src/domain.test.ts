import { describe, expect, it } from 'vitest'
import {
  acceptProposal, addComment, approveOriginal, assignReviewer, counterEdit, currentVersion,
  exportCsv, preapprove, requestChanges, saveDraft, waitingSince, type Submission,
} from './domain'

function submission(): Submission {
  return {
    id: 'CP-101', title: 'A little breathing room', owner: 'Jordan Lee', reviewer: 'Alex Morgan',
    priority: 'High', due: '2026-11-02', submittedAt: '2026-11-01T12:00:00.000Z',
    status: 'Needs review', comments: [], events: [],
    versions: [{
      id: 1, author: 'Jordan Lee', createdAt: '2026-11-01T12:00:00.000Z', note: 'Submitted',
      content: { headline: 'A little breathing room', body: 'Explore your options.', disclosure: 'Terms apply.', cta: 'Learn more', art: 'sunrise' },
      scope: { product: 'Personal loan', audience: 'US adults', channel: 'Paid social', placement: 'Feed' },
    }],
  }
}

describe('approval belongs to an exact version and scope', () => {
  it('requires a reviewer decision before creative can accept', () => {
    const original = submission()
    expect(() => acceptProposal(original)).toThrow('no pending adjustment')
    const pending = preapprove(original, 'Disclosure now covers the claim.')
    const approved = acceptProposal(pending)
    expect(approved.status).toBe('Approved')
    expect(approved.approvedVersionId).toBe(1)
    expect(approved.proposalVersionId).toBeUndefined()
    expect(approved.decisionNote).toBe('Disclosure now covers the claim.')
    expect(original.status).toBe('Needs review')
    expect(() => acceptProposal(approved)).toThrow('no pending adjustment')
  })

  it.each(['content', 'scope'] as const)('invalidates approval when %s changes without mutating history', (kind) => {
    const approved = approveOriginal(submission(), 'Reviewed intended use.')
    const previous = currentVersion(approved)
    const content = { ...previous.content, ...(kind === 'content' ? { headline: 'New headline' } : {}) }
    const scope = { ...previous.scope, ...(kind === 'scope' ? { placement: 'Stories' } : {}) }
    const updated = saveDraft(approved, content, scope, 'Updated creative')
    expect(updated.status).toBe('Needs review')
    expect(updated.approvedVersionId).toBeUndefined()
    expect(updated.proposalVersionId).toBeUndefined()
    expect(updated.decisionNote).toBeUndefined()
    expect(currentVersion(updated).id).toBe(2)
    expect(updated.versions[0]).toEqual(previous)
    expect(approved.versions).toHaveLength(1)
    content.headline = 'Later external mutation'
    scope.placement = 'Later external mutation'
    expect(currentVersion(updated).content.headline).not.toBe(content.headline)
    expect(currentVersion(updated).scope.placement).not.toBe(scope.placement)
  })

  it('rejects edited and stale proposals, even if a caller retains the old proposal ID', () => {
    const pending = preapprove(submission(), 'Ready for creative')
    const version = currentVersion(pending)
    const changed = saveDraft(pending, { ...version.content, cta: 'Apply now' }, version.scope, 'CTA changed')
    expect(changed.proposalVersionId).toBeUndefined()
    expect(() => acceptProposal(changed)).toThrow('no pending adjustment')
    expect(() => acceptProposal({ ...changed, status: 'With creative', proposalVersionId: 1 })).toThrow('has changed')
  })

  it('rejects compliance decisions while creative is reviewing and after approval', () => {
    const pending = preapprove(submission(), 'Reviewed intended use.')
    const approved = acceptProposal(pending)
    for (const state of [pending, approved]) {
      expect(() => approveOriginal(state, '')).toThrow('awaiting compliance review')
      expect(() => preapprove(state, '')).toThrow('awaiting compliance review')
    }
  })

  it.each([preapprove, approveOriginal])('requires and preserves a decision rationale', (decide) => {
    expect(() => decide(submission(), '  \n ')).toThrow('Add a decision note')
    const decided = decide(submission(), ' Reviewed claim and disclosure. ')
    expect(decided.decisionNote).toBe('Reviewed claim and disclosure.')
    const version = currentVersion(decided)
    const edited = saveDraft(decided, { ...version.content, cta: 'Explore' }, version.scope, 'Revised CTA')
    expect(edited.decisionNote).toBeUndefined()
    expect(edited.events.some((entry) => entry.text.includes('Rationale: Reviewed claim and disclosure.'))).toBe(true)
  })
})

describe('feedback and accountability', () => {
  it('keeps the ownership wait clock unchanged by comments, check evidence, or previews', () => {
    const item = submission()
    item.events = [
      { id: 'submitted', actor: item.owner, text: 'Submitted v1 for review.', createdAt: '2026-11-01T10:00:00.000Z' },
      { id: 'preapproved', actor: item.reviewer, text: 'Pre-approved v1 and its intended use.', createdAt: '2026-11-01T11:00:00.000Z' },
      { id: 'commented', actor: item.reviewer, text: 'Commented on headline in v1.', createdAt: '2026-11-01T12:00:00.000Z' },
      { id: 'checked', actor: item.reviewer, text: 'Reviewed findings and requested a proposed draft.', createdAt: '2026-11-01T13:00:00.000Z' },
      { id: 'preview', actor: item.reviewer, text: 'Prepared the handoff preview.', createdAt: '2026-11-01T14:00:00.000Z', preview: { versionId: 1, decisionId: 'preapproved', kind: 'proposal', status: 'prepared' } },
    ]
    expect(waitingSince(item)).toBe('2026-11-01T11:00:00.000Z')
    const assigned = { ...item, events: [...item.events, { id: 'assigned', actor: item.reviewer, text: 'Assigned review to Sam Patel.', createdAt: '2026-11-01T15:00:00.000Z' }] }
    expect(waitingSince(assigned)).toBe('2026-11-01T15:00:00.000Z')
    expect(waitingSince({ ...assigned, status: 'With creative' })).toBe('2026-11-01T11:00:00.000Z')
    expect(waitingSince(submission())).toBe(submission().submittedAt)
  })

  it('preserves the actual Slack actor for acceptance and requested changes', () => {
    const pending = preapprove(submission(), 'Disclosure reviewed.')
    const accepted = acceptProposal(pending, 'Slack member U012345')
    expect(accepted.events.at(-1)?.actor).toBe('Slack member U012345')
    const returned = requestChanges(pending, 'Keep the original CTA.', 'Slack member U067890')
    expect(returned.events.at(-1)?.actor).toBe('Slack member U067890')
    expect(returned.comments.at(-1)?.author).toBe('Slack member U067890')
  })

  it('attributes a creative counter-edit and sends its exact new version for review', () => {
    const pending = preapprove(submission(), 'Disclosure reviewed.')
    const version = currentVersion(pending)
    const edited = counterEdit(pending, { ...version.content, headline: 'Our preferred headline' }, version.scope, ' Preserve our campaign voice. ')
    expect(edited.status).toBe('Needs review')
    expect(edited.proposalVersionId).toBeUndefined()
    expect(edited.approvedVersionId).toBeUndefined()
    expect(currentVersion(edited)).toMatchObject({ id: 2, author: pending.owner, note: 'Preserve our campaign voice.' })
    expect(edited.events.at(-1)?.actor).toBe(pending.owner)
    expect(pending.versions).toHaveLength(1)
    expect(() => acceptProposal(edited)).toThrow('no pending adjustment')
    const newlyApproved = acceptProposal(preapprove(edited, 'Updated headline reviewed.'))
    expect(newlyApproved.approvedVersionId).toBe(2)
  })

  it('requires counter-edit feedback and an active, current proposal', () => {
    const pending = preapprove(submission(), 'Disclosure reviewed.')
    const version = currentVersion(pending)
    expect(() => counterEdit(pending, version.content, version.scope, ' ')).toThrow('Explain the creative changes')
    expect(() => counterEdit(submission(), version.content, version.scope, 'Adjusted')).toThrow('no pending adjustment')
    const stale = { ...pending, proposalVersionId: 0 }
    expect(() => counterEdit(stale, version.content, version.scope, 'Adjusted')).toThrow('has changed')
  })

  it('requires specific creative feedback and returns ownership to compliance', () => {
    const pending = preapprove(submission(), 'Reviewed')
    expect(() => requestChanges(pending, '   ')).toThrow('Explain what needs to change')
    const returned = requestChanges(pending, ' Please keep the original CTA. ')
    expect(returned.status).toBe('Changes requested')
    expect(returned.proposalVersionId).toBeUndefined()
    expect(returned.approvedVersionId).toBeUndefined()
    expect(returned.comments.at(-1)).toMatchObject({
      author: pending.owner, text: 'Please keep the original CTA.', versionId: 1,
    })
    expect(() => requestChanges(returned, 'Again')).toThrow('no pending adjustment')
    expect(approveOriginal(returned, 'Agreed with creative.').approvedVersionId).toBe(1)
  })

  it('anchors comments to the reviewed version across subsequent edits', () => {
    const commented = addComment(submission(), 'Add the APR range.', 'Disclosure')
    const version = currentVersion(commented)
    const edited = saveDraft(commented, { ...version.content, disclosure: 'APR varies.' }, version.scope, '')
    expect(edited.comments[0]).toMatchObject({ versionId: 1, field: 'Disclosure', text: 'Add the APR range.' })
    expect(currentVersion(edited).id).toBe(2)
    expect(() => addComment(edited, '', 'Asset')).toThrow('Write a comment')
  })

  it('uses unique IDs even when events occur in quick succession', () => {
    let state = submission()
    for (let i = 0; i < 20; i += 1) state = addComment(state, `Comment ${i}`, 'Asset')
    const ids = [...state.comments, ...state.events].map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('records assignment without changing version or approval', () => {
    const approved = approveOriginal(submission(), 'Reviewed')
    const assigned = assignReviewer(approved, ' Sam Patel ')
    expect(assigned.reviewer).toBe('Sam Patel')
    expect(assigned.approvedVersionId).toBe(1)
    expect(assigned.events.at(-1)?.text).toContain('Sam Patel')
    expect(assignReviewer(assigned, 'Sam Patel')).toBe(assigned)
    expect(() => assignReviewer(assigned, ' ')).toThrow('Choose a reviewer')
  })
})

describe('CSV export', () => {
  it('includes status, ownership, scope, and exact approval version', () => {
    const csv = exportCsv([approveOriginal(submission(), 'Reviewed')])
    expect(csv).toContain('"Approved version"')
    expect(csv).toContain('"Approved","Jordan Lee","Alex Morgan"')
    expect(csv).toContain('"1","1","","Personal loan","US adults","Paid social","Feed"')
    expect(exportCsv([]).split('\r\n')).toHaveLength(1)
  })

  it('escapes quotes, commas, and line breaks inside cells', () => {
    const state = { ...submission(), title: 'Headline, "quoted"\nSecond line' }
    expect(exportCsv([state])).toContain('"Headline, ""quoted""\nSecond line"')
  })

  it.each(['=HYPERLINK("bad")', '+1+1', '-1+1', '@SUM(A1)', '  =1+1', '\tvalue', '\rvalue', '\nvalue'])(
    'neutralizes spreadsheet formulas and control prefixes: %j',
    (title) => {
      const csv = exportCsv([{ ...submission(), title }])
      expect(csv).toContain(`"'${title.replaceAll('"', '""')}"`)
    },
  )
})

import { describe, expect, it } from 'vitest'
import { approveChecked, checkSubmission, draftFeedback, generationPrompt, recordCheckReport, submitCheckFeedback } from './checker'
import { currentVersion, preapprove, returnForRevision, saveDraft, type AssetContent, type Scope, type Submission } from './domain'
import { fixes, seedSubmissions } from './seed'

const sample = (id: string) => seedSubmissions().find(item => item.id === id)!
const result = (item: Submission, id: string) => checkSubmission(item).checks.find(check => check.id === id)!
const fixed = (item: Submission) => saveDraft(item, fixes[item.fixture!].content, currentVersion(item).scope, 'Prepared demo draft')

describe('three distinct review outcomes', () => {
  it('keeps the six queue samples and provides a clean first guided scenario', () => {
    expect(seedSubmissions()).toHaveLength(6)
    const report = checkSubmission(sample('CP-1040'))
    expect(report.checks).toHaveLength(5)
    expect(report.checks.every(check => ['pass', 'not-applicable'].includes(check.status))).toBe(true)
    expect(report.canApprove).toBe(true)
    expect(report.canSuggestFix).toBe(false)
  })

  it('finds concrete loan copy/disclosure failures and clears the prepared repair', () => {
    const loan = sample('CP-1042')
    const report = checkSubmission(loan)
    expect(report.canApprove).toBe(false)
    expect(report.canSuggestFix).toBe(true)
    expect(result(loan, 'misleading-claim').status).toBe('fail')
    expect(result(loan, 'product-disclosure').status).toBe('fail')
    expect(checkSubmission(fixed(loan)).canApprove).toBe(true)
  })

  it('keeps California and affiliate evidence gaps open after the mortgage copy/image repair', () => {
    const mortgage = sample('CP-1041')
    const report = checkSubmission(mortgage)
    expect(result(mortgage, 'brand-palette').status).toBe('fail')
    expect(result(mortgage, 'misleading-claim').status).toBe('fail')
    expect(report.canSuggestFix).toBe(true)
    const repaired = fixed(mortgage)
    expect(result(repaired, 'brand-palette').status).toBe('pass')
    expect(result(repaired, 'misleading-claim').status).toBe('pass')
    expect(result(repaired, 'product-disclosure').status).toBe('pass')
    expect(result(repaired, 'state-review').status).toBe('needs-review')
    expect(result(repaired, 'affiliate-identity').status).toBe('needs-review')
    expect(checkSubmission(repaired).canApprove).toBe(false)
    expect(checkSubmission(repaired).canSuggestFix).toBe(false)
    expect(() => approveChecked(repaired, checkSubmission(repaired))).toThrow('Unresolved findings')
  })
})

describe('unknowns never become all-clear', () => {
  it('uses current palette metadata instead of fixture identity or presumed image analysis', () => {
    const item = sample('CP-1040')
    const version = currentVersion(item)
    expect(result(saveDraft(item, { ...version.content, palette: 'off-brand' }, version.scope, 'Changed artwork'), 'brand-palette').status).toBe('fail')
    expect(result(saveDraft(item, { ...version.content, palette: undefined }, version.scope, 'Unknown palette'), 'brand-palette').status).toBe('needs-review')
    expect(result(item, 'brand-palette').evidence).toContain('registered template')
    const newImage = saveDraft(item, { ...version.content, image: 'creative/new-artwork.png' }, version.scope, 'New image')
    expect(result(newImage, 'brand-palette').status).toBe('needs-review')
    expect(checkSubmission(newImage).canApprove).toBe(false)
  })

  it('does not clear arbitrary new copy merely because no banned phrase matched', () => {
    const item = sample('CP-1040')
    const version = currentVersion(item)
    const edited = saveDraft(item, { ...version.content, headline: 'New offer, new claims.' }, version.scope, 'New campaign')
    expect(result(edited, 'misleading-claim').status).toBe('needs-review')
    expect(checkSubmission(edited).canApprove).toBe(false)
  })

  it('checks unstructured extracted copy without treating an uploaded image as reviewed', () => {
    const item = sample('CP-1040')
    const version = currentVersion(item)
    const extracted = saveDraft(item, {
      ...version.content,
      image: 'upload:example',
      headline: 'ClearPath',
      body: 'Make more of your everyday.\nExplore the card.\nSubject to credit approval. See card agreement for rates, fees, and reward terms.',
      cta: '', disclosure: '',
    }, version.scope, 'Confirmed extracted text')
    expect(result(extracted, 'product-disclosure').status).toBe('pass')
    expect(result(extracted, 'brand-palette').status).toBe('needs-review')
    expect(checkSubmission(extracted).canApprove).toBe(false)
    const hiddenClaim = saveDraft(item, { ...version.content, disclosure: `${version.content.disclosure} Guaranteed approval.` }, version.scope, 'Changed text')
    expect(result(hiddenClaim, 'misleading-claim').status).toBe('fail')
  })

  it('does not offer a fixture generation action for arbitrary submissions', () => {
    const loan = sample('CP-1042')
    expect(checkSubmission({ ...loan, fixture: undefined }).canSuggestFix).toBe(false)
    expect(checkSubmission(loan).canSuggestFix).toBe(true)
  })

  it.each(['0% APR for 12 months', '$100 per month', '24 payments'])('requires expanded review for numerical terms: %s', text => {
    const item = sample('CP-1040')
    const version = currentVersion(item)
    const edited = saveDraft(item, { ...version.content, body: text }, version.scope, 'Offer terms')
    expect(result(edited, 'product-disclosure').status).toBe('needs-review')
    expect(checkSubmission(edited).canApprove).toBe(false)
  })

  it.each(['product', 'audience', 'channel', 'placement'] as (keyof Scope)[])('invalidates exact-scope review evidence when %s changes', key => {
    const item = sample('CP-1040')
    const version = currentVersion(item)
    const edited = saveDraft(item, version.content, { ...version.scope, [key]: key === 'channel' ? 'Unknown channel' : 'Different value' }, 'Scope change')
    expect(result(edited, 'state-review').status).toBe('needs-review')
    expect(checkSubmission(edited).canApprove).toBe(false)
  })

  it('does not confuse words containing ca with explicit California targeting', () => {
    const item = sample('CP-1040')
    const version = currentVersion(item)
    const unspecified = { ...item, reviewEvidence: undefined }
    expect(result(unspecified, 'state-review').evidence).not.toContain('California targeting is explicit')
    const california = saveDraft(unspecified, version.content, { ...version.scope, audience: 'CA adults' }, '')
    expect(result(california, 'state-review').evidence).toContain('California targeting is explicit')
  })

  it('treats partner display names and unsupported channels as unresolved, not proof', () => {
    const item = sample('CP-1041')
    expect(result(item, 'affiliate-identity').status).toBe('needs-review')
    const version = currentVersion(item)
    const unsupported = saveDraft(item, version.content, { ...version.scope, channel: 'Mystery distribution' }, '')
    expect(result(unsupported, 'affiliate-identity').status).toBe('needs-review')
  })
})

describe('check evidence is bound to the approved asset and use', () => {
  it('records the report and explicit limited policy basis on one-click approval', () => {
    const item = sample('CP-1040')
    const report = checkSubmission(item)
    const approved = approveChecked(item, report)
    expect(approved.status).toBe('Approved')
    expect(approved.approvedVersionId).toBe(report.versionId)
    expect(approved.checkReport).toEqual(report)
    expect(approved.checkReports).toEqual([report])
    expect(approved.events.at(-1)?.actor).toBe(item.reviewer)
    expect(approved.decisionNote).toContain('Reviewer confirmed v1 and its recorded use.')
    expect(() => approveChecked(approved, report)).toThrow('awaiting compliance review')
  })

  it.each(['headline', 'image', 'palette'] as (keyof AssetContent)[])('rejects a previously clear report after %s changes', key => {
    const item = sample('CP-1040')
    const report = checkSubmission(item)
    const version = currentVersion(item)
    const content = { ...version.content, [key]: key === 'palette' ? 'off-brand' : 'changed' } as AssetContent
    // Even an invalid caller that edits a version in place cannot reuse the old report.
    const changed = { ...item, versions: [{ ...version, content }] }
    expect(() => approveChecked(changed, report)).toThrow('changed')
  })

  it('rejects evidence changes, forged pass flags, and missing checks', () => {
    const item = sample('CP-1040')
    const report = checkSubmission(item)
    expect(() => approveChecked({ ...item, reviewEvidence: undefined }, report)).toThrow('changed')
    expect(() => approveChecked(item, { ...report, checks: [] })).toThrow('current policy pack')
    const mortgage = sample('CP-1041')
    expect(() => approveChecked(mortgage, { ...checkSubmission(mortgage), canApprove: true })).toThrow('current policy pack')
  })

  it('clears the active report on a new version but retains the approval audit', () => {
    const item = sample('CP-1040')
    const approved = approveChecked(item, checkSubmission(item))
    const version = currentVersion(approved)
    const changed = saveDraft(approved, version.content, { ...version.scope, placement: 'Different placement' }, 'Changed use')
    expect(changed.checkReport).toBeUndefined()
    expect(changed.checkReports).toHaveLength(1)
    expect(changed.approvedVersionId).toBeUndefined()
  })

  it('preserves the current successful check evidence with a creative preapproval', () => {
    const item = fixed(sample('CP-1042'))
    const report = checkSubmission(item)
    const pending = preapprove(recordCheckReport(item, report), 'Revised claim and disclosure checked.')
    expect(pending.checkReports).toHaveLength(1)
    expect(pending.checkReport?.fingerprint).toBe(report.fingerprint)
    expect(pending.events.at(-1)?.text).toContain(report.checkedAt)
    expect(() => recordCheckReport({ ...item, reviewEvidence: undefined }, report)).toThrow('changed')
  })
})

describe('reviewed feedback and human revision', () => {
  it('preserves exact original content, scope, failed specs, feedback, and source references in the generation request', () => {
    const item = sample('CP-1041')
    const report = checkSubmission(item)
    const feedback = `${draftFeedback(report)}\nKeep the home illustration.`
    const prompt = generationPrompt(item, report, feedback)
    expect(prompt).toContain(JSON.stringify(currentVersion(item).content, null, 2))
    expect(prompt).toContain(JSON.stringify(currentVersion(item).scope, null, 2))
    expect(prompt).toContain('Keep the home illustration.')
    expect(prompt).toContain('1014.3')
    expect(prompt).toContain('Do not invent license numbers')
    const submitted = submitCheckFeedback(item, report, feedback)
    expect(submitted.generationRequests?.[0]).toMatchObject({ versionId: 1, fingerprint: report.fingerprint, feedback, prompt })
    expect(submitted.comments.filter(comment => comment.field.startsWith('Spec · '))).toHaveLength(4)
    expect(submitted.comments.every(comment => comment.versionId === 1)).toBe(true)
    const repeated = submitCheckFeedback(submitted, report, feedback)
    expect(repeated.comments).toHaveLength(submitted.comments.length)
    expect(repeated.generationRequests).toHaveLength(1)
    const editedFeedback = submitCheckFeedback(repeated, report, `${feedback}\nKeep the CTA tone.`)
    expect(editedFeedback.comments).toHaveLength(submitted.comments.length)
    expect(editedFeedback.generationRequests).toHaveLength(2)
  })

  it('requires feedback, rejects stale check submissions, and blocks unresolved preapproval', () => {
    const item = sample('CP-1042')
    const report = checkSubmission(item)
    expect(() => submitCheckFeedback(item, report, ' ')).toThrow('Review the feedback')
    expect(() => submitCheckFeedback(fixed(item), report, 'Fix it.')).toThrow('changed')
    const submitted = submitCheckFeedback(item, report, draftFeedback(report))
    expect(() => preapprove(submitted, 'Looks good')).toThrow('unresolved findings')
  })

  it('returns blockers to creative without an acceptance path and requires a new version to resume', () => {
    const item = fixed(sample('CP-1041'))
    const report = checkSubmission(item)
    const returned = returnForRevision({ ...item, checkReport: report }, draftFeedback(report))
    expect(returned.status).toBe('Revision requested')
    expect(returned.proposalVersionId).toBeUndefined()
    expect(returned.approvedVersionId).toBeUndefined()
    expect(returned.decisionNote).toBe(draftFeedback(report))
    expect(returned.events.at(-1)?.text).toContain(`${item.owner} for revision`)
    expect(() => preapprove(returned, 'Reuse')).toThrow('awaiting compliance review')
    const version = currentVersion(returned)
    const revised = saveDraft(returned, version.content, version.scope, 'Added creative revision', returned.owner)
    expect(revised.status).toBe('Needs review')
    expect(currentVersion(revised).author).toBe(returned.owner)
    expect(checkSubmission(revised).canApprove).toBe(false)
  })

  it('records needs-review feedback for return without claiming generation or duplicating comments', () => {
    const item = fixed(sample('CP-1041'))
    const report = checkSubmission(item)
    const feedback = draftFeedback(report)
    expect(report.canSuggestFix).toBe(false)
    const recorded = submitCheckFeedback(item, report, feedback, false)
    expect(recorded.generationRequests).toBeUndefined()
    expect(recorded.comments.filter(comment => comment.field.startsWith('Spec · '))).toHaveLength(2)
    expect(recorded.events.at(-1)?.text).toContain(feedback)
    expect(recorded.events.at(-1)?.text).not.toContain('requested a proposed draft')
    const repeated = submitCheckFeedback(recorded, report, feedback, false)
    expect(repeated.comments).toHaveLength(recorded.comments.length)
    expect(repeated.events).toHaveLength(recorded.events.length)
    expect(returnForRevision(recorded, feedback).status).toBe('Revision requested')
  })
})

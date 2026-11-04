import { describe, expect, it } from 'vitest'
import { LIVE_POLICY_VERSION, LIVE_RULES } from '../shared/reviewPolicy.mjs'
import { sourceFingerprint } from '../shared/aiSnapshot.mjs'
import { aiSnapshot, approveLiveReview, currentLiveReport, recordLiveReport, type LiveReviewReport } from './ai'
import { currentVersion, saveDraft } from './domain'
import { seedSubmissions } from './seed'
function fixture() {
  const item = seedSubmissions().find(item => item.id === 'CP-1040')!
  const report: LiveReviewReport = {
    id: crypto.randomUUID(), policyVersion: LIVE_POLICY_VERSION, model: 'test-model', submissionId: item.id,
    versionId: 1, sourceFingerprint: sourceFingerprint(aiSnapshot(item)), sourceImageHash: 'hash', checkedAt: new Date().toISOString(),
    summary: 'All applicable requirements passed.', assetRelevant: true,
    checks: LIVE_RULES.map(rule => ({ id: rule.id, label: rule.label, category: rule.category, sources: rule.sources,
      applicability: 'applies', status: 'pass', evidence: 'Visible evidence', rationale: 'Matches policy' })),
    suggestedCopy: null, canApprove: true, canSuggestFix: false, canCreateConcept: false,
  }
  return { item, report }
}
describe('live assessment decision binding', () => {
  it('requires a current, complete live report for approval', () => {
    const { item, report } = fixture()
    expect(() => approveLiveReview(item, 'Clear')).toThrow()
    expect(approveLiveReview(recordLiveReport(item, report), 'Clear').status).toBe('Approved')
    report.checks.pop()
    expect(() => approveLiveReview(recordLiveReport(item, report), 'Clear')).toThrow()
  })
  it('does not approve an irrelevant asset even if flags are inconsistent', () => {
    const { item, report } = fixture()
    report.assetRelevant = false
    expect(() => approveLiveReview(recordLiveReport(item, report), 'Clear')).toThrow()
  })
  it.each(['jurisdiction', 'affiliatePartner', 'placement'] as const)('invalidates results when %s changes', field => {
    const { item, report } = fixture()
    const reviewed = recordLiveReport(item, report)
    Object.assign(currentVersion(reviewed).scope, { [field]: 'Changed' })
    expect(currentLiveReport(reviewed)).toBeUndefined()
    expect(() => approveLiveReview(reviewed, 'Clear')).toThrow()
  })
  it('retains review history but requires a fresh result for generated pixels', () => {
    const { item, report } = fixture()
    const reviewed = recordLiveReport(item, report)
    const revised = saveDraft(reviewed, { ...currentVersion(item).content, image: 'upload:new-pixels' }, currentVersion(item).scope, 'AI correction')
    expect(revised.liveReview).toBeUndefined()
    expect(revised.liveReviews).toHaveLength(1)
    expect(() => approveLiveReview(revised, 'Clear')).toThrow()
    expect(() => recordLiveReport(revised, report)).toThrow()
  })
  it('manual reviewer changes also require creative acceptance', () => {
    const { item, report } = fixture()
    const changed = saveDraft(item, { ...currentVersion(item).content, headline: 'Explore a new option' }, currentVersion(item).scope, 'Manual edit')
    const checked = { ...report, versionId: 2, sourceFingerprint: sourceFingerprint(aiSnapshot(changed)) }
    expect(approveLiveReview(recordLiveReport(changed, checked), 'Checked').status).toBe('With creative')
  })
  it('a reviewed AI correction waits for creative acceptance', () => {
    const { item, report } = fixture()
    currentVersion(item).aiGeneration = { reviewId: 'original-report', model: 'image-model', createdAt: report.checkedAt }
    const approved = approveLiveReview(recordLiveReport(item, report), 'Revised pixels checked')
    expect(approved.status).toBe('With creative')
    expect(approved.approvedVersionId).toBeUndefined()
    expect(approved.proposalVersionId).toBe(1)
  })
})

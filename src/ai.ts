import { LIVE_POLICY_VERSION, LIVE_RULES, type PolicySource, type LiveRuleId } from '../shared/reviewPolicy.mjs'
import { sourceFingerprint } from '../shared/aiSnapshot.mjs'
import { approveOriginal, currentVersion, preapprove, type AssetContent, type Submission } from './domain'
import { isUploadedImage, prepareCorrectedImage, prepareUploadedImage, readUploadedImage, storeUploadedImage, type UploadedImage } from './uploads'

export type EvidenceRegion = { quote: string; x: number; y: number; width: number; height: number }
export type LiveReviewCheck = {
  id: LiveRuleId; label: string; category: string; sources: PolicySource[];
  applicability: 'applies' | 'not-applicable' | 'unknown';
  status: 'pass' | 'fail' | 'needs-review' | 'not-applicable';
  evidence: string; rationale: string; fix?: string; regions?: EvidenceRegion[];
}
export type LiveReviewReport = {
  id: string; policyVersion: string; model: string; submissionId: string; versionId: number;
  sourceFingerprint: string; sourceImageHash: string; checkedAt: string; summary: string;
  assetRelevant: boolean; checks: LiveReviewCheck[];
  suggestedCopy: Pick<AssetContent, 'headline' | 'body' | 'disclosure' | 'cta'> | null;
  canApprove: boolean; canSuggestFix: boolean; canCreateConcept: boolean;
}
export type AIHealth = { available: boolean; imageEditingAvailable: boolean; reviewModel: string | null; imageModel: string | null; budgetAvailable: boolean }
const API = (import.meta.env.VITE_AI_API_URL || import.meta.env.VITE_SLACK_API_URL || '').replace(/\/+$/, '')
const attempts = new Map<string, string>()
const previews = new Map<string, string>()
const reviewedRasters = new Map<string, string>()
const RASTER_STORAGE = 'clearpath-review-raster:'
async function rasterHash(image: string): Promise<string> {
  const bytes = Uint8Array.from(atob(image.slice(image.indexOf(',') + 1)), value => value.charCodeAt(0))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
}
export async function evidenceImage(item: Submission): Promise<string> {
  const report = currentLiveReport(item)
  if (!report) throw new Error('Review the current version to locate its text.')
  let saved = reviewedRasters.get(report.sourceImageHash)
  if (!saved) { try { saved = localStorage.getItem(`${RASTER_STORAGE}${report.sourceImageHash}`) || undefined } catch {} }
  const image = saved || await reviewedAssetImage(item)
  if (await rasterHash(image) !== report.sourceImageHash) throw new Error('The reviewed image is unavailable. Run a new assessment to locate text on this preview.')
  return image
}
export function aiSnapshot(item: Submission) {
  const version = currentVersion(item)
  return { submissionId: item.id, versionId: version.id, content: version.content, scope: version.scope }
}
export function currentLiveReport(item: Submission): LiveReviewReport | undefined {
  const report = item.liveReview
  return report?.policyVersion === LIVE_POLICY_VERSION && report.sourceFingerprint === sourceFingerprint(aiSnapshot(item))
    && report.submissionId === item.id && report.versionId === currentVersion(item).id ? report : undefined
}
export function recordLiveReport(item: Submission, report: LiveReviewReport): Submission {
  const next = { ...item, liveReview: report }
  if (!currentLiveReport(next)) throw new Error('The asset or intended use changed while the review ran. Review the current version.')
  return { ...next, liveReviews: [...(item.liveReviews ?? []).filter(value => value.id !== report.id), report],
    events: [...item.events, { id: crypto.randomUUID(), actor: item.reviewer, text: `Reviewed v${report.versionId} with ${report.model} against ${report.policyVersion}. ${report.summary}`, createdAt: report.checkedAt }] }
}
export function approveLiveReview(item: Submission, note: string): Submission {
  const report = currentLiveReport(item)
  if (!report?.canApprove || !report.assetRelevant || report.checks.length !== LIVE_RULES.length
    || !LIVE_RULES.every(rule => report.checks.some(check => check.id === rule.id && ['pass', 'not-applicable'].includes(check.status)))) {
    throw new Error('Run a complete review of this version and resolve every finding before approval.')
  }
  // Prepared checks belong to the older policy pack and cannot authorize a live decision.
  const reviewed = { ...item, checkReport: undefined }
  const version = currentVersion(item)
  const reviewerChangedAsset = version.id > 1 && version.author === item.reviewer
  return version.aiGeneration || reviewerChangedAsset ? preapprove(reviewed, note) : approveOriginal(reviewed, note)
}
async function request(path: string, body?: object): Promise<any> {
  if (!API) throw new Error('Live AI is not configured for this deployment.')
  const response = await fetch(`${API}/v1/ai/${path}`, { method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(185000) })
  const result = await response.json()
  if (!response.ok) {
    const error = new Error(typeof result.error === 'string' ? result.error : 'The AI request could not finish.')
    Object.assign(error, { definitive: result.code !== 'request_pending', code: result.code })
    throw error
  }
  return result
}
export async function aiHealth(): Promise<AIHealth> { return request('health') }
export type AIUsage = {
  scope: 'demo-only'; currency: 'USD'; estimatedUsd: number; trackedCalls: number; untrackedCalls: number; totalCalls: number;
  providers: { provider: string; model: string; estimatedUsd: number; trackedCalls: number; untrackedCalls: number; totalCalls: number }[];
  budget: { reservedUsd: number; protectedUsd: number; limitUsd: number; accounting: 'usage-with-conservative-reserves';
    expiresAt?: string | null; providers?: { provider: string; protectedUsd: number; limitUsd: number | null }[] };
  limits?: { review: { perMinute: number; perHour: number; perDay: number }; edit: { perMinute: number; perHour: number; perDay: number }; concurrent: number; expiresAt: string | null };
  pricingVerifiedAt: string; note: string;
}
export async function aiUsage(): Promise<AIUsage> { return request('usage') }
export async function reviewedAssetImage(item: Submission): Promise<string> {
  const content = currentVersion(item).content
  const fingerprint = sourceFingerprint(aiSnapshot(item))
  const cached = previews.get(fingerprint)
  if (cached) return cached
  let image: string
  if (isUploadedImage(content.image)) {
    const stored = readUploadedImage(content.image)
    if (!stored) throw new Error('The original image is unavailable in this browser. Ask creative to upload it again.')
    image = stored
  } else if (content.image) {
    // Only bundled creatives are loaded; user-provided URLs are never fetched.
    if (!/^creative\/[a-z0-9-]+\.(png|jpg|jpeg)$/.test(content.image)) throw new Error('Upload the original image before reviewing it.')
    const response = await fetch(`${import.meta.env.BASE_URL}${content.image}`)
    if (!response.ok) throw new Error('The original creative could not be loaded.')
    const blob = await response.blob()
    image = (await prepareUploadedImage(new File([blob], 'creative.png', { type: blob.type }))).dataUrl
  } else {
    const { renderAsset } = await import('./renderAsset')
    image = await renderAsset(content)
  }
  previews.set(fingerprint, image)
  return image
}
async function paidRequest(path: string, item: Submission, extras: object = {}): Promise<any> {
  const snapshot = aiSnapshot(item)
  const assetImage = path === 'edits' ? await evidenceImage(item) : await reviewedAssetImage(item)
  const key = JSON.stringify([path, sourceFingerprint(snapshot), extras])
  const requestId = attempts.get(key) ?? crypto.randomUUID()
  attempts.set(key, requestId)
  try {
    const result = await request(path, { ...snapshot, requestId, assetImage, ...extras })
    attempts.delete(key)
    return result
  } catch (error) {
    // A transport timeout may hide a completed, billed result. Reuse its ID on retry.
    if ((error as { definitive?: boolean }).definitive) attempts.delete(key)
    throw error
  }
}
export async function reviewAsset(item: Submission): Promise<LiveReviewReport> {
  const report = await paidRequest('reviews', item) as LiveReviewReport
  if (!Array.isArray(report.checks) || report.checks.length !== LIVE_RULES.length
    || new Set(report.checks.map(check => check.id)).size !== LIVE_RULES.length
    || !report.checks.every(check => LIVE_RULES.some(rule => rule.id === check.id)
      && ['pass', 'fail', 'needs-review', 'not-applicable'].includes(check.status))
    || !currentLiveReport({ ...item, liveReview: report })) throw new Error('The provider returned an incomplete or mismatched review. Nothing was approved.')
  // Source links always come from the shipped policy pack, never generated URLs.
  report.checks = report.checks.map(check => ({ ...check, sources: LIVE_RULES.find(rule => rule.id === check.id)!.sources }))
  report.canApprove = report.assetRelevant && report.checks.every(check => ['pass', 'not-applicable'].includes(check.status))
  const raster = previews.get(sourceFingerprint(aiSnapshot(item)))
  if (raster && await rasterHash(raster) === report.sourceImageHash) {
    reviewedRasters.set(report.sourceImageHash, raster)
    // Uploaded pixels already persist. Templates need their exact reviewed
    // raster: responsive CSS or a later release can change a fresh rendering.
    if (!isUploadedImage(currentVersion(item).content.image)) {
      try { localStorage.setItem(`${RASTER_STORAGE}${report.sourceImageHash}`, raster) } catch { /* Hash verification hides unavailable locations after reload. */ }
    }
  }
  return report
}
export async function editAsset(item: Submission, feedback: string): Promise<{ content: AssetContent; provenance: { reviewId: string; model: string; createdAt: string; mode?: string } }> {
  const report = currentLiveReport(item)
  if (!report || !(report.canSuggestFix || report.canCreateConcept)) throw new Error('Run a live review with a supported correction first.')
  const reviewedImage = await evidenceImage(item)
  const result = await paidRequest('edits', item, { reviewId: report.id, feedback, mode: report.canCreateConcept ? "replacement-concept" : "correction" })
  if (result.sourceFingerprint !== report.sourceFingerprint || result.sourceImageHash !== report.sourceImageHash
    || result.reviewId !== report.id || result.requiresReview !== true || !/^data:image\/(png|jpeg);base64,/.test(result.assetImage)) {
    throw new Error('The correction did not match this reviewed asset. Nothing was replaced.')
  }
  // An unrelated source is inspiration for a new placement, not its canvas.
  let image: UploadedImage
  if (report.canCreateConcept) {
    const blob = await (await fetch(result.assetImage)).blob()
    image = await prepareUploadedImage(new File([blob], 'ai-concept.jpg', { type: blob.type }))
  } else {
    image = await prepareCorrectedImage(result.assetImage, reviewedImage)
  }
  storeUploadedImage(image)
  return { content: { ...currentVersion(item).content, ...result.proposedCopy, image: image.reference },
    provenance: { reviewId: report.id, model: result.provenance.model, createdAt: result.provenance.createdAt, mode: result.provenance.mode } }
}

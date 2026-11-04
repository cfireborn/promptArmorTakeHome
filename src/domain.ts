import type { CheckReport, GenerationRequest } from './checker'
import type { LiveReviewReport } from './ai'

export type Scope = {
  product: string
  audience: string
  channel: string
  placement: string
  jurisdiction?: 'California' | 'Other US jurisdiction' | 'Unspecified'
  affiliatePartner?: 'None' | 'Homewise' | 'Other'
}

export type AssetContent = {
  headline: string
  body: string
  disclosure: string
  cta: string
  art: 'sunrise' | 'home' | 'card'
  image?: string
  palette?: 'brand' | 'off-brand'
}

export type Version = {
  id: number
  content: AssetContent
  scope: Scope
  createdAt: string
  author: string
  note: string
  aiGeneration?: { reviewId: string; model: string; createdAt: string; mode?: string }
}

export type Comment = {
  id: string
  author: string
  text: string
  createdAt: string
  versionId: number
  field: string
}

export type Event = {
  id: string
  actor: string
  text: string
  createdAt: string
  preview?: {
    versionId: number
    decisionId: string
    kind: 'approved' | 'revision_requested' | 'proposal'
    status: 'prepared' | 'accepted' | 'acknowledged'
  }
}

export type Submission = {
  id: string
  title: string
  owner: string
  reviewer: string
  priority: 'High' | 'Normal'
  due: string
  submittedAt: string
  status: 'Needs review' | 'With creative' | 'Changes requested' | 'Revision requested' | 'Approved'
  versions: Version[]
  comments: Comment[]
  events: Event[]
  approvedVersionId?: number
  proposalVersionId?: number
  decisionNote?: string
  fixture?: 'loan' | 'mortgage'
  registeredUpload?: { sample: 'card' | 'loan' | 'mortgage'; image: string }
  reviewEvidence?: {
    scope: Scope
    stateReview?: string
    affiliateIdentity?: string
    affiliateReview?: string
  }
  checkReport?: CheckReport
  checkReports?: CheckReport[]
  generationRequests?: GenerationRequest[]
  liveReview?: LiveReviewReport
  liveReviews?: LiveReviewReport[]
}

export function currentVersion(submission: Submission): Version {
  const version = submission.versions.at(-1)
  if (!version) throw new Error('This submission has no asset version to review.')
  return version
}

export function waitingSince(submission: Submission): string {
  const reviewerOwnsNext = submission.status !== 'With creative' && submission.status !== 'Revision requested'
  return [...submission.events].reverse().find(entry =>
    /^(Submitted|Saved|Pre-approved|Returned|Requested changes)\b/.test(entry.text)
    || (reviewerOwnsNext && /^Assigned review\b/.test(entry.text)),
  )?.createdAt ?? submission.submittedAt
}

function event(actor: string, text: string): Event {
  return { id: crypto.randomUUID(), actor, text, createdAt: new Date().toISOString() }
}

function requireReview(submission: Submission) {
  if (submission.status !== 'Needs review' && submission.status !== 'Changes requested') {
    throw new Error('Only an asset awaiting compliance review can receive a new decision.')
  }
}

function requireProposal(submission: Submission) {
  if (submission.status !== 'With creative' || submission.proposalVersionId === undefined) {
    throw new Error('There is no pending adjustment for creative to review.')
  }
  if (submission.proposalVersionId !== currentVersion(submission).id) {
    throw new Error('This adjustment has changed. Compliance must review the current version first.')
  }
}

export function saveDraft(
  submission: Submission,
  content: AssetContent,
  scope: Scope,
  note: string,
  author: string = submission.reviewer,
): Submission {
  const version: Version = {
    id: Math.max(0, ...submission.versions.map((item) => item.id)) + 1,
    content: { ...content },
    scope: { ...scope },
    author,
    createdAt: new Date().toISOString(),
    note: note.trim() || 'Updated asset or intended use.',
  }
  return {
    ...submission,
    status: 'Needs review',
    versions: [...submission.versions, version],
    approvedVersionId: undefined,
    proposalVersionId: undefined,
    decisionNote: undefined,
    checkReport: undefined,
    liveReview: undefined,
    events: [
      ...submission.events,
      event(author, `Saved v${version.id}. Asset and scope require a new compliance decision.`),
    ],
  }
}

export function addComment(submission: Submission, text: string, field: string): Submission {
  if (!text.trim()) throw new Error('Write a comment before adding it.')
  const versionId = currentVersion(submission).id
  const comment: Comment = {
    id: crypto.randomUUID(),
    author: submission.reviewer,
    text: text.trim(),
    createdAt: new Date().toISOString(),
    versionId,
    field,
  }
  return {
    ...submission,
    comments: [...submission.comments, comment],
    events: [...submission.events, event(submission.reviewer, `Commented on ${field || 'asset'} in v${versionId}.`)],
  }
}

export function preapprove(submission: Submission, note: string): Submission {
  requireReview(submission)
  if (!note.trim()) throw new Error('Add a decision note explaining the compliance rationale.')
  if (submission.checkReport && !submission.checkReport.canApprove) {
    throw new Error('The current check report still has unresolved findings. Resolve them or return this asset for revision.')
  }
  const versionId = currentVersion(submission).id
  if (submission.checkReport && submission.checkReport.versionId !== versionId) {
    throw new Error('The check report belongs to an older asset version. Run checks again.')
  }
  return {
    ...submission,
    status: 'With creative',
    proposalVersionId: versionId,
    approvedVersionId: undefined,
    decisionNote: note.trim(),
    checkReports: submission.checkReport && !submission.checkReports?.some(report => report.fingerprint === submission.checkReport!.fingerprint)
      ? [...(submission.checkReports ?? []), structuredClone(submission.checkReport)] : submission.checkReports,
    events: [
      ...submission.events,
      event(submission.reviewer, `Pre-approved v${versionId} and its intended use. Awaiting creative acceptance. Rationale: ${note.trim()}${submission.checkReport ? ` Checked against the saved policy report at ${submission.checkReport.checkedAt}.` : ''}`),
    ],
  }
}

export function acceptProposal(submission: Submission, actor: string = submission.owner): Submission {
  requireProposal(submission)
  const versionId = currentVersion(submission).id
  return {
    ...submission,
    status: 'Approved',
    approvedVersionId: versionId,
    proposalVersionId: undefined,
    events: [
      ...submission.events,
      event(actor, `Accepted the compliance adjustment. v${versionId} is approved for its recorded intended use.`),
    ],
  }
}

export function requestChanges(submission: Submission, feedback: string, actor: string = submission.owner): Submission {
  requireProposal(submission)
  if (!feedback.trim()) throw new Error('Explain what needs to change so compliance can respond.')
  const versionId = currentVersion(submission).id
  return {
    ...submission,
    status: 'Changes requested',
    proposalVersionId: undefined,
    approvedVersionId: undefined,
    decisionNote: undefined,
    comments: [
      ...submission.comments,
      {
        id: crypto.randomUUID(),
        author: actor,
        text: feedback.trim(),
        createdAt: new Date().toISOString(),
        versionId,
        field: 'Creative feedback',
      },
    ],
    events: [...submission.events, event(actor, `Requested changes to v${versionId}: ${feedback.trim()}`)],
  }
}

export function counterEdit(
  submission: Submission,
  content: AssetContent,
  scope: Scope,
  feedback: string,
): Submission {
  requireProposal(submission)
  if (!feedback.trim()) throw new Error('Explain the creative changes so compliance can review them.')
  return saveDraft(submission, content, scope, feedback, submission.owner)
}

export function returnForRevision(submission: Submission, feedback: string): Submission {
  requireReview(submission)
  if (!feedback.trim()) throw new Error('Explain what creative needs to revise before returning this asset.')
  const versionId = currentVersion(submission).id
  return {
    ...submission,
    status: 'Revision requested',
    approvedVersionId: undefined,
    proposalVersionId: undefined,
    decisionNote: feedback.trim(),
    comments: [...submission.comments, {
      id: crypto.randomUUID(), author: submission.reviewer, text: feedback.trim(),
      createdAt: new Date().toISOString(), versionId, field: 'Revision request',
    }],
    events: [...submission.events, event(submission.reviewer, `Returned v${versionId} to ${submission.owner} for revision. Next action owner: creative. ${feedback.trim()}`)],
  }
}

export function approveOriginal(submission: Submission, note: string): Submission {
  requireReview(submission)
  if (!note.trim()) throw new Error('Add a decision note explaining the compliance rationale.')
  const versionId = currentVersion(submission).id
  return {
    ...submission,
    status: 'Approved',
    approvedVersionId: versionId,
    proposalVersionId: undefined,
    decisionNote: note.trim(),
    events: [
      ...submission.events,
      event(submission.reviewer, `Approved v${versionId} for its recorded product, audience, channel, and placement. Rationale: ${note.trim()}`),
    ],
  }
}

export function assignReviewer(submission: Submission, reviewer: string): Submission {
  if (!reviewer.trim()) throw new Error('Choose a reviewer to assign this submission.')
  if (submission.reviewer === reviewer.trim()) return submission
  return {
    ...submission,
    reviewer: reviewer.trim(),
    events: [...submission.events, event(submission.reviewer, `Assigned review to ${reviewer.trim()}.`)],
  }
}

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? '')
  // Quoting alone does not stop spreadsheet formulas. Preserve the original text as a literal.
  const safe = /^[\s]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

export function exportCsv(submissions: Submission[]): string {
  const headings = [
    'ID', 'Title', 'Status', 'Creative owner', 'Compliance reviewer', 'Priority', 'Due',
    'Current version', 'Approved version', 'Proposed version', 'Product', 'Audience',
    'Channel', 'Placement', 'Decision note',
  ]
  const rows = submissions.map((submission) => {
    const version = currentVersion(submission)
    return [
      submission.id, submission.title, submission.status, submission.owner, submission.reviewer,
      submission.priority, submission.due, version.id, submission.approvedVersionId,
      submission.proposalVersionId, version.scope.product, version.scope.audience,
      version.scope.channel, version.scope.placement, submission.decisionNote,
    ].map(csvCell).join(',')
  })
  return [headings.map(csvCell).join(','), ...rows].join('\r\n')
}

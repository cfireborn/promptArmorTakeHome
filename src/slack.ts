import { useEffect, useRef, useState } from 'react'
import { acceptProposal, currentVersion, requestChanges, type AssetContent, type Scope, type Submission } from './domain'

export const SLACK_API = (import.meta.env.VITE_SLACK_API_URL || '').replace(/\/+$/, '')
const STORAGE_KEY = 'clearpath-live-slack-v1'
const contentKeys: (keyof AssetContent)[] = ['headline', 'body', 'disclosure', 'cta', 'art']
const scopeKeys: (keyof Scope)[] = ['product', 'audience', 'channel', 'placement']

export type SlackRecipient = { owner: string; slackUserId: string; displayName: string; isProxy: boolean; channelId?: string; channelName?: string | null }
export type ReviewerSlackNotification = { recipient: SlackRecipient; delivery: 'not_sent' | 'sending' | 'sent' | 'failed' | 'uncertain'; slackMessageUrl: string | null }
type SlackRoute = { name: string; channelName: string | null; channelId: string }
export type SlackSession = { token: string; expiresAt: string; channel: string; routing?: { owners: SlackRoute[]; reviewers: SlackRoute[] } }
type AssetSnapshot = { id: number; content: AssetContent; scope: Scope }
type SourceSnapshot = { submissionId: string; assetVersion: AssetSnapshot }
export type SlackProposal = {
  id: string
  status: 'pending' | 'accepted' | 'changes_requested' | 'superseded'
  delivery: 'sending' | 'sent' | 'failed' | 'uncertain'
  sourceSnapshot: SourceSnapshot
  slackMessageUrl: string | null
  createdAt: string
  updatedAt: string
  feedback: string | null
  decidedAt: string | null
  decidedBy: string | null
  recipient?: SlackRecipient | null
  reviewerNotification?: ReviewerSlackNotification | null
}
type ProposalRequest = {
  clientRequestId: string
  submissionId: string
  title: string
  reviewer: string
  owner: string
  assetVersion: AssetSnapshot
  originalContent: AssetContent
  rationale: string
  assetImage?: string
}
export type SlackLink = {
  request: ProposalRequest
  decisionEventId?: string
  proposal?: SlackProposal
  applied: boolean
  stale: boolean
  retirement?: 'pending' | 'complete' | 'failed'
  error?: string
}
type Links = Record<string, SlackLink>
export type NotificationKind = 'approved' | 'revision_requested'
type NotificationRequest = Omit<ProposalRequest, 'originalContent' | 'rationale'> & { kind: NotificationKind; note: string }
export type SlackNotification = {
  id: string; kind: NotificationKind; status: 'noted' | 'awaiting_acknowledgment' | 'acknowledged'
  delivery: SlackProposal['delivery']; sourceSnapshot: SourceSnapshot; slackMessageUrl: string | null
  reviewerNotification?: ReviewerSlackNotification | null
  recipient: SlackRecipient; createdAt: string; updatedAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null
}
export type SlackNotificationLink = { request: NotificationRequest; decisionEventId?: string; notification?: SlackNotification; error?: string }
type Notifications = Record<string, SlackNotificationLink>
type StoredConnection = { endpoint: string; session: SlackSession; links: Links; notifications?: Notifications }

export function slackChannelName(recipient: SlackRecipient | undefined | null, fallback = 'Slack'): string {
  return recipient?.channelName ? `#${recipient.channelName}` : recipient?.channelId || fallback
}

export function reviewerNoticePending(record: SlackProposal | SlackNotification): boolean {
  return ['accepted', 'changes_requested', 'acknowledged'].includes(record.status)
    && !!record.reviewerNotification && ['not_sent', 'sending'].includes(record.reviewerNotification.delivery)
}

function isReviewerNotice(value: unknown): boolean {
  if (value == null) return true
  if (typeof value !== 'object') return false
  const notice = value as ReviewerSlackNotification
  return !!notice.recipient && typeof notice.recipient.owner === 'string'
    && typeof notice.recipient.displayName === 'string' && typeof notice.recipient.isProxy === 'boolean'
    && /^U[A-Z0-9]{8,20}$/.test(notice.recipient.slackUserId)
    && typeof notice.recipient.channelId === 'string' && /^[CG][A-Z0-9]{8,20}$/.test(notice.recipient.channelId)
    && (notice.recipient.channelName == null || /^[a-z0-9_-]{1,80}$/.test(notice.recipient.channelName))
    && ['not_sent', 'sending', 'sent', 'failed', 'uncertain'].includes(notice.delivery)
    && (notice.slackMessageUrl === null || typeof notice.slackMessageUrl === 'string')
}

function isAsset(value: unknown): value is AssetSnapshot {
  if (!value || typeof value !== 'object') return false
  const asset = value as AssetSnapshot
  return Number.isInteger(asset.id) && asset.id > 0 && !!asset.content && !!asset.scope
    && contentKeys.every(key => typeof asset.content[key] === 'string')
    && ['sunrise', 'home', 'card'].includes(asset.content.art)
    && (asset.content.image === undefined || typeof asset.content.image === 'string')
    && (asset.content.palette === undefined || ['brand', 'off-brand'].includes(asset.content.palette))
    && scopeKeys.every(key => typeof asset.scope[key] === 'string')
}

function isSession(value: unknown): value is SlackSession {
  if (!value || typeof value !== 'object') return false
  const session = value as SlackSession
  return typeof session.token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(session.token)
    && typeof session.channel === 'string' && typeof session.expiresAt === 'string'
    && Date.parse(session.expiresAt) > Date.now()
    && (session.routing === undefined || (!!session.routing
      && ['owners', 'reviewers'].every(key => Array.isArray(session.routing![key as 'owners' | 'reviewers'])
        && session.routing![key as 'owners' | 'reviewers'].every(route => route && typeof route.name === 'string'
          && typeof route.channelId === 'string' && (route.channelName === null || typeof route.channelName === 'string')))))
}

function isProposal(value: unknown): value is SlackProposal {
  if (!value || typeof value !== 'object') return false
  const proposal = value as SlackProposal
  return typeof proposal.id === 'string' && /^[a-f0-9-]{36}$/.test(proposal.id)
    && ['pending', 'accepted', 'changes_requested', 'superseded'].includes(proposal.status)
    && ['sending', 'sent', 'failed', 'uncertain'].includes(proposal.delivery)
    && !!proposal.sourceSnapshot && typeof proposal.sourceSnapshot.submissionId === 'string'
    && isAsset(proposal.sourceSnapshot.assetVersion)
    && (proposal.decidedBy === null || typeof proposal.decidedBy === 'string')
    && (proposal.feedback === null || typeof proposal.feedback === 'string')
    && (proposal.slackMessageUrl === null || typeof proposal.slackMessageUrl === 'string')
    && isReviewerNotice(proposal.reviewerNotification)
}

function sameAsset(left: AssetSnapshot, right: AssetSnapshot): boolean {
  return left.id === right.id
    && contentKeys.every(key => left.content[key] === right.content[key])
    && (left.content.image || '') === (right.content.image || '')
    && (left.content.palette ?? 'brand') === (right.content.palette ?? 'brand')
    && scopeKeys.every(key => left.scope[key] === right.scope[key])
    && (left.scope.jurisdiction || "") === (right.scope.jurisdiction || "")
    && (left.scope.affiliatePartner || "") === (right.scope.affiliatePartner || "")
}

export function matchesSlackSnapshot(item: Submission | undefined, source: SourceSnapshot): boolean {
  return !!item && item.id === source.submissionId && sameAsset(currentVersion(item), source.assetVersion)
}

export function canSendToSlack(item: Submission): boolean {
  return item.status === 'With creative' && item.proposalVersionId === currentVersion(item).id && !!item.decisionNote?.trim()
}
export function canNotifySlack(item: Submission, kind: NotificationKind): boolean {
  return kind === 'approved'
    ? item.status === 'Approved' && item.approvedVersionId === currentVersion(item).id
    : item.status === 'Revision requested'
}
export function matchesNotification(item: Submission, link: SlackNotificationLink): boolean {
  return !!link.decisionEventId && link.decisionEventId === notificationEventId(item, link.request.kind)
    && canNotifySlack(item, link.request.kind) && item.owner === link.request.owner
    && matchesSlackSnapshot(item, { submissionId: link.request.submissionId, assetVersion: link.request.assetVersion })
}
function notificationEventId(item: Submission, kind: NotificationKind): string | undefined {
  return [...item.events].reverse().find(entry => kind === 'revision_requested'
    ? entry.text.startsWith('Returned v')
    : entry.text.startsWith('Approved v') || entry.text.startsWith('Accepted the compliance adjustment.'))?.id
}
function isNotification(value: unknown): value is SlackNotification {
  if (!value || typeof value !== 'object') return false
  const item = value as SlackNotification
  return /^[a-f0-9-]{36}$/.test(item.id) && ['approved', 'revision_requested'].includes(item.kind)
    && ['noted', 'awaiting_acknowledgment', 'acknowledged'].includes(item.status)
    && ['sending', 'sent', 'failed', 'uncertain'].includes(item.delivery)
    && !!item.sourceSnapshot && typeof item.sourceSnapshot.submissionId === 'string' && isAsset(item.sourceSnapshot.assetVersion)
    && !!item.recipient && typeof item.recipient.owner === 'string' && /^U[A-Z0-9]{8,20}$/.test(item.recipient.slackUserId)
    && typeof item.recipient.displayName === 'string' && typeof item.recipient.isProxy === 'boolean'
    && (item.slackMessageUrl === null || typeof item.slackMessageUrl === 'string')
    && isReviewerNotice(item.reviewerNotification)
}

export function applySlackDecision(item: Submission, proposal: SlackProposal): Submission | null {
  if (proposal.delivery !== 'sent' || !canSendToSlack(item) || !matchesSlackSnapshot(item, proposal.sourceSnapshot)
    || !proposal.decidedBy?.trim()) return null
  const actor = `Slack member ${proposal.decidedBy}`
  if (proposal.status === 'accepted') return acceptProposal(item, actor)
  if (proposal.status === 'changes_requested' && proposal.feedback?.trim()) return requestChanges(item, proposal.feedback, actor)
  return null
}

function sourceFor(link: SlackLink): SourceSnapshot {
  return { submissionId: link.request.submissionId, assetVersion: link.request.assetVersion }
}

function decisionEventId(item: Submission): string | undefined {
  return [...item.events].reverse().find(entry => entry.text.startsWith('Pre-approved'))?.id
}

export function matchesCurrentHandoff(item: Submission | undefined, link: SlackLink): boolean {
  return !!item && !!link.decisionEventId && link.decisionEventId === decisionEventId(item)
    && matchesSlackSnapshot(item, sourceFor(link))
}

function isStale(link: SlackLink, item: Submission | undefined): boolean {
  if (!matchesCurrentHandoff(item, link) || !item) return true
  if (!link.applied) return !canSendToSlack(item)
  return link.proposal?.status === 'accepted'
    ? item.status !== 'Approved' || item.approvedVersionId !== link.request.assetVersion.id
    : item.status !== 'Changes requested'
}

function readConnection(): StoredConnection | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as StoredConnection
    if (saved.endpoint !== SLACK_API || !isSession(saved.session) || !saved.links || typeof saved.links !== 'object') {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    for (const [id, link] of Object.entries(saved.links)) {
      if (!link?.request || link.request.submissionId !== id || !isAsset(link.request.assetVersion)
        || typeof link.request.clientRequestId !== 'string' || (link.proposal && !isProposal(link.proposal))) {
        throw new Error('Invalid saved connection')
      }
      if (typeof link.decisionEventId !== 'string') link.stale = true
    }
    if (saved.notifications && (typeof saved.notifications !== 'object' || Object.entries(saved.notifications).some(([id, link]) => !link?.request || link.request.submissionId !== id || !isAsset(link.request.assetVersion) || !['approved', 'revision_requested'].includes(link.request.kind) || typeof link.request.note !== 'string' || typeof link.request.clientRequestId !== 'string' || (link.notification && !isNotification(link.notification))))) throw new Error('Invalid saved notifications')
    return saved
  } catch { return null }
}

function storeConnection(session: SlackSession, links: Links, notifications: Notifications = {}) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ endpoint: SLACK_API, session, links, notifications })) }
  catch { throw new ApiError('This browser cannot save the private Slack connection. Enable session storage before sending.', 0) }
}

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function api(path: string, token: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(`${SLACK_API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      keepalive: path.endsWith('/supersede'),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) throw new ApiError(typeof result?.error === 'string' ? result.error : 'The Slack service could not complete this request.', response.status)
    return result
  } finally { globalThis.clearTimeout(timeout) }
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Could not reach the Slack service. Check your connection and try again.'
}

export async function supersedeSlackProposal(id: string, token: string): Promise<SlackProposal> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await api(`/v1/proposals/${encodeURIComponent(id)}/supersede`, token, {})
      if (!isProposal(result) || result.id !== id || result.status === 'pending') {
        throw new ApiError('The old Slack adjustment could not be retired.', 502)
      }
      return result
    } catch (cause) {
      if (attempt === 2 || (cause instanceof ApiError && [400, 401, 403, 404].includes(cause.status))) throw cause
      await new Promise(resolve => globalThis.setTimeout(resolve, 500 * (attempt + 1)))
    }
  }
  throw new Error('Could not retire the old Slack adjustment.')
}

export function useLiveSlack(items: Submission[], commit: (item: Submission) => void) {
  const [initial] = useState(readConnection)
  const [session, setSession] = useState<SlackSession | null>(initial?.session ?? null)
  const [links, setLinks] = useState<Links>(initial?.links ?? {})
  const [notifications, setNotifications] = useState<Notifications>(initial?.notifications ?? {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const itemsRef = useRef(items)
  const commitRef = useRef(commit)
  const sessionRef = useRef(session)
  const linksRef = useRef(links)
  const notificationsRef = useRef(notifications)
  const busyRef = useRef(false)
  const generationRef = useRef(0)
  const retirementsRef = useRef(new Map<string, Promise<SlackProposal>>())
  const reviewerPollStarted = useRef(new Map<string, number>())
  itemsRef.current = items
  commitRef.current = commit

  function replaceLinks(next: Links) {
    if (!sessionRef.current) return
    storeConnection(sessionRef.current, next, notificationsRef.current)
    linksRef.current = next
    setLinks(next)
  }
  function replaceNotifications(next: Notifications) {
    if (!sessionRef.current) return
    storeConnection(sessionRef.current, linksRef.current, next)
    notificationsRef.current = next
    setNotifications(next)
  }

  function retireLink(link: SlackLink, connection: SlackSession): Promise<SlackProposal> {
    const proposal = link.proposal!
    const existing = retirementsRef.current.get(proposal.id)
    if (existing) return existing
    const pending = supersedeSlackProposal(proposal.id, connection.token).then(result => {
      if (sessionRef.current?.token === connection.token) {
        const latest = linksRef.current[link.request.submissionId]
        if (latest?.proposal?.id === result.id) replaceLinks({
          ...linksRef.current,
          [link.request.submissionId]: { ...latest, proposal: result, stale: true, retirement: 'complete', error: undefined },
        })
      }
      return result
    }).catch(cause => {
      if (sessionRef.current?.token === connection.token) {
        const latest = linksRef.current[link.request.submissionId]
        if (latest?.proposal?.id === proposal.id) {
          try { replaceLinks({ ...linksRef.current, [link.request.submissionId]: { ...latest, retirement: 'failed' } }) } catch { /* Keep the local stale guard. */ }
        }
        setError('The old Slack adjustment could not be retired. Its response will not affect this review; check the old message in Slack.')
      }
      throw cause
    })
    retirementsRef.current.set(proposal.id, pending)
    return pending
  }

  async function retirePending(): Promise<boolean> {
    const connection = sessionRef.current
    if (!connection) return true
    const pending = Object.values(linksRef.current).filter(link => link.proposal?.status === 'pending')
    const results = await Promise.allSettled(pending.map(link => retireLink(link, connection)))
    return results.every(result => result.status === 'fulfilled')
  }

  function disconnect(retire = true) {
    // Capture the capability only for these bounded requests, then discard browser access immediately.
    const retirement = retire ? retirePending() : Promise.resolve(true)
    generationRef.current += 1
    sessionRef.current = null
    linksRef.current = {}
    notificationsRef.current = {}
    busyRef.current = false
    setSession(null)
    setLinks({})
    setNotifications({})
    setBusy(false)
    setError('')
    try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* The in-memory capability is still discarded. */ }
    const generation = generationRef.current
    void retirement.then(success => {
      if (!success && generationRef.current === generation && !sessionRef.current) {
        setError('Disconnected locally. Some old Slack messages could not be retired; check the demo channel before responding to them.')
      }
    })
  }

  function report(error: unknown) {
    if (error instanceof ApiError && error.status === 401) disconnect(false)
    setError(errorMessage(error))
  }

  async function connect(setupCode: string) {
    if (busyRef.current) return
    if (!SLACK_API) { setError('Live Slack is not configured for this deployment.'); return }
    if (!setupCode.trim()) { setError('Enter the private demo setup code.'); return }
    const generation = ++generationRef.current
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api('/v1/sessions', setupCode.trim(), {})
      if (generation !== generationRef.current) return
      if (!isSession(result)) throw new ApiError('The Slack service returned an invalid connection.', 502)
      storeConnection(result, {})
      sessionRef.current = result
      linksRef.current = {}
      notificationsRef.current = {}
      setSession(result)
      setLinks({})
      setNotifications({})
    } catch (cause) {
      if (generation === generationRef.current) report(cause)
    } finally {
      if (generation === generationRef.current) { busyRef.current = false; setBusy(false) }
    }
  }

  function receive(submissionId: string, requestId: string, proposal: SlackProposal, token: string) {
    if (sessionRef.current?.token !== token) return
    const link = linksRef.current[submissionId]
    if (!link || link.request.clientRequestId !== requestId) return
    if (link.proposal?.status !== undefined && link.proposal.status !== 'pending' && proposal.status === 'pending') return
    if (proposal.sourceSnapshot.submissionId !== submissionId || !sameAsset(proposal.sourceSnapshot.assetVersion, link.request.assetVersion)) {
      throw new ApiError('Slack returned a different asset snapshot. This decision was not applied.', 409)
    }
    const item = itemsRef.current.find(candidate => candidate.id === submissionId)
    const stale = proposal.status === 'superseded' || link.stale || isStale(link, item)
    const updated = !link.applied && !stale && item ? applySlackDecision(item, proposal) : null
    replaceLinks({ ...linksRef.current, [submissionId]: { ...link, proposal, stale, applied: link.applied || !!updated, error: undefined } })
    if (updated) {
      // Read the latest submission after the network wait so new comments/history survive.
      itemsRef.current = itemsRef.current.map(candidate => candidate.id === submissionId ? updated : candidate)
      commitRef.current(updated)
    }
  }

  async function send(item: Submission) {
    if (busyRef.current) return
    const connection = sessionRef.current
    const current = itemsRef.current.find(candidate => candidate.id === item.id)
    if (!connection) { setError('Connect with the private demo setup code before sending.'); return }
    if (!current || !canSendToSlack(current)) { setError('Pre-approve the current asset version before sending it to Slack.'); return }
    const existing = linksRef.current[item.id]
    const sameHandoff = !!existing && matchesCurrentHandoff(current, existing)
    if (sameHandoff && (existing.applied || existing.stale)) {
      setError('This review already has a Slack decision. Pre-approve another adjustment before sending again.')
      return
    }
    const version = currentVersion(current)
    const request: ProposalRequest = sameHandoff ? existing.request : {
      clientRequestId: crypto.randomUUID(), submissionId: current.id, title: current.title,
      reviewer: [...current.events].reverse().find(entry => entry.text.startsWith('Pre-approved'))?.actor || current.reviewer,
      owner: current.owner,
      assetVersion: { id: version.id, content: { ...version.content }, scope: { ...version.scope } },
      originalContent: { ...current.versions[0].content }, rationale: current.decisionNote!,
    }
    const link: SlackLink = sameHandoff ? existing : { request, decisionEventId: decisionEventId(current), applied: false, stale: false }
    const generation = generationRef.current
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      if (!sameHandoff) {
        if (existing?.proposal?.status === 'pending') await retireLink(existing, connection)
        try {
          const { renderAsset } = await import('./renderAsset')
          request.assetImage = await renderAsset(request.assetVersion.content)
        } catch (cause) {
          throw new ApiError(cause instanceof Error ? cause.message : 'The creative preview could not be rendered. Nothing was sent.', 0)
        }
        if (generation !== generationRef.current) return
        const latest = itemsRef.current.find(candidate => candidate.id === item.id)
        if (!latest || !canSendToSlack(latest) || !matchesCurrentHandoff(latest, link)
          || latest.decisionNote !== request.rationale) {
          throw new ApiError('This asset or decision changed while its preview was rendering. Nothing was sent. Review the current version and try again.', 409)
        }
      }
      // Persist before the request: refreshes and retries must reuse this exact payload and ID.
      replaceLinks({ ...linksRef.current, [item.id]: { ...link, error: undefined } })
      const result = await api('/v1/proposals', connection.token, request)
      if (!isProposal(result)) throw new ApiError('The Slack service returned an invalid proposal. Check delivery before retrying.', 502)
      if (generation !== generationRef.current) {
        // A disconnect during delivery must also retire a proposal whose ID just became known.
        if (result.status === 'pending') void supersedeSlackProposal(result.id, connection.token).catch(() => {})
        return
      }
      receive(item.id, request.clientRequestId, result, connection.token)
    } catch (cause) {
      if (generation !== generationRef.current) return
      const latest = linksRef.current[item.id]
      if (latest?.request.clientRequestId === request.clientRequestId) {
        try { replaceLinks({ ...linksRef.current, [item.id]: { ...latest, error: errorMessage(cause) } }) } catch { /* Keep the original request ID in memory. */ }
      }
      report(cause)
    } finally {
      if (generation === generationRef.current) { busyRef.current = false; setBusy(false) }
    }
  }

  async function notify(item: Submission, kind: NotificationKind, note: string) {
    if (busyRef.current) return
    const connection = sessionRef.current
    if (!connection) { setError('Connect live Slack before notifying the marketing owner. No message was sent.'); return }
    if (!canNotifySlack(item, kind) || !note.trim()) { setError('Save a clear review outcome and note before notifying marketing.'); return }
    const existing = notificationsRef.current[item.id]
    const sameNotice = !!existing && matchesNotification(item, existing) && existing.request.kind === kind && existing.request.note === note.trim()
    if (sameNotice && existing.notification?.delivery === 'sent') return
    const version = currentVersion(item)
    const request: NotificationRequest = sameNotice ? existing.request : {
      clientRequestId: crypto.randomUUID(), submissionId: item.id, title: item.title, reviewer: item.reviewer, owner: item.owner,
      assetVersion: { id: version.id, content: { ...version.content }, scope: { ...version.scope } }, kind, note: note.trim(),
    }
    const link: SlackNotificationLink = sameNotice ? existing : { request, decisionEventId: notificationEventId(item, kind) }
    const generation = generationRef.current
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      if (!sameNotice) {
        try {
          const { renderAsset } = await import('./renderAsset')
          request.assetImage = await renderAsset(request.assetVersion.content)
        } catch (cause) { throw new ApiError(cause instanceof Error ? cause.message : 'The creative preview could not be rendered. Nothing was sent.', 0) }
        if (generation !== generationRef.current) return
        const latest = itemsRef.current.find(candidate => candidate.id === item.id)
        if (!latest || !matchesNotification(latest, link) || latest.decisionNote !== item.decisionNote) {
          throw new ApiError('The asset or review outcome changed while rendering. Nothing was sent; review the current version first.', 409)
        }
      }
      replaceNotifications({ ...notificationsRef.current, [item.id]: { ...link, error: undefined } })
      const result = await api('/v1/notifications', connection.token, request)
      if (generation !== generationRef.current) return
      if (!isNotification(result) || result.kind !== request.kind || result.sourceSnapshot.submissionId !== request.submissionId || !sameAsset(result.sourceSnapshot.assetVersion, request.assetVersion)) {
        throw new ApiError('The notification response did not match this request. Check Slack before sending another.', 502)
      }
      replaceNotifications({ ...notificationsRef.current, [item.id]: { ...link, notification: result, error: undefined } })
    } catch (cause) {
      if (generation !== generationRef.current) return
      const latest = notificationsRef.current[item.id]
      if (latest?.request.clientRequestId === request.clientRequestId) {
        try { replaceNotifications({ ...notificationsRef.current, [item.id]: { ...latest, error: errorMessage(cause) } }) } catch { /* Preserve the original request ID in memory. */ }
      }
      report(cause)
    } finally {
      if (generation === generationRef.current) { busyRef.current = false; setBusy(false) }
    }
  }

  useEffect(() => {
    if (!session) return
    let changed = false
    const next = { ...linksRef.current }
    for (const [id, link] of Object.entries(next)) {
      if (!link.stale && isStale(link, items.find(item => item.id === id))) {
        next[id] = { ...link, stale: true }
        changed = true
      }
    }
    if (changed) {
      try { replaceLinks(next) } catch { setError('Browser storage is unavailable. Reconnect before sending another adjustment.') }
    }
    for (const link of Object.values(linksRef.current)) {
      if (link.stale && link.proposal?.status === 'pending' && link.retirement !== 'failed') {
        void retireLink(link, session).catch(() => {})
      }
    }
  }, [items, session, links])

  useEffect(() => {
    if (!session || !SLACK_API) return
    let active = true
    let polling = false
    function pollReviewer(record: SlackProposal | SlackNotification): boolean {
      if (!reviewerNoticePending(record)) { reviewerPollStarted.current.delete(record.id); return false }
      if (!reviewerPollStarted.current.has(record.id)) reviewerPollStarted.current.set(record.id, Date.now())
      // A saved decision survives a failed follow-up notice. Check the bounded
      // background delivery for one minute without polling stalled sends forever.
      return Date.now() - reviewerPollStarted.current.get(record.id)! < 60_000
    }
    async function poll() {
      if (!active || polling || sessionRef.current?.token !== session!.token) return
      if (Date.parse(session!.expiresAt) <= Date.now()) { disconnect(false); setError('This Slack connection expired. Reconnect with the private setup code.'); return }
      polling = true
      await Promise.all(Object.entries(linksRef.current).map(async ([id, link]) => {
        if (!link.proposal || link.stale || link.proposal.status === 'superseded' || ['failed', 'uncertain'].includes(link.proposal.delivery)) return
        const pendingReviewer = pollReviewer(link.proposal)
        if (link.applied && !pendingReviewer) return
        try {
          const result = link.proposal.status === 'pending' || pendingReviewer
            ? await api(`/v1/proposals/${encodeURIComponent(link.proposal.id)}`, session!.token)
            : link.proposal
          if (!active || sessionRef.current?.token !== session!.token) return
          if (!isProposal(result)) throw new ApiError('The Slack service returned an invalid proposal. No decision was applied.', 502)
          receive(id, link.request.clientRequestId, result, session!.token)
        } catch (cause) { if (active && sessionRef.current?.token === session!.token) report(cause) }
      }))
      await Promise.all(Object.entries(notificationsRef.current).map(async ([id, link]) => {
        if (link.notification?.delivery !== 'sent' || (link.notification.status !== 'awaiting_acknowledgment' && !pollReviewer(link.notification))) return
        const current = itemsRef.current.find(item => item.id === id)
        if (!current || !matchesNotification(current, link)) return
        try {
          const result = await api(`/v1/notifications/${encodeURIComponent(link.notification.id)}`, session!.token)
          if (!active || sessionRef.current?.token !== session!.token) return
          const latest = notificationsRef.current[id]
          if (!latest || latest.request.clientRequestId !== link.request.clientRequestId) return
          if (!isNotification(result) || result.id !== link.notification.id || result.kind !== link.request.kind || result.sourceSnapshot.submissionId !== id || !sameAsset(result.sourceSnapshot.assetVersion, link.request.assetVersion)) throw new ApiError('The Slack receipt did not match this notification.', 502)
          replaceNotifications({ ...notificationsRef.current, [id]: { ...latest, notification: result, error: undefined } })
        } catch (cause) { if (active && sessionRef.current?.token === session!.token) report(cause) }
      }))
      polling = false
    }
    void poll()
    const interval = window.setInterval(() => { void poll() }, 4_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [session])

  return { session, connect, disconnect, retirePending, send, notify, links, notifications, busy, error }
}

export type LiveSlackBridge = ReturnType<typeof useLiveSlack>

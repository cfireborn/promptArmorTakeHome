import { useState, type FormEvent } from 'react'
import { ExternalLink, Link, Send, Unplug } from 'lucide-react'
import { type Submission } from '../domain'
import { canNotifySlack, canSendToSlack, matchesCurrentHandoff, matchesNotification, slackChannelName, SLACK_API, type LiveSlackBridge, type SlackLink, type SlackNotificationLink, type ReviewerSlackNotification, type SlackSession } from '../slack'

function deliveryText(link: SlackLink): string {
  if (link.proposal?.status === 'superseded') return 'Superseded in Slack. The old adjustment can no longer be accepted.'
  if (link.stale && link.proposal && link.proposal.status !== 'pending') return 'This Slack decision belongs to an older review and will not change the current asset.'
  if (link.stale && !link.proposal) return 'This adjustment is out of date and its delivery is unconfirmed. Any later response will be ignored here.'
  if (link.stale) return link.retirement === 'failed'
    ? 'This adjustment is out of date. Slack retirement could not be confirmed; any response will be ignored here.'
    : 'This adjustment is out of date. Retiring its Slack buttons; any response will be ignored here.'
  if (link.applied) return link.proposal?.status === 'accepted' ? 'Accepted in Slack. This exact version is approved.' : 'Creative requested changes in Slack. Feedback is saved in the review.'
  if (!link.proposal) return 'Delivery has not been confirmed. Check the same request safely below.'
  if (link.proposal.delivery === 'failed') return 'Slack delivery failed. No second message will be sent for this request.'
  if (link.proposal.delivery === 'uncertain') return 'Delivery is uncertain. Check the channel before preparing another version.'
  if (link.proposal.delivery === 'sending') return 'Slack is still processing this request.'
  if (link.proposal.status !== 'pending') return 'Slack recorded a decision, but it could not be applied to this review.'
  return 'Sent to Slack. Waiting for creative’s decision; this page updates automatically.'
}

function slackUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'app.slack.com' || url.hostname.endsWith('.slack.com')) ? url.href : undefined
  } catch { return undefined }
}

function notificationText(link: SlackNotificationLink): string {
  const notice = link.notification
  if (!notice) return 'Notification delivery has not been confirmed. Check this same request safely below.'
  if (notice.delivery === 'failed') return 'Slack notification failed. Checking again inspects this request; it will not send a duplicate.'
  if (notice.delivery === 'uncertain') return 'Notification delivery is uncertain. Check the channel before preparing another request.'
  if (notice.delivery === 'sending') return 'Slack is still processing this notification.'
  const recipient = `${notice.recipient.displayName}${notice.recipient.isProxy ? `, demo proxy for ${notice.recipient.owner}` : ''}`
  if (notice.status === 'acknowledged') return `Receipt acknowledged by ${recipient}. The asset still needs revision and a fresh review.`
  return notice.kind === 'approved'
    ? `Approval notice delivered to ${recipient}. It covers this recorded version and use.`
    : `Revision request delivered to ${recipient}. Waiting for acknowledgment of receipt.`
}

export function SlackRoutingSummary({ session }: { session: SlackSession }) {
  const names = (routes: NonNullable<SlackSession['routing']>['owners']) => [...new Set(routes.map(route => route.channelName ? `#${route.channelName}` : route.channelId))].join(', ')
  return <p className="muted" style={{ overflowWrap: 'anywhere' }}>
    {session.routing ? <>Marketing: {names(session.routing.owners)}.{session.routing.reviewers.length > 0 && <> Responses return to {names(session.routing.reviewers)}.</>}</> : 'The actual destination appears with each delivered message.'}
  </p>
}

export function ReviewerSlackActivity({ notice }: { notice?: ReviewerSlackNotification | null }) {
  if (!notice) return null
  const channel = slackChannelName(notice.recipient)
  const url = slackUrl(notice.slackMessageUrl)
  const label = notice.delivery === 'sent' ? `Response delivered to ${notice.recipient.owner} in ${channel}.`
    : notice.delivery === 'failed' ? `The response is saved. Delivery to ${notice.recipient.owner} in ${channel} failed.`
    : notice.delivery === 'uncertain' ? `The response is saved. Delivery to ${notice.recipient.owner} in ${channel} is unconfirmed.`
    : `The response is saved. Notifying ${notice.recipient.owner} in ${channel}…`
  return <div role="status" className="muted" style={{ overflowWrap: 'anywhere' }}>
    <p>{label}</p>
    {url && notice.delivery === 'sent' && <a className="text-button" href={url} target="_blank" rel="noopener noreferrer">View reviewer update <ExternalLink size={13} aria-hidden="true"/></a>}
  </div>
}

export function LiveSlack({ bridge, item }: { bridge: LiveSlackBridge; item: Submission }) {
  const [code, setCode] = useState('')
  if (!SLACK_API) return null
  const link = bridge.links[item.id]
  const currentLink = link && matchesCurrentHandoff(item, link) ? link : undefined
  const url = slackUrl(link?.proposal?.slackMessageUrl)
  const hasSent = currentLink?.proposal?.delivery === 'sent'
  const retry = !!currentLink && !currentLink.applied && !currentLink.stale
    && (!currentLink.proposal || ['sending', 'failed', 'uncertain'].includes(currentLink.proposal.delivery))
  const notice = bridge.notifications[item.id]
  const kind = item.status === 'Approved' ? 'approved' : 'revision_requested'
  const currentNotice = notice && matchesNotification(item, notice) && notice.request.kind === kind && notice.request.note === item.decisionNote ? notice : undefined
  const noticeUrl = slackUrl(notice?.notification?.slackMessageUrl)
  const canNotify = canNotifySlack(item, kind) && !!item.decisionNote?.trim()
    && !(currentLink?.applied && currentLink.proposal?.status === 'accepted')
  const noticeSent = currentNotice?.notification?.delivery === 'sent'
  async function connect(event: FormEvent) {
    event.preventDefault()
    const privateCode = code
    setCode('')
    await bridge.connect(privateCode)
  }
  return <section className="decision-summary live-slack" aria-label="Live Slack connection">
    {!bridge.session ? <details>
      <summary><Link size={14} aria-hidden="true"/> Connect live Slack</summary>
      <p className="muted">Send real owner notifications and adjustments to the assigned marketing channels. Charlie receives pings for the fictional marketing owners. A presenter’s setup code is required.</p>
      <form onSubmit={event => { void connect(event) }}>
        <label className="field-label">Private setup code
          <input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} required disabled={bridge.busy} spellCheck={false}/>
        </label>
        <button className="secondary" type="submit" disabled={bridge.busy || !code.trim()}>{bridge.busy ? 'Connecting…' : 'Connect this browser'}</button>
      </form>
      <p className="muted">Connection lasts up to 72 hours in this browser tab. The setup code is discarded after use. Reconnecting starts a new connection; it does not resend earlier messages.</p>
    </details> : <>
      <div className="section-heading"><strong>Live Slack connected</strong><button className="text-button" type="button" onClick={() => bridge.disconnect()}><Unplug size={13} aria-hidden="true"/> Disconnect</button></div>
      <SlackRoutingSummary session={bridge.session}/>
      <p className="muted">Charlie receives real pings as the demo proxy for fictional owners Maya, Jordan, and Sofia. Only the assigned recipient can respond.</p>
      {!canSendToSlack(item) && !canNotify && !link && !notice && <p className="muted">Record a review decision to notify the owner, or pre-approve a concrete fix for acceptance.</p>}
      {link && <div role="status"><p>{deliveryText(link)}</p>{link.proposal?.delivery === 'sent' && <p className="muted">Marketing channel: {slackChannelName(link.proposal.recipient, bridge.session.channel)}</p>}{link.proposal?.decidedBy && <p className="muted">Decision by Slack member {link.proposal.decidedBy}</p>}{link.proposal?.feedback && <p>Creative feedback: {link.proposal.feedback}</p>}{link.proposal && ['accepted', 'changes_requested'].includes(link.proposal.status) && <ReviewerSlackActivity notice={link.proposal.reviewerNotification}/>}</div>}
      {notice && <div role="status">{!currentNotice && <p className="muted">Earlier notification · v{notice.request.assetVersion.id}. It does not describe the current review.</p>}<p>{notificationText(notice)}</p>{notice.notification?.delivery === 'sent' && <p className="muted">Marketing channel: {slackChannelName(notice.notification.recipient, bridge.session.channel)}</p>}{notice.notification?.status === 'acknowledged' && <ReviewerSlackActivity notice={notice.notification.reviewerNotification}/>}</div>}
      <div className="slack-actions">
        {canSendToSlack(item) && !hasSent && !currentLink?.applied && !currentLink?.stale && <button className="primary" type="button" disabled={bridge.busy} onClick={() => { void bridge.send(item) }}><Send size={14} aria-hidden="true"/>{bridge.busy ? 'Checking delivery…' : retry ? 'Check this request again' : 'Send pre-approved fix'}</button>}
        {url && <a className="text-button" href={url} target="_blank" rel="noopener noreferrer">Open actual Slack message <ExternalLink size={13} aria-hidden="true"/></a>}
        {canNotify && !noticeSent && <button className="primary" type="button" disabled={bridge.busy} onClick={() => { void bridge.notify(item, kind, item.decisionNote!) }}><Send size={14} aria-hidden="true"/>{bridge.busy ? 'Checking delivery…' : currentNotice ? 'Check notification again' : kind === 'approved' ? 'Notify owner of approval' : 'Send revision request'}</button>}
        {noticeUrl && <a className="text-button" href={noticeUrl} target="_blank" rel="noopener noreferrer">Open actual Slack notification <ExternalLink size={13} aria-hidden="true"/></a>}
      </div>
    </>}
    {bridge.error && <p className="error-banner" role="alert">{bridge.error}</p>}
  </section>
}

import { useEffect, useState } from 'react'
import { aiUsage, type AIUsage } from '../ai'
import './developer-usage.css'

const dollars = (value: number) => `$${value.toFixed(4)}`
const localTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
export function DeveloperUsage() {
  const [open, setOpen] = useState(false)
  const [usage, setUsage] = useState<AIUsage>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function refresh() {
    setBusy(true)
    setError('')
    try { setUsage(await aiUsage()) }
    catch { setError('Usage is unavailable. Try refreshing in a moment.') }
    finally { setBusy(false) }
  }
  useEffect(() => { if (open) void refresh() }, [open])
  return <details className="developer-usage" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Developer / demo review</summary>
    {open && <div>
      <p>Demo API usage · estimated from provider token counts. This is not your account-wide balance.</p>
      {usage && <>
        <dl>{usage.providers.map(provider => <div key={`${provider.provider}:${provider.model}`}>
          <dt>{provider.provider} <small>{provider.model}</small></dt>
          <dd>{dollars(provider.estimatedUsd)} <small>{provider.trackedCalls} measured calls</small></dd>
        </div>)}<div><dt>Total measured estimate</dt><dd>{dollars(usage.estimatedUsd)}</dd></div></dl>
        <p>{usage.untrackedCalls > 0 ? `${usage.untrackedCalls} earlier or incomplete calls have no priced usage and are excluded from the estimate. ` : ''}
          Budget protected: ${usage.budget.protectedUsd.toFixed(2)} / ${usage.budget.limitUsd.toFixed(2)}. Finished calls with measured usage count at twice their estimated cost, rounded up to the cent. In-flight or unpriced calls retain their full reserve.</p>
        {usage.budget.providers?.some(provider => provider.limitUsd !== null) && <p>
          {usage.budget.providers.filter(provider => provider.limitUsd !== null).map(provider => `${provider.provider}: $${provider.protectedUsd.toFixed(2)} protected / $${provider.limitUsd!.toFixed(2)} limit`).join(' · ')}
          {usage.budget.expiresAt && ` · Budget window ends ${localTime(usage.budget.expiresAt)}.`}
        </p>}
        {usage.limits?.expiresAt && <p>
          Temporary allowance per IP: {usage.limits.review.perDay} reviews and {usage.limits.edit.perDay} image requests per rolling 24 hours, with minute/hour limits and {usage.limits.concurrent} simultaneous calls across the demo. Higher rates end {localTime(usage.limits.expiresAt)}.
        </p>}
      </>}
      {error && <p role="alert">{error}</p>}
      <button className="text-button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Loading usage…' : 'Refresh usage'}</button>
    </div>}
  </details>
}

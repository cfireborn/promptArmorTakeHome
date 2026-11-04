import { useEffect, useState } from 'react'
import type { Submission } from '../domain'
import { evidenceImage, type EvidenceRegion, type LiveReviewReport } from '../ai'
import { Asset } from './Asset'

export type LocatedEvidence = EvidenceRegion & { number: number; checkId: string; label: string }
export function locatedEvidence(report?: LiveReviewReport): LocatedEvidence[] {
  return (report?.checks ?? []).flatMap(check => (check.regions ?? []).filter(region =>
    typeof region.quote === 'string' && region.quote.trim() &&
    [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
    region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0 &&
    region.x + region.width <= 1 && region.y + region.height <= 1,
  ).slice(0, 3).map(region => ({ ...region, checkId: check.id, label: check.label })))
    .map((region, index) => ({ ...region, number: index + 1 }))
}

// Overlay the exact raster used for review, including rendered template assets.
// A responsive HTML reflow would move text relative to the model's coordinates.
export function EvidenceAsset({ item, regions, active, show = true }: {
  item: Submission; regions: LocatedEvidence[]; active?: number; show?: boolean;
}) {
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const version = item.versions.at(-1)!
  useEffect(() => {
    let current = true
    setSource('')
    setError('')
    evidenceImage(item).then(value => { if (current) setSource(value) }).catch(cause => { if (current) setError(cause.message) })
    return () => { current = false }
  }, [item.id, version.id, item.liveReview?.id])
  if (!source) return <div className="lr-evidence-image"><Asset content={version.content} />{error && <p className="lr-evidence-unavailable" role="status">{error}</p>}</div>
  return <div className="lr-evidence-image">
    <img src={source} alt={`Reviewed creative, version ${version.id}. Numbered text locations correspond to review findings.`} />
    {show && <div className="lr-evidence-overlay" aria-hidden="true">
      {regions.map(region => <div key={region.number}
        className={`lr-evidence-region ${active === region.number ? 'active' : active ? 'dimmed' : ''}`}
        style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}>
        <span>{region.number}</span>
      </div>)}
    </div>}
  </div>
}

import { LIVE_POLICY_VERSION } from './reviewPolicy.mjs';

// Both sides use the same field order and explicit defaults. Display-only
// metadata is excluded; the actual submitted pixels have a separate SHA-256.
export function sourceFingerprint(input) {
  const content = input.content ?? {};
  const scope = input.scope ?? {};
  return JSON.stringify({
    policyVersion: LIVE_POLICY_VERSION,
    submissionId: input.submissionId,
    versionId: input.versionId,
    content: {
      headline: content.headline, body: content.body, disclosure: content.disclosure,
      cta: content.cta, art: content.art, image: content.image || '',
      palette: content.palette || 'brand',
    },
    scope: {
      product: scope.product, audience: scope.audience, channel: scope.channel,
      placement: scope.placement, jurisdiction: scope.jurisdiction || 'Unspecified',
      affiliatePartner: scope.affiliatePartner || 'Other',
    },
  });
}

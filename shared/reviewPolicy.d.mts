export type LiveRuleId = 'brand-palette' | 'misleading-claim' | 'product-disclosure' | 'state-review' | 'affiliate-identity';
export type PolicyAuthority = 'company-policy' | 'federal' | 'state' | 'partner-policy';
export type PolicySource = {
  id: string;
  authority: PolicyAuthority;
  label: string;
  url: string;
  pinpoint: string;
};
export type LiveRule = {
  id: LiveRuleId;
  label: string;
  category: 'Brand' | 'Claims' | 'Product' | 'State' | 'Affiliate';
  description: string;
  applicabilityDescription: string;
  instructions: string[];
  sources: PolicySource[];
};
export type PolicyScope = {
  product: string;
  audience: string;
  channel: string;
  placement: string;
  jurisdiction: 'California' | 'Other US jurisdiction' | 'Unspecified';
  affiliatePartner: 'None' | 'Homewise' | 'Other';
};
export type ApplicableRule = LiveRule & {
  applicability: 'applies' | 'not-applicable' | 'unknown';
  reason: string;
};
export const LIVE_POLICY_VERSION: string;
export const CALIFORNIA_DISCLOSURE: string;
export const LIVE_RULES: readonly LiveRule[];
export function applicableRules(scope?: Partial<PolicyScope> | null): ApplicableRule[];

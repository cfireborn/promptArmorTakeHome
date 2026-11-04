// Shared by the browser and Worker. Sources and applicability are owned by the
// policy pack, never supplied by a model or inferred from marketing copy.
export const LIVE_POLICY_VERSION = 'ClearPath live review policy v3.3';
export const CALIFORNIA_DISCLOSURE = 'California residents: this promotion is subject to ClearPath’s California offer terms.';

const companySource = (id, label, ruleId) => ({
  id, authority: 'company-policy', label,
  url: `?guidelines#${ruleId}`, pinpoint: id,
});

export const LIVE_RULES = [
  {
    id: 'brand-palette', label: 'Brand palette and presentation', category: 'Brand',
    description: 'Use ClearPath’s forest, sage, cream, and warm-gold palette for brand graphics. Photography may contain other colors. Keep essential content legible and fully inside the canvas. Supplied copy and recorded use must be consistent with the artwork.',
    applicabilityDescription: 'Every submission.',
    instructions: [
      'Inspect the actual submitted image, not its palette label. Assess brand-controlled backgrounds, graphics, typography, and logos against forest, sage, cream, and warm-gold. Do not reject natural colors in photography.',
      'Company presentation policy requires the entire logo, headline, body, CTA, and disclosures to be visible inside the creative with safe margins. A cropped button, cut-off text, or unreadable required copy fails this rule even if the colors match. If intended placement explicitly says portrait, square, or landscape, the artwork must have the corresponding orientation.',
      'Verify supplied transcription against the actual artwork. Empty supplied copy is valid for image-only review. Partial transcription that does not contradict the artwork, typography or whitespace differences, and harmless OCR errors are not material conflicts. Assess all visible wording even when omitted from supplied copy.',
      'Check that the recorded intended use is internally coherent and consistent with the visible product and publisher. Material contradictions in transcription or scope require needs-review in the relevant existing check; use this presentation check for transcription or routing conflicts. Examples include an invented or altered approval promise, qualifier, or financial term, a different visible product or publisher, or a California-only audience recorded as Other US jurisdiction. Explicitly distinguish what the artwork shows from what supplied copy or recorded use says. Never describe transcript-only wording as visible pixels or assign it an image region. Actual visible violations must still fail their appropriate checks.',
      'For any material transcription or scope conflict, request corrected transcription or intended use before generation and return suggestedCopy=null until the conflict is resolved. Rule applicability still follows the structured selections supplied by the server. Do not activate California or Homewise requirements from audience text or image wording; report conflicting scope in this presentation check without changing those rules’ applicability.',
      'Identify the visible element and color that conflicts with the policy. Do not claim exact color-code matching from visual estimation.',
      'If the image is missing, unreadable, unrelated to the recorded financial product, or too small to assess, return needs-review with a concrete request for usable creative. Do not silently pass on supplied copy alone.',
    ],
    sources: [companySource('CP-BRAND-01', 'ClearPath brand policy', 'brand-palette')],
  },
  {
    id: 'misleading-claim', label: 'Claims and approval language', category: 'Claims',
    description: 'Avoid unconditional approval guarantees and unsupported eligibility, credit-impact, cost, or savings claims.',
    applicabilityDescription: 'Personal loans, credit cards, and mortgage prequalification.',
    instructions: [
      'Read express and implied claims in the complete image and supplied copy. ClearPath company policy prohibits unconditional approval guarantees and promises that creditworthiness cannot affect approval.',
      'Quote the asset text or identify the visual claim behind each finding. A contradictory fine-print qualifier does not resolve an unconditional headline.',
      'For mortgage prequalification, do not imply a mortgage is approved or guaranteed. 12 CFR 1014.3(q) concerns material misrepresentations about obtaining a mortgage, including preapproval or guarantees; it is not a prohibition of every appearance of the word guaranteed.',
      'An objective assertion needing external substantiation must remain needs-review unless relevant support is supplied. Do not invent eligibility, rates, credit effects, or substantiation. Ordinary invitations to explore options can pass this rule without matching a prepared example.',
      'The general no-guarantee restriction is company policy. FTC guidance explains truthfulness and substantiation; it does not establish jurisdiction over every financial institution.',
    ],
    sources: [
      companySource('CP-CLAIMS-01', 'ClearPath claims policy', 'misleading-claim'),
      {
        id: 'FTC-TRUTH', authority: 'federal', label: 'FTC guidance: truthful and substantiated advertising',
        url: 'https://www.ftc.gov/business-guidance/resources/advertising-faqs-guide-small-business',
        pinpoint: 'Truth-in-advertising and express / implied claims guidance',
      },
      {
        id: 'MAP-1014-3-Q', authority: 'federal', label: 'Mortgage representations · 12 CFR 1014.3(q)',
        url: 'https://www.ecfr.gov/current/title-12/chapter-X/part-1014/section-1014.3#p-1014.3(q)',
        pinpoint: '§ 1014.3(q), mortgage products only',
      },
    ],
  },
  {
    id: 'product-disclosure', label: 'Product disclosure', category: 'Product',
    description: 'Include the company’s product qualifier. Specific rates, fees, or payment offers also require the applicable advertising disclosures.',
    applicabilityDescription: 'The selected product determines the qualifier and federal reference.',
    instructions: [
      'Company policy for personal loans: make credit approval conditional and explain that rates and terms depend on the applicant’s credit profile. For cards: include the credit-approval qualifier and direct the reader to rates, fees, and terms. For mortgage prequalification: explain that it is not loan approval or a commitment to lend and final approval requires verification and underwriting. Equivalent clear wording is acceptable.',
      'These generic qualifiers are company requirements, not wording prescribed by the federal sections below. Assess whether they appear legibly on the asset; supplied transcription alone does not establish that they are visible.',
      'For personal loans and mortgages, assess stated finance-charge rates under 12 CFR 1026.24(c), including APR disclosure. Additional payment or repayment terms can trigger § 1026.24(d). Do not assume every number, dollar amount, or percentage is a triggering credit term.',
      'For credit cards, relevant cost terms can trigger § 1026.16(b), and introductory/promotional rates or fees can trigger § 1026.16(g). Assess immediate/proximate disclosures and applicable exceptions rather than demanding every disclosure in every advertisement.',
      'If a specific financial offer requires facts or disclosure coverage beyond the supplied evidence, return needs-review and identify the missing term. Do not calculate an APR from an interest rate, invent numeric terms, or suggest that a generic terms link resolves all triggered disclosures.',
    ],
    sources: [
      companySource('CP-DISCLOSURE-01', 'ClearPath product qualifier policy', 'product-disclosure'),
      {
        id: 'REG-Z-CLOSED', authority: 'federal', label: 'Loan advertising · Regulation Z § 1026.24',
        url: 'https://www.consumerfinance.gov/rules-policy/regulations/1026/24/',
        pinpoint: '§ 1026.24(b)–(d): legibility, rates, and triggering terms',
      },
      {
        id: 'REG-Z-CARD', authority: 'federal', label: 'Card advertising · Regulation Z § 1026.16',
        url: 'https://www.consumerfinance.gov/rules-policy/regulations/1026/16/',
        pinpoint: '§ 1026.16(b), (g): cost terms and promotional offers',
      },
    ],
  },
  {
    id: 'state-review', label: 'California offer disclosure', category: 'State',
    description: `ClearPath’s fictional company demo policy CP-CA-01 requires this disclosure for California creative: “${CALIFORNIA_DISCLOSURE}”`,
    applicabilityDescription: 'Every supported product with California selected. Other US jurisdiction is not applicable; unspecified jurisdiction or an unsupported product needs review.',
    instructions: [
      'CP-CA-01 is a fictional ClearPath company demo policy, not a law, statute, or licensure requirement. It applies to every supported product when the recorded jurisdiction is California.',
      `For California creative, require this complete sentence legibly on the actual image: “${CALIFORNIA_DISCLOSURE}” Typography-only apostrophe and whitespace differences are acceptable; do not change the substance. Supplied transcription alone does not establish visibility.`,
      'When this rule applies, a missing or substantively changed sentence fails. Unreadable or uncertain disclosure text needs review. Do not return not-applicable because a licensure claim, financial offer, or California wording is absent.',
      `When proposing complete corrected copy or a replacement concept for California, include “${CALIFORNIA_DISCLOSURE}” in the disclosure field, preserving other valid product disclosures. The image correction must render this required sentence legibly.`,
      'Do not fabricate offer terms, legal citations, licenses, license numbers, or claims that ClearPath is licensed. This demo policy supplies only the required disclosure sentence.',
      'Use not-applicable only when the recorded jurisdiction is Other US jurisdiction. Unspecified jurisdiction or an unsupported product needs review. This policy does not establish coverage of other state requirements.',
    ],
    sources: [companySource('CP-CA-01', 'ClearPath California offer policy · fictional demo policy', 'state-review')],
  },
  {
    id: 'affiliate-identity', label: 'Homewise advertising label', category: 'Affiliate',
    description: 'Homewise placements must show the publisher’s identity and a clear paid-advertising label naming ClearPath Financial.',
    applicabilityDescription: 'Select Homewise as the affiliate partner. Direct distribution has no Homewise requirement; other affiliates need a policy.',
    instructions: [
      'HW-01 is a fictional Homewise contractual requirement, not a law: show Homewise as the publisher and an obvious paid-advertising label identifying ClearPath Financial. “Paid advertisement by ClearPath Financial” is an acceptable example.',
      'Assess whether the label is readable and clearly attached to the advertisement. A partner name, an unexplained affiliate link label, or a disclosure only in submitted metadata is insufficient for this contract.',
      'This example describes a paid-advertising publisher relationship. Do not invent referral commissions, endorsement claims, or the terms of a real agreement.',
      'FTC material-connection guidance is background: it applies to unexpected material connections affecting endorsements. Do not claim that every affiliate placement is an endorsement or that every obvious paid ad needs a separate commission disclosure.',
    ],
    sources: [
      {
        id: 'HW-01', authority: 'partner-policy', label: 'Homewise placement policy · fictional example',
        url: '?guidelines#affiliate-identity', pinpoint: 'HW-01: publisher identity and paid-ad label',
      },
      {
        id: 'FTC-ENDORSEMENTS', authority: 'federal', label: 'Background: FTC material-connection guidance',
        url: 'https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking',
        pinpoint: 'Affiliate marketing Q&A; endorsement context, not a universal affiliate-ad rule',
      },
    ],
  },
];

const supportedProducts = new Set(['Personal loans', 'Credit cards', 'Mortgage prequalification']);
const directChannels = new Set(['Email', 'Paid social', 'Organic social']);

export function applicableRules(scope) {
  const selected = scope ?? {};
  return LIVE_RULES.map(rule => {
    let applicability = 'applies';
    let reason = 'This requirement applies to every submitted creative.';
    if (rule.id === 'misleading-claim' || rule.id === 'product-disclosure') {
      applicability = supportedProducts.has(selected.product) ? 'applies' : 'unknown';
      reason = applicability === 'applies'
        ? `Review the ${selected.product.toLowerCase()} asset against the applicable product policy.`
        : 'Choose a supported product so the correct product and claims requirements can be selected.';
    }
    if (rule.id === 'state-review') {
      if (!['California', 'Other US jurisdiction'].includes(selected.jurisdiction)) {
        applicability = 'unknown';
        reason = 'Select the intended jurisdiction before deciding whether the California offer disclosure applies.';
      } else if (selected.jurisdiction !== 'California') {
        applicability = 'not-applicable';
        reason = 'The recorded jurisdiction is outside California. No other state rule is included in this example pack.';
      } else if (!supportedProducts.has(selected.product)) {
        applicability = 'unknown';
        reason = 'Select a supported product to establish the California offer disclosure’s applicability.';
      } else {
        reason = 'California selected. The company demo policy requires the California offer disclosure on every supported product’s creative.';
      }
    }
    if (rule.id === 'affiliate-identity') {
      if (selected.affiliatePartner === 'Homewise') {
        reason = 'Homewise is the recorded publisher, so its example placement policy applies.';
      } else if (selected.affiliatePartner === 'None' && directChannels.has(selected.channel)) {
        applicability = 'not-applicable';
        reason = 'Direct distribution with no affiliate selected; the Homewise policy does not apply.';
      } else {
        applicability = 'unknown';
        reason = selected.affiliatePartner === 'Other'
          ? 'This affiliate has no policy in the example pack. Supply the partner’s requirements before approval.'
          : 'Confirm the affiliate and channel. An affiliate placement without a selected partner cannot be cleared.';
      }
    }
    return { ...rule, applicability, reason };
  });
}

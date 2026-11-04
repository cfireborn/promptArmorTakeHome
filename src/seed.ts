import type { AssetContent, Scope, Submission } from "./domain";
const ago = (hours: number) =>
  new Date(Date.now() - hours * 3600000).toISOString();
const due = (hours: number) =>
  new Date(Date.now() + hours * 3600000).toISOString();
export const fixes: Record<
  string,
  { title: string; why: string; content: AssetContent }
> = {
  loan: {
    title: "Keep the promise. Lose the guarantee.",
    why: "The original promises approval to everyone. This example keeps the emotional benefit, removes the guarantee, and puts the eligibility condition in the asset.",
    content: {
      headline: "A little breathing room.",
      body: "Explore a personal loan for the things that matter. See options tailored to you.",
      disclosure:
        "Subject to credit approval. Rates and terms depend on your credit profile. Not all applicants qualify.",
      cta: "Explore your options",
      art: "sunrise",
      palette: "brand",
    },
  },
  mortgage: {
    title: "Give the qualification room to be read.",
    why: "The original suggests prequalification is a loan commitment. This example changes the claim and moves the qualification onto a dedicated, high-contrast disclosure panel.",
    content: {
      headline: "Your next chapter starts here.",
      body: "Get a clearer picture of your homebuying budget with mortgage prequalification.",
      disclosure:
        "Prequalification is an estimate, not a loan approval or commitment to lend. Final approval requires verification and underwriting.",
      cta: "Explore prequalification",
      art: "home",
      palette: "brand",
      image: "creative/mortgage-fixed.png",
    },
  },
};
export function seedSubmissions(): Submission[] {
  const base: Scope = {
    product: "Personal loans",
    audience: "US adults · existing customers",
    channel: "Paid social",
    placement: "Instagram feed · portrait creative",
  };
  const make = (
    id: string,
    title: string,
    owner: string,
    hours: number,
    content: AssetContent,
    scope: Scope,
    fixture?: "loan" | "mortgage",
  ): Submission => ({
    id,
    title,
    owner,
    reviewer: "Alex Morgan",
    priority: hours > 20 ? "High" : "Normal",
    due: due(hours > 20 ? 4 : 28),
    submittedAt: ago(hours),
    status: "Needs review",
    versions: [
      {
        id: 1,
        content: { palette: "brand", ...content },
        scope: { jurisdiction: scope.audience.includes("California") ? "California" : "Other US jurisdiction", affiliatePartner: scope.channel === "Affiliate partner" ? "Homewise" : "None", ...scope },
        createdAt: ago(hours),
        author: owner,
        note: "Original submission from marketing.",
      },
    ],
    comments: [],
    events: [
      {
        id: `${id}-created`,
        actor: owner,
        text: "Submitted v1 for compliance review with its intended use.",
        createdAt: ago(hours),
      },
    ],
    fixture,
  });
  const loan = make(
    "CP-1042",
    "A little breathing room",
    "Maya Chen",
    26,
    {
      headline: "Big plans. Guaranteed approval.",
      body: "Get the funds you need, whatever your credit score. Your next chapter starts today.",
      disclosure: "Apply online. Terms apply.",
      cta: "Get approved today",
      art: "sunrise",
    },
    base,
    "loan",
  );
  loan.comments.push({
    id: "note-loan",
    author: "Maya Chen",
    text: "We want to keep this warm and optimistic. Happy for you to adjust the claim directly if we can keep that feeling.",
    createdAt: ago(26),
    versionId: 1,
    field: "Creative brief",
  });
  const mortgage = make(
    "CP-1041",
    "Room for your next chapter",
    "Jordan Lee",
    22,
    {
      headline: "Your new home. Already approved.",
      body: "Prequalify today and start shopping with a guaranteed mortgage.",
      disclosure:
        "Prequalification is not a commitment to lend. Subject to verification and underwriting.",
      cta: "Find your home",
      art: "home",
      palette: "off-brand",
      image: "creative/mortgage-original.png",
    },
    {
      product: "Mortgage prequalification",
      audience: "California adults · first-time homebuyers",
      channel: "Affiliate partner",
      placement: "Homewise · landing-page hero",
    },
    "mortgage",
  );
  const card = make(
    "CP-1040",
    "Everyday, a little more rewarding",
    "Sofia Patel",
    7,
    {
      headline: "Make more of your everyday.",
      body: "Explore a credit card designed for your everyday purchases.",
      disclosure:
        "Subject to credit approval. See card agreement for rates, fees, and reward terms.",
      cta: "Explore the card",
      art: "card",
    },
    {
      product: "Credit cards",
      audience: "US adults · prospecting",
      channel: "Email",
      placement: "Monthly newsletter · hero",
    },
  );
  for (const item of [card, loan]) {
    item.reviewEvidence = {
      scope: { ...item.versions[0].scope },
      stateReview: `Review record CP-ROUTE-${item.id}: generic national campaign scope reviewed under the ClearPath campaign-routing policy`,
    };
  }
  const waiting = make(
    "CP-1039",
    "A fresh start, on your terms",
    "Maya Chen",
    19,
    { ...fixes.loan.content, headline: "A fresh start, on your terms." },
    { ...base, channel: "Email", placement: "Customer email · hero" },
  );
  waiting.status = "With creative";
  waiting.proposalVersionId = 2;
  waiting.decisionNote =
    "Removed the unconditional claim and clarified eligibility. Please confirm the revised headline works for the campaign.";
  waiting.versions.push({
    ...waiting.versions[0],
    id: 2,
    createdAt: ago(3),
    author: "Alex Morgan",
    note: "Adjusted headline and eligibility language.",
  });
  waiting.events.push({
    id: "waiting-pre",
    actor: "Alex Morgan",
    text: "Pre-approved v2 and its recorded intended use. Awaiting creative acceptance.",
    createdAt: ago(3),
  });
  const approved = make(
    "CP-1038",
    "A clearer path to home",
    "Jordan Lee",
    40,
    { ...fixes.mortgage.content, image: undefined },
    {
      ...mortgage.versions[0].scope,
      audience: "US adults · first-time homebuyers",
      channel: "Organic social",
      placement: "LinkedIn · feed",
    },
  );
  approved.status = "Approved";
  approved.approvedVersionId = 1;
  approved.decisionNote =
    "Reviewed the copy and readable disclosure for the stated placement.";
  approved.events.push({
    id: "approved",
    actor: "Alex Morgan",
    text: "Approved v1 for its recorded intended use.",
    createdAt: ago(2),
  });
  const returned = make(
    "CP-1037",
    "Room to move forward",
    "Sofia Patel",
    12,
    { ...fixes.loan.content, headline: "Room to move forward." },
    {
      ...base,
      channel: "Affiliate partner",
      placement: "CompareWell · comparison page",
    },
  );
  returned.status = "Changes requested";
  returned.comments.push({
    id: "creative-feedback",
    author: "Sofia Patel",
    text: "Can we keep “move forward” in the headline? It ties this placement to the rest of the campaign.",
    createdAt: ago(1),
    versionId: 1,
    field: "Creative feedback",
  });
  returned.events.push({
    id: "returned",
    actor: "Sofia Patel",
    text: "Requested a headline adjustment. Compliance has the next action.",
    createdAt: ago(1),
  });
  return [loan, mortgage, card, waiting, returned, approved];
}

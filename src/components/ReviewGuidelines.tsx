import { LIVE_POLICY_VERSION, LIVE_RULES } from "../../shared/reviewPolicy.mjs";
import { GUIDELINE_MAINTENANCE, REVIEW_GUIDELINES } from "../reviewGuidelines";
import { PolicySources } from "./PolicySources";

const ruleNotes: Record<string, string> = {
  "brand-palette": "This is ClearPath company policy, not a legal color requirement. Review the actual artwork; photography can include other colors. Keep essential content legible and within the canvas, in the recorded placement’s orientation.",
  "misleading-claim": "The blanket no-guarantee rule is company policy. The mortgage reference prohibits material misrepresentations about obtaining a mortgage. FTC guidance explains truthful, substantiated claims; it does not prescribe ClearPath’s exact wording.",
  "product-disclosure": "ClearPath requires conditional credit approval and product-specific qualifying language. Those company phrases are not federally prescribed boilerplate. Specific credit terms may trigger additional disclosures under the linked rules; missing rates or supporting facts must be supplied, not invented.",
  "state-review": "CP-CA-01 is a fictional ClearPath company policy for California campaigns, not a statement of California law. The disclosure must be readable on the artwork itself; entering it only in supplied copy does not satisfy the check.",
  "affiliate-identity": "HW-01 is a fictional partner contract: identify Homewise and include a readable label such as “Paid advertisement by ClearPath Financial.” The FTC link is background about endorsements and unexpected material connections; it is not the source of this fictional contract or a rule covering every affiliate banner.",
};

export function GuidelinesChecklist({ mode = "prepared" }: { mode?: "prepared" | "live" }) {
  if (mode === "live") {
    return (
      <ol className="guidelines-checklist">
        {LIVE_RULES.map(rule => (
          <li key={rule.id} id={rule.id}>
            <strong>{rule.label}</strong>
            <p>{rule.description}</p>
            <p><b>When it applies:</b> {rule.applicabilityDescription}</p>
            <p>{ruleNotes[rule.id]}</p>
            <PolicySources sources={rule.sources} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="guidelines-checklist">
      {Object.entries(REVIEW_GUIDELINES).map(([id, guideline]) => (
        <li key={id}>
          <strong>{guideline.label}</strong>
          <p>{guideline.description}</p>
        </li>
      ))}
    </ol>
  );
}

export function ReviewGuidelines() {
  return (
    <div className="queue-page guidelines-page">
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>Review guidelines</h1>
          <p className="page-subtitle">
            {LIVE_POLICY_VERSION} · {LIVE_RULES.length}{" "}
            specifications
          </p>
        </div>
      </div>
      <div className="guidelines-creative-note">
        <strong>Give creative this checklist before work begins.</strong>
        <p>
          The creative team should have a copy while creating assets and
          preparing submissions, so they can address these requirements before
          review.
        </p>
        <a href="?guidelines">
          Checklist link for creative <span aria-hidden="true">→</span>
        </a>
      </div>
      <div className="guidelines-maintenance">
        <h2>Rules follow the intended use</h2>
        <p>
          Choose the product, jurisdiction, and affiliate partner when submitting.
          California activates the offer disclosure for all three products; Homewise
          activates its placement policy. Other US jurisdiction excludes California
          for this example. Unspecified jurisdiction or an unsupported affiliate
          needs review before approval.
        </p>
        <p>
          Each finding links to its source. Company and partner policies are
          separate from laws and regulatory guidance. The checks cover the rules
          listed here; absent requirements are not silently assumed to pass.
        </p>
      </div>
      <section aria-label="Review checklist" className="guidelines-specs">
        <GuidelinesChecklist mode="live" />
      </section>
      <div className="guidelines-maintenance" id="california-example">
        <h2>Try the California example</h2>
        <p>
          This personal-loan ad deliberately omits the California disclosure.
          Download it, then use <b>New submission</b> with <b>Personal loans</b>,{" "}
          <b>Paid social</b>, <b>California</b>, and affiliate partner <b>None</b>.
          Use a California adult audience and the default Instagram portrait placement.
        </p>
        <p>
          Run AI review → review the missing-disclosure feedback → Prepare correction
          → Recheck revised asset. The same artwork submitted for <b>Other US jurisdiction</b>{" "}
          does not require this California line.
        </p>
        <a href={`${import.meta.env.BASE_URL}examples/california-missing-disclosure.jpg`} download>
          Download California example · JPEG
        </a>
      </div>
      <div className="guidelines-maintenance">
        <h2>Keep the checklist current</h2>
        <p>
          {GUIDELINE_MAINTENANCE} Keep the review checks and creative’s copy of
          the checklist in sync.
        </p>
      </div>
    </div>
  );
}

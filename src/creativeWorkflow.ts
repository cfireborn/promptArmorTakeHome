import {
  currentVersion,
  saveDraft,
  type AssetContent,
  type Scope,
  type Submission,
} from "./domain";

function sameFields(left: object, right: object): boolean {
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (key) => a[key] === b[key],
  );
}

export function resubmitCreativeRevision(
  submission: Submission,
  content: AssetContent,
  scope: Scope,
  owner: string,
): Submission {
  if (owner !== submission.owner)
    throw new Error("Only this submission’s creative owner can resubmit it.");
  if (
    !["Revision requested", "Changes requested", "Approved"].includes(
      submission.status,
    )
  )
    throw new Error("This submission is not awaiting a creative revision.");
  if (!content.image && !content.headline.trim() && !content.body.trim())
    throw new Error("Add a revised image or creative copy before submitting.");
  if (
    ![scope.product, scope.audience, scope.channel, scope.placement].every(
      (value) => value.trim(),
    )
  )
    throw new Error("Complete the intended use before resubmitting.");
  const previous = currentVersion(submission);
  if (
    sameFields(previous.content, content) &&
    sameFields(previous.scope, scope)
  )
    throw new Error(
      "Change the asset, copy, or intended use before resubmitting.",
    );
  return saveDraft(
    submission,
    content,
    scope,
    `Creative revision of v${previous.id}, resubmitted to ${submission.reviewer} for review.`,
    owner,
  );
}

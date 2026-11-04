import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Expand,
  History,
  LoaderCircle,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  applicableRules,
  LIVE_POLICY_VERSION,
} from "../../shared/reviewPolicy.mjs";
import { sourceFingerprint } from "../../shared/aiSnapshot.mjs";
import {
  addComment,
  currentVersion,
  returnForRevision,
  saveDraft,
  type Scope,
  type Submission,
} from "../domain";
import {
  approveLiveReview,
  currentLiveReport,
  editAsset,
  recordLiveReport,
  reviewAsset,
  type LiveReviewReport,
} from "../ai";
import { formatCreativeCopy, parseCreativeCopy } from "../intake";
import type { LiveSlackBridge } from "../slack";
import { Asset } from "./Asset";
import { EvidenceAsset, locatedEvidence } from "./EvidenceAsset";
import { LiveSlack } from "./LiveSlack";
import { Modal } from "./Modal";
import { PolicySources } from "./PolicySources";
import "../live-review.css";

type Props = {
  item: Submission;
  update: (item: Submission) => void;
  slack: LiveSlackBridge;
  back?: () => void;
  onCreative?: () => void;
  readOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};
const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const snapshotKey = (item: Submission) => {
  const version = currentVersion(item);
  return sourceFingerprint({
    submissionId: item.id,
    versionId: version.id,
    content: version.content,
    scope: version.scope,
  });
};
const scopeDefaults = (scope: Scope): Scope => ({
  ...scope,
  jurisdiction: scope.jurisdiction || "Unspecified",
  affiliatePartner: scope.affiliatePartner || "Other",
});
const canReview = (item: Submission) =>
  item.status === "Needs review" || item.status === "Changes requested";
const statusLabels = {
  pass: "Passed",
  fail: "Change required",
  "needs-review": "Needs evidence",
  "not-applicable": "Not applicable",
};
function suggestedFeedback(report?: LiveReviewReport): string {
  if (!report || report.canApprove) return "";
  return report.checks
    .filter(
      (check) => check.status === "fail" || check.status === "needs-review",
    )
    .map(
      (check) =>
        `${check.label}: ${(check.fix || check.evidence).slice(0, 220)}`,
    )
    .join("\n\n")
    .slice(0, 1500);
}
function previewDecision(item: Submission): Submission {
  const version = currentVersion(item);
  const decision = [...item.events]
    .reverse()
    .find((event) => /^(Approved|Pre-approved|Returned) v/.test(event.text));
  if (!decision) return item;
  return {
    ...item,
    events: [
      ...item.events,
      {
        id: crypto.randomUUID(),
        actor: "Slack preview",
        createdAt: new Date().toISOString(),
        text: `Prepared ${item.status === "With creative" ? "an adjustment" : item.status === "Approved" ? "an approval notice" : "a revision request"} for ${item.owner}. No real Slack message was sent.`,
        preview: {
          versionId: version.id,
          decisionId: decision.id,
          kind:
            item.status === "With creative"
              ? "proposal"
              : item.status === "Approved"
                ? "approved"
                : "revision_requested",
          status: "prepared",
        },
      },
    ],
  };
}

export function LiveReviewWorkspace({
  item,
  update,
  slack,
  back,
  onCreative,
  readOnly = false,
  onDirtyChange,
}: Props) {
  const version = currentVersion(item);
  const [copy, setCopy] = useState(formatCreativeCopy(version.content));
  const [scope, setScope] = useState<Scope>(scopeDefaults(version.scope));
  const [feedback, setFeedback] = useState(
    suggestedFeedback(currentLiveReport(item)),
  );
  const [busy, setBusy] = useState<"review" | "edit" | "delivery" | null>(null);
  const [error, setError] = useState("");
  const [returning, setReturning] = useState(false);
  const [enlarged, setEnlarged] = useState(false);
  const [showLocations, setShowLocations] = useState(true);
  const [activeRegion, setActiveRegion] = useState<number>();
  const [visibleVersion, setVisibleVersion] = useState(version.id);
  const latest = useRef(item);
  latest.current = item;
  const sequence = useRef(0);
  const alive = useRef(true);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const copiedContent =
    copy === formatCreativeCopy(version.content)
      ? version.content
      : { ...version.content, ...parseCreativeCopy(copy) };
  const dirty =
    copy !== formatCreativeCopy(version.content) ||
    JSON.stringify(scope) !== JSON.stringify(scopeDefaults(version.scope));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const report = dirty ? undefined : currentLiveReport(item);
  const viewingCurrent = visibleVersion === version.id;
  const regions = locatedEvidence(viewingCurrent ? report : undefined);
  const displayed =
    item.versions.find((value) => value.id === visibleVersion) || version;
  const allowed =
    !readOnly &&
    canReview(item) &&
    !busy &&
    !slack.busy &&
    !dirty &&
    viewingCurrent;
  const unresolved =
    report?.checks.filter(
      (check) => check.status === "fail" || check.status === "needs-review",
    ).length || 0;
  const concept = !!report?.canCreateConcept;
  const canGenerate = !!report && (report.canSuggestFix || concept);
  const reviewerFeedback = item.comments
    .filter((comment) => comment.field === "Creative feedback")
    .at(-1);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  useEffect(() => {
    sequence.current++;
    setCopy(formatCreativeCopy(version.content));
    setScope(scopeDefaults(version.scope));
    setVisibleVersion(version.id);
    setBusy(null);
    setReturning(false);
    setError("");
    setActiveRegion(undefined);
  }, [item.id, version.id]);
  useEffect(() => {
    setFeedback(suggestedFeedback(currentLiveReport(item)));
  }, [item.id, version.id, item.liveReview?.id]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      onDirtyChange?.(false);
    };
  }, [dirty, onDirtyChange]);
  function leave(action?: () => void) {
    if (
      dirty &&
      !window.confirm("Discard unsaved text and intended-use changes?")
    )
      return;
    onDirtyChange?.(false);
    action?.();
  }
  function focusResult() {
    requestAnimationFrame(() =>
      resultHeading.current?.focus({ preventScroll: true }),
    );
  }
  function sourceIsCurrent(source: Submission, request: number) {
    return (
      alive.current &&
      sequence.current === request &&
      !dirtyRef.current &&
      snapshotKey(source) === snapshotKey(latest.current)
    );
  }
  async function assess() {
    if (!allowed) return;
    const source = item;
    const request = ++sequence.current;
    setBusy("review");
    setError("");
    try {
      const result = await reviewAsset(source);
      if (!sourceIsCurrent(source, request)) return;
      update(recordLiveReport(latest.current, result));
      setFeedback(suggestedFeedback(result));
      focusResult();
    } catch (cause) {
      if (sourceIsCurrent(source, request))
        setError(
          cause instanceof Error
            ? cause.message
            : "The review could not finish. Retry this review.",
        );
    } finally {
      if (alive.current && sequence.current === request) setBusy(null);
    }
  }
  async function generate() {
    if (!allowed || !report || !canGenerate || !feedback.trim()) return;
    const source = item;
    const request = ++sequence.current;
    const instructions = feedback.trim();
    setBusy("edit");
    setError("");
    try {
      const result = await editAsset(source, instructions);
      if (!sourceIsCurrent(source, request)) return;
      const commented = addComment(
        latest.current,
        instructions,
        concept ? "New concept instructions" : "AI correction instructions",
      );
      const draft = saveDraft(
        commented,
        result.content,
        currentVersion(source).scope,
        concept
          ? "Created a new advertising concept from the uploaded inspiration. New pixels require review before approval."
          : "Generated corrected artwork on the same reviewed canvas, fitted without cropping, stretching, or enlargement. New pixels require review before approval.",
      );
      draft.versions[draft.versions.length - 1].aiGeneration =
        result.provenance;
      update(draft);
      focusResult();
    } catch (cause) {
      if (sourceIsCurrent(source, request))
        setError(
          cause instanceof Error
            ? cause.message
            : "The image could not be prepared. Retry or return comments to creative.",
        );
    } finally {
      if (alive.current && sequence.current === request) setBusy(null);
    }
  }
  function save() {
    if (
      !dirty ||
      busy ||
      readOnly ||
      ![scope.product, scope.audience, scope.channel, scope.placement].every(
        (value) => value.trim(),
      )
    )
      return;
    if (
      !copiedContent.image &&
      !copiedContent.headline.trim() &&
      !copiedContent.body.trim()
    ) {
      setError("Add creative copy before saving.");
      return;
    }
    update(
      saveDraft(
        item,
        copiedContent,
        scope,
        version.content.image
          ? "Updated supplied transcript or intended use. Image pixels remain unchanged; review the new version."
          : "Updated creative copy or intended use for a new review.",
      ),
    );
  }
  async function decide(returnRevision = false) {
    if (!allowed || (returnRevision && !feedback.trim())) return;
    setError("");
    try {
      const source = latest.current;
      const corrections = version.aiGeneration ? source.comments.filter(comment =>
        comment.versionId < version.id && ['AI correction instructions', 'New concept instructions'].includes(comment.field)) : [];
      const omitted = Math.max(0, corrections.length - 3);
      const historyNotice = omitted
        ? `${omitted} intermediate correction ${omitted === 1 ? 'note' : 'notes'} omitted; full instructions are in History.`
        : '';
      const shownCorrections = omitted ? [corrections[0], ...corrections.slice(-2)] : corrections;
      const maxLineLength = shownCorrections.length
        ? Math.floor((900 - historyNotice.length - shownCorrections.length) / shownCorrections.length)
        : 0;
      const correctionNotes = shownCorrections.map(comment => {
        const prefix = `What changed from v${comment.versionId}: `;
        const available = maxLineLength - prefix.length;
        const shortened = '… [shortened; full text in History]';
        const text = comment.text.length > available
          ? comment.text.slice(0, available - shortened.length) + shortened
          : comment.text;
        return prefix + text;
      });
      const approvalNote = [
        [...correctionNotes, historyNotice].filter(Boolean).join('\n'),
        `Reviewed v${version.id} and its recorded use against ${report?.policyVersion}. ${report?.summary || "All applicable requirements passed."}`,
      ].filter(Boolean).join('\n\n').slice(0, 1500);
      const next = returnRevision
        ? returnForRevision(source, feedback.trim())
        : approveLiveReview(
            source,
            approvalNote,
          );
      flushSync(() => update(slack.session ? next : previewDecision(next)));
      if (slack.session) {
        setBusy("delivery");
        if (next.status === "With creative") await slack.send(next);
        else
          await slack.notify(
            next,
            returnRevision ? "revision_requested" : "approved",
            next.decisionNote!,
          );
      }
      focusResult();
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The decision could not be saved.",
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  const resultTitle =
    busy === "review"
      ? "Reviewing the submitted asset"
      : busy === "edit"
        ? "Preparing corrected artwork"
        : item.status === "Approved"
          ? `v${item.approvedVersionId} is approved`
          : item.status === "With creative"
            ? "Waiting for creative’s response"
            : item.status === "Revision requested"
              ? "Revision requested"
              : dirty
                ? "Save this version before reviewing"
                : report
                  ? !report.assetRelevant
                    ? "The uploaded image is not the intended ad"
                    : report.canApprove
                      ? "All applicable checks passed"
                      : `${unresolved} ${unresolved === 1 ? "requirement needs" : "requirements need"} attention`
                  : version.aiGeneration
                    ? "Recheck the revised asset"
                    : "Ready for AI review";
  return (
    <div className="queue-page lr-page">
      <div className="lr-topline">
        {back && (
          <button className="text-button" onClick={() => leave(back)}>
            <ArrowLeft size={15} /> Queue
          </button>
        )}
        <span
          className={`status ${item.status.toLowerCase().replaceAll(" ", "-")}`}
        >
          {item.status}
        </span>
      </div>
      <div className="page-heading lr-heading">
        <div>
          <p className="eyebrow">
            {item.id} · v{version.id}
          </p>
          <h1 tabIndex={-1}>
            {version.scope.product} · {version.scope.placement} for review
          </h1>
          <p className="page-subtitle">
            Creative: {item.owner} · Reviewer: {item.reviewer}
          </p>
        </div>
      </div>
      {reviewerFeedback && item.status === "Changes requested" && (
        <div className="lr-context">
          <strong>Creative requested a change</strong>
          <p>{reviewerFeedback.text}</p>
        </div>
      )}
      <div className="lr-layout">
        <section className="lr-asset-card" aria-label="Submitted creative">
          <div className="lr-card-heading">
            <strong>
              {visibleVersion === version.id
                ? "Current asset"
                : "Earlier asset"}{" "}
              · v{displayed.id}
            </strong>
            <div className="lr-image-controls">
              {item.versions.length > 1 && (
                <label className="sr-only" htmlFor={`version-${item.id}`}>
                  Asset version
                </label>
              )}
              {item.versions.length > 1 && (
                <select
                  id={`version-${item.id}`}
                  aria-label="Asset version"
                  value={visibleVersion}
                  onChange={(event) =>
                    setVisibleVersion(Number(event.target.value))
                  }
                >
                  {[...item.versions].reverse().map((value) => (
                    <option key={value.id} value={value.id}>
                      v{value.id}
                      {value.id === version.id ? " · current" : ""}
                    </option>
                  ))}
                </select>
              )}
              <button className="text-button" onClick={() => setEnlarged(true)}>
                <Expand size={14} /> Full size
              </button>
            </div>
          </div>
          <div className="lr-asset-stage">
            {regions.length ? <EvidenceAsset item={item} regions={regions} show={showLocations} /> : <Asset content={displayed.content} />}
          </div>
          {regions.length > 0 && <div className="lr-evidence-key">
            <label><input type="checkbox" checked={showLocations} onChange={event => setShowLocations(event.target.checked)} /> Show text locations</label>
            <p>AI-located text. Check the highlighted area against the image.</p>
            <div>{regions.map(region => <button key={region.number} onClick={() => { setActiveRegion(region.number); setEnlarged(true); }}>
              <b>{region.number}</b><span>{region.quote}</span><Expand size={13} />
            </button>)}</div>
          </div>}
          {displayed.aiGeneration && (
            <p className="lr-provenance">
              Generated with {displayed.aiGeneration.model} ·{" "}
              {date(displayed.aiGeneration.createdAt)}. Saved as a separate asset
              version.
            </p>
          )}
          <div className="lr-scope">
            <strong>Recorded intended use</strong>
            <dl>
              {Object.entries(scopeDefaults(displayed.scope)).map(
                ([key, value]) => (
                  <div key={key}>
                    <dt>
                      {key === "affiliatePartner" ? "Affiliate partner" : key}
                    </dt>
                    <dd>{value}</dd>
                  </div>
                ),
              )}
            </dl>
          </div>
          {!readOnly && (
            <details className="lr-editor">
              <summary>
                Edit {version.content.image ? "supplied text" : "creative copy"}{" "}
                and intended use <ChevronDown size={15} />
              </summary>
              <p>
                {version.content.image
                  ? "The text below is a supplied transcript. Editing it does not change the image. Use an AI image correction or ask creative to replace the artwork when pixels need to change."
                  : "Copy edits update the creative when saved. Every saved edit needs a fresh review."}
              </p>
              <fieldset disabled={!!busy}>
                <label className="field-label">
                  {version.content.image ? "Supplied text" : "Creative copy"}
                  <textarea
                    rows={8}
                    value={copy}
                    onChange={(event) => setCopy(event.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label className="field-label">
                    Product
                    <select
                      value={scope.product}
                      onChange={(event) =>
                        setScope({ ...scope, product: event.target.value })
                      }
                    >
                      {[
                        "Personal loans",
                        "Credit cards",
                        "Mortgage prequalification",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Channel
                    <select
                      value={scope.channel}
                      onChange={(event) =>
                        setScope({
                          ...scope,
                          channel: event.target.value,
                          affiliatePartner:
                            event.target.value === "Affiliate partner"
                              ? scope.affiliatePartner === "None"
                                ? "Other"
                                : scope.affiliatePartner
                              : "None",
                        })
                      }
                    >
                      {[
                        "Paid social",
                        "Email",
                        "Organic social",
                        "Affiliate partner",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Audience
                    <input
                      value={scope.audience}
                      onChange={(event) =>
                        setScope({ ...scope, audience: event.target.value })
                      }
                    />
                  </label>
                  <label className="field-label">
                    Placement
                    <input
                      value={scope.placement}
                      onChange={(event) =>
                        setScope({ ...scope, placement: event.target.value })
                      }
                    />
                  </label>
                  <label className="field-label">
                    Jurisdiction
                    <select
                      value={scope.jurisdiction}
                      onChange={(event) =>
                        setScope({
                          ...scope,
                          jurisdiction: event.target
                            .value as Scope["jurisdiction"],
                        })
                      }
                    >
                      <option>Unspecified</option>
                      <option>California</option>
                      <option>Other US jurisdiction</option>
                    </select>
                  </label>
                  <label className="field-label">
                    Affiliate partner
                    <select
                      value={scope.affiliatePartner}
                      onChange={(event) =>
                        setScope({
                          ...scope,
                          affiliatePartner: event.target
                            .value as Scope["affiliatePartner"],
                          channel:
                            event.target.value === "None"
                              ? scope.channel === "Affiliate partner"
                                ? "Paid social"
                                : scope.channel
                              : "Affiliate partner",
                        })
                      }
                    >
                      <option>None</option>
                      <option>Homewise</option>
                      <option>Other</option>
                    </select>
                  </label>
                </div>
              </fieldset>
              {dirty && (
                <button
                  className="text-button"
                  onClick={() => {
                    setCopy(formatCreativeCopy(version.content));
                    setScope(scopeDefaults(version.scope));
                  }}
                >
                  Discard edits
                </button>
              )}
            </details>
          )}
        </section>
        <section className="lr-review-card" aria-label="AI review">
          <div className="lr-card-heading">
            <span>
              <ShieldCheck size={17} /> Review findings
            </span>
            <small>{LIVE_POLICY_VERSION}</small>
          </div>
          <div
            className={`lr-result ${report?.canApprove || item.status === "Approved" ? "lr-success" : report ? "lr-attention" : ""}`}
          >
            {busy ? (
              <LoaderCircle className="lr-spin" size={25} />
            ) : report?.canApprove || item.status === "Approved" ? (
              <CheckCircle2 size={25} />
            ) : (
              <ShieldCheck size={25} />
            )}
            <div>
              <h2 ref={resultHeading} tabIndex={-1}>
                {resultTitle}
              </h2>
              <p>
                {busy === "review"
                  ? "Claude is reading the actual image, supplied copy, intended use, and applicable policies."
                  : busy === "edit"
                    ? "OpenAI is generating new pixels from the source and your instructions. The result will need a fresh review."
                    : item.status === "With creative"
                      ? `${item.owner} can accept the exact proposed version or request changes.`
                      : item.status === "Revision requested"
                        ? `${item.owner} has the next action. Acknowledgment is not approval.`
                        : item.status === "Approved"
                          ? "Approval covers this exact asset version and its recorded use."
                          : dirty
                            ? "Saving clears the previous assessment. Image pixels stay unchanged when only the transcript is edited."
                            : report?.summary ||
                              "Review this asset against the five requirements, including the rules selected by jurisdiction and affiliate."}
              </p>
            </div>
          </div>
          {report && (
            <p className="lr-model">
              {report.model} · {date(report.checkedAt)} · v{report.versionId}
            </p>
          )}
          {report && !report.assetRelevant && concept && (
            <p className="lr-concept-note">
              This upload cannot be approved as the declared ad. A correction
              will create a financial ad using only visual inspiration from this
              upload and the selected product. The new version must be reviewed.
            </p>
          )}
          {report && (
            <div className="lr-checks">
              {report.checks.map((check) => (
                <details
                  key={`${report.id}:${check.id}`}
                  open={
                    check.status === "fail" || check.status === "needs-review"
                  }
                >
                  <summary>
                    <span className={`lr-check-icon ${check.status}`}>
                      {check.status === "pass" ? (
                        <Check size={14} />
                      ) : check.status === "fail" ? (
                        <X size={14} />
                      ) : check.status === "not-applicable" ? (
                        "—"
                      ) : (
                        "?"
                      )}
                    </span>
                    <strong>{check.label}</strong>
                    <small>{statusLabels[check.status]}</small>
                    <ChevronDown size={14} />
                  </summary>
                  <div className="lr-check-body">
                    <p>{check.evidence}</p>
                    {check.rationale !== check.evidence && (
                      <p className="muted">{check.rationale}</p>
                    )}
                    {check.fix && (
                      <p>
                        <strong>To resolve:</strong> {check.fix}
                      </p>
                    )}
                    {regions.filter(region => region.checkId === check.id).map(region => <button
                      className="lr-evidence-link" key={region.number}
                      onClick={() => { setActiveRegion(region.number); setEnlarged(true); }}>
                      <span>{region.number}</span> Locate “{region.quote}” <Expand size={13} />
                    </button>)}
                    <PolicySources sources={check.sources} />
                  </div>
                </details>
              ))}
            </div>
          )}
          {!report && !dirty && (
            <details className="lr-policy-preview">
              <summary>
                Applicable review guidelines <ChevronDown size={14} />
              </summary>
              {applicableRules(version.scope).map((rule) => (
                <div key={rule.id}>
                  <strong>{rule.label}</strong>
                  <p>{rule.reason}</p>
                  <PolicySources sources={rule.sources} />
                </div>
              ))}
            </details>
          )}
          {!readOnly &&
            canReview(item) &&
            viewingCurrent &&
            !dirty &&
            (returning || (report && !report.canApprove)) && (
              <div className="lr-feedback">
                <label className="field-label">
                  Comments for creative
                  <textarea
                    rows={5}
                    maxLength={1500}
                    value={feedback}
                    disabled={!!busy}
                    onChange={(event) => setFeedback(event.target.value)}
                  />
                </label>
                <small>
                  Review these instructions before generating an image or
                  sending them to {item.owner.split(" ")[0]}.
                </small>
              </div>
            )}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {!readOnly && (
            <div className="lr-action" aria-label="Next review action">
              {!viewingCurrent ? (
                <button
                  className="primary"
                  onClick={() => setVisibleVersion(version.id)}
                >
                  Return to current v{version.id} <ArrowRight size={16} />
                </button>
              ) : dirty ? (
                <button
                  className="primary"
                  disabled={
                    !!busy ||
                    ![
                      scope.product,
                      scope.audience,
                      scope.channel,
                      scope.placement,
                    ].every((value) => value.trim())
                  }
                  onClick={save}
                >
                  <Save size={16} /> Save new version
                </button>
              ) : busy ? (
                <button className="primary" disabled>
                  <LoaderCircle className="lr-spin" size={16} />
                  {busy === "review"
                    ? "Reviewing asset…"
                    : busy === "edit"
                      ? "Generating artwork…"
                      : "Sending to Slack…"}
                </button>
              ) : canReview(item) ? (
                returning ? (
                  <>
                    <button
                      className="primary"
                      disabled={!allowed || !feedback.trim()}
                      onClick={() => void decide(true)}
                    >
                      <Send size={16} /> Return with comments
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setReturning(false)}
                    >
                      Keep reviewing
                    </button>
                  </>
                ) : !report ? (
                  <>
                    <button
                      className="primary"
                      disabled={!allowed}
                      onClick={() => void assess()}
                    >
                      <Sparkles size={16} />
                      {version.aiGeneration
                        ? "Recheck revised asset"
                        : error
                          ? "Retry AI review"
                          : "Run AI review"}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setReturning(true)}
                    >
                      Return without AI review
                    </button>
                  </>
                ) : report.canApprove ? (
                  <>
                    <button
                      className="primary"
                      disabled={!allowed}
                      onClick={() => void decide()}
                    >
                      {version.aiGeneration ? (
                        <Send size={16} />
                      ) : (
                        <Check size={16} />
                      )}
                      {(version.aiGeneration || (version.id > 1 && version.author === item.reviewer))
                        ? "Pre-approve & send to creative"
                        : `Approve v${version.id}`}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setReturning(true)}
                    >
                      Return with comments instead
                    </button>
                  </>
                ) : canGenerate ? (
                  <>
                    <button
                      className="primary"
                      disabled={!allowed || !feedback.trim()}
                      onClick={() => void generate()}
                    >
                      <Sparkles size={16} />
                      Prepare correction
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setReturning(true)}
                    >
                      Return with comments instead
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={!allowed || !feedback.trim()}
                    onClick={() => void decide(true)}
                  >
                    <Send size={16} /> Return with comments
                  </button>
                )
              ) : null}
              {report &&
                canReview(item) &&
                !dirty &&
                !busy &&
                viewingCurrent && (
                  <button
                    className="text-button lr-recheck"
                    onClick={() => void assess()}
                    disabled={!allowed}
                  >
                    Run a new AI assessment
                  </button>
                )}
            </div>
          )}
          {!canReview(item) && (
            <div className="lr-decision">
              <strong>Decision for v{version.id}</strong>
              <p>{item.decisionNote}</p>
              {!slack.session && (
                <p className="muted">
                  Slack preview only. No real message was sent.
                </p>
              )}
              {onCreative && (
                <button className="secondary" onClick={() => leave(onCreative)}>
                  View as {item.owner.split(" ")[0]} <ArrowRight size={15} />
                </button>
              )}
              {!readOnly && busy !== "delivery" && (
                <LiveSlack item={item} bridge={slack} />
              )}
            </div>
          )}
          {canReview(item) && !readOnly && (
            <p className="lr-provider-note">
              Live review sends this asset and supplied text to Claude. Image
              generation uses OpenAI when requested.
            </p>
          )}
        </section>
      </div>
      <details className="lr-history">
        <summary>
          <History size={16} /> Version history and decision trail{" "}
          <span>{item.events.length} {item.events.length === 1 ? 'event' : 'events'}</span>
        </summary>
        <ol reversed>
          {[...item.events].reverse().map((event) => (
            <li key={event.id}>
              <strong>{event.actor}</strong>
              <time>{date(event.createdAt)}</time>
              <p>{event.text}</p>
            </li>
          ))}
        </ol>
      </details>
      {enlarged && (
        <Modal
          title={`Asset ${item.id} · v${displayed.id}`}
          onClose={() => setEnlarged(false)}
          wide
        >
          <div className="lr-full-image">
            {regions.length ? <EvidenceAsset item={item} regions={regions} active={activeRegion} /> : <Asset content={displayed.content} />}
          </div>
          {regions.length > 0 && <div className="lr-evidence-key">
            <p>AI-located text · v{displayed.id}</p>
            <div>{regions.map(region => <button key={region.number} aria-pressed={activeRegion === region.number}
              onClick={() => setActiveRegion(region.number)}>
              <b>{region.number}</b><span>{region.quote}</span>
            </button>)}</div>
          </div>}
        </Modal>
      )}
    </div>
  );
}

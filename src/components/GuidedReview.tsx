import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileCheck2,
  ImageIcon,
  LoaderCircle,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  acceptProposal,
  currentVersion,
  preapprove,
  returnForRevision,
  saveDraft,
  waitingSince,
  type Submission,
} from "../domain";
import {
  POLICY_PACK,
  approveChecked,
  checkSubmission,
  draftFeedback,
  submitCheckFeedback,
  recordCheckReport,
  type CheckReport,
} from "../checker";
import { generateSuggestedFix } from "../generation";
import {
  matchesCurrentHandoff,
  matchesNotification,
  canNotifySlack,
  slackChannelName,
  type LiveSlackBridge,
} from "../slack";
import { Asset } from "./Asset";
import { Modal } from "./Modal";
import { ReviewerSlackActivity, SlackRoutingSummary } from "./LiveSlack";
import { GuidelinesChecklist } from "./ReviewGuidelines";
import { GUIDELINE_MAINTENANCE, REVIEW_GUIDELINES } from "../reviewGuidelines";
import "../guided.css";

const stages = [
  {
    id: "CP-1040",
    title: "A clean submission",
    label: "Check & approve",
  },
  {
    id: "CP-1042",
    title: "A small, clear fix",
    label: "Fix & hand off",
  },
  {
    id: "CP-1041",
    title: "A revision with context",
    label: "",
  },
];
const isDone = (item: Submission) =>
  ["Approved", "Revision requested"].includes(item.status);
function deliveryFor(item: Submission, slack: LiveSlackBridge) {
  const decision = [...item.events]
    .reverse()
    .find((event) => /^(Approved|Pre-approved|Returned) v/.test(event.text));
  const preview = [...item.events]
    .reverse()
    .find(
      (event) =>
        event.preview?.versionId === currentVersion(item).id &&
        event.preview?.decisionId === decision?.id,
    )?.preview;
  const rawLink = slack.links[item.id];
  const proposal =
    rawLink && matchesCurrentHandoff(item, rawLink) && !rawLink.stale
      ? rawLink.proposal
      : undefined;
  const rawNotice = slack.notifications?.[item.id];
  const notification =
    rawNotice &&
    matchesNotification(item, rawNotice) &&
    canNotifySlack(item, rawNotice.request.kind)
      ? rawNotice.notification
      : undefined;
  const sent = slack.session
    ? proposal?.delivery === "sent" || notification?.delivery === "sent"
    : !!preview;
  const responseReceived = slack.session
    ? proposal?.status === "accepted" || notification?.status === "acknowledged"
    : preview?.status === "accepted" || preview?.status === "acknowledged";
  return {
    proposal,
    notification,
    simulated: preview?.status,
    sent,
    responseReceived,
    complete:
      isDone(item) &&
      sent &&
      (item.status !== "Revision requested" || responseReceived),
  };
}
const when = (date: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  return minutes < 1
    ? "just now"
    : minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
const issueCount = (report: CheckReport) =>
  report.checks.filter((check) =>
    ["fail", "needs-review"].includes(check.status),
  ).length;

type Props = {
  items: Submission[];
  update: (item: Submission) => void;
  slack: LiveSlackBridge;
  onOpenQueue: (submissionId?: string) => void;
  onNewSubmission: () => void;
  onOpenGuidelines: () => void;
  onRestart: () => Promise<void>;
  warning: string;
};
export function GuidedReview({
  items,
  update,
  slack,
  onOpenQueue,
  onNewSubmission,
  onOpenGuidelines,
  onRestart,
  warning,
}: Props) {
  const [index, setIndex] = useState(() => {
    try {
      const saved = Number(
        localStorage.getItem("clearpath-guided-step-v1") || 0,
      );
      return Number.isInteger(saved) && saved >= 0 && saved < 3 ? saved : 0;
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("clearpath-guided-step-v1", String(index));
    } catch {
      /* The review itself still works without storage. */
    }
  }, [index]);
  const [settings, setSettings] = useState(false);
  const [code, setCode] = useState("");
  const [resetting, setResetting] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  function changeStage(step: number) {
    flushSync(() => setIndex(step));
    titleRef.current?.focus({ preventScroll: true });
    titleRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  const stage = stages[index];
  const item = items.find((value) => value.id === stage.id);
  const needsUpdatedExamples = items.some(
    (item) =>
      stages.some((stage) => stage.id === item.id) &&
      !item.versions[0].content.palette,
  );
  const completed = stages.filter((stage) =>
    items.some(
      (item) => item.id === stage.id && deliveryFor(item, slack).complete,
    ),
  ).length;
  return (
    <div className="gr-app">
      <header className="gr-header">
        <a
          className="gr-brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            changeStage(0);
          }}
        >
          <span>
            <ArrowUpRight size="1em" strokeWidth={1.5} aria-hidden="true" />
          </span>
          relay<span className="gr-dot">.</span>
        </a>
        <span className="gr-company">
          ClearPath Financial <span>/</span> Marketing review
        </span>
        <div className="gr-header-actions">
          <button
            className={`gr-connection ${slack.session ? "connected" : ""}`}
            onClick={() => setSettings(true)}
          >
            <span />
            {slack.session ? "Live Slack connected" : "Slack preview"}
            <ChevronDown size={13} />
          </button>
          <button className="gr-quiet" onClick={() => onOpenQueue()}>
            All submissions <ArrowUpRight size={14} />
          </button>
          <button className="gr-quiet gr-guidelines-link" onClick={onOpenGuidelines}>
            <ShieldCheck size={15} /> Review guidelines
          </button>
          <button className="gr-new-submission" onClick={onNewSubmission}>
            <Plus size={15} /> New submission
          </button>
        </div>
      </header>
      <main className="gr-main">
        <div className="gr-heading">
          <div>
            <h1>Marketing review</h1>
          </div>
          <span className="gr-demo-badge">
            Prepared examples · {completed} of 3 complete
          </span>
        </div>
        <nav className="gr-steps" aria-label="Demo examples">
          {stages.map((value, step) => (
            <button
              key={value.id}
              className={`${step === index ? "active" : ""} ${items.some((item) => item.id === value.id && deliveryFor(item, slack).complete) ? "complete" : ""}`}
              aria-current={step === index ? "step" : undefined}
              disabled={
                step > index &&
                !items.some(
                  (item) =>
                    item.id === stages[step - 1].id &&
                    deliveryFor(item, slack).complete,
                )
              }
              onClick={() => changeStage(step)}
            >
              <span className="gr-step-number">
                {items.some(
                  (item) =>
                    item.id === value.id && deliveryFor(item, slack).complete,
                ) ? (
                  <Check size={17} />
                ) : (
                  step + 1
                )}
              </span>
              <span>
                <strong>{value.title}</strong>
                {value.label && <small>{value.label}</small>}
              </span>
              {step < 2 && <ArrowRight className="gr-step-arrow" size={16} />}
            </button>
          ))}
        </nav>
        {warning && (
          <p className="gr-error" role="alert">
            {warning}
          </p>
        )}
        {needsUpdatedExamples ? (
          <div className="gr-card gr-upgrade">
            <p className="gr-eyebrow">NEW GUIDED WALKTHROUGH</p>
            <h2>Three reviews, from simple to complex.</h2>
            <p>
              Load the updated sample assets and checklist evidence. This
              restarts the three demo reviews; your other submissions stay
              saved.
            </p>
            <button
              className="gr-primary"
              onClick={async () => {
                await onRestart();
                setIndex(0);
              }}
            >
              Load updated examples <ArrowRight size={16} />
            </button>
          </div>
        ) : item ? (
          <ReviewCase
            key={`${item.id}:${item.submittedAt}`}
            item={item}
            update={update}
            slack={slack}
            titleRef={titleRef}
            onNext={index < 2 ? () => changeStage(index + 1) : undefined}
            onOpenQueue={onOpenQueue}
          />
        ) : (
          <div className="gr-card">
            <h2>Restore the demo examples</h2>
            <button
              className="gr-primary"
              onClick={() => {
                void onRestart();
              }}
            >
              Restore examples
            </button>
          </div>
        )}
        <footer className="gr-footer">
          <span>
            <ShieldCheck size={14} /> Decisions stay with the exact version and
            intended use.
          </span>
          <button
            className="gr-quiet"
            disabled={resetting}
            onClick={async () => {
              if (
                !window.confirm(
                  "Restart the three sample reviews? Your other submissions stay saved.",
                )
              )
                return;
              setResetting(true);
              try {
                await onRestart();
                setIndex(0);
              } finally {
                setResetting(false);
              }
            }}
          >
            <RotateCcw size={13} /> Restart walkthrough
          </button>
        </footer>
      </main>
      {settings && (
        <Modal title="Slack delivery" onClose={() => setSettings(false)}>
          {slack.session ? (
            <>
              <p>
                Live Slack is connected. Messages mention Charlie, acting for
                the fictional marketing owners. Replies update this review automatically.
              </p>
              <SlackRoutingSummary session={slack.session} />
              <button className="gr-primary" onClick={() => setSettings(false)}>
                Continue with live Slack <Check size={16} />
              </button>
              <button
                className="gr-quiet"
                onClick={() => {
                  slack.disconnect();
                  setSettings(false);
                }}
              >
                Use preview instead
              </button>
            </>
          ) : (
            <>
              <p>
                The public walkthrough previews messages without sending
                anything. Connect privately to send real messages and receive
                Slack responses.
              </p>
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const privateCode = code;
                  setCode("");
                  await slack.connect(privateCode);
                }}
              >
                <label className="gr-label">
                  Private setup code
                  <input
                    type="password"
                    autoComplete="off"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </label>
                <button
                  className="gr-primary"
                  disabled={slack.busy || !code.trim()}
                >
                  {slack.busy ? "Connecting…" : "Connect live Slack"}
                </button>
              </form>
            </>
          )}
          {slack.error && (
            <p className="gr-error" role="alert">
              {slack.error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

function ReviewCase({
  item,
  update,
  slack,
  titleRef,
  onNext,
  onOpenQueue,
}: {
  item: Submission;
  update: Props["update"];
  slack: LiveSlackBridge;
  titleRef: RefObject<HTMLHeadingElement | null>;
  onNext?: () => void;
  onOpenQueue: (submissionId?: string) => void;
}) {
  const version = currentVersion(item);
  const fresh = checkSubmission(item);
  const savedReport =
    item.checkReport?.fingerprint === fresh.fingerprint
      ? item.checkReport
      : undefined;
  const [report, setReport] = useState<CheckReport | undefined>(savedReport);
  const [feedback, setFeedback] = useState(
    savedReport && !savedReport.canApprove ? draftFeedback(savedReport) : "",
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [showOriginal, setShowOriginal] = useState(false);
  const run = useRef(0);
  const latest = useRef(item);
  const actionRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  latest.current = item;
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );
  useEffect(() => {
    if (report && report.fingerprint !== checkSubmission(item).fingerprint) {
      setReport(savedReport);
      setFeedback(savedReport ? draftFeedback(savedReport) : "");
    }
  }, [item]);
  const currentReport =
    report?.fingerprint === fresh.fingerprint ? report : savedReport;
  const count = currentReport ? issueCount(currentReport) : 0;
  const isRevision = item.status === "Revision requested";
  const changesRequested = item.status === "Changes requested";
  const creativeFeedback = [...item.comments]
    .reverse()
    .find(
      (comment) =>
        comment.field === "Creative feedback" &&
        comment.versionId === version.id,
    );
  const done = isDone(item);
  const withCreative = item.status === "With creative";
  const generated = version.id > 1 && !!item.fixture;
  const failed = !!currentReport && !currentReport.canApprove;
  const {
    proposal,
    notification,
    simulated,
    sent,
    responseReceived,
    complete,
  } = deliveryFor(item, slack);
  const channel = slackChannelName(proposal?.recipient || notification?.recipient, slack.session?.channel || "#marketing-review");
  const reviewerNotice = proposal?.reviewerNotification || notification?.reviewerNotification;
  const nextOwner =
    withCreative || isRevision
      ? item.owner
      : item.status === "Approved"
        ? item.owner
        : item.reviewer;
  const waitingFrom = waitingSince(item);
  const busy = working || slack.busy;
  const wasComplete = useRef(complete);
  useEffect(() => {
    // Delivery and receipt polling can finish after the action callback returns.
    // Wait for the completed state to render before focusing its next action.
    if (complete && !wasComplete.current) focusNextAction();
    wasComplete.current = complete;
  }, [complete]);
  function commit(next: Submission) {
    flushSync(() => update(next));
  }
  function focusNextAction() {
    requestAnimationFrame(() => {
      actionRef.current
        ?.querySelector<HTMLButtonElement>(".gr-primary:not(:disabled)")
        ?.focus();
    });
  }
  function recordPreview(
    next: Submission,
    kind: "approved" | "revision_requested" | "proposal",
    status: "prepared" | "accepted" | "acknowledged" = "prepared",
  ) {
    const decision = [...next.events]
      .reverse()
      .find((event) => /^(Approved|Pre-approved|Returned) v/.test(event.text));
    if (!decision) return;
    commit({
      ...next,
      events: [
        ...next.events,
        {
          id: crypto.randomUUID(),
          actor: "Slack preview (simulation)",
          createdAt: new Date().toISOString(),
          text:
            status === "prepared"
              ? `Prepared a preview of the ${kind === "proposal" ? "adjustment" : kind === "approved" ? "approval notification" : "revision request"} for ${next.owner}. No real message was sent.`
              : status === "accepted"
                ? "Simulated creative acceptance received."
                : "Simulated marketing acknowledgment received. The asset still needs revision.",
          preview: {
            versionId: currentVersion(next).id,
            decisionId: decision.id,
            kind,
            status,
          },
        },
      ],
    });
    if (status !== "prepared") focusNextAction();
  }
  function runChecks() {
    const checked = checkSubmission(item);
    flushSync(() => {
      setReport(checked);
      setFeedback(checked.canApprove ? "" : draftFeedback(checked));
      setError("");
      update(recordCheckReport(item, checked));
    });
    resultRef.current?.focus({ preventScroll: true });
    resultRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  async function approve() {
    if (!currentReport) return;
    try {
      setError("");
      const next = approveChecked(item, currentReport);
      commit(next);
      if (slack.session)
        await slack.notify(
          next,
          "approved",
          next.decisionNote || "All applicable demo checks passed.",
        );
      else recordPreview(next, "approved");
      focusNextAction();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Approval could not be saved.",
      );
    }
  }
  async function generate() {
    if (!currentReport) return;
    const token = ++run.current;
    const sourceFingerprint = currentReport.fingerprint;
    setWorking(true);
    setError("");
    try {
      const reviewed = submitCheckFeedback(item, currentReport, feedback);
      commit(reviewed);
      const result = await generateSuggestedFix(
        reviewed,
        currentReport,
        feedback,
      );
      if (run.current !== token) return;
      if (checkSubmission(latest.current).fingerprint !== sourceFingerprint)
        throw new Error(
          "The source changed while the draft was preparing. Check the current version again.",
        );
      const draft = saveDraft(
        latest.current,
        result.content,
        version.scope,
        `Prepared ${result.kind} draft from the submitted spec feedback. Not approved.`,
      );
      const checked = checkSubmission(draft);
      const next = {
        ...draft,
        checkReport: checked,
        checkReports: [...(draft.checkReports || []), checked],
      };
      commit(next);
      setReport(checked);
      setFeedback(checked.canApprove ? feedback : draftFeedback(checked));
      setShowOriginal(false);
    } catch (error) {
      if (run.current === token)
        setError(
          error instanceof Error
            ? error.message
            : "The draft could not be prepared.",
        );
    } finally {
      if (run.current === token) {
        flushSync(() => setWorking(false));
        focusNextAction();
      }
    }
  }
  async function handoff() {
    if (!currentReport?.canApprove) return;
    try {
      setError("");
      const next = preapprove(
        recordCheckReport(item, currentReport),
        `Reviewed ${currentReport.checks.filter((c) => c.status === "pass").length} passed checks in the demo policy pack. ${feedback || "The small adjustment resolves the flagged claims and disclosure."}`,
      );
      commit(next);
      if (slack.session) await slack.send(next);
      else recordPreview(next, "proposal");
      focusNextAction();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The handoff could not be prepared.",
      );
    }
  }
  async function returnRevision() {
    if (!currentReport || !feedback.trim()) return;
    try {
      setError("");
      const reviewed = submitCheckFeedback(
        item,
        currentReport,
        feedback,
        false,
      );
      const next = returnForRevision(reviewed, feedback);
      commit(next);
      if (slack.session)
        await slack.notify(next, "revision_requested", feedback);
      else recordPreview(next, "revision_requested");
      focusNextAction();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The revision request could not be saved.",
      );
    }
  }
  async function retryDelivery() {
    if (withCreative) await slack.send(item);
    else
      await slack.notify(
        item,
        isRevision ? "revision_requested" : "approved",
        item.decisionNote || feedback || "Reviewed this exact version.",
      );
  }
  return (
    <>
      <div className="gr-case-heading">
        <div>
          <p className="gr-eyebrow">
            {item.id} <span>·</span> {version.scope.product}
          </p>
          <h2 ref={titleRef} tabIndex={-1}>
            {version.scope.product} · {version.scope.placement} for review
          </h2>
        </div>
        <div className="gr-owner">
          <span className="gr-avatar">
            {nextOwner
              .split(" ")
              .map((s) => s[0])
              .join("")}
          </span>
          <div>
            <strong>{nextOwner}</strong>
            <small>
              {done && !isRevision
                ? "Ready for recorded use"
                : `Next action owner · waiting ${when(waitingFrom)}`}
            </small>
          </div>
        </div>
      </div>
      <div className="gr-workspace">
        <section
          className="gr-creative gr-card"
          aria-label="Marketing creative"
        >
          <div className="gr-card-top">
            <span>
              <ImageIcon size={15} />{" "}
              {generated && !showOriginal
                ? "Suggested version · prepared example"
                : "Submitted creative"}
            </span>
            <span className="gr-version">
              v{showOriginal ? item.versions[0].id : version.id}
              {generated && !done && !withCreative && !showOriginal
                ? " · draft"
                : ""}
            </span>
          </div>
          <div className="gr-asset-stage">
            <Asset
              content={
                showOriginal ? item.versions[0].content : version.content
              }
            />
          </div>
          {generated && (
            <button
              className="gr-compare"
              onClick={() => setShowOriginal(!showOriginal)}
            >
              {showOriginal
                ? "Show suggested version"
                : "Compare with original"}{" "}
              <ArrowRight size={14} />
            </button>
          )}
          <div className="gr-scope">
            <span className="gr-eyebrow">REVIEWED FOR THIS USE</span>
            <dl>
              <div>
                <dt>Audience</dt>
                <dd>{version.scope.audience}</dd>
              </div>
              <div>
                <dt>Channel</dt>
                <dd>{version.scope.channel}</dd>
              </div>
              <div>
                <dt>Placement</dt>
                <dd>{version.scope.placement}</dd>
              </div>
              <div>
                <dt>Marketing owner</dt>
                <dd>{item.owner}</dd>
              </div>
            </dl>
          </div>
        </section>
        <section
          className="gr-review gr-card"
          aria-label="Spec review"
          ref={actionRef}
        >
          <div className="gr-card-top">
            <span>
              <FileCheck2 size={17} /> Submission checks
            </span>
            <span className="gr-pack">{POLICY_PACK}</span>
          </div>
          <div className="gr-panel-body">
            <div
              className={`gr-result ${changesRequested ? "attention" : done ? "success" : currentReport?.canApprove ? "success" : failed ? "attention" : ""}`}
            >
              <span className="gr-result-icon">
                {working ? (
                  <LoaderCircle className="gr-spin" />
                ) : done ? (
                  <CheckCircle2 />
                ) : failed || changesRequested ? (
                  <MessageSquare />
                ) : (
                  <ShieldCheck />
                )}
              </span>
              <div>
                <h3 ref={resultRef} tabIndex={-1}>
                  {working
                    ? "Preparing a suggested version"
                    : changesRequested
                      ? "Creative requested changes"
                      : isRevision
                        ? "Revision requested"
                        : item.status === "Approved"
                          ? `v${version.id} is approved`
                          : withCreative
                            ? "The fix is with creative"
                            : currentReport?.canApprove
                              ? generated
                                ? "The small fix clears the checks"
                                : "Ready on the first pass"
                              : currentReport
                                ? `${count} ${count === 1 ? "item needs" : "items need"} attention`
                                : "Ready to check"}
                </h3>
                <p>
                  {working
                    ? "Replaying a prepared AI example from the source and your submitted feedback."
                    : changesRequested
                      ? "The checks still describe this version. Review creative’s feedback before making another decision."
                      : isRevision
                        ? "The remaining evidence needs marketing. This draft is not approved."
                        : item.status === "Approved"
                          ? "The reviewer confirmed this version for its recorded use."
                          : withCreative
                            ? "Creative can accept this exact adjustment without another review round."
                            : currentReport?.canApprove
                              ? "Every applicable check passed. Confirm the decision with one click."
                              : currentReport
                                ? "Suggested comments explain what to change and what still needs evidence."
                                : "Check the creative against the specs that apply to its product, audience, and placement."}
                </p>
              </div>
            </div>
            <details className="gr-guidelines">
              <summary>
                <ShieldCheck size={15} /> Review guidelines
                <span>{Object.keys(REVIEW_GUIDELINES).length} specifications</span>
                <ChevronDown size={14} />
              </summary>
              <GuidelinesChecklist />
              <p>{GUIDELINE_MAINTENANCE}</p>
            </details>
            <div className="gr-checks" aria-label="Compliance specifications">
              {(currentReport || fresh).checks.map((check) => (
                <details
                  key={check.id}
                  className={`gr-check ${currentReport ? check.status : "unchecked"}`}
                >
                  <summary>
                    <span className="gr-check-icon">
                      {!currentReport ? (
                        <span />
                      ) : check.status === "pass" ? (
                        <Check size={14} />
                      ) : check.status === "not-applicable" ? (
                        "—"
                      ) : check.status === "fail" ? (
                        <X size={13} />
                      ) : (
                        "?"
                      )}
                    </span>
                    <strong>{check.label}</strong>
                    <span className="gr-check-state">
                      {!currentReport
                        ? "To check"
                        : check.status === "pass"
                          ? "Passed"
                          : check.status === "fail"
                            ? "Needs a fix"
                            : check.status === "needs-review"
                              ? "Needs evidence"
                              : "Not applicable"}
                    </span>
                    <ChevronDown size={13} />
                  </summary>
                  <div>
                    <p>
                      {currentReport
                        ? check.evidence
                        : "Run the checks to inspect this specification."}
                    </p>
                    {currentReport && check.fix && (
                      <p>
                        <strong>Next step:</strong> {check.fix}
                      </p>
                    )}
                    {check.source && (
                      <small>
                        {check.source.url ? (
                          <a
                            href={check.source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {check.source.label} <ExternalLink size={11} />
                          </a>
                        ) : (
                          check.source.label
                        )}
                      </small>
                    )}
                  </div>
                </details>
              ))}
            </div>
            {failed &&
              !done &&
              !withCreative &&
              !working &&
              !changesRequested && (
                <div className="gr-feedback">
                  <label htmlFor={`feedback-${item.id}`}>
                    <MessageSquare size={15} />{" "}
                    {generated
                      ? "Remaining instructions for marketing"
                      : "Suggested comments · review before sending"}
                  </label>
                  <textarea
                    id={`feedback-${item.id}`}
                    rows={5}
                    value={feedback}
                    onChange={(event) => setFeedback(event.target.value)}
                  />
                  <p>
                    {generated
                      ? "The image draft fixes presentation. Missing evidence still needs an owner."
                      : "Submitting these comments records the failed specs and supplies the generation prompt."}
                  </p>
                </div>
              )}
            {working && (
              <div className="gr-generation">
                <span className="gr-generation-dot" />
                <div>
                  <strong>
                    {item.fixture === "mortgage"
                      ? "Image revision"
                      : "Copy revision"}
                  </strong>
                  <p>Original submission + failed specs + your comments</p>
                </div>
              </div>
            )}
            {!done && !withCreative && !changesRequested && (
              <div className="gr-action">
                {!currentReport ? (
                  <button className="gr-primary" onClick={runChecks}>
                    <Sparkles size={17} /> Check submission{" "}
                    <ArrowRight size={16} />
                  </button>
                ) : working ? (
                  <button className="gr-primary" disabled>
                    <LoaderCircle className="gr-spin" size={17} /> Preparing
                    draft…
                  </button>
                ) : currentReport.canApprove ? (
                  <button
                    className="gr-primary"
                    disabled={busy}
                    onClick={() => {
                      void (generated ? handoff() : approve());
                    }}
                  >
                    {generated ? (
                      <Send size={17} />
                    ) : (
                      <CheckCircle2 size={17} />
                    )}{" "}
                    {generated
                      ? `Pre-approve & send to ${item.owner.split(" ")[0]}`
                      : `Approve v${version.id} & notify ${item.owner.split(" ")[0]}`}
                  </button>
                ) : !generated && currentReport.canSuggestFix ? (
                  <>
                    <button
                      className="gr-primary"
                      disabled={busy || !feedback.trim()}
                      onClick={() => {
                        void generate();
                      }}
                    >
                      <Sparkles size={17} /> Submit feedback & draft a fix
                    </button>
                    <details className="gr-alternative">
                      <summary>Need marketing to handle the revision?</summary>
                      <p>
                        Send the reviewed comments without generating a
                        suggested version.
                      </p>
                      <button
                        className="gr-secondary"
                        disabled={busy || !feedback.trim()}
                        onClick={() => {
                          void returnRevision();
                        }}
                      >
                        Return without a suggested fix{" "}
                        <ArrowUpRight size={14} />
                      </button>
                    </details>
                  </>
                ) : (
                  <button
                    className="gr-primary"
                    disabled={busy || !feedback.trim()}
                    onClick={() => {
                      void returnRevision();
                    }}
                  >
                    <Send size={17} /> Return to {item.owner.split(" ")[0]} for
                    revision
                  </button>
                )}
              </div>
            )}
            {(withCreative || done || changesRequested) && (
              <div className="gr-handoff" aria-label="Slack activity">
                <div className="gr-handoff-title">
                  <span className="gr-slack-symbol">#</span>
                  <strong>
                    {slack.session
                      ? "Live Slack activity"
                      : "Slack preview · no message sent"}
                  </strong>
                </div>
                <div className="gr-delivery">
                  <span className={sent ? "sent" : ""} />
                  <strong>
                    {busy
                      ? "Sending…"
                      : sent
                        ? slack.session
                          ? `Sent to ${channel}`
                          : "Message preview ready"
                        : "Not sent"}
                  </strong>
                </div>
                <div className="gr-message">
                  <small>
                    ClearPath Relay → {item.owner}
                    {slack.session ? " · Charlie is the demo recipient" : ""}
                  </small>
                  <p>
                    {changesRequested
                      ? `v${version.id} was pre-approved and sent for creative review.`
                      : withCreative
                        ? `v${version.id} is pre-approved. Does this exact adjustment work for the campaign?`
                        : isRevision
                          ? `Please revise v${version.id}. ${item.decisionNote || feedback}`
                          : `v${version.id} is approved for ${version.scope.channel}, ${version.scope.placement}. Ready to use.`}
                  </p>
                  <span className="gr-message-action">
                    {changesRequested
                      ? "Slack response: Request changes"
                      : withCreative
                        ? "Slack buttons: Accept adjustment / Request changes"
                        : isRevision
                          ? "Slack button: Acknowledge request"
                          : "Informational notification · no acceptance needed"}
                  </span>
                </div>
                {!slack.session && !sent && done && !isRevision && (
                  <button
                    className="gr-primary"
                    onClick={() => recordPreview(item, "approved")}
                  >
                    Preview approval notification <ArrowRight size={14} />
                  </button>
                )}
                {slack.session && !sent && !busy && !changesRequested && (
                  <button
                    className="gr-secondary"
                    onClick={() => {
                      void retryDelivery();
                    }}
                  >
                    Check delivery / retry safely <ArrowRight size={14} />
                  </button>
                )}
                {slack.session &&
                  (proposal?.slackMessageUrl ||
                    notification?.slackMessageUrl) && (
                    <a
                      className="gr-quiet"
                      href={
                        proposal?.slackMessageUrl ||
                        notification?.slackMessageUrl ||
                        "#"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open actual Slack message <ExternalLink size={13} />
                    </a>
                  )}
                {responseReceived && (
                  <p className="gr-response">
                    <CheckCircle2 size={15} />
                    {isRevision
                      ? "Marketing acknowledged the revision request."
                      : "Acceptance received. The exact version is approved."}
                    {slack.session && (
                      <small>
                        Slack member{" "}
                        {proposal?.decidedBy || notification?.acknowledgedBy}
                      </small>
                    )}
                  </p>
                )}
                {slack.session && (responseReceived || changesRequested) && <ReviewerSlackActivity notice={reviewerNotice} />}
                {changesRequested && (
                  <div className="gr-feedback">
                    <strong>
                      <MessageSquare size={15} /> Creative feedback received
                    </strong>
                    <p>
                      {creativeFeedback?.text ||
                        "Open the review workspace to inspect the requested changes."}
                    </p>
                    {creativeFeedback && (
                      <small>
                        {creativeFeedback.author} · v
                        {creativeFeedback.versionId}
                      </small>
                    )}
                    <button
                      className="gr-primary"
                      onClick={() => onOpenQueue(item.id)}
                    >
                      Review requested changes <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                {!slack.session && withCreative && (
                  <button
                    className="gr-primary"
                    onClick={() => {
                      recordPreview(
                        acceptProposal(item, `${item.owner} (Slack preview)`),
                        "proposal",
                        "accepted",
                      );
                    }}
                  >
                    Simulate {item.owner.split(" ")[0]} accepting in Slack{" "}
                    <Check size={16} />
                  </button>
                )}
                {!slack.session &&
                  isRevision &&
                  simulated !== "acknowledged" && (
                    <button
                      className="gr-primary"
                      onClick={() =>
                        recordPreview(
                          item,
                          "revision_requested",
                          "acknowledged",
                        )
                      }
                    >
                      Simulate marketing acknowledging <Check size={14} />
                    </button>
                  )}
                {slack.session && sent && withCreative && !responseReceived && (
                  <p className="gr-wait">
                    <Clock3 size={14} /> Waiting for creative in Slack. This
                    page updates automatically.
                  </p>
                )}
              </div>
            )}
            {(error || slack.error) && (
              <p className="gr-error" role="alert">
                {error || slack.error}
              </p>
            )}
            {complete && (
              <div className="gr-next">
                <button
                  className="gr-primary"
                  onClick={() => (onNext ? onNext() : onOpenQueue())}
                >
                  {onNext
                    ? "Continue to next example"
                    : "Explore all submissions"}
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
            {generated && (
              <details className="gr-audit">
                <summary>How the suggested version was made</summary>
                <p>
                  Prepared example, replayed asynchronously. The image was
                  edited with Imagegen from the original creative and specific
                  reviewer instructions; copy uses a prepared model-style
                  revision. New feedback is captured for review, not silently
                  treated as fulfilled by the prepared output.
                </p>
                <pre>
                  {item.generationRequests?.at(-1)?.prompt ||
                    "The source version and submitted comments are retained in the review history."}
                </pre>
              </details>
            )}
            {(currentReport || done) && (
              <details className="gr-audit">
                <summary>Decision trail · {item.events.length} events</summary>
                <ol reversed>
                  {item.events
                    .slice()
                    .reverse()
                    .map((event) => (
                      <li key={event.id}>
                        <strong>{event.actor}</strong>
                        <p>{event.text}</p>
                        <small>
                          {new Date(event.createdAt).toLocaleString()}
                        </small>
                      </li>
                    ))}
                </ol>
              </details>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

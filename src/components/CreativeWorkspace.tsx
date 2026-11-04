import { useState } from "react";
import { ArrowRight, Check, ExternalLink, Plus, Upload } from "lucide-react";
import {
  acceptProposal,
  currentVersion,
  requestChanges,
  type Submission,
} from "../domain";
import { matchesCurrentHandoff, type LiveSlackBridge } from "../slack";
import { Asset } from "./Asset";

type Props = {
  items: Submission[];
  owner: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRevise: (item: Submission) => void;
  onSwitchToReviewer: (id?: string) => void;
  update: (item: Submission) => void;
  slack: LiveSlackBridge;
};

function safeSlackUrl(value?: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      (url.hostname === "slack.com" || url.hostname.endsWith(".slack.com"))
    )
      return url.href;
  } catch {
    /* An absent link leaves the review in its current state. */
  }
}

export function CreativeWorkspace(props: Props) {
  const owned = props.items.filter((item) => item.owner === props.owner);
  return (
    <div className="queue-page cw-page">
      <div className="page-heading">
        <div>
          <h1 tabIndex={-1}>Your creative submissions</h1>
          <p className="page-subtitle">
            {props.owner} · Submit assets, respond to proposed fixes, and upload
            revisions.
          </p>
        </div>
        <button className="primary" onClick={props.onNew}>
          <Plus size={17} /> New submission
        </button>
      </div>
      {!owned.length ? (
        <div className="empty-state">
          <h2>No submissions yet</h2>
          <p>
            Submit an image or copy with its intended use. Compliance reviews
            next.
          </p>
        </div>
      ) : (
        <div className="cw-list">
          {owned.map((item) => (
            <CreativeSubmission
              key={`${item.id}:${currentVersion(item).id}`}
              {...props}
              item={item}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreativeSubmission({
  item,
  owner,
  onOpen,
  onRevise,
  onSwitchToReviewer,
  update,
  slack,
}: Props & { item: Submission }) {
  const [responding, setResponding] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const version = currentVersion(item);
  const revision =
    item.status === "Revision requested" || item.status === "Changes requested";
  const link = slack.links[item.id];
  const currentLink =
    link && !link.stale && matchesCurrentHandoff(item, link) ? link : undefined;
  const url =
    currentLink?.proposal?.delivery === "sent"
      ? safeSlackUrl(currentLink.proposal.slackMessageUrl)
      : undefined;
  const instructions =
    item.status === "Changes requested"
      ? item.comments
          .filter((comment) => comment.field === "Creative feedback")
          .at(-1)?.text
      : item.decisionNote;
  const nextAction =
    item.status === "With creative"
      ? `${owner} · accept the exact adjustment or request changes`
      : item.status === "Revision requested"
        ? `${owner} · revise and resubmit`
        : item.status === "Changes requested"
          ? `${item.reviewer} · respond to your feedback; you can also submit a revision`
          : item.status === "Approved"
            ? "Approved for the recorded use"
            : `${item.reviewer} · review this submission`;
  function respond(accept: boolean) {
    if (slack.session) return;
    try {
      update(
        accept
          ? acceptProposal(item, `${owner} (demo persona)`)
          : requestChanges(item, feedback, `${owner} (demo persona)`),
      );
      setResponding(false);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The response could not be saved.",
      );
    }
  }
  return (
    <article className="cw-item" aria-label={`${item.title} · ${item.id}`}>
      <div className="cw-preview">
        <Asset content={version.content} compact />
      </div>
      <div className="cw-details">
        <div className="cw-meta">
          <span>
            {item.id} · v{version.id}
          </span>
          <span
            className={`status ${item.status.toLowerCase().replaceAll(" ", "-")}`}
          >
            {item.status}
          </span>
        </div>
        <h2>{item.title}</h2>
        <p>
          {version.scope.product} · {version.scope.channel} ·{" "}
          {version.scope.placement}
        </p>
        <p className="cw-next">
          <strong>Next action:</strong> {nextAction}
        </p>
        {instructions && (
          <div className="cw-instructions">
            <strong>
              {item.status === "With creative"
                ? "Proposed adjustment"
                : revision
                  ? "Revision context"
                  : "Review decision"}
            </strong>
            <p>{instructions}</p>
          </div>
        )}
        {item.status === "With creative" &&
          (slack.session ? (
            <>
              <p>
                Live Slack owns this response, so the message and approval stay
                in sync.
              </p>
              {url ? (
                <a
                  className="primary"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Respond in Slack <ExternalLink size={15} />
                </a>
              ) : (
                <>
                  <p className="muted">
                    A delivered handoff is not available yet.
                  </p>
                  <button
                    className="primary"
                    onClick={() => onSwitchToReviewer(item.id)}
                  >
                    Open reviewer handoff <ArrowRight size={15} />
                  </button>
                </>
              )}
            </>
          ) : responding ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                respond(false);
              }}
            >
              <label className="field-label">
                What needs to change?
                <textarea
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  required
                  rows={3}
                />
              </label>
              <div className="cw-actions">
                <button className="primary" disabled={!feedback.trim()}>
                  Send feedback to {item.reviewer.split(" ")[0]}
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setResponding(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <p className="muted">
                This response is recorded in the demo. No Slack message is sent.
              </p>
              <div className="cw-actions">
                <button className="primary" onClick={() => respond(true)}>
                  <Check size={16} /> Accept v{version.id}
                </button>
                <button
                  className="text-button"
                  onClick={() => setResponding(true)}
                >
                  Request changes
                </button>
              </div>
            </>
          ))}
        {revision && (
          <button className="primary" onClick={() => onRevise(item)}>
            <Upload size={16} /> Upload revision
          </button>
        )}
        {item.status === "Needs review" && (
          <button
            className="primary"
            onClick={() => onSwitchToReviewer(item.id)}
          >
            Switch to reviewer <ArrowRight size={16} />
          </button>
        )}
        {item.status === "Approved" && (
          <p className="cw-approved">
            <Check size={16} /> v{item.approvedVersionId} is approved for this
            exact asset and intended use.
          </p>
        )}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <button className="text-button cw-open" onClick={() => onOpen(item.id)}>
          View submission and history <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}

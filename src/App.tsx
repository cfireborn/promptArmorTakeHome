import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Search,
  Plus,
  Inbox,
  Clock3,
  CheckCircle2,
  Sparkles,
  MessageSquare,
  History,
  Pencil,
  Send,
  FileCheck2,
  RotateCcw,
  LayoutGrid,
  X,
  SlidersHorizontal,
  ShieldCheck,
  ExternalLink,
  CircleHelp,
  Link,
  CheckCheck,
  Menu,
} from "lucide-react";
import {
  type Submission,
  type AssetContent,
  type Scope,
  currentVersion,
  saveDraft,
  addComment,
  preapprove,
  acceptProposal,
  requestChanges,
  counterEdit,
  approveOriginal,
  assignReviewer,
  exportCsv,
  returnForRevision,
} from "./domain";
import { seedSubmissions, fixes } from "./seed";
import { Asset } from "./components/Asset";
import { Modal } from "./components/Modal";
import { useLiveSlack, type LiveSlackBridge } from "./slack";
import { LiveSlack } from "./components/LiveSlack";
import { GuidedReview } from "./components/GuidedReview";
import { ReviewGuidelines } from "./components/ReviewGuidelines";
import { isUploadedImage, readUploadedImage } from "./uploads";
import { checkSubmission, recordCheckReport, draftFeedback, approveChecked, submitCheckFeedback } from "./checker";
import { registeredDemoAsset, preparedUploadFix } from "./demoAssets";
import { LiveReviewWorkspace } from "./components/LiveReviewWorkspace";
import { PersonaSwitcher } from "./components/PersonaSwitcher";
import { CreativeWorkspace } from "./components/CreativeWorkspace";
import { NewSubmission } from "./components/NewSubmission";
import { DeveloperUsage } from "./components/DeveloperUsage";
import { formatCreativeCopy, parseCreativeCopy } from "./intake";
const STORAGE = "clearpath-relay-v1";
const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .join("");
const ago = (date: string) => {
  const h = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 3600000));
  return h < 1
    ? "Just now"
    : h < 24
      ? `${h}h ago`
      : `${Math.floor(h / 24)}d ${h % 24}h ago`;
};
const formatDate = (date: string) =>
  new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const statusClass = (s: string) => s.toLowerCase().replaceAll(" ", "-");
const needsReview = (s: Submission) =>
  s.status === "Needs review" || s.status === "Changes requested";
const nextAction = (s: Submission) =>
  s.status === "Approved"
    ? "Ready for the recorded placement"
    : s.status === "Revision requested"
      ? `${s.owner.split(" ")[0]} to revise the asset`
      : s.status === "With creative"
        ? `${s.owner.split(" ")[0]} to accept the proposed fix`
        : s.status === "Changes requested"
          ? "Respond to creative’s feedback"
          : "Review and make a decision";
const editableFields = ["headline", "body", "cta", "disclosure"] as const;
function initialState(): { items: Submission[]; warning: string } {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (!saved) return { items: seedSubmissions(), warning: "" };
    const parsed = JSON.parse(saved);
    if (
      !Array.isArray(parsed) ||
      !parsed.length ||
      !parsed.every(
        (s) =>
          s &&
          ["id", "title", "owner", "reviewer", "due", "submittedAt"].every(
            (key) => typeof s[key] === "string",
          ) &&
          [
            "Needs review",
            "With creative",
            "Changes requested",
            "Revision requested",
            "Approved",
          ].includes(s.status) &&
          Array.isArray(s.versions) &&
          s.versions.length > 0 &&
          Array.isArray(s.events) &&
          s.events.every(
            (e: any) =>
              e &&
              ["id", "actor", "text", "createdAt"].every(
                (k) => typeof e[k] === "string",
              ),
          ) &&
          Array.isArray(s.comments) &&
          s.comments.every(
            (c: any) =>
              c &&
              ["id", "author", "text", "field", "createdAt"].every(
                (k) => typeof c[k] === "string",
              ),
          ) &&
          s.versions.every(
            (v: any) =>
              v &&
              Number.isInteger(v.id) &&
              v.content &&
              v.scope &&
              ["sunrise", "home", "card"].includes(v.content.art) &&
              editableFields.every((k) => typeof v.content[k] === "string") &&
              ["product", "audience", "channel", "placement"].every(
                (k) => typeof v.scope[k] === "string",
              ),
          ),
      )
    )
      throw Error();
    return { items: parsed, warning: "" };
  } catch {
    return {
      items: seedSubmissions(),
      warning:
        "Saved demo data could not be read. A fresh sample queue is shown.",
    };
  }
}
export default function App() {
  const [initial] = useState(initialState);
  const [items, setItems] = useState(initial.items);
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const prepared = new URLSearchParams(window.location.search).has("prepared");
  const [persona, setPersona] = useState("Alex Morgan");
  const [revision, setRevision] = useState<Submission | undefined>();
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState(
    new URLSearchParams(window.location.search).has("guidelines")
      ? "Review guidelines"
      : "Review queue",
  );
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("All products");
  const [sort, setSort] = useState("Launch date");
  const [modal, setModal] = useState<
    "new" | "reset" | "help" | "navigation" | null
  >(null);
  const [toast, setToast] = useState("");
  const [guide, setGuide] = useState(true);
  const [guided, setGuided] = useState(
    !["workspace", "guidelines"].some((key) =>
      new URLSearchParams(window.location.search).has(key),
    ),
  );
  const selectedItem = items.find((i) => i.id === selected);
  const workspaceRef = useRef<HTMLElement>(null);
  const dirtyReviewRef = useRef(false);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    workspaceRef.current
      ?.querySelector<HTMLHeadingElement>("h1")
      ?.focus({ preventScroll: true });
  }, [guided, selected, view]);
  const leaveReview = (nextView: string) => {
    if (
      dirtyReviewRef.current &&
      !window.confirm("Discard your unsaved edits and leave this review?")
    )
      return;
    dirtyReviewRef.current = false;
    setSelected(null);
    setView(nextView);
  };
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  const persist = (next: Submission[]) => {
    itemsRef.current = next;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setStorageWarning("");
    } catch {
      setStorageWarning(
        "Browser storage is unavailable. Changes work in this tab but may not survive a refresh.",
      );
    }
    setItems(next);
  };
  const update = (s: Submission, message?: string) => {
    persist(itemsRef.current.map((i) => (i.id === s.id ? s : i)));
    if (message) setToast(message);
  };
  const slack = useLiveSlack(items, (s) =>
    update(
      s,
      s.status === "Approved"
        ? "Accepted in Slack. The exact version is ready to launch."
        : "Creative feedback arrived from Slack.",
    ),
  );
  const count = (label: string) =>
    items.filter((s) =>
      label === "Review queue"
        ? needsReview(s)
        : label === "With creative"
          ? ["With creative", "Revision requested"].includes(s.status)
          : label === "Approved"
            ? s.status === "Approved"
            : true,
    ).length;
  const filtered = items
    .filter(
      (s) =>
        (view === "Review queue"
          ? needsReview(s)
          : view === "With creative"
            ? ["With creative", "Revision requested"].includes(s.status)
            : view === "Approved"
              ? s.status === "Approved"
              : true) &&
        (product === "All products" ||
          currentVersion(s).scope.product === product) &&
        `${s.title} ${s.id} ${s.owner} ${currentVersion(s).scope.channel}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "Oldest first"
        ? Date.parse(a.submittedAt) - Date.parse(b.submittedAt)
        : Date.parse(a.due) - Date.parse(b.due),
    );
  function download() {
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + exportCsv(filtered)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "clearpath-review-queue.csv";
    a.click();
    URL.revokeObjectURL(url);
    setToast(`Exported ${filtered.length} submissions from this view.`);
  }
  function changePersona(name: string) {
    if (dirtyReviewRef.current && !window.confirm("Discard unsaved edits and switch demo personas?")) return;
    dirtyReviewRef.current = false;
    setPersona(name);
    setSelected(null);
    setView("All submissions");
    if (name !== "Alex Morgan") setGuided(false);
  }
  function openCreative(owner: string) { changePersona(owner); setGuided(false); }
  function openNew(item?: Submission) { setRevision(item); setModal("new"); }
  const switcher = <PersonaSwitcher value={persona} onChange={changePersona} />;
  if (guided && persona === "Alex Morgan")
    return (
      <GuidedReview
        items={items}
        update={update}
        slack={slack}
        warning={storageWarning}
        onNewSubmission={() => {
          setSelected(null);
          setView("All submissions");
          setGuided(false);
          openNew();
        }}
        onOpenQueue={(submissionId) => {
          setSelected(submissionId ?? null);
          setView("All submissions");
          setGuided(false);
        }}
        onOpenGuidelines={() => {
          setSelected(null);
          setView("Review guidelines");
          setGuided(false);
        }}
        onRestart={async () => {
          const samples = seedSubmissions().filter((item) =>
            ["CP-1040", "CP-1042", "CP-1041"].includes(item.id),
          );
          persist([
            ...itemsRef.current.filter(
              (item) => !samples.some((sample) => sample.id === item.id),
            ),
            ...samples,
          ]);
        }}
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => {
            if (
              !dirtyReviewRef.current ||
              window.confirm(
                "Discard your unsaved edits and open the walkthrough?",
              )
            ) {
              dirtyReviewRef.current = false;
              setGuided(true);
            }
          }}
        >
          <span className="brand-icon">
            <ArrowUpRight size={23} />
          </span>
          <span>
            relay<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="workspace-label">
          <span className="company-logo">C</span>
          <div>
            ClearPath Financial<small>Marketing compliance</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {[
            ["Review queue", Inbox],
            ["With creative", Send],
            ["Approved", CheckCircle2],
            ["All submissions", LayoutGrid],
            ["Review guidelines", ShieldCheck],
          ].map(([label, Icon]) => {
            const name = label as string;
            const NavIcon = Icon as typeof Inbox;
            return (
              <button
                key={name}
                className={`nav-item ${view === name && !selected ? "active" : ""}`}
                aria-current={view === name && !selected ? "page" : undefined}
                onClick={() => leaveReview(name)}
              >
                <NavIcon size={18} />
                <span>{name}</span>
                {name !== "Review guidelines" && <b>{count(name)}</b>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setModal("help")}>
            <CircleHelp size={17} /> How this demo works
          </button>
          <button onClick={() => setModal("reset")}>
            <RotateCcw size={16} /> Reset sample data
          </button>
          <div className="profile">
            <span className="avatar">{initials(persona)}</span>
            <div>
              {persona}<small>{persona === "Alex Morgan" ? "Compliance reviewer" : "Creative owner"}</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <main ref={workspaceRef}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu-button"
              aria-label="Open navigation"
              onClick={() => setModal("navigation")}
            >
              <Menu size={19} />
            </button>
            Workspace <span>/</span>{" "}
            <b>{selectedItem ? "Review workspace" : view}</b>
          </div>
          <div className="topbar-right">
{switcher}
          </div>
        </header>
        {storageWarning && (
          <div className="storage-warning" role="alert">
            {storageWarning}
          </div>
        )}
        {selectedItem && !prepared ? (
          <LiveReviewWorkspace
            key={selectedItem.id}
            item={selectedItem}
            update={update}
            slack={slack}
            back={() => leaveReview(view)}
            readOnly={persona !== "Alex Morgan"}
            onCreative={() => openCreative(selectedItem.owner)}
            onDirtyChange={(value) => { dirtyReviewRef.current = value; }}
          />
        ) : selectedItem ? (
          <Review
            key={selectedItem.id}
            item={selectedItem}
            update={update}
            back={() => leaveReview(view)}
            notify={setToast}
            slack={slack}
            onDirtyChange={(value) => {
              dirtyReviewRef.current = value;
            }}
          />
        ) : view === "Review guidelines" ? (
          <ReviewGuidelines />
        ) : persona !== "Alex Morgan" ? (
          <CreativeWorkspace items={items} owner={persona} slack={slack} update={update}
            onOpen={setSelected} onNew={() => openNew()} onRevise={openNew}
            onSwitchToReviewer={(id) => { setPersona("Alex Morgan"); setSelected(id ?? null); setView("All submissions"); }} />
        ) : (
          <div className="queue-page">
            <div className="page-heading">
              <div>
                <h1 tabIndex={-1}>{view}</h1>
                <p className="page-subtitle">
                  {view === "Review queue"
                    ? "Review submitted creative and record a decision."
                    : view === "With creative"
                      ? "Waiting for the marketing owner’s response."
                      : view === "Approved"
                        ? "Approved versions and their recorded use."
                        : "Status, ownership, and recorded decisions."}
                </p>
              </div>
              <button className="primary" onClick={() => openNew()}>
                <Plus size={18} /> New submission
              </button>
            </div>
            <div className="overview">
              <button
                onClick={() => setView("Review queue")}
                className={view === "Review queue" ? "selected" : ""}
              >
                <span className="overview-icon amber">
                  <Inbox size={20} />
                </span>
                <div>
                  <strong>{count("Review queue")}</strong>
                  <span>Need your review</span>
                </div>
                <ArrowUpRight size={17} />
              </button>
              <button
                onClick={() => setView("With creative")}
                className={view === "With creative" ? "selected" : ""}
              >
                <span className="overview-icon purple">
                  <Send size={20} />
                </span>
                <div>
                  <strong>{count("With creative")}</strong>
                  <span>With creative</span>
                </div>
                <ArrowUpRight size={17} />
              </button>
              <button
                onClick={() => setView("Approved")}
                className={view === "Approved" ? "selected" : ""}
              >
                <span className="overview-icon green">
                  <CheckCheck size={20} />
                </span>
                <div>
                  <strong>{count("Approved")}</strong>
                  <span>Ready to go</span>
                </div>
                <ArrowUpRight size={17} />
              </button>
            </div>
            {guide && view === "Review queue" && (
              <div className="guide-banner">
                <div className="guide-symbol">
                  <Sparkles size={24} />
                </div>
                <div>
                  <strong>Review walkthrough</strong>
                  <p>
                    Follow three examples: approve clean work, hand off a small
                    fix, and return work that needs revision.
                  </p>
                </div>
                <button
                  onClick={() => setGuided(true)}
                  className="text-button"
                >
                  Open walkthrough <ArrowRight size={17} />
                </button>
                <button
                  className="icon-button"
                  onClick={() => setGuide(false)}
                  aria-label="Dismiss introduction"
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <section className="queue-section">
              <div className="section-heading">
                <h2>
                  {view}
                  <span className="count-label">{filtered.length}</span>
                </h2>
                <button className="secondary small" onClick={download}>
                  <Download size={15} /> Export CSV
                </button>
              </div>
              <div className="filters">
                <label className="search">
                  <Search size={17} />
                  <input
                    placeholder="Search submissions, people…"
                    aria-label="Search submissions"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setSearch("")}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <label className="select-control">
                  <SlidersHorizontal size={15} />
                  <select
                    aria-label="Filter by product"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                  >
                    <option>All products</option>
                    <option>Personal loans</option>
                    <option>Credit cards</option>
                    <option>Mortgage prequalification</option>
                  </select>
                </label>
                <label className="select-control sort-control">
                  Sort:
                  <select
                    aria-label="Sort submissions"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option>Launch date</option>
                    <option>Oldest first</option>
                  </select>
                </label>
              </div>
              <div className="queue-table">
                <div className="table-head">
                  <span>SUBMISSION</span>
                  <span>STATUS / NEXT ACTION OWNER</span>
                  <span>OWNER</span>
                  <span>LAUNCH</span>
                  <span />
                </div>
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    className="submission-row"
                    onClick={() => setSelected(s.id)}
                  >
                    <span className="submission-title">
                      <span
                        className={`thumbnail ${currentVersion(s).content.art}`}
                      >
                        <span>
                          {currentVersion(s).content.art === "home"
                            ? "⌂"
                            : currentVersion(s).content.art === "card"
                              ? "▰"
                              : "◒"}
                        </span>
                      </span>
                      <span>
                        <strong>{s.title}</strong>
                        <small>
                          {s.id}
                          <i /> {currentVersion(s).scope.channel}
                          <i />v{currentVersion(s).id}
                        </small>
                      </span>
                    </span>
                    <span>
                      <span className={`status ${statusClass(s.status)}`}>
                        <span />
                        {s.status}
                      </span>
                      <small className="next-action">{nextAction(s)}</small>
                    </span>
                    <span className="row-owner">
                      <span
                        className={`avatar ${["With creative", "Revision requested", "Approved"].includes(s.status) ? "lavender" : "sage"}`}
                      >
                        {initials(
                          [
                            "With creative",
                            "Revision requested",
                            "Approved",
                          ].includes(s.status)
                            ? s.owner
                            : s.reviewer,
                        )}
                      </span>
                      <span>
                        {
                          ([
                            "With creative",
                            "Revision requested",
                            "Approved",
                          ].includes(s.status)
                            ? s.owner
                            : s.reviewer
                          ).split(" ")[0]
                        }
                        <small>
                          {[
                            "With creative",
                            "Revision requested",
                            "Approved",
                          ].includes(s.status)
                            ? "Creative"
                            : "Compliance"}
                        </small>
                      </span>
                    </span>
                    <span className="launch-date">
                      <strong>
                        {new Date(s.due).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </strong>
                      <small className={s.priority === "High" ? "urgent" : ""}>
                        {s.priority === "High"
                          ? "Priority launch"
                          : `Submitted ${ago(s.submittedAt)}`}
                      </small>
                    </span>
                    <ArrowUpRight className="row-arrow" size={18} />
                  </button>
                ))}
              </div>
              {!filtered.length && (
                <div className="empty-state">
                  <Inbox size={32} />
                  <h3>
                    {search || product !== "All products"
                      ? "No submissions match."
                      : "All clear here."}
                  </h3>
                  <p>
                    {search || product !== "All products"
                      ? "Try another search or clear your filters."
                      : "There’s nothing waiting in this view."}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSearch("");
                      setProduct("All products");
                      setView("All submissions");
                    }}
                  >
                    Show all submissions
                  </button>
                </div>
              )}
            </section>
            <div className="queue-footer">
              <ShieldCheck size={15} />
              <span>
                Every decision stays with its asset version and intended use.
              </span>
              <span className="footer-demo">
                Fictional sample data · Saved in this browser
              </span>
            </div>
          </div>
        )}
        {!prepared && <DeveloperUsage />}
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {modal === "reset" && (
        <Modal title="Reset the demo?" onClose={() => setModal(null)}>
          <p>
            This replaces your browser’s submissions, comments, and decisions
            with the original samples.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setModal(null)}>
              Keep my work
            </button>
            <button
              className="primary"
              onClick={() => {
                slack.disconnect();
                persist(seedSubmissions());
                setSelected(null);
                setView("Review queue");
                setModal(null);
                setToast("Sample queue restored.");
              }}
            >
              Reset sample data
            </button>
          </div>
        </Modal>
      )}
      {modal === "navigation" && (
        <Modal title="Your workspace" onClose={() => setModal(null)}>
          <nav className="mobile-navigation">
            {[
              "Review queue",
              "With creative",
              "Approved",
              "All submissions",
              "Review guidelines",
            ].map((name) => (
              <button
                className="nav-item"
                key={name}
                aria-current={view === name && !selected ? "page" : undefined}
                onClick={() => {
                  leaveReview(name);
                  setModal(null);
                }}
              >
                {name}
                {name !== "Review guidelines" && <b>{count(name)}</b>}
              </button>
            ))}
            <button className="secondary" onClick={() => setModal("help")}>
              How this demo works <CircleHelp size={16} />
            </button>
            <button className="secondary" onClick={() => setModal("reset")}>
              Reset sample data <RotateCcw size={16} />
            </button>
          </nav>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="Three review outcomes"
          onClose={() => setModal(null)}
        >
          <div className="help-steps">
            <p>
              <b>1. Approve clean work.</b> Check the submission against the review
              guidelines, then approve its exact version and intended use.
            </p>
            <p>
              <b>2. Hand off a small fix.</b> Review a suggested correction or edit
              the copy, then pre-approve the adjustment for creative to accept.
              {slack.session
                ? " Send it to the marketing owner in Slack; their response returns to Relay."
                : " Use the labeled Slack preview to try creative’s response, or connect live Slack in the walkthrough."}
            </p>
            <p>
              <b>3. Return work with comments.</b> Send unresolved findings to the
              marketing owner. Acknowledging the request leaves the asset
              unapproved; a revised version needs review.
            </p>
          </div>
          <div className="notice">
            Review records and assets are saved in this browser.
          </div>
        </Modal>
      )}
      {modal === "new" && (
        <NewSubmission
          key={revision ? `${revision.id}:${currentVersion(revision).id}` : "new"}
          owner={persona === "Alex Morgan" ? undefined : persona}
          initialSubmission={revision}
          close={() => setModal(null)}
          create={(s) => {
            persist(revision ? itemsRef.current.map(item => item.id === s.id ? s : item) : [s, ...itemsRef.current]);
            setModal(null);
            setSelected(persona === "Alex Morgan" ? s.id : null);
            setRevision(undefined);
            setToast(`${revision ? "Revision submitted" : "Submission created"}. Alex Morgan reviews next. Use Viewing as to switch roles.`);
          }}
        />
      )}
    </div>
  );
}
function Review({
  item,
  update,
  back,
  notify,
  onDirtyChange,
  slack,
}: {
  item: Submission;
  update: (s: Submission, message?: string) => void;
  back: () => void;
  notify: (s: string) => void;
  onDirtyChange: (value: boolean) => void;
  slack: LiveSlackBridge;
}) {
  const version = currentVersion(item);
  const original = item.versions[0];
  const [content, setContent] = useState<AssetContent>({ ...version.content });
  const [scope, setScope] = useState<Scope>({ ...version.scope });
  const [tab, setTab] = useState("Asset & edits");
  const compareTabRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState("Suggested fix");
  const [copyDraft, setCopyDraft] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [modal, setModal] = useState<
    "decision" | "slack" | "scope" | "revision" | null
  >(null);
  const [decision, setDecision] = useState<"proposal" | "direct">("proposal");
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [commentField, setCommentField] = useState("headline");
  const [suggestion, setSuggestion] = useState(false);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [responding, setResponding] = useState(false);
  const [counter, setCounter] = useState(false);
  const [counterHeadline, setCounterHeadline] = useState(
    version.content.headline,
  );
  const [error, setError] = useState("");
  const editRef = useRef<HTMLTextAreaElement>(null);
  const dirty =
    JSON.stringify(content) !== JSON.stringify(version.content) ||
    JSON.stringify(scope) !== JSON.stringify(version.scope);
  useEffect(() => {
    onDirtyChange(dirty);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    if (dirty) window.addEventListener("beforeunload", warn);
    return () => {
      onDirtyChange(false);
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty, onDirtyChange]);
  const modified = version.id > 1 || dirty;
  const decisionAuthor =
    [...item.events].reverse().find((e) => e.text.startsWith("Pre-approved"))
      ?.actor || item.reviewer;
  const uploaded = isUploadedImage(version.content.image) || !!item.registeredUpload;
  const registered = registeredDemoAsset(item);
  const uploadFix = preparedUploadFix(item);
  const fixture = item.fixture && !uploaded ? fixes[item.fixture] : null;
  const latestItem = useRef(item);
  latestItem.current = item;
  const prepareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (prepareTimer.current) clearTimeout(prepareTimer.current);
  }, [item.id, version.id]);
  const report =
    !dirty &&
    item.checkReport &&
    item.checkReport.fingerprint === checkSubmission(item).fingerprint
      ? item.checkReport
      : null;
  useEffect(() => {
    setContent({ ...version.content });
    setCopyDraft(null);
    setScope({ ...version.scope });
    setSuggestion(false);
    setLoading(false);
    setCounterHeadline(version.content.headline);
  }, [version.id]);
  const act = (fn: () => Submission, message: string) => {
    try {
      update(fn(), message);
      setError("");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const startEdit = (f: string) => {
    setPanel("Edit copy");
    void f;
    setTimeout(() => editRef.current?.focus(), 0);
  };
  function save() {
    return act(
      () =>
        saveDraft(
          item,
          content,
          scope,
          "Updated copy or intended use in the review workspace.",
        ),
      "New version saved. Ready for your decision.",
    );
  }
  function openDecision(mode: "proposal" | "direct") {
    setDecision(mode);
    setReason(mode === "proposal" ? item.decisionNote || item.generationRequests?.at(-1)?.feedback || "" : "");
    setChecked(false);
    setModal("decision");
    setError("");
  }
  async function confirmDecision() {
    if (isUploadedImage(content.image) && !readUploadedImage(content.image)) {
      setError(
        "The uploaded image is unavailable. Restore the image in a new submission before making a decision.",
      );
      return;
    }
    const next = dirty
      ? saveDraft(item, content, scope, "Prepared the adjustment for creative.")
      : item;
    try {
      const decided = decision === "proposal"
        ? preapprove(next, reason)
        : approveOriginal(next, reason);
      flushSync(() => update(decided, decision === "proposal"
        ? "Fix pre-approved. Next action owner: creative."
        : "Exact version approved for its recorded use."));
      setError("");
      setModal(decision === "proposal" ? "slack" : null);
      if (decision === "direct" && slack.session)
        await slack.notify(decided, "approved", reason);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function approveCheckedUpload() {
    if (!report) return;
    try {
      if (isUploadedImage(version.content.image) && !readUploadedImage(version.content.image))
        throw new Error("The uploaded image is unavailable. Restore it before approving.");
      const approved = approveChecked(item, report);
      flushSync(() => update(approved, "Exact version approved. Next action owner: marketing."));
      if (slack.session) await slack.notify(approved, "approved", approved.decisionNote!);
      setError("");
    } catch (error) { setError((error as Error).message); }
  }
  function prepareCheckedUploadFix() {
    if (!report || !uploadFix || !feedback.trim() || dirty || loading) return;
    setLoading(true);
    prepareTimer.current = setTimeout(() => {
      try {
        const source = latestItem.current;
        const replacement = preparedUploadFix(source);
        if (!replacement) throw new Error("This asset no longer matches the prepared example. Run checks again.");
        const reviewed = submitCheckFeedback(source, report, feedback);
        const revised = saveDraft(reviewed, replacement, currentVersion(source).scope,
          "Prepared an image correction from the registered example. Original upload and reviewed feedback preserved.");
        const checked = checkSubmission(revised);
        flushSync(() => {
          update(recordCheckReport(revised, checked), "Prepared v2. Compare the images and review the remaining findings.");
          setFeedback(draftFeedback(checked));
          setTab("Compare versions");
          setLoading(false);
        });
        compareTabRef.current?.focus({ preventScroll: true });
        compareTabRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
      } catch (error) {
        setError((error as Error).message);
        setLoading(false);
      }
    }, 650);
  }
  function loadSuggestion() {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      setSuggestion(true);
    }, 650);
  }
  function renderScope() {
    return (
      <dl className="scope-grid">
        {Object.entries(version.scope).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="review-page">
      <div className="review-heading">
        <button className="back-button" onClick={back}>
          <ArrowLeft size={17} /> Queue
        </button>
        <div className="review-title">
          <div>
            <span className="eyebrow">
              {item.id} <span> / </span> {version.scope.product}
            </span>
            <h1 tabIndex={-1}>
              {version.scope.product} · {version.scope.placement} for review
            </h1>
          </div>
          <span className={`status ${statusClass(item.status)}`}>
            <span />
            {item.status}
          </span>
        </div>
        <div className="review-meta">
          <span className="avatar small lavender">{initials(item.owner)}</span>
          <span>
            Submitted by <b>{item.owner}</b>
          </span>
          <span className="meta-dot">·</span>
          <span>{ago(item.submittedAt)}</span>
          <span className="meta-dot">·</span>
          <span>
            Launch{" "}
            {new Date(item.due).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
          <label className="reviewer-select">
            Reviewer{" "}
            <select
              value={item.reviewer}
              aria-label="Assigned reviewer"
              onChange={(e) =>
                act(
                  () => assignReviewer(item, e.target.value),
                  "Reviewer updated.",
                )
              }
            >
              <option>Alex Morgan</option>
              <option>Sam Rivera</option>
              <option>Taylor Brooks</option>
            </select>
          </label>
        </div>
      </div>
      <div className="review-progress">
        <span className="complete">
          <Check size={14} /> Submitted
        </span>
        <i />
        <span className={needsReview(item) ? "current" : "complete"}>
          {needsReview(item) ? (
            <span className="step-number">2</span>
          ) : (
            <Check size={14} />
          )}{" "}
          Compliance fix
        </span>
        <i />
        <span
          className={
            item.status === "With creative"
              ? "current"
              : item.status === "Approved"
                ? "complete"
                : ""
          }
        >
          {item.status === "Approved" ? (
            <Check size={14} />
          ) : (
            <span className="step-number">3</span>
          )}{" "}
          Creative acceptance
        </span>
        <i />
        <span className={item.status === "Approved" ? "complete" : ""}>
          <FlagIcon /> Ready to use
        </span>
      </div>
      {item.status === "Approved" && (
        <div className="approval-banner">
          <ShieldCheck size={23} />
          <div>
            <strong>
              {dirty
                ? `Saved v${item.approvedVersionId} is approved. This draft still needs review.`
                : `v${item.approvedVersionId} is approved for launch.`}
            </strong>
            <p>
              Approval covers this exact creative and the recorded intended use.
              An edit starts a new review.
            </p>
          </div>
          <button className="text-button" onClick={() => setTab("History")}>
            View decision <ArrowRight size={16} />
          </button>
        </div>
      )}
      {item.status === "With creative" && (
        <div className="waiting-banner">
          <Send size={22} />
          <div>
            <strong>Next action owner: {item.owner.split(" ")[0]}.</strong>
            <p>
              v{item.proposalVersionId} is pre-approved. Creative can accept it
              without another review round.
            </p>
          </div>
          <button
            className="secondary small"
            onClick={() => {
              if (dirty) {
                setError(
                  "Save or discard your unsaved changes before opening the creative handoff.",
                );
                return;
              }
              setModal("slack");
            }}
          >
            {slack.session ? "Open live Slack handoff" : "Open Slack preview"} <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      {version.author === item.owner &&
        version.id > 1 &&
        item.status === "Needs review" && (
          <div className="feedback-banner">
            <MessageSquare size={20} />
            <div>
              <strong>
                {item.owner.split(" ")[0]} proposed a new revision.
              </strong>
              <p>{version.note}</p>
            </div>
          </div>
        )}
      {item.status === "Changes requested" && (
        <div className="feedback-banner">
          <MessageSquare size={20} />
          <div>
            <strong>Creative asked for an adjustment.</strong>
            <p>
              {
                item.comments
                  .filter((c) => c.field === "Creative feedback")
                  .at(-1)?.text
              }
            </p>
          </div>
        </div>
      )}
      {item.status === "Revision requested" && (
        <div className="feedback-banner">
          <MessageSquare size={20} />
          <div>
            <strong>Next action owner: {item.owner}.</strong>
            <p>{item.decisionNote}</p>
            <p className="muted">
              {slack.session
                ? "The owner notification and receipt appear below."
                : "Revision saved in this browser. No Slack message was sent."}
            </p>
          </div>
        </div>
      )}
      <div className="review-layout">
        <section className="asset-workspace">
          <div className="review-tabs" role="tablist" aria-label="Review views">
            {["Asset & edits", "Compare versions", "History"].map((t) => (
              <button
                role="tab"
                ref={t === "Compare versions" ? compareTabRef : undefined}
                aria-selected={tab === t}
                className={tab === t ? "active" : ""}
                key={t}
                onClick={() => setTab(t)}
              >
                {t === "History" ? (
                  <History size={16} />
                ) : t === "Compare versions" ? (
                  <LayoutGrid size={16} />
                ) : (
                  <FileCheck2 size={16} />
                )}{" "}
                {t}
              </button>
            ))}
            <span className="version-label">
              v{version.id}
              {dirty ? " · Unsaved edit" : ""}
            </span>
          </div>
          {tab === "Asset & edits" ? (
            <>
              <div className="canvas-toolbar">
                <span>
                  {version.scope.channel} <span> / </span>{" "}
                  {version.scope.placement}
                </span>
                <span className="canvas-hint">
                  <Pencil size={12} />{" "}
                  {uploaded
                    ? "Compare image and transcribed copy"
                    : "Click copy to edit"}
                </span>
              </div>
              <div className="asset-canvas">
                <Asset content={content} onEdit={startEdit} />
              </div>
              <div className="intended-use">
                <div className="section-heading">
                  <h3>
                    <ShieldCheck size={16} /> Intended use
                  </h3>
                  <button
                    className="text-button"
                    disabled={loading}
                    onClick={() => setModal("scope")}
                  >
                    Edit scope <Pencil size={13} />
                  </button>
                </div>
                {renderScope()}
                {dirty &&
                  JSON.stringify(scope) !== JSON.stringify(version.scope) && (
                    <div className="notice">
                      Scope changes are included in your unsaved revision.
                    </div>
                  )}
              </div>
            </>
          ) : tab === "Compare versions" ? (
            <div className="compare-view">
              <div className="compare-assets">
                <div>
                  <div className="compare-label">
                    ORIGINAL <span>v{original.id}</span>
                  </div>
                  <Asset content={original.content} compact />
                </div>
                <div>
                  <div className="compare-label">
                    {dirty ? "YOUR DRAFT" : "CURRENT VERSION"}{" "}
                    <span>v{dirty ? version.id + 1 : version.id}</span>
                  </div>
                  <Asset content={content} compact />
                </div>
              </div>
              <div className="change-list">
                <h3>What changed</h3>
                {editableFields
                  .filter((k) => original.content[k] !== content[k])
                  .map((k) => (
                    <div className="change" key={k}>
                      <h4>{k}</h4>
                      <del>{original.content[k]}</del>
                      <ins>{content[k]}</ins>
                    </div>
                  ))}
                {Object.keys(scope)
                  .filter(
                    (k) =>
                      original.scope[k as keyof Scope] !==
                      scope[k as keyof Scope],
                  )
                  .map((k) => (
                    <div className="change" key={k}>
                      <h4>{k}</h4>
                      <del>{original.scope[k as keyof Scope]}</del>
                      <ins>{scope[k as keyof Scope]}</ins>
                    </div>
                  ))}
                {JSON.stringify(original.content) === JSON.stringify(content) &&
                  JSON.stringify(original.scope) === JSON.stringify(scope) && (
                    <p className="muted">
                      This is the original submission. Edit it or try a
                      suggested fix to see the difference.
                    </p>
                  )}
              </div>
            </div>
          ) : (
            <div className="history-view">
              <h3>Version history</h3>
              <p className="muted">
                Content, intended use, and decisions stay together.
              </p>
              <div className="timeline">
                {[...item.events].reverse().map((e) => (
                  <div className="timeline-item" key={e.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>{e.actor}</strong>
                      <time>{formatDate(e.createdAt)}</time>
                      <p>{e.text}</p>
                    </div>
                  </div>
                ))}
              </div>
              <h3>Saved versions</h3>
              {[...item.versions].reverse().map((v) => (
                <details className="version-history" key={v.id}>
                  <summary>
                    <span>
                      v{v.id} · {v.author}
                    </span>
                    <small>{formatDate(v.createdAt)}</small>
                    <ChevronDown size={15} />
                  </summary>
                  <p>{v.note}</p>
                  <div className="version-copy">
                    <b>{v.content.headline}</b>
                    <p>{v.content.body}</p>
                    <p>{v.content.disclosure}</p>
                    <small>{v.content.cta}</small>
                  </div>
                  <dl className="scope-grid">
                    {Object.entries(v.scope).map(([k, val]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{val}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </div>
          )}
        </section>
        <aside className="review-panel">
          <div className="panel-tabs">
            {["Suggested fix", "Edit copy", "Comments"].map((p) => (
              <button
                key={p}
                className={panel === p ? "active" : ""}
                onClick={() => setPanel(p)}
              >
                {p === "Suggested fix" ? (
                  <Sparkles size={16} />
                ) : p === "Edit copy" ? (
                  <Pencil size={16} />
                ) : (
                  <MessageSquare size={16} />
                )}
                <span>{p}</span>
                {p === "Comments" && <small>{item.comments.length}</small>}
              </button>
            ))}
          </div>
          <div className="panel-content">
            {panel === "Suggested fix" ? (
              <>
                <div className="panel-eyebrow">
                  <span className="sparkle-icon">
                    <Sparkles size={18} />
                  </span>{" "}
                  REVIEW
                </div>
                <h2>
                  {fixture ? "Suggested adjustment" : "Submission checks"}
                </h2>
                <p className="panel-intro">
                  Review the asset, recorded use, and required changes.
                </p>
                {fixture ? (
                  <>
                    <div className="review-observation">
                      <span className="small-label">ORIGINAL REVIEW NOTE</span>
                      <h3>
                        {item.fixture === "loan"
                          ? "The headline promises approval."
                          : "Prequalification ≠ approval."}
                      </h3>
                      <p>
                        {item.fixture === "loan"
                          ? "“Guaranteed approval” and “whatever your credit score” don’t match this sample product’s eligibility conditions."
                          : "The headline implies a loan commitment. The qualification also needs more breathing room in this layout."}
                      </p>
                      <span className="policy-label">ClearPath policy</span>
                    </div>
                    {!suggestion ? (
                      <button
                        className="suggestion-button"
                        onClick={loadSuggestion}
                        disabled={loading}
                      >
                        <Sparkles size={18} className={loading ? "spin" : ""} />
                        {loading ? "Preparing example…" : "Try an example fix"}
                        <ArrowRight size={17} />
                      </button>
                    ) : (
                      <div className="suggestion-card">
                        <span className="small-label">
                          <Sparkles size={13} /> CURATED AI EXAMPLE
                        </span>
                        <h3>{fixture.title}</h3>
                        <p>{fixture.why}</p>
                        <blockquote>{fixture.content.headline}</blockquote>
                        <button
                          className="primary full"
                          onClick={() => {
                            flushSync(() => {
                              setContent({ ...fixture.content });
                              setCopyDraft(null);
                              setSuggestion(false);
                              setTab("Compare versions");
                            });
                            compareTabRef.current?.focus({
                              preventScroll: true,
                            });
                            compareTabRef.current?.scrollIntoView({
                              block: "start",
                              behavior: "instant",
                            });
                            notify(
                              "Example applied to your draft. Review or edit before sending.",
                            );
                          }}
                        >
                          <Check size={16} /> Use this as my starting point
                        </button>
                      </div>
                    )}
                    <p className="simulation-note">
                      A prepared example, not a live AI call. You can edit every
                      word.
                    </p>
                  </>
                ) : (
                  <div className="review-observation">
                    <h3>
                      {registered
                        ? "Registered sample asset"
                        : uploaded
                        ? "Uploaded image · visual review required"
                        : "Review submitted creative"}
                    </h3>
                    <p>
                      {registered
                        ? "The image, copy, and intended use match a registered sample. Run checks to see which requirements pass and which still need evidence."
                        : uploaded
                        ? "Compare the extracted or supplied copy with the image and its intended use before deciding."
                        : "Review the creative and its intended use, then edit the copy or approve the original."}
                    </p>
                    <button
                      className="primary full"
                      disabled={dirty || !needsReview(item)}
                      onClick={() => {
                        const checked = checkSubmission(item);
                        setFeedback(draftFeedback(checked));
                        update(recordCheckReport(item, checked));
                      }}
                    >
                      <ShieldCheck size={16} />{" "}
                      {report ? "Run checks again" : "Check submission"}
                    </button>
                    {dirty && (
                      <p className="muted">
                        Save your changes before checking this version.
                      </p>
                    )}
                    {report && (
                      <div
                        className="submission-checks"
                        aria-label="Submission check results"
                      >
                        {report.checks.map((check) => (
                          <details key={check.id}>
                            <summary>
                              <strong>{check.label}</strong>
                              <span>
                                {check.status === "pass"
                                  ? "Passed"
                                  : check.status === "not-applicable"
                                    ? "Not applicable"
                                    : check.status === "fail"
                                      ? "Change required"
                                      : "Review needed"}
                              </span>
                            </summary>
                            <p>{check.evidence}</p>
                            {check.fix && <p>{check.fix}</p>}
                          </details>
                        ))}
                      </div>
                    )}
                    {report?.canSuggestFix && uploadFix && needsReview(item) && (
                      <>
                        <label className="field-label">
                          Comments for creative
                          <textarea rows={4} value={feedback}
                            onChange={(event) => setFeedback(event.target.value)} disabled={loading} />
                        </label>
                        <button className="primary full" disabled={loading || !feedback.trim()}
                          onClick={prepareCheckedUploadFix}>
                          <Sparkles size={16} /> {loading ? "Preparing example…" : "Submit feedback & draft a fix"}
                        </button>
                        <p className="muted">Uses the prepared correction for this exact sample. Your comments stay with the review.</p>
                      </>
                    )}
                    <button
                      className="secondary full"
                      onClick={() => startEdit("headline")}
                    >
                      <Pencil size={16} />{" "}
                      {uploaded ? "Read transcribed copy" : "Edit the copy"}
                    </button>
                  </div>
                )}
                <div className="brief-note">
                  <MessageSquare size={16} />
                  <div>
                    <strong>From {item.owner.split(" ")[0]}</strong>
                    <p>
                      {item.comments.find((c) => c.field === "Creative brief")
                        ?.text ||
                        "Please keep the campaign’s tone while making any necessary adjustments. A concrete alternative is welcome."}
                    </p>
                  </div>
                </div>
              </>
            ) : panel === "Edit copy" ? (
              <>
                <h2>{uploaded ? "Submitted copy" : "Edit creative copy"}</h2>
                <p className="panel-intro">
                  {uploaded
                    ? "This copy is recorded with the image. Changing text here would not change the artwork; return the image for revision if a correction is needed."
                    : "Your preview updates as you type. Save a version when it’s ready."}
                </p>
                <label className="field-label">
                  Creative copy
                  <textarea
                    ref={editRef}
                    aria-label="Creative copy"
                    value={copyDraft ?? formatCreativeCopy(content)}
                    rows={12}
                    readOnly={uploaded}
                    onChange={(e) => {
                      setCopyDraft(e.target.value);
                      setContent({
                        ...content,
                        ...parseCreativeCopy(e.target.value),
                        image: undefined,
                      });
                    }}
                  />
                </label>
                <button
                  className="secondary full"
                  disabled={!dirty || !content.headline.trim()}
                  onClick={save}
                >
                  <Check size={16} /> Save new version
                </button>
                {dirty && (
                  <button
                    className="text-button discard"
                    onClick={() => {
                      setContent({ ...version.content });
                      setCopyDraft(null);
                      setScope({ ...version.scope });
                    }}
                  >
                    Discard unsaved edits
                  </button>
                )}
              </>
            ) : (
              <>
                <h2>Keep the context close.</h2>
                <p className="panel-intro">
                  Comments stay attached to the version and field you reviewed.
                </p>
                <div className="comments">
                  {item.comments.map((c) => (
                    <div className="comment" key={c.id}>
                      <span className="avatar small lavender">
                        {initials(c.author)}
                      </span>
                      <div>
                        <strong>
                          {c.author}
                          <small>{ago(c.createdAt)}</small>
                        </strong>
                        <span className="comment-anchor">
                          v{c.versionId} · {c.field}
                        </span>
                        <p>{c.text}</p>
                      </div>
                    </div>
                  ))}
                  {!item.comments.length && (
                    <p className="muted">
                      No comments yet. Add context for the next person.
                    </p>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (
                      act(
                        () => addComment(item, comment, commentField),
                        "Comment saved to this version.",
                      )
                    )
                      setComment("");
                  }}
                >
                  <label className="field-label">
                    Comment on
                    <select
                      value={commentField}
                      onChange={(e) => setCommentField(e.target.value)}
                    >
                      <option value="headline">Headline</option>
                      <option value="body">Body copy</option>
                      <option value="disclosure">Disclosure</option>
                      <option value="cta">Button</option>
                      <option value="Asset">Whole asset</option>
                    </select>
                  </label>
                  {dirty && (
                    <p className="notice">
                      Save your draft before commenting so your note stays with
                      the right version.
                    </p>
                  )}
                  <label className="field-label">
                    Your note
                    <textarea
                      rows={3}
                      placeholder="Explain the change or add context…"
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </label>
                  <button
                    className="secondary full"
                    disabled={!comment.trim() || dirty}
                  >
                    <MessageSquare size={16} /> Add comment
                  </button>
                </form>
              </>
            )}
          </div>
          <div className="decision-card">
            <div className="decision-eyebrow">
              <ShieldCheck size={17} /> NEXT ACTION
            </div>
            <h3>
              {item.status === "Approved"
                ? "A decision worth keeping."
                : item.status === "Revision requested"
                  ? "Next action owner: marketing"
                  : item.status === "With creative"
                    ? "The fix is in creative’s hands."
                    : modified
                      ? "Ready to hand over a fix?"
                      : "Record a decision"}
            </h3>
            <p>
              {item.status === "Approved"
                ? "The approved version and scope are saved together."
                : item.status === "Revision requested"
                  ? "The image and your revision instructions stay together."
                  : item.status === "With creative"
                    ? slack.session
                      ? "Waiting for the marketing owner’s response in Slack."
                      : "See the exact adjustment and answer as creative in the Slack preview."
                    : report && !report.canApprove
                      ? report.canSuggestFix && uploadFix
                        ? "Review the drafted comments and prepare the supported correction."
                        : "Return the outstanding findings to the marketing owner."
                      : registered && version.id === 1 && report?.canApprove
                        ? "Approve this exact version and its recorded use, then notify the marketing owner."
                        : "Pre-approve your adjustment so creative can accept it without another round trip."}
            </p>
            {item.status === "With creative" ? (
              <button
                className="primary full"
                onClick={() => {
                  if (dirty) {
                    setError(
                      "Save or discard your unsaved changes before opening the creative handoff.",
                    );
                    return;
                  }
                  setModal("slack");
                }}
              >
                Open creative’s handoff <ArrowUpRight size={17} />
              </button>
            ) : item.status === "Revision requested" ? (
              <p>
                Marketing must provide a revised asset before another decision.
              </p>
            ) : item.status === "Approved" ? (
              <button
                className="secondary full"
                onClick={() => {
                  setPanel("Edit copy");
                  notify(
                    "Any saved edit creates a new version requiring review.",
                  );
                }}
              >
                <Pencil size={16} /> Create a new revision
              </button>
            ) : (
              <>
                {((!registered && !report) || report?.canApprove) && (
                  <>
                    {registered && version.id === 1 && report?.canApprove ? (
                      <button className="primary full" disabled={slack.busy} onClick={approveCheckedUpload}>
                        <Check size={16} /> Approve v{version.id}{slack.session ? ` & notify ${item.owner.split(" ")[0]}` : ""}
                      </button>
                    ) : <button
                      className="primary full"
                      disabled={
                        !content.headline.trim() ||
                        Object.values(scope).some((v) => !v.trim())
                      }
                      onClick={() => openDecision("proposal")}
                    >
                      <Send size={16} /> Pre-approve & hand off
                    </button>}
                    {!registered && !modified && (
                      <button
                        className="text-button full"
                        onClick={() => openDecision("direct")}
                      >
                        Approve original as submitted
                      </button>
                    )}
                  </>
                )}
                {!fixture && (
                  <button
                    className={
                      report && !report.canApprove && !(report.canSuggestFix && uploadFix)
                        ? "primary full"
                        : "secondary full"
                    }
                    disabled={dirty || loading}
                    onClick={() => {
                      setFeedback(report ? draftFeedback(report) : "");
                      setModal("revision");
                    }}
                  >
                    Return for revision
                  </button>
                )}
              </>
            )}
            <div className="bound-version">
              <Link size={12} /> Bound to v{dirty ? version.id + 1 : version.id}{" "}
              and its intended use
            </div>
          </div>
        </aside>
      </div>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {(item.status === "Revision requested" || item.status === "Approved") && (
        <LiveSlack item={item} bridge={slack} />
      )}
      {modal === "revision" && (
        <Modal title="Return for revision" onClose={() => setModal(null)}>
          <p className="muted">
            Give {item.owner} a specific change to make. This sends no approval.
          </p>
          <label className="field-label">
            What needs to change?
            <textarea
              rows={4}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              required
            />
          </label>
          <div className="modal-actions">
            <button
              className="primary"
              disabled={!feedback.trim() || slack.busy}
              onClick={async () => {
                try {
                  const next = returnForRevision(item, feedback);
                  flushSync(() => update(next));
                  setModal(null);
                  if (slack.session)
                    await slack.notify(next, "revision_requested", feedback);
                  else
                    notify(
                      "Revision request saved. No Slack message was sent.",
                    );
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "The revision request could not be saved.",
                  );
                }
              }}
            >
              Return to {item.owner.split(" ")[0]} <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "scope" && (
        <Modal title="Edit intended use" onClose={() => setModal(null)}>
          <p className="muted">
            A change to the audience or placement can change the review. Saving
            creates a new version.
          </p>
          {Object.entries(scope).map(([k, val]) => (
            <label className="field-label" key={k}>
              {k}
              <input
                value={val}
                onChange={(e) => setScope({ ...scope, [k]: e.target.value })}
                required
              />
            </label>
          ))}
          <div className="modal-actions">
            <button
              className="primary"
              disabled={Object.values(scope).some((v) => !v.trim())}
              onClick={() => setModal(null)}
            >
              Use this scope
            </button>
          </div>
        </Modal>
      )}
      {modal === "decision" && (
        <Modal
          title={
            decision === "proposal"
              ? "Review the proposed adjustment"
              : "Approve the submitted asset"
          }
          onClose={() => setModal(null)}
        >
          <p className="muted">
            {decision === "proposal"
              ? `${item.owner} will be asked to accept v${dirty ? version.id + 1 : version.id}. A different edit comes back for review.`
              : "This records approval of the original submission for its stated use."}
          </p>
          <div className="decision-summary">
            <b>
              v{dirty ? version.id + 1 : version.id} · {content.headline}
            </b>
            <dl className="scope-grid">
              {Object.entries(scope).map(([k, val]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{val}</dd>
                </div>
              ))}
            </dl>
          </div>
          <label className="field-label">
            {decision === "proposal"
              ? "What changed, and why?"
              : "Decision rationale"}
            <textarea
              autoFocus
              rows={3}
              value={reason}
              placeholder="Give creative the context they need to say yes…"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I reviewed this exact version and its intended use.
          </label>
          <p className="simulation-note">
            Recorded as {item.reviewer}.{" "}
            {decision === "proposal"
              ? slack.session
                ? "The next screen lets you send this adjustment to the marketing owner in Slack."
                : "The next screen previews the Slack handoff."
              : ""}
          </p>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={() => setModal(null)}>
              Keep reviewing
            </button>
            <button
              className="primary"
              disabled={!checked || !reason.trim()}
              onClick={confirmDecision}
            >
              {decision === "proposal"
                ? "Pre-approve this version"
                : "Approve this version"}
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {modal === "slack" && (
        <Modal
          title="Meet creative where they work."
          onClose={() => {
            setModal(null);
            setResponding(false);
            setCounter(false);
          }}
          wide
        >
          <LiveSlack bridge={slack} item={item} />
          {!slack.session && <>
          <div className="slack-demo-label">
            <span className="demo-pill">Slack preview</span>
            <p>
              This preview changes your demo record. It doesn’t send a Slack
              message.
            </p>
          </div>
          <div className="slack-window">
            <div className="slack-channel">
              <span className="slack-hash">#</span> creative-approvals{" "}
              <span>ClearPath Financial</span>
            </div>
            <div className="slack-message">
              <div className="bot-avatar">
                <ArrowUpRight size={23} />
              </div>
              <div className="slack-message-body">
                <div className="slack-sender">
                  Relay <span>APP</span>
                  <time>Just now</time>
                </div>
                <p>
                  <strong>
                    @{item.owner.replaceAll(" ", "").toLowerCase()}
                  </strong>{" "}
                  — a ready-to-use fix for <b>{item.title}</b>.
                </p>
                <div className="slack-proposal">
                  <span className="small-label">
                    PRE-APPROVED BY {decisionAuthor.toUpperCase()} · V
                    {version.id}
                  </span>
                  <h3>{version.content.headline}</h3>
                  <p>{item.decisionNote}</p>
                  <div className="slack-diff">
                    <div>
                      <small>BEFORE</small>
                      <del>{original.content.headline}</del>
                    </div>
                    <ArrowRight size={16} />
                    <div>
                      <small>PROPOSED</small>
                      <strong>{version.content.headline}</strong>
                    </div>
                  </div>
                  <div className="slack-scope">
                    {version.scope.product} · {version.scope.channel}
                    <br />
                    {version.scope.audience}
                    <br />
                    {version.scope.placement}
                  </div>
                  <details className="slack-full">
                    <summary>Review the full creative and disclosure</summary>
                    <p>{version.content.body}</p>
                    <p>
                      <b>Button:</b> {version.content.cta}
                    </p>
                    <p>
                      <b>Disclosure:</b> {version.content.disclosure}
                    </p>
                  </details>
                </div>
                <div className="creative-identity">
                  <span className="avatar small lavender">
                    {initials(item.owner)}
                  </span>{" "}
                  You’re trying this as {item.owner} · Creative
                </div>
                {item.status === "With creative" ? (
                  <>
                    <div className="slack-actions">
                      <button
                        className="primary"
                        onClick={() => {
                          if (
                            act(
                              () => acceptProposal(item),
                              "Creative accepted. This exact version is ready to launch.",
                            )
                          ) {
                            setResponding(false);
                            setCounter(false);
                          }
                        }}
                      >
                        <Check size={16} /> Accept this version
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setResponding(!responding)}
                      >
                        <MessageSquare size={16} /> Request a change
                      </button>
                    </div>
                    {responding && (
                      <form
                        className="creative-response"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (
                            act(
                              () =>
                                counter
                                  ? counterEdit(
                                      item,
                                      {
                                        ...version.content,
                                        headline: counterHeadline,
                                        image: undefined,
                                      },
                                      version.scope,
                                      feedback,
                                    )
                                  : requestChanges(item, feedback),
                              "Feedback returned to compliance with a clear next step.",
                            )
                          ) {
                            setResponding(false);
                            setCounter(false);
                          }
                        }}
                      >
                        <label className="field-label">
                          What would you like changed?
                          <textarea
                            autoFocus
                            rows={3}
                            placeholder="Keep the tone, but could we…"
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                          />
                        </label>
                        {!uploaded && (
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={counter}
                              onChange={(e) => setCounter(e.target.checked)}
                            />
                            Suggest a different headline
                          </label>
                        )}
                        {counter && (
                          <label className="field-label">
                            Your proposed headline
                            <input
                              value={counterHeadline}
                              onChange={(e) =>
                                setCounterHeadline(e.target.value)
                              }
                            />
                          </label>
                        )}
                        <p className="simulation-note">
                          {counter
                            ? "This creates a new version and returns it to compliance."
                            : "The current pre-approval will be withdrawn."}
                        </p>
                        <button
                          className="primary"
                          disabled={
                            !feedback.trim() ||
                            (counter && !counterHeadline.trim())
                          }
                        >
                          Send feedback <ArrowRight size={16} />
                        </button>
                      </form>
                    )}
                  </>
                ) : (
                  <div className="slack-result">
                    <CheckCircle2 size={20} />
                    <div>
                      <strong>
                        {item.status === "Approved"
                          ? "Accepted. You’re ready to go."
                          : "Back with compliance."}
                      </strong>
                      <p>
                        {item.status === "Approved"
                          ? `v${item.approvedVersionId} and its intended use are now approved.`
                          : "Your feedback is saved with the version you reviewed."}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          </>}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button className="secondary" onClick={() => setModal(null)}>
              Back to workspace
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function FlagIcon() {
  return <CheckCircle2 size={15} />;
}

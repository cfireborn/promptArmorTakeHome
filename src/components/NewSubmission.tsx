import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ScanText } from "lucide-react";
import {
  currentVersion,
  type AssetContent,
  type Scope,
  type Submission,
} from "../domain";
import { attachRegisteredDemoAsset } from "../demoAssets";
import { formatCreativeCopy, parseCreativeCopy } from "../intake";
import { resubmitCreativeRevision } from "../creativeWorkflow";
import { extractImageText } from "../ocr";
import {
  prepareUploadedImage,
  isUploadedImage,
  readUploadedImage,
  storeUploadedImage,
  type UploadedImage,
} from "../uploads";
import { Modal } from "./Modal";
import { Asset } from "./Asset";
import "./new-submission.css";

const owners = ["Maya Chen", "Jordan Lee", "Sofia Patel"];
const products = [
  "Personal loans",
  "Credit cards",
  "Mortgage prequalification",
];
const channels = [
  "Paid social",
  "Affiliate partner",
  "Email",
  "Organic social",
];

export function NewSubmission({
  close,
  create,
  owner: preferredOwner,
  initialSubmission,
}: {
  close: () => void;
  create: (submission: Submission) => void;
  owner?: string;
  initialSubmission?: Submission;
}) {
  const initialVersion = initialSubmission
    ? currentVersion(initialSubmission)
    : undefined;
  const [title, setTitle] = useState(initialSubmission?.title || "");
  const [owner, setOwner] = useState(
    initialSubmission?.owner ||
      (preferredOwner && owners.includes(preferredOwner)
        ? preferredOwner
        : owners[0]),
  );
  const [product, setProduct] = useState(
    initialVersion?.scope.product || products[0],
  );
  const [channel, setChannel] = useState(
    initialVersion?.scope.channel || channels[0],
  );
  const [audience, setAudience] = useState(
    initialVersion?.scope.audience || "US adults · existing customers",
  );
  const [placement, setPlacement] = useState(
    initialVersion?.scope.placement || "Instagram feed · portrait creative",
  );
  const [jurisdiction, setJurisdiction] = useState<
    NonNullable<Scope["jurisdiction"]>
  >(initialVersion?.scope.jurisdiction || "Unspecified");
  const [affiliatePartner, setAffiliatePartner] = useState<
    NonNullable<Scope["affiliatePartner"]>
  >(
    initialVersion?.scope.affiliatePartner ||
      (initialVersion?.scope.channel === "Affiliate partner"
        ? /^Homewise\b/i.test(initialVersion.scope.placement)
          ? "Homewise"
          : "Other"
        : "None"),
  );
  const [copy, setCopy] = useState(
    initialVersion ? formatCreativeCopy(initialVersion.content) : "",
  );
  const [upload, setUpload] = useState<UploadedImage | null>(null);
  const [keepExistingImage, setKeepExistingImage] = useState(
    !!initialVersion?.content.image,
  );
  const imageReference =
    upload?.reference ||
    (keepExistingImage ? initialVersion?.content.image : undefined);
  const hasImage = !!imageReference;
  const revisionInstructions =
    initialSubmission?.decisionNote ||
    initialSubmission?.comments
      .filter((comment) =>
        ["Revision request", "Creative feedback"].includes(comment.field),
      )
      .at(-1)?.text;
  const [submitError, setSubmitError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [ocrStatus, setOcrStatus] = useState("");
  const [recognizing, setRecognizing] = useState(false);
  const uploadRun = useRef(0);
  const copyRevision = useRef(0);
  const ocr = useRef<AbortController | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      uploadRun.current++;
      ocr.current?.abort();
    };
  }, []);

  function cancelOcr() {
    ocr.current?.abort();
    ocr.current = null;
    setRecognizing(false);
    setOcrStatus("");
  }
  async function readImage() {
    if (!upload || recognizing) return;
    cancelOcr();
    const controller = new AbortController();
    ocr.current = controller;
    const revision = copyRevision.current;
    setRecognizing(true);
    try {
      const text = await extractImageText(
        upload.dataUrl,
        controller.signal,
        (status) => {
          if (alive.current && ocr.current === controller) setOcrStatus(status);
        },
      );
      if (
        !alive.current ||
        ocr.current !== controller ||
        controller.signal.aborted
      )
        return;
      if (revision !== copyRevision.current) {
        setOcrStatus(
          "Your edited copy was kept. Clear the field to run text extraction again.",
        );
      } else if (text) {
        setCopy(text);
        copyRevision.current++;
        setOcrStatus(
          "Text extracted. Check it against the image before submitting.",
        );
      } else
        setOcrStatus(
          "No text found. You can submit the image or add the visible copy below.",
        );
    } catch (error) {
      if (alive.current && ocr.current === controller)
        setOcrStatus(
          error instanceof DOMException && error.name === "AbortError"
            ? "Text extraction stopped. You can enter copy below or submit the image."
            : "Text extraction could not finish. Retry, enter copy below, or submit the image.",
        );
    } finally {
      if (alive.current && ocr.current === controller) {
        ocr.current = null;
        setRecognizing(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      uploading ||
      recognizing ||
      uploadError ||
      ![title, audience, placement].every((value) => value.trim()) ||
      (!hasImage && !copy.trim())
    )
      return;
    if (upload) {
      try {
        storeUploadedImage(upload);
      } catch (error) {
        setUploadError(
          error instanceof Error
            ? error.message
            : "The image could not be saved.",
        );
        return;
      }
    }
    if (isUploadedImage(imageReference) && !readUploadedImage(imageReference)) {
      setSubmitError(
        "The previous image is no longer saved in this browser. Upload a replacement before resubmitting.",
      );
      return;
    }
    const content: AssetContent = {
      ...parseCreativeCopy(copy),
      ...(imageReference ? { image: imageReference } : {}),
      ...(initialVersion?.content.palette &&
      imageReference === initialVersion.content.image
        ? { palette: initialVersion.content.palette }
        : {}),
      art:
        product === "Credit cards"
          ? "card"
          : product === "Mortgage prequalification"
            ? "home"
            : "sunrise",
    };
    const scope: Scope = {
      product,
      audience: audience.trim(),
      channel,
      placement: placement.trim(),
      jurisdiction,
      affiliatePartner,
    };
    if (initialSubmission) {
      try {
        const revision = resubmitCreativeRevision(
          initialSubmission,
          content,
          scope,
          owner,
        );
        create({ ...revision, title: title.trim() });
      } catch (error) {
        setSubmitError(
          error instanceof Error
            ? error.message
            : "The revision could not be submitted.",
        );
      }
      return;
    }
    const now = new Date().toISOString();
    const submission: Submission = {
      id: `CP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      title: title.trim(),
      owner,
      reviewer: "Alex Morgan",
      priority: "Normal",
      due: new Date(Date.now() + 86400000).toISOString(),
      submittedAt: now,
      status: "Needs review",
      versions: [
        {
          id: 1,
          content,
          scope,
          createdAt: now,
          author: owner,
          note: upload
            ? `Uploaded ${upload.name}${copy.trim() ? "; supplied copy accompanies the image" : "; image submitted for visual assessment"}. Image saved in this browser.`
            : "Original submission from marketing.",
        },
      ],
      comments: [],
      events: [
        {
          id: crypto.randomUUID(),
          actor: owner,
          text: "Submitted v1 with its intended use. Next action owner: compliance.",
          createdAt: now,
        },
      ],
    };
    create(attachRegisteredDemoAsset(submission, upload));
  }
  return (
    <Modal
      title={
        initialSubmission ? `Revise ${initialSubmission.id}` : "New submission"
      }
      onClose={close}
      wide
    >
      <p className="muted">
        You are submitting as {owner}.{" "}
        {initialSubmission?.reviewer || "Alex Morgan"} reviews next.
      </p>
      <p className="muted">
        Upload creative and record where it will run. Supplied copy is optional
        when an image is attached.
      </p>
      {initialSubmission && (
        <div className="cw-instructions">
          <strong>Revision instructions</strong>
          <p>
            {revisionInstructions ||
              "Update the asset or its intended use for a new review."}
          </p>
          <p>The new version stays with this submission’s history.</p>
        </div>
      )}
      <form className="ns-form" onSubmit={submit}>
        <p className="ns-required-legend muted">
          <span className="ns-required" aria-hidden="true">
            *
          </span>{" "}
          Required
        </p>
        <div className="upload-field">
          <label className="field-label">
            {initialSubmission
              ? "Replacement image (optional)"
              : "Creative image (optional)"}
            <input
              ref={uploadInput}
              type="file"
              accept="image/png,image/jpeg"
              aria-required="false"
              aria-describedby="upload-help"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                const run = ++uploadRun.current;
                cancelOcr();
                setUpload(null);
                setUploadError("");
                setUploading(!!file);
                if (!file) return;
                try {
                  const prepared = await prepareUploadedImage(file);
                  if (alive.current && run === uploadRun.current)
                    setUpload(prepared);
                } catch (error) {
                  if (alive.current && run === uploadRun.current)
                    setUploadError(
                      error instanceof Error
                        ? error.message
                        : "The image could not be prepared.",
                    );
                } finally {
                  if (alive.current && run === uploadRun.current)
                    setUploading(false);
                }
              }}
            />
          </label>
          <p id="upload-help" className="muted">
            PNG or JPEG, up to 8 MB. A smaller copy is saved in this browser.
          </p>
          {uploading && <p role="status">Preparing image…</p>}
          {!upload && keepExistingImage && initialVersion && (
            <div className="upload-preview">
              <Asset content={initialVersion.content} compact />
              <div>
                <strong>Current image · v{initialVersion.id}</strong>
                <p className="muted">
                  This image is kept unless you replace or remove it.
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setKeepExistingImage(false);
                  }}
                >
                  Remove current image
                </button>
              </div>
            </div>
          )}
          {upload && (
            <div className="upload-preview">
              <img src={upload.dataUrl} alt="Selected creative preview" />
              <div>
                <strong>{upload.name}</strong>
                <p className="muted">
                  Review this resized image and confirm any supplied copy
                  matches it.
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    uploadRun.current++;
                    cancelOcr();
                    setUpload(null);
                    setUploadError("");
                    if (uploadInput.current) uploadInput.current.value = "";
                  }}
                >
                  {keepExistingImage ? "Use previous image" : "Remove image"}
                </button>
              </div>
            </div>
          )}
          {upload && (
            <div className="ocr-controls">
              <button
                type="button"
                className="secondary"
                disabled={recognizing || !!copy.trim()}
                onClick={readImage}
              >
                <ScanText size={16} /> Extract text from image
              </button>
              {recognizing && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    cancelOcr();
                    setOcrStatus("Text extraction canceled.");
                  }}
                >
                  Cancel extraction
                </button>
              )}
              <p className="muted">
                English text recognition runs on your device.{" "}
                {copy.trim()
                  ? "Clear Creative copy to extract again; your current text will be kept."
                  : "The first run downloads the recognition engine."}
              </p>
              {ocrStatus && <p role="status">{ocrStatus}</p>}
            </div>
          )}
          {uploadError && (
            <div className="error-banner" role="alert">
              {uploadError}{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  uploadRun.current++;
                  cancelOcr();
                  setUpload(null);
                  setUploadError("");
                  setUploading(false);
                  if (uploadInput.current) uploadInput.current.value = "";
                }}
              >
                Remove image
              </button>
            </div>
          )}
        </div>
        <div className="form-grid">
          <label className="field-label">
            <span>
              Campaign name{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <input
              data-autofocus
              required
              aria-required="true"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              placeholder="A name the team will recognize"
            />
          </label>
          <label className="field-label">
            <span>
              Creative owner{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <select
              required
              aria-required="true"
              value={owner}
              disabled={!!initialSubmission}
              onChange={(event) => {
                setOwner(event.target.value);
              }}
            >
              {owners.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>
              Product{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <select
              required
              aria-required="true"
              value={product}
              onChange={(event) => {
                setProduct(event.target.value);
              }}
            >
              {products.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>
              Channel{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <select
              required
              aria-required="true"
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value);
                if (event.target.value !== "Affiliate partner")
                  setAffiliatePartner("None");
                else if (affiliatePartner === "None")
                  setAffiliatePartner("Other");
              }}
            >
              {channels.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            <span>
              Audience{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <input
              required
              aria-required="true"
              value={audience}
              onChange={(event) => {
                setAudience(event.target.value);
              }}
            />
          </label>
          <label className="field-label">
            <span>
              Placement{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <input
              required
              aria-required="true"
              value={placement}
              onChange={(event) => {
                setPlacement(event.target.value);
              }}
            />
          </label>
          <label className="field-label">
            <span>
              Jurisdiction{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <select
              required
              aria-required="true"
              value={jurisdiction}
              onChange={(event) => {
                setJurisdiction(
                  event.target.value as NonNullable<Scope["jurisdiction"]>,
                );
              }}
            >
              <option>Unspecified</option>
              <option>California</option>
              <option>Other US jurisdiction</option>
            </select>
          </label>
          <label className="field-label">
            <span>
              Affiliate partner{" "}
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            </span>
            <select
              required
              aria-required="true"
              value={affiliatePartner}
              onChange={(event) => {
                setAffiliatePartner(
                  event.target.value as NonNullable<Scope["affiliatePartner"]>,
                );
                if (event.target.value !== "None")
                  setChannel("Affiliate partner");
                else if (channel === "Affiliate partner")
                  setChannel("Paid social");
              }}
            >
              <option>None</option>
              <option>Homewise</option>
              <option>Other</option>
            </select>
          </label>
        </div>
        <p className="muted">
          Jurisdiction and affiliate partner select the additional review rules.
          Choose where the asset will run and who will distribute it.
        </p>
        <label className="field-label">
          <span>
            Creative copy{" "}
            {!hasImage && (
              <span className="ns-required" aria-hidden="true">
                *
              </span>
            )}
          </span>
          <textarea
            aria-label="Creative copy"
            rows={9}
            required={!hasImage}
            aria-required={!hasImage}
            value={copy}
            onChange={(event) => {
              copyRevision.current++;
              setCopy(event.target.value);
            }}
            placeholder={
              hasImage
                ? "Optional: supply visible copy or extract it from the image"
                : "All visible copy, including the call to action and disclosure"
            }
          />
        </label>
        <p className="muted">
          Live review sends the asset and supplied copy to Claude. Image edits
          use OpenAI when requested.
        </p>
        {submitError && (
          <p className="error-banner" role="alert">
            {submitError}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={
              uploading ||
              recognizing ||
              !!uploadError ||
              ![title, audience, placement].every((value) => value.trim()) ||
              (!hasImage && !copy.trim())
            }
          >
            {initialSubmission ? "Resubmit for review" : "Submit for review"}{" "}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

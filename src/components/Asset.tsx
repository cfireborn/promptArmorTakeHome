import type { AssetContent } from "../domain";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { isUploadedImage, readUploadedImage } from "../uploads";

function UploadedAsset({
  content,
  compact,
}: {
  content: AssetContent;
  compact: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const source = readUploadedImage(content.image);
  return (
    <div className={`asset asset-image ${compact ? "compact" : ""}`}>
      {source && !failed ? (
        <img
          src={source}
          alt={`Uploaded creative: ${content.headline}. ${content.body} ${content.disclosure}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="uploaded-image-missing"
          role="alert"
          data-asset-error="true"
        >
          <strong>Uploaded image unavailable</strong>
          <p>
            This image is saved only in the browser where it was submitted.
            Create a new submission with the image to review or send it.
          </p>
        </div>
      )}
    </div>
  );
}
export function Asset({
  content,
  onEdit,
  compact = false,
}: {
  content: AssetContent;
  onEdit?: (field: string) => void;
  compact?: boolean;
}) {
  if (isUploadedImage(content.image))
    return (
      <UploadedAsset key={content.image} content={content} compact={compact} />
    );
  if (
    content.image &&
    /^creative\/(?:mortgage-(?:original|fixed)|loan-fixed)\.png$/.test(content.image)
  ) {
    return (
      <div className={`asset asset-image ${compact ? "compact" : ""}`}>
        <img
          src={`${import.meta.env.BASE_URL}${content.image}`}
          alt={`${content.headline} ${content.body} ${content.disclosure}`}
        />
      </div>
    );
  }
  const home = content.art === "home";
  const improved = content.disclosure.length > 120;
  return (
    <div
      className={`asset asset-${content.art} ${compact ? "compact" : ""} ${improved ? "readable" : ""}`}
    >
      <div className="asset-brand">
        <span className="path-mark">
          <ArrowUpRight size="1em" strokeWidth={1.5} aria-hidden="true" />
        </span>{" "}
        ClearPath<span>FINANCIAL</span>
      </div>
      <div className="asset-art" aria-hidden="true">
        {home ? (
          <svg viewBox="0 0 400 250">
            <circle cx="310" cy="55" r="35" fill="#e9cf93" />
            <path d="M0 210 Q100 140 210 190T400 160V250H0Z" fill="#94a89a" />
            <path d="M60 112L185 29L310 112V235H60Z" fill="#ede5d4" />
            <path
              d="M41 116L185 18L330 116L317 130L185 43L55 130Z"
              fill="#34584e"
            />
            <path d="M160 151H211V235H160Z" fill="#477468" />
            <g fill="#d0a85f" stroke="#fff7e7" strokeWidth="7">
              <path d="M94 131H132V178H94Z" />
              <path d="M239 131H277V178H239Z" />
              <path d="M167 83H204V115H167Z" />
            </g>
            <path d="M160 235L120 250H248L211 235" fill="#dfc49b" />
            <path
              d="M340 230V170M30 230V175"
              stroke="#546e56"
              strokeWidth="8"
            />
            <g fill="#66866b">
              <ellipse cx="344" cy="167" rx="27" ry="43" />
              <ellipse cx="28" cy="177" rx="22" ry="36" />
            </g>
          </svg>
        ) : content.art === "card" ? (
          <div className="credit-card">
            <span>ClearPath</span>
            <span className="chip">▦</span>
            <span>•••• &nbsp; •••• &nbsp; •••• &nbsp; 2048</span>
            <small>EVERYDAY POSSIBILITIES</small>
          </div>
        ) : (
          <>
            <div className="sun" />
            <div className="sun-ring ring-one" />
            <div className="sun-ring ring-two" />
            <div className="arch arch-one" />
            <div className="arch arch-two" />
            <div className="art-caption">
              A little space.
              <br />A new possibility.
            </div>
          </>
        )}
      </div>
      <div className="asset-copy">
        {onEdit ? (
          <button
            className="editable headline-button"
            title="Edit headline in place"
            onClick={() => onEdit("headline")}
          >
            {content.headline}
          </button>
        ) : (
          <h3>{content.headline}</h3>
        )}
        {onEdit ? (
          <button
            className="editable body-button"
            title="Edit body copy in place"
            onClick={() => onEdit("body")}
          >
            {content.body}
          </button>
        ) : (
          <p>{content.body}</p>
        )}
        <span className="asset-cta">
          {content.cta}
          <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </span>
      </div>
      <div className="asset-disclosure">
        {onEdit ? (
          <button
            className="editable"
            title="Edit disclosure in place"
            onClick={() => onEdit("disclosure")}
          >
            {content.disclosure}
          </button>
        ) : (
          content.disclosure
        )}
      </div>
    </div>
  );
}

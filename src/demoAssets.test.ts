import { describe, expect, it } from "vitest";
import {
  attachRegisteredDemoAsset,
  demoAssetForSourceHash,
  preparedUploadFix,
  registeredDemoAsset,
} from "./demoAssets";
import { approveChecked, checkSubmission } from "./checker";
import {
  currentVersion,
  saveDraft,
  type AssetContent,
} from "./domain";
import { seedSubmissions } from "./seed";

const image = `upload:${"a".repeat(64)}`;
function uploaded(sample: "card" | "loan" | "mortgage") {
  const id =
    sample === "card" ? "CP-1040" : sample === "loan" ? "CP-1042" : "CP-1041";
  const item = seedSubmissions().find((row) => row.id === id)!;
  item.id = "CP-NEW";
  item.fixture = undefined;
  item.reviewEvidence = undefined;
  const version = currentVersion(item);
  version.content = { ...version.content, image, palette: undefined };
  if (sample === "mortgage")
    version.content.body += "\n\nClearPath FINANCIAL; Homewise · California";
  return item;
}
const upload = (sample: "card" | "loan" | "mortgage") => ({
  reference: image,
  dataUrl: "",
  name: "anything.png",
  knownSample: sample,
});

describe("registered uploaded examples", () => {
  it("recognizes exact original file hashes, never file names or arbitrary digests", () => {
    expect(
      demoAssetForSourceHash(
        "a56897bb15e7c9cd0b544f4ae090cfaf5ee8263e13b1a97511fa4ae162c7b19d",
      ),
    ).toBe("card");
    expect(demoAssetForSourceHash("01-credit-card-clean.png")).toBeUndefined();
    expect(demoAssetForSourceHash("a".repeat(64))).toBeUndefined();
    expect(demoAssetForSourceHash("__proto__")).toBeUndefined();
  });
  it.each(["Maya Chen", "Jordan Lee", "Sofia Patel"])(
    "retains %s ownership while recognizing the exact clean card",
    (owner) => {
      const item = attachRegisteredDemoAsset(
        { ...uploaded("card"), owner },
        upload("card"),
      );
      expect(item.owner).toBe(owner);
      expect(registeredDemoAsset(item)).toBe("card");
      expect(
        approveChecked(item, checkSubmission(item)).approvedVersionId,
      ).toBe(1);
      expect(preparedUploadFix(item)).toBeNull();
    },
  );
  it.each([
    "headline",
    "body",
    "disclosure",
    "cta",
    "art",
    "image",
  ] as (keyof AssetContent)[])(
    "does not register mismatched submitted %s",
    (field) => {
      const item = uploaded("card");
      Object.assign(currentVersion(item).content, { [field]: "different" });
      const result = attachRegisteredDemoAsset(item, upload("card"));
      expect(result.registeredUpload).toBeUndefined();
      expect(result.reviewEvidence).toBeUndefined();
      expect(checkSubmission(result).canApprove).toBe(false);
    },
  );
  it.each(["product", "audience", "channel", "placement"] as const)(
    "does not carry routing evidence into different %s",
    (field) => {
      const item = uploaded("card");
      currentVersion(item).scope[field] = "Different use";
      const result = attachRegisteredDemoAsset(item, upload("card"));
      expect(result.registeredUpload).toBeUndefined();
      expect(result.reviewEvidence).toBeUndefined();
      expect(checkSubmission(result).canApprove).toBe(false);
    },
  );
  it("requires a recognized raw file as well as exact text and scope", () => {
    const result = attachRegisteredDemoAsset(uploaded("card"), {
      ...upload("card"),
      knownSample: undefined,
    });
    expect(result.registeredUpload).toBeUndefined();
    expect(checkSubmission(result).canApprove).toBe(false);
  });
  it("makes a real replacement image v2, retaining the uploaded loan original and evidence", () => {
    const item = attachRegisteredDemoAsset(uploaded("loan"), upload("loan"));
    expect(checkSubmission(item).canSuggestFix).toBe(true);
    expect(checkSubmission(item).canApprove).toBe(false);
    const fix = preparedUploadFix(item)!;
    expect(fix.image).toBe("creative/loan-fixed.png");
    const repaired = saveDraft(
      item,
      fix,
      currentVersion(item).scope,
      "Prepared registered replacement",
    );
    expect(repaired.versions[0].content.image).toBe(image);
    expect(repaired.versions[0].content.headline).toContain(
      "Guaranteed approval",
    );
    expect(registeredDemoAsset(repaired)).toBe("loan");
    expect(checkSubmission(repaired).canApprove).toBe(true);
    expect(currentVersion(repaired).content.headline).toBe(
      "A little breathing room.",
    );
    const changedCopy = saveDraft(
      repaired,
      { ...fix, body: "An unreviewed promise" },
      currentVersion(repaired).scope,
      "Changed",
    );
    expect(registeredDemoAsset(changedCopy)).toBeNull();
    expect(checkSubmission(changedCopy).canApprove).toBe(false);
    const fakeFixedImage = saveDraft(
      item,
      { ...fix, image },
      currentVersion(item).scope,
      "Changed text over original pixels",
    );
    expect(registeredDemoAsset(fakeFixedImage)).toBeNull();
    expect(checkSubmission(fakeFixedImage).canApprove).toBe(false);
  });
  it("preserves mortgage state and affiliate blockers after the prepared image repair", () => {
    const item = attachRegisteredDemoAsset(
      uploaded("mortgage"),
      upload("mortgage"),
    );
    expect(item.reviewEvidence).toBeUndefined();
    const fixed = saveDraft(
      item,
      preparedUploadFix(item)!,
      currentVersion(item).scope,
      "Prepared image repair",
    );
    expect(registeredDemoAsset(fixed)).toBe("mortgage");
    const report = checkSubmission(fixed);
    expect(report.canApprove).toBe(false);
    expect(
      report.checks
        .filter((check) => check.status === "needs-review")
        .map((check) => check.id),
    ).toEqual(["state-review", "affiliate-identity"]);
    expect(() => approveChecked(fixed, report)).toThrow("Unresolved findings");
  });
  it("invalidates registration if original provenance or current scope is changed", () => {
    const item = attachRegisteredDemoAsset(uploaded("loan"), upload("loan"));
    const fixed = saveDraft(
      item,
      preparedUploadFix(item)!,
      currentVersion(item).scope,
      "Repair",
    );
    const changed = saveDraft(
      fixed,
      currentVersion(fixed).content,
      { ...currentVersion(fixed).scope, placement: "Another placement" },
      "Changed use",
    );
    expect(registeredDemoAsset(changed)).toBeNull();
    expect(checkSubmission(changed).canApprove).toBe(false);
    fixed.versions[0].content.body = "Altered original";
    expect(registeredDemoAsset(fixed)).toBeNull();
    expect(checkSubmission(fixed).canApprove).toBe(false);
  });
});

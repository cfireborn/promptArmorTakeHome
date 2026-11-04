import { describe, expect, it } from "vitest";
import { checkSubmission, recordCheckReport } from "./checker";
import { resubmitCreativeRevision } from "./creativeWorkflow";
import { approveOriginal, currentVersion, returnForRevision } from "./domain";
import { seedSubmissions } from "./seed";

function returnedSubmission() {
  const item = seedSubmissions().find((item) => item.id === "CP-1040")!;
  item.versions[0].content.image = `upload:${"a".repeat(64)}`;
  const checked = recordCheckReport(item, checkSubmission(item));
  return returnForRevision(
    checked,
    "Replace the image with a readable disclosure.",
  );
}

describe("creative resubmission", () => {
  it("keeps the submission and immutable history while replacing the exact asset", () => {
    const source = returnedSubmission();
    const snapshot = structuredClone(source);
    const version = currentVersion(source);
    const content = { ...version.content, image: `upload:${"b".repeat(64)}` };
    const next = resubmitCreativeRevision(
      source,
      content,
      version.scope,
      source.owner,
    );
    expect(next.id).toBe(source.id);
    expect(next.owner).toBe(source.owner);
    expect(next.reviewer).toBe(source.reviewer);
    expect(next.status).toBe("Needs review");
    expect(next.versions).toHaveLength(2);
    expect(next.versions[0]).toEqual(snapshot.versions[0]);
    expect(currentVersion(next)).toMatchObject({
      id: 2,
      author: source.owner,
      content,
      scope: version.scope,
    });
    expect(next.comments).toEqual(snapshot.comments);
    expect(next.events.slice(0, -1)).toEqual(snapshot.events);
    expect(next.events.at(-1)?.actor).toBe(source.owner);
    expect(next.checkReports).toEqual(snapshot.checkReports);
    expect(next.checkReport).toBeUndefined();
    expect(next.approvedVersionId).toBeUndefined();
    expect(next.proposalVersionId).toBeUndefined();
    expect(next.decisionNote).toBeUndefined();
    expect(source).toEqual(snapshot);
    content.image = "later-change";
    expect(currentVersion(next).content.image).toBe(`upload:${"b".repeat(64)}`);
  });

  it("preserves the existing image while changed scope invalidates prior approval", () => {
    const original = seedSubmissions().find((item) => item.id === "CP-1040")!;
    original.versions[0].content.image = `upload:${"c".repeat(64)}`;
    const source = approveOriginal(original, "Reviewed this exact scope.");
    const version = currentVersion(source);
    const scope = {
      ...version.scope,
      jurisdiction: "California" as const,
      affiliatePartner: "Homewise" as const,
      channel: "Affiliate partner",
    };
    const next = resubmitCreativeRevision(
      source,
      version.content,
      scope,
      source.owner,
    );
    expect(currentVersion(next).content.image).toBe(version.content.image);
    expect(currentVersion(next).scope).toEqual(scope);
    expect(next.versions[0].scope).toEqual(version.scope);
    expect(next.approvedVersionId).toBeUndefined();
    expect(next.status).toBe("Needs review");
  });

  it("accepts an image-only replacement without inventing extracted copy", () => {
    const source = returnedSubmission();
    const version = currentVersion(source);
    const next = resubmitCreativeRevision(
      source,
      {
        headline: "",
        body: "",
        disclosure: "",
        cta: "",
        art: "card",
        image: `upload:${"d".repeat(64)}`,
      },
      version.scope,
      source.owner,
    );
    expect(currentVersion(next).content.headline).toBe("");
    expect(currentVersion(next).content.image).toBe(`upload:${"d".repeat(64)}`);
  });

  it("rejects another owner and a submission still awaiting its first review", () => {
    const source = returnedSubmission();
    const version = currentVersion(source);
    const content = { ...version.content, headline: "Revised copy" };
    expect(() =>
      resubmitCreativeRevision(source, content, version.scope, "Maya Chen"),
    ).toThrow("creative owner");
    expect(() =>
      resubmitCreativeRevision(
        { ...source, status: "Needs review" },
        content,
        version.scope,
        source.owner,
      ),
    ).toThrow("not awaiting");
  });

  it("rejects an unchanged resubmission regardless of object property order", () => {
    const source = returnedSubmission();
    const version = currentVersion(source);
    const reordered = { image: version.content.image, ...version.content };
    expect(() =>
      resubmitCreativeRevision(
        source,
        reordered,
        { ...version.scope },
        source.owner,
      ),
    ).toThrow("Change the asset");
    expect(() =>
      resubmitCreativeRevision(
        source,
        { headline: "", body: "", disclosure: "", cta: "", art: "card" },
        version.scope,
        source.owner,
      ),
    ).toThrow("revised image or creative copy");
  });
});

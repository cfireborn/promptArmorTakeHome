import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imageReference,
  isUploadedImage,
  readUploadedImage,
  storeUploadedImage,
  validateImageFile,
} from "./uploads";
import { checkSubmission } from "./checker";
import { currentVersion, saveDraft } from "./domain";
import { matchesSlackSnapshot } from "./slack";
import { seedSubmissions } from "./seed";

afterEach(() => vi.unstubAllGlobals());

describe("uploaded image snapshots", () => {
  it("binds the normalized bytes to a stable reference and rejects a different image in a Slack snapshot", async () => {
    const first = await imageReference("data:image/jpeg;base64,YWJj");
    const second = await imageReference("data:image/jpeg;base64,ZGVm");
    expect(first).toBe(await imageReference("data:image/jpeg;base64,YWJj"));
    expect(first).not.toBe(second);
    expect(isUploadedImage(first)).toBe(true);
    const item = seedSubmissions()[0];
    const version = currentVersion(item);
    const uploaded = saveDraft(
      item,
      { ...version.content, image: first },
      version.scope,
      "New image",
    );
    expect(
      matchesSlackSnapshot(uploaded, {
        submissionId: uploaded.id,
        assetVersion: {
          ...currentVersion(uploaded),
          content: { ...currentVersion(uploaded).content, image: second },
        },
      }),
    ).toBe(false);
  });

  it("never automatically clears or offers fixture generation for an unregistered uploaded image", async () => {
    const item = seedSubmissions()[0];
    const version = currentVersion(item);
    const uploaded = saveDraft(
      item,
      {
        ...version.content,
        image: await imageReference("image"),
        palette: "brand",
      },
      version.scope,
      "Uploaded",
    );
    const report = checkSubmission(uploaded);
    expect(report.canApprove).toBe(false);
    expect(report.canSuggestFix).toBe(false);
    expect(
      report.checks.find((check) => check.id === "brand-palette"),
    ).toMatchObject({
      status: "needs-review",
      evidence: expect.stringContaining("manual review"),
    });
  });

  it("validates MIME, file signature, and bounded input size", () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(() =>
      validateImageFile({ type: "image/png", size: 100 }, png),
    ).not.toThrow();
    expect(() =>
      validateImageFile(
        { type: "image/jpeg", size: 100 },
        new Uint8Array([255, 216, 255]),
      ),
    ).not.toThrow();
    expect(() =>
      validateImageFile({ type: "image/svg+xml", size: 100 }, png),
    ).toThrow("PNG or JPEG");
    expect(() =>
      validateImageFile({ type: "image/jpeg", size: 100 }, png),
    ).toThrow("valid PNG or JPEG");
    expect(() =>
      validateImageFile({ type: "image/png", size: 9 * 1024 * 1024 }, png),
    ).toThrow("8 MB");
  });

  it("preserves immutable cached bytes and handles missing or unavailable storage", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const dataUrl = "data:image/jpeg;base64,YWJj";
    const reference = await imageReference(dataUrl);
    expect(readUploadedImage(reference)).toBeNull();
    storeUploadedImage({ reference, dataUrl, name: "ad.jpg" });
    expect(readUploadedImage(reference)).toBe(dataUrl);
    expect(() =>
      storeUploadedImage({
        reference,
        dataUrl: "data:image/jpeg;base64,ZGVm",
        name: "changed.jpg",
      }),
    ).toThrow("could not save");
    expect(readUploadedImage(reference)).toBe(dataUrl);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("Denied");
      },
      setItem: () => {
        throw new Error("Quota");
      },
    });
    expect(readUploadedImage(reference)).toBeNull();
    expect(() =>
      storeUploadedImage({ reference, dataUrl, name: "ad.jpg" }),
    ).toThrow("could not save");
  });
});

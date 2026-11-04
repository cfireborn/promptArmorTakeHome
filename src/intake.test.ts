import { describe, expect, it } from "vitest";
import { formatCreativeCopy, parseCreativeCopy } from "./intake";

describe("single-field creative copy", () => {
  it("preserves labeled template copy through the combined editor", () => {
    const source = {
      headline: "A little breathing room.",
      body: "Explore options.\nChoose what fits.",
      disclosure: "Subject to credit approval.",
      cta: "Explore your options",
    };
    expect(parseCreativeCopy(formatCreativeCopy(source))).toEqual(source);
  });
  it("retains arbitrary OCR lines without inventing a CTA or disclosure", () => {
    const source =
      "ClearPath\n\nNew possibilities\nTerms apply.\nExtra artwork text";
    const parsed = parseCreativeCopy(source);
    expect(parsed).toEqual({
      headline: "ClearPath",
      body: "New possibilities\nTerms apply.\nExtra artwork text",
      disclosure: "",
      cta: "",
    });
    expect(Object.values(parsed).join(" ")).toContain("Extra artwork text");
  });
});

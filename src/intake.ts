import type { AssetContent } from "./domain";

const sections = {
  headline: "headline",
  "body copy": "body",
  body: "body",
  "call to action": "cta",
  "call to action (visible in image)": "cta",
  cta: "cta",
  disclosure: "disclosure",
} as const;
type CopyFields = Pick<
  AssetContent,
  "headline" | "body" | "cta" | "disclosure"
>;

export function formatCreativeCopy(content: CopyFields): string {
  return (
    [
      ["Headline", content.headline],
      ["Body copy", content.body],
      ["Call to action", content.cta],
      ["Disclosure", content.disclosure],
    ] as const
  )
    .filter(([, text]) => text.trim())
    .map(([label, text]) => `${label}\n${text}`)
    .join("\n\n");
}

// Existing layouts remain structured internally. Unlabeled OCR is retained in
// order, not guessed into disclosure/CTA fields or treated as verified evidence.
export function parseCreativeCopy(text: string): CopyFields {
  const copy: CopyFields = { headline: "", body: "", cta: "", disclosure: "" };
  const lines = text.replace(/\r\n?/g, "\n").trim().split("\n");
  const first = lines[0]?.trim().replace(/:$/, "").toLowerCase();
  if (first !== "headline") {
    copy.headline = lines.shift() || "";
    copy.body = lines.join("\n").trim();
    return copy;
  }
  let field: keyof CopyFields = "headline";
  for (const line of lines) {
    const key = line.trim().replace(/:$/, "").toLowerCase();
    if (Object.hasOwn(sections, key))
      field = sections[key as keyof typeof sections];
    else copy[field] += `${copy[field] ? "\n" : ""}${line}`;
  }
  for (const field of Object.keys(copy) as (keyof CopyFields)[])
    copy[field] = copy[field].trim();
  return copy;
}

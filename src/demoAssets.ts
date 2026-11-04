import {
  currentVersion,
  type AssetContent,
  type Scope,
  type Submission,
} from "./domain";
import { fixes, seedSubmissions } from "./seed";
import type { UploadedImage } from "./uploads";

export type DemoAsset = "card" | "loan" | "mortgage";

// These identify the exact supplied PNG files, before browser resizing. Names,
// extracted text, or a similar-looking image cannot enroll a new template.
const sourceHashes: Record<string, DemoAsset> = {
  a56897bb15e7c9cd0b544f4ae090cfaf5ee8263e13b1a97511fa4ae162c7b19d: "card",
  c6086ac5378886c1846f7edba561809f3306ca54ce70953830f310f81f34ddb6: "loan",
  "628cec6905ff68c0be55e721581e76328765781d751601082f5ebb3d3efb098e":
    "mortgage",
};

export function demoAssetForSourceHash(hash: string): DemoAsset | undefined {
  return Object.hasOwn(sourceHashes, hash) ? sourceHashes[hash] : undefined;
}

const seeds = seedSubmissions();
const samples = {
  card: seeds.find((item) => item.id === "CP-1040")!,
  loan: seeds.find((item) => item.id === "CP-1042")!,
  mortgage: seeds.find((item) => item.id === "CP-1041")!,
};

function originalContent(sample: DemoAsset): AssetContent {
  const content = samples[sample].versions[0].content;
  return sample === "mortgage"
    ? {
        ...content,
        body: `${content.body}\n\nClearPath FINANCIAL; Homewise · California`,
      }
    : content;
}

function fixedContent(sample: DemoAsset): AssetContent | null {
  return sample === "card"
    ? null
    : { ...fixes[sample].content, image: `creative/${sample}-fixed.png` };
}

function sameCopy(left: AssetContent, right: AssetContent): boolean {
  return (["headline", "body", "disclosure", "cta", "art"] as const).every(
    (field) => left[field] === right[field],
  );
}

function sameScope(left: Scope, right: Scope): boolean {
  return (["product", "audience", "channel", "placement"] as const).every(
    (field) => left[field] === right[field],
  );
}

export function attachRegisteredDemoAsset(
  item: Submission,
  upload: UploadedImage | null,
): Submission {
  const sample = upload?.knownSample;
  if (!sample || !Object.hasOwn(samples, sample)) return item;
  const version = currentVersion(item);
  const registered = samples[sample];
  const original = originalContent(sample);
  if (
    item.versions.length !== 1 ||
    version.content.image !== upload.reference ||
    !sameCopy(version.content, original) ||
    !sameScope(version.scope, registered.versions[0].scope)
  )
    return item;
  return {
    ...item,
    registeredUpload: { sample, image: upload.reference },
    fixture: registered.fixture,
    reviewEvidence: registered.reviewEvidence
      ? structuredClone(registered.reviewEvidence)
      : undefined,
    versions: [
      {
        ...version,
        content: { ...version.content, palette: original.palette },
        note: `${version.note} Exact source file, submitted copy, and intended use match the registered ${sample} example.`,
      },
    ],
  };
}

// A source registration remains useful for its one prepared replacement. Both
// the immutable original and current copy/image/scope must still match.
export function registeredDemoAsset(item: Submission): DemoAsset | null {
  const registration = item.registeredUpload;
  if (!registration || !Object.hasOwn(samples, registration.sample))
    return null;
  const sample = registration.sample;
  const expected = originalContent(sample);
  const scope = samples[sample].versions[0].scope;
  const original = item.versions[0];
  if (
    !original ||
    !/^upload:[a-f0-9]{64}$/.test(registration.image) ||
    original.content.image !== registration.image ||
    !sameCopy(original.content, expected) ||
    original.content.palette !== expected.palette ||
    !sameScope(original.scope, scope)
  )
    return null;
  const version = currentVersion(item);
  if (!sameScope(version.scope, scope)) return null;
  if (
    version.content.image === registration.image &&
    sameCopy(version.content, expected) &&
    version.content.palette === expected.palette
  )
    return sample;
  const fixed = fixedContent(sample);
  return fixed &&
    version.content.image === fixed.image &&
    sameCopy(version.content, fixed) &&
    version.content.palette === fixed.palette
    ? sample
    : null;
}

export function preparedUploadFix(item: Submission): AssetContent | null {
  const sample = registeredDemoAsset(item);
  return sample ? fixedContent(sample) : null;
}

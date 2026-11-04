import { demoAssetForSourceHash, type DemoAsset } from "./demoAssets";

const PREFIX = "clearpath-upload:";
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_STORED_BYTES = 300 * 1024;
export type UploadedImage = {
  reference: string;
  dataUrl: string;
  name: string;
  knownSample?: DemoAsset;
};

export function isUploadedImage(reference?: string): boolean {
  return /^upload:[a-f0-9]{64}$/.test(reference || "");
}

export function validateImageFile(
  file: Pick<File, "type" | "size">,
  bytes: Uint8Array,
) {
  if (!["image/png", "image/jpeg"].includes(file.type))
    throw new Error("Choose a PNG or JPEG image.");
  if (!file.size || file.size > MAX_INPUT_BYTES)
    throw new Error("Choose an image smaller than 8 MB.");
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (value, index) => bytes[index] === value,
  );
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!(file.type === "image/png" ? png : jpeg))
    throw new Error("This file does not contain a valid PNG or JPEG image.");
}

export async function imageReference(dataUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(dataUrl);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `upload:${[...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function readUploadedImage(reference?: string): string | null {
  if (!isUploadedImage(reference)) return null;
  try {
    const data = localStorage.getItem(`${PREFIX}${reference!.slice(7)}`);
    return data &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(data) &&
      data.length <= (MAX_STORED_BYTES * 4) / 3 + 30
      ? data
      : null;
  } catch {
    return null;
  }
}

export function storeUploadedImage(image: UploadedImage): void {
  if (!isUploadedImage(image.reference))
    throw new Error("The uploaded image reference is invalid.");
  try {
    const key = `${PREFIX}${image.reference.slice(7)}`;
    const existing = localStorage.getItem(key);
    if (existing && existing !== image.dataUrl)
      throw new Error("Image reference conflict");
    localStorage.setItem(key, image.dataUrl);
    if (readUploadedImage(image.reference) !== image.dataUrl)
      throw new Error("Image could not be stored");
  } catch {
    throw new Error(
      "This browser could not save the image. Free some browser storage or submit without an image.",
    );
  }
}

// Corrections preserve the exact reviewed working canvas. Unlike intake, this
// path never reduces dimensions to meet storage limits or enlarges model pixels.
export async function prepareCorrectedImage(
  generatedDataUrl: string,
  reviewedDataUrl: string,
): Promise<UploadedImage> {
  const [generated, reviewed] = [new Image(), new Image()];
  generated.src = generatedDataUrl;
  reviewed.src = reviewedDataUrl;
  try {
    await Promise.all([generated.decode(), reviewed.decode()]);
  } catch {
    throw new Error(
      "The corrected artwork could not be decoded. The original is unchanged.",
    );
  }
  for (const image of [generated, reviewed]) {
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 2048 ||
      image.naturalHeight > 2048 ||
      image.naturalWidth * image.naturalHeight > 4_000_000
    ) {
      throw new Error(
        "The corrected artwork has unsupported dimensions. Return comments to creative to revise the original layout.",
      );
    }
  }
  const scale = Math.min(
    1,
    reviewed.naturalWidth / generated.naturalWidth,
    reviewed.naturalHeight / generated.naturalHeight,
  );
  const width = generated.naturalWidth * scale;
  const height = generated.naturalHeight * scale;
  if (
    (width * height) / (reviewed.naturalWidth * reviewed.naturalHeight) <
    0.6
  ) {
    throw new Error(
      "The generated image cannot fill enough of the original canvas without cropping or enlargement. The original is unchanged; return comments to creative to revise its layout.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = reviewed.naturalWidth;
  canvas.height = reviewed.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("This browser cannot prepare the corrected artwork.");
  context.fillStyle = "#f6f4eb";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // One shared scale preserves proportions; fractional coordinates avoid
  // stretching odd-sized inputs by rounding width and height independently.
  context.drawImage(
    generated,
    (canvas.width - width) / 2,
    (canvas.height - height) / 2,
    width,
    height,
  );
  for (const quality of [0.94, 0.9, 0.86, 0.82]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (
      ((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4 <=
      MAX_STORED_BYTES
    ) {
      return {
        reference: await imageReference(dataUrl),
        dataUrl,
        name: "ai-correction.jpg",
      };
    }
  }
  throw new Error(
    "This correction is too detailed to save at the original dimensions within the demo's storage limit. The original is unchanged; return comments to creative.",
  );
}

export async function prepareUploadedImage(file: File): Promise<UploadedImage> {
  validateImageFile(file, new Uint8Array(await file.slice(0, 8).arrayBuffer()));
  const sourceHash = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  const knownSample = demoAssetForSourceHash(
    [...new Uint8Array(sourceHash)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(""),
  );
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    ) {
      throw new Error("Use an image with fewer than 40 million pixels.");
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare an image.");
    let scale = Math.min(
      1,
      1200 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    let dataUrl = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      dataUrl = canvas.toDataURL("image/jpeg", 0.88);
      if (
        ((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4 <=
        MAX_STORED_BYTES
      )
        break;
      scale *= 0.75;
    }
    if (
      ((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4 >
      MAX_STORED_BYTES
    )
      throw new Error(
        "This image is too detailed for the demo. Choose a smaller image.",
      );
    return {
      reference: await imageReference(dataUrl),
      dataUrl,
      name: file.name,
      ...(knownSample ? { knownSample } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.name !== "EncodingError") throw error;
    throw new Error(
      "The image could not be decoded. Choose a valid PNG or JPEG.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

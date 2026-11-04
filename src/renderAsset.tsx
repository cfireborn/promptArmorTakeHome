import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import { Asset } from "./components/Asset";
import type { AssetContent } from "./domain";

const WIDTH = 345;
const MAX_IMAGE_BYTES = 500 * 1024;
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function verifyPreview(
  dataUrl: string,
  height: number,
  pixelRatio: number,
) {
  if (!dataUrl.startsWith("data:image/png;base64,"))
    throw new Error(
      "The creative preview could not be rendered. Nothing was sent.",
    );
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes =
    (encoded.length * 3) / 4 -
    (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES)
    throw new Error(
      "The creative preview exceeds the demo’s 500 KB limit. Nothing was sent.",
    );
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  if (
    image.naturalWidth !== WIDTH * pixelRatio ||
    image.naturalHeight < height * pixelRatio - 2
  ) {
    throw new Error(
      "The creative preview was incomplete. Nothing was sent; try again.",
    );
  }
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error(
      "This browser could not verify the creative preview. Nothing was sent.",
    );
  context.drawImage(image, 0, 0, 32, 32);
  const pixels = context.getImageData(0, 0, 32, 32).data;
  const colors = new Set<string>();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] > 0)
      colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
  }
  if (colors.size < 4)
    throw new Error(
      "The creative preview appears blank. Nothing was sent; try again.",
    );
}

export async function renderAsset(content: AssetContent): Promise<string> {
  const host = document.createElement("div");
  host.className = "slack-render-root";
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  Object.assign(host.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${WIDTH}px`,
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<Asset content={{ ...content }} />));
    const asset = host.querySelector<HTMLElement>(".asset");
    if (!asset)
      throw new Error(
        "The creative preview could not be mounted. Nothing was sent.",
      );
    if (asset.querySelector("[data-asset-error]"))
      throw new Error(
        "The uploaded image is unavailable in this browser. Nothing was sent.",
      );
    Object.assign(asset.style, {
      width: `${WIDTH}px`,
      maxWidth: `${WIDTH}px`,
      margin: "0",
      animation: "none",
      transition: "none",
    });
    // Read layout before waiting so the browser discovers the locally bundled fonts in this asset.
    asset.getBoundingClientRect();
    await document.fonts.ready;
    await Promise.all(
      [...asset.querySelectorAll("img")].map((image) => image.decode()),
    );
    const raster = asset.classList.contains("asset-image")
      ? asset.querySelector("img")
      : null;
    if (raster) {
      // Safari can drop embedded images during an SVG foreignObject round-trip.
      // The reviewed creative is already a raster: export its decoded pixels directly.
      if (!raster.naturalWidth || !raster.naturalHeight)
        throw new Error(
          "The creative preview has no usable image. Nothing was sent.",
        );
      const height = Math.max(
        1,
        Math.round((WIDTH * raster.naturalHeight) / raster.naturalWidth),
      );
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error(
          "This browser could not render the creative preview. Nothing was sent.",
        );
      context.drawImage(raster, 0, 0, WIDTH, height);
      const dataUrl = canvas.toDataURL("image/png");
      await verifyPreview(dataUrl, height, 1);
      return dataUrl;
    }
    await nextFrame();
    await nextFrame();
    const height = Math.ceil(asset.getBoundingClientRect().height);
    if (height < 100)
      throw new Error(
        "The creative preview has no usable layout. Nothing was sent.",
      );
    const pixelRatio = content.image ? 1 : 2;
    const dataUrl = await toPng(asset, {
      width: WIDTH,
      height,
      pixelRatio,
      skipAutoScale: true,
      preferredFontFormat: "woff2",
      // WebKit's corner-shape shorthands lose border radii on SVG round-trip.
      includeStyleProperties: Array.from(
        getComputedStyle(document.documentElement),
      ).filter((name) => !name.startsWith("corner-")),
    });
    await verifyPreview(dataUrl, height, pixelRatio);
    return dataUrl;
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("Nothing was sent"))
      throw cause;
    throw new Error(
      "The creative preview could not be rendered. Nothing was sent; try again in this browser.",
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

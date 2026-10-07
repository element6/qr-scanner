/**
 * QR export — data-URL/name logic (pure, testable) plus the two thin browser
 * boundaries that tests deliberately do not exercise.
 *
 * Layer split, because jsdom has no working canvas and no `URL.createObjectURL`:
 *
 * - Pure: `svgDataUrlToBlob`, `PNG_FILENAME`, `SVG_FILENAME`, `PNG_SIZE`.
 * - Browser boundary: `rasterizeSvgToPng` (Image + `<canvas>`) and
 *   `downloadBlob` (object URL + anchor click). Both are small, both report
 *   failure by returning a value rather than throwing, and neither is faked in
 *   tests — a stub canvas would only assert our own stub.
 *
 * No new dependency: rasterisation goes through the DOM the app already has.
 */

import { SVG_DATA_URL_PREFIX } from "./qrcode";

/** Side of the square PNG we export, in pixels. */
export const PNG_SIZE = 1024;

/**
 * How long a rasterising export waits for the SVG to load before giving up.
 *
 * Bounded on purpose: if the load event never fires (an environment that
 * neither loads nor rejects the image), the promise would otherwise stay
 * pending forever and leave the Save image button disabled with no message.
 */
const RASTERIZE_TIMEOUT_MS = 10_000;

/** Filename offered for the PNG export. */
export const PNG_FILENAME = "qr-code.png";

/** Filename offered for the SVG export. */
export const SVG_FILENAME = "qr-code.svg";

/**
 * The prefix this module understands, restated locally so the export code
 * never has to import the encoder. `SVG_DATA_URL_PREFIX_SATISFIES_ENCODER`
 * below fails `tsc` if it ever drifts from `qrcode.ts` — a reworded upstream
 * prefix is a compile error, not a silent runtime "that is not an SVG".
 */
const SVG_PREFIX = "data:image/svg+xml;base64,";
const SVG_DATA_URL_PREFIX_SATISFIES_ENCODER: typeof SVG_PREFIX =
  SVG_DATA_URL_PREFIX satisfies typeof SVG_PREFIX;
void SVG_DATA_URL_PREFIX_SATISFIES_ENCODER;

/** Error message thrown when fed something that is not our SVG data URL. */
const NOT_SVG_MESSAGE = "Expected a base64 SVG data URL";

/**
 * Decode a base64 SVG data URL into an `image/svg+xml` Blob.
 *
 * The payload is decoded whole and handed to the Blob as-is — the SVG markup
 * is never string-split, re-quoted or re-encoded. `btoa`-produced base64 is
 * ASCII-only, so the binary string from `atob` maps 1:1 onto bytes.
 *
 * @throws {Error} when `dataUrl` does not start with the encoder's prefix.
 */
export function svgDataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith(SVG_PREFIX)) {
    throw new Error(NOT_SVG_MESSAGE);
  }

  const base64 = dataUrl.slice(SVG_PREFIX.length);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: "image/svg+xml" });
}

/**
 * Build the `<img>` used to load the SVG for rasterising, kept apart from the
 * canvas work so a failure to even create the element is still contained.
 */
function loadSvgImage(svgDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The SVG could not be loaded"));
    image.src = svgDataUrl;
  });
}

/** Options for {@link rasterizeSvgToPng}. */
export interface RasterizeOptions {
  /** Side length of the square output, in pixels. */
  size?: number;
  /** Upper bound on the SVG load, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Rasterise the app's SVG data URL to a square PNG Blob.
 *
 * `size` square with an opaque white background painted first: a transparent
 * PNG of dark modules on nothing is unreadable in many messaging apps, and the
 * white also matches the quiet zone the encoder already draws. The image is
 * drawn at its natural aspect ratio inside the square (the encoder's SVG is
 * itself square, so this fills it).
 *
 * Returns `null` — never throws — when there is no usable canvas context, the
 * image will not load, the load never completes within `timeoutMs`, or
 * `toBlob` yields nothing. The caller turns that into a notification telling
 * the user to use Save SVG instead.
 */
export async function rasterizeSvgToPng(
  svgDataUrl: string,
  options: RasterizeOptions = {}
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;

  const { size = PNG_SIZE, timeoutMs = RASTERIZE_TIMEOUT_MS } = options;

  try {
    const image = await Promise.race([
      loadSvgImage(svgDataUrl),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("The SVG did not load in time")),
          timeoutMs
        );
      }),
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  } catch {
    return null;
  }
}

/**
 * Trigger a download for `blob` under `filename`.
 *
 * The object URL is created and revoked inside this synchronous call, so no
 * URL can outlive the click — there is nothing for an unmount to leak.
 * `URL.createObjectURL` is absent in jsdom; tests stub it.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

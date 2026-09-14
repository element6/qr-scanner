/**
 * Decode a matrix code from an image file: file picker, drag-and-drop, clipboard
 * paste. Specs: specs/scan-image-from-file.md §7.3 (interfaces), §7.7 (copy).
 *
 * Pure logic (validateImageFile / toOutcome / describeOutcome) is separated from
 * the one impure decoder shell (`scanImageFile`) so the suite runs under jsdom
 * without wasm and without React testing library (vitest include is *.test.ts).
 *
 * Import the ponyfill, not the root entry: the root module installs a global
 * `window.BarcodeDetector` polyfill, which this app must not do (spec §7.1).
 */
import { BarcodeDetector, type BarcodeDetectorOptions } from "barcode-detector/ponyfill";

/** R9: reject before decode so a huge file can never lock the tab. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** R8: longest side fed to the detector after downscaling. */
const MAX_SIDE = 2048;

/** R8: above this many SOURCE pixels, skip the full-resolution retry. */
const MAX_RETRY_PIXELS = 40_000_000;

/** Matrix codes only (QR, DataMatrix, Aztec, PDF417…) — spec R10 / AC1.
 *  `matrix_codes` is the group alias; the ponyfill rejects mixing it with a
 *  member of the group, so it is the sole entry. */
const DETECTOR_OPTIONS = { formats: ["matrix_codes"] } as unknown as BarcodeDetectorOptions;

/** Extensions we trust when `File.type` is empty (common on drop transfers). */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif)$/i;

export type ScanFailure =
  | { ok: false; kind: "not-image"; name: string }
  | { ok: false; kind: "too-large"; name: string; bytes: number }
  | { ok: false; kind: "empty"; name: string }
  | { ok: false; kind: "undecodable"; name: string }
  | { ok: false; kind: "not-found"; name: string }
  | { ok: false; kind: "decode-failed"; name: string };

/** Clipboard outcomes decided before any decode runs (R4, AC4). */
export type ClipboardFailure =
  | { kind: "clipboard-denied" }
  | { kind: "clipboard-unavailable" }
  | { kind: "clipboard-empty" };

export type ScanSuccess = { ok: true; value: string; count: number };

export type ScanOutcome = ScanSuccess | ScanFailure;

/** Decode inputs accepted by the ponyfill's `detect` (widened by our injectable). */
type DetectSource = ImageBitmap | File;
export type Detector = {
  detect: (source: DetectSource) => Promise<Array<{ rawValue: string }>>;
};
/**
 * §7.6/AC9 seam: a *constructor*, not a `detect` — so a test can make
 * construction throw (wasm never loaded → `decode-failed`) independently of
 * `detect()` throwing (the engine choked on this image → `undecodable`).
 */
export type DetectorFactory = () => Detector | Promise<Detector>;

/** R1/AC12: first non-empty rawValue wins; `count` is everything the decoder saw. */
export function toOutcome(
  results: Array<{ rawValue: string }>,
  name: string
): ScanOutcome {
  for (const r of results) {
    if (r.rawValue) {
      return { ok: true, value: r.rawValue, count: results.length };
    }
  }
  return { ok: false, kind: "not-found", name };
}

/**
 * R9 gate — pure and always first: empty, then size, then image-ness, all
 * before any bytes touch the decoder. Returns null for "ok to decode" and also
 * for `null`/`undefined` (a dismissed file dialog is a silent cancel, AC2).
 */
export function validateImageFile(
  file: File | null | undefined
): ScanFailure | null {
  if (!file) return null;
  if (file.size === 0) return { ok: false, kind: "empty", name: file.name };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, kind: "too-large", name: file.name, bytes: file.size };
  }
  if (!file.type.startsWith("image/") && !IMAGE_EXT_RE.test(file.name)) {
    return { ok: false, kind: "not-image", name: file.name };
  }
  return null;
}

/**
 * §7.7 normative copy, one exhaustive switch so a new kind is a compile error.
 * Strings are fixed (AC12 pins them); the file name is carried on the outcome
 * for logging but never interpolated — R7 keeps announcements short.
 */
export function describeOutcome(o: ScanOutcome | ClipboardFailure): string {
  if (!("ok" in o)) {
    switch (o.kind) {
      case "clipboard-denied":
        return "Clipboard blocked — allow it in browser settings, or choose a file";
      case "clipboard-unavailable":
        return "Clipboard not available here — choose a file instead";
      case "clipboard-empty":
        return "No image on the clipboard";
    }
  }
  if (o.ok) return `Scanned ${o.value}`;
  switch (o.kind) {
    case "not-image":
      return "That file isn't an image";
    case "too-large":
      return "Image is too large (20 MB max)";
    case "empty":
      return "That file is empty";
    case "undecodable":
      return "Couldn't read that image — try a PNG or JPEG";
    case "not-found":
      return "No code found in this image";
    case "decode-failed":
      return "Scanner failed to start — reload the page";
  }
}

/**
 * R3a: paste-event path — `clipboardData.files[0]` when it is an image, otherwise
 * fall back to the first image item (WebKit screenshots); text-only paste → null
 * so the handler can return silently (AC4).
 */
export function clipboardImageFromDataTransfer(
  dt: DataTransfer | null
): File | null {
  const direct = dt?.files?.[0] ?? null;
  if (direct && direct.type.startsWith("image/")) return direct;
  const items = dt?.items;
  if (!items) return null;
  // DataTransferItemList is ArrayLike but not iterable in lib.dom — index loop.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** R3b: Paste-button path — `navigator.clipboard.read()` → first `image/*`
 *  item → Blob. Each rejection class is a `ClipboardFailure` (AC11).
 *  App intentionally *consumes* these with describeOutcome; the helper never
 *  throws.
 *
 *  Resilient: a single item/type that rejects (a transient `getType` failure,
 *  an unsupported mime, a denied sub-permission) does NOT abort the whole
 *  read — iterate every item and every image type, take the first successful
 *  blob, and only fail after exhausting the clipboard (scanImage.ts:168-180). */
export async function readClipboardImage(): Promise<File | ClipboardFailure> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.read !== "function"
  ) {
    return { kind: "clipboard-unavailable" };
  }
  let items: ClipboardItem[];
  try {
    items = await (navigator.clipboard as Clipboard).read();
  } catch (e) {
    const denied =
      e instanceof DOMException && (e as DOMException).name === "NotAllowedError";
    return { kind: denied ? "clipboard-denied" : "clipboard-unavailable" };
  }
  let lastFailure: ClipboardFailure | null = null;
  for (const item of items) {
    // Try every image type on this item, not just the first — a multi-mime
    // clipboard may carry the same image under several encodings.
    for (const type of item.types) {
      if (!type.startsWith("image/")) continue;
      try {
        const blob = await item.getType(type);
        if (blob) return new File([blob], "pasted-image", { type });
      } catch (e) {
        const denied =
          e instanceof DOMException &&
          (e as DOMException).name === "NotAllowedError";
        lastFailure = {
          kind: denied ? "clipboard-denied" : "clipboard-unavailable",
        };
      }
    }
  }
  return lastFailure ?? { kind: "clipboard-empty" };
}

/** Lazily constructed, reused detector — never recreated per scan (§7.3). */
let cachedDetector: BarcodeDetector | null = null;
function getDetector(): BarcodeDetector {
  cachedDetector ??= new BarcodeDetector(DETECTOR_OPTIONS);
  return cachedDetector;
}

/**
 * The one impure step. §7.4 flow: validate → preprocess (EXIF + ≤2048px) →
 * detect → on not-found retry once at full res unless the source exceeds the
 * pixel budget. Every bitmap handle is closed on every path; throws are
 * classified, never rethrown. `makeDetector` is injectable for tests (§7.6).
 */
export async function scanImageFile(
  file: File,
  makeDetector: DetectorFactory = getDetector
): Promise<ScanOutcome> {
  const invalid = validateImageFile(file);
  if (invalid) return invalid;

  let source: DetectSource = file;
  let isBitmap = false; // true only while `source` owns an unclosed bitmap
  let sourcePixels = 0;
  // `construct` = the detector never came up (wasm load/init). `preprocess` =
  // the browser cannot rasterize this file. `decode` = `detect()` threw.
  let phase: "construct" | "preprocess" | "decode" = "construct";

  try {
    const detector = await makeDetector();
    phase = "preprocess";

    if (typeof createImageBitmap === "function") {
      // One native decode applies EXIF deterministically; only when the source
      // is larger than MAX_SIDE do we downscale it again (native resize is
      // cheap; the wasm detector run is what must stay bounded).
      const natural = await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
      sourcePixels = natural.width * natural.height;
      const longest = Math.max(natural.width, natural.height);
      if (longest > MAX_SIDE) {
        const scale = MAX_SIDE / longest;
        try {
          source = await createImageBitmap(natural, {
            resizeWidth: Math.max(1, Math.round(natural.width * scale)),
            resizeHeight: Math.max(1, Math.round(natural.height * scale)),
            resizeQuality: "high",
          } as ImageBitmapOptions);
        } finally {
          natural.close();
        }
      } else {
        source = natural;
      }
      isBitmap = true;
    }
    phase = "decode";

    const results = await detector.detect(source);
    // Skip the retry when: a value was found (no need), no downscale happened
    // (identical re-decode is waste), or the source is past the pixel budget
    // (wasm time guard, §7.4).
    if (results.length > 0 || !isBitmap || sourcePixels > MAX_RETRY_PIXELS) {
      return toOutcome(results, file.name);
    }
    (source as ImageBitmap).close();
    isBitmap = false;
    const full = await detector.detect(file);
    return toOutcome(full, file.name);
  } catch (err) {
    // §7.6: construction throw = the engine never came up (`decode-failed`,
    // "reload the page"). Anything after that — the browser can't rasterize
    // the file, or `detect()` choked on it — is `undecodable`. Mirrors
    // handleError: log raw.
    console.error(`Image ${phase} failed:`, err);
    return {
      ok: false,
      kind: phase === "construct" ? "decode-failed" : "undecodable",
      name: file.name,
    };
  } finally {
    if (isBitmap) (source as ImageBitmap).close();
  }
}

/**
 * QR encoder wrapper — pure, no React, no DOM.
 *
 * Wraps the `qrcode` package's browser build (`toString` with `type: "svg"`).
 * The SVG markup is wrapped as a base64 data URL here so the component can
 * render it as an `<img src>` with zero XSS surface.
 */

import QRCode from "qrcode";

/** Error codes the encoder wrapper can return. */
export type QrErrorCode = "empty" | "too-long" | "encode-failed";

/** Result of an encode attempt. */
export interface QrEncodeResult {
  ok: boolean;
  dataUrl?: string;
  error?: QrErrorCode;
  message?: string;
  byteLength: number;
}

/** Error correction level used for every code this app emits. */
export const QR_ERROR_CORRECTION = "M" as const;

/** Byte-mode capacity at EC M — for messaging/readout only, never a hard gate. */
export const BYTE_MODE_MAX_BYTES = 2331;

/** Prefix every rendered code's `src` starts with. */
export const SVG_DATA_URL_PREFIX = "data:image/svg+xml;base64,";

/**
 * Exact capacity-error message thrown by `qrcode` v1.5.4 when no symbol
 * version can contain the payload (lib/core/qrcode.js, createSymbol).
 * Matched verbatim — a reference, not a heuristic — so a reworded upstream
 * error fails loudly instead of being silently misclassified.
 */
const QR_TOO_LONG_ERROR =
  "The amount of data is too big to be stored in a QR Code";

/**
 * UTF-8 byte length of a string. Uses TextEncoder, never string.length,
 * so multibyte/emoji payloads are measured correctly.
 */
export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/**
 * Encode text into a base64 SVG data URL.
 *
 * The encoder is the authority on capacity: `qrcode` picks the densest mode
 * itself (numeric 5,596 / alphanumeric 3,391 / byte 2,331 at EC M) and throws
 * when nothing fits. We map that throw to a user-facing "too-long" message
 * naming the byte-mode limit; anything else is "encode-failed".
 *
 * Empty input is a no-op: returns ok:true with no dataUrl, so the caller can
 * render a placeholder instead of a blank symbol.
 */
export async function encodeQrSvg(text: string): Promise<QrEncodeResult> {
  const byteLength = utf8ByteLength(text);

  if (text === "") {
    return { ok: true, byteLength };
  }

  let svg: string;
  try {
    svg = await QRCode.toString(text, {
      type: "svg",
      errorCorrectionLevel: QR_ERROR_CORRECTION,
      margin: 2,
    });
  } catch (err) {
    console.error("[qrcode] encode threw", err instanceof Error ? err.message : String(err));
    const isTooLong =
      err instanceof Error && err.message === QR_TOO_LONG_ERROR;
    const message = isTooLong
      ? `Text is too long for one QR code at EC level ${QR_ERROR_CORRECTION} ` +
        `(${BYTE_MODE_MAX_BYTES} bytes in byte mode). Shorten the text, or ` +
        `use purely numeric input (up to 5,596 characters).`
      : "Could not generate a QR code for this text.";
    const error: QrErrorCode = isTooLong ? "too-long" : "encode-failed";
    return { ok: false, error, message, byteLength };
  }

  // btoa only accepts Latin-1; the SVG output is pure ASCII (user bytes become
  // module coordinates), so this is safe and round-trips exactly.
  const dataUrl = SVG_DATA_URL_PREFIX + btoa(svg);
  return { ok: true, dataUrl, byteLength };
}
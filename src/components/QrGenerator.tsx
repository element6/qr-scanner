/**
 * Create panel: text area + byte readout + live QR preview + copy button.
 *
 * Owns no app state — text, the debounced encode result, and the change
 * callback all come from `useQrCode` in App.tsx, so the value survives tab
 * switches (this component unmounts when Scan is active).
 */

import { useRef } from "react";
import type { QrEncodeResult } from "../utils/qrcode";
import {
  BYTE_MODE_MAX_BYTES,
  QR_ERROR_CORRECTION,
} from "../utils/qrcode";

export interface QrGeneratorProps {
  text: string;
  result: QrEncodeResult | null;
  onChange: (value: string) => void;
  onCopy: (data: string) => void;
}

export function QrGenerator({
  text,
  result,
  onChange,
  onCopy,
}: QrGeneratorProps) {
  const byteLength = result?.byteLength ?? 0;
  const warningAboveLimit = byteLength > BYTE_MODE_MAX_BYTES;

  // Retain the last successful render so a failed encode keeps the previous
  // valid code on screen (spec §4.1 R5, §5, §8) while showing the warning.
  // Reset the retained render only when there is nothing to encode (empty
  // text), which also covers the ~150 ms debounce window in useQrCode.ts
  // where `result` is still the previous successful result after the user
  // clears the field. Clearing on `!result.ok` would destroy the R5 feature.
  const lastGood = useRef<{ url: string; alt: string } | null>(null);
  if (text === "") {
    lastGood.current = null;
  } else if (result?.ok && result.dataUrl) {
    lastGood.current = { url: result.dataUrl, alt: "QR code for: " + text };
  }
  const preview =
    text === ""
      ? null
      : result?.ok && result.dataUrl
        ? { url: result.dataUrl, alt: "QR code for: " + text }
        : lastGood.current;
  const errorCard =
    text !== "" && result && !result.ok ? (
      <div className="mx-auto max-w-sm text-center">
        <p className="text-sm font-semibold text-amber-700">
          Could not generate a code
        </p>
        <p className="mt-1 text-xs text-slate-500">{result.message}</p>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="qr-generator-input"
          className="block text-sm font-semibold text-slate-700 mb-1"
        >
          Text to encode
        </label>
        <textarea
          id="qr-generator-input"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter text to generate a QR code."
          rows={4}
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          <span className="font-semibold text-slate-700">
            {byteLength.toLocaleString()}
          </span>{" "}
          bytes
        </span>
        {warningAboveLimit && (
          <span className="text-amber-600">
            Above the {BYTE_MODE_MAX_BYTES.toLocaleString()}-byte soft limit
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {preview ? (
          <div className="flex flex-col items-center gap-2">
            <img
              src={preview.url}
              alt={preview.alt}
              className="mx-auto block w-full max-w-[320px] h-auto"
            />
            {errorCard}
          </div>
        ) : errorCard ? (
          errorCard
        ) : text === "" ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Enter text to generate a QR code.
          </p>
        ) : (
          <p className="py-6 text-center text-xs text-slate-400">
            Generating…
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onCopy(text)}
        disabled={!text}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Copy text
      </button>

      <p className="text-xs text-slate-400">
        Codes use error correction level {QR_ERROR_CORRECTION}. Numeric input
        fits up to 5,596 characters; the byte readout is a soft heads-up only.
      </p>
    </div>
  );
}
/**
 * Create panel: text area + byte readout + live QR preview + export actions.
 *
 * Owns no app state — text, the debounced encode result, and the change
 * callback all come from `useQrCode` in App.tsx, so the value survives tab
 * switches (this component unmounts when Scan is active).
 */

import { useRef, useState } from "react";
import type { QrEncodeResult } from "../utils/qrcode";
import { BYTE_MODE_MAX_BYTES } from "../utils/qrcode";
import {
  PNG_FILENAME,
  SVG_FILENAME,
  downloadBlob,
  rasterizeSvgToPng,
  svgDataUrlToBlob,
} from "../utils/qrExport";

/** Id of the size-limit help text the `?` disclosure controls. */
const SIZE_HELP_ID = "qr-generator-size-help";

/** Shown when rasterising fails; the SVG path is the documented fallback. */
const PNG_FAILED_MESSAGE = "Could not save the image. Use Save SVG instead.";

/** Shown when the SVG could not be downloaded either. */
const SVG_FAILED_MESSAGE = "Could not save the SVG file.";

export interface QrGeneratorProps {
  text: string;
  result: QrEncodeResult | null;
  onChange: (value: string) => void;
  onCopy: (data: string) => void;
  /**
   * Surface a message through the app's single toast surface (App.tsx owns
   * `Notification`), so a failed download is announced like every other
   * failure instead of inventing a second error treatment.
   */
  onNotify: (message: string, tone: "info" | "error") => void;
  /**
   * Rasteriser used by Save image. Injectable so the failure branch can be
   * exercised without a real canvas — the production default is the only
   * value App.tsx ever passes.
   */
  rasterize?: (svgDataUrl: string) => Promise<Blob | null>;
}

export function QrGenerator({
  text,
  result,
  onChange,
  onCopy,
  onNotify,
  rasterize = rasterizeSvgToPng,
}: QrGeneratorProps) {
  const byteLength = result?.byteLength ?? 0;
  const warningAboveLimit = byteLength > BYTE_MODE_MAX_BYTES;
  const [sizeHelpOpen, setSizeHelpOpen] = useState(false);
  /** True only while a rasterising export is in flight. */
  const [savingPng, setSavingPng] = useState(false);

  // Retain the last successful render so a failed encode keeps the previous
  // valid code on screen (spec §4.1 R5, §5, §8) while showing the warning.
  // Reset the retained render only when there is nothing to encode (empty
  // text), which also covers the ~150 ms debounce window in useQrCode.ts
  // where `result` is still the previous successful result after the user
  // clears the field. Clearing on `!result.ok` would destroy the R5 feature.
  // `url` is carried once here so the preview and both exports share one
  // source rather than re-reading it through the alt text.
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
        {lastGood.current && (
          <p className="mt-1 text-xs text-slate-500">
            Showing your last valid code.
          </p>
        )}
      </div>
    ) : null;

  // Both exports are offered exactly when a code is on screen. That includes
  // the retained-code case (`preview` is the last good render while an error
  // card shows): the retained code is what the user is looking at, so saving
  // it is the correct outcome rather than a disabled button.

  /** Rasterise the on-screen SVG and download it as a white-backed PNG. */
  async function handleSavePng() {
    if (!preview) return;
    setSavingPng(true);
    try {
      const blob = await rasterize(preview.url);
      if (!blob) {
        // Canvas missing, image failed to load, or toBlob produced nothing.
        // Never leave the button silently dead.
        onNotify(PNG_FAILED_MESSAGE, "error");
        return;
      }
      downloadBlob(blob, PNG_FILENAME);
    } catch {
      onNotify(PNG_FAILED_MESSAGE, "error");
    } finally {
      setSavingPng(false);
    }
  }

  /** Download the encoder's SVG unchanged, as a file rather than a data URL. */
  function handleSaveSvg() {
    if (!preview) return;
    try {
      downloadBlob(svgDataUrlToBlob(preview.url), SVG_FILENAME);
    } catch {
      onNotify(SVG_FAILED_MESSAGE, "error");
    }
  }

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
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          <span className="font-semibold text-slate-700">
            {byteLength.toLocaleString()}
          </span>{" "}
          bytes
        </span>
        {/* The size limit is uncommon detail: it stays behind the `?` instead
         *  of sitting in the reading order of every visit. */}
        <button
          type="button"
          aria-label="About QR code size limits"
          aria-expanded={sizeHelpOpen}
          aria-controls={SIZE_HELP_ID}
          onClick={() => setSizeHelpOpen((open) => !open)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-300 px-1.5 leading-none text-slate-500 hover:border-slate-400 hover:text-slate-700"
        >
          ?
        </button>
        {warningAboveLimit && (
          <span className="text-amber-700">
            Above the {BYTE_MODE_MAX_BYTES.toLocaleString()}-byte soft limit
          </span>
        )}
        {sizeHelpOpen && (
          <p id={SIZE_HELP_ID} className="w-full pt-1">
            Long text may not fit in one QR code. Purely numeric text fits the
            most — about 5,600 characters.
          </p>
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
          <p className="py-6 text-center text-sm text-slate-500">
            Your QR code will appear here.
          </p>
        ) : (
          <p className="py-6 text-center text-xs text-slate-500">
            Generating…
          </p>
        )}
      </div>

      {/* One primary action per surface: saving the image is the outcome for
       *  the phone case (a chat app accepts a PNG). Copy text and Save SVG are
       *  real but no longer the point of this panel, so they take the
       *  DESIGN.md secondary style. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSavePng}
          disabled={!preview || savingPng}
          className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          {savingPng ? "Saving…" : "Save image"}
        </button>
        <button
          type="button"
          onClick={handleSaveSvg}
          disabled={!preview}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          Save SVG
        </button>
        <button
          type="button"
          onClick={() => onCopy(text)}
          disabled={!text}
          className="min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          Copy text
        </button>
      </div>
    </div>
  );
}
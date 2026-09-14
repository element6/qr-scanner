import { useCallback, useEffect, useRef } from "react";
import { clipboardImageFromDataTransfer } from "../utils/scanImage";

export type ImageScanControlProps = {
  busy: boolean;
  status: string | null; // describeOutcome text or null when idle (live region must stay mounted)
  onFile: (file: File | null) => void; // picker/drop funnel — picker normalizes to one File
  onPasteClick: () => void; // Paste button; App owns clipboard.read() (R3b)
};

/**
 * Presentational — owns no app data. Two buttons ("Choose image…", "Paste"), a
 * hidden file input the first button opens, a document-level paste listener so
 * ⌘V on the Scan tab decodes `clipboardData.files[0]` (text paste is ignored,
 * AC4), and an always-mounted status line (`role="status"`, AC6/AC13) announced
 * by screen readers even though the text is visually empty when idle. The
 * `document`-level dragover/drop preventDefault is also here — unconditional
 * while the control is mounted so a drop outside the frame never navigates the
 * SPA away to the raw file (R2).
 */
export function ImageScanControl({
  busy,
  status,
  onFile,
  onPasteClick,
}: ImageScanControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Paste is event-driven so ⌘V decodes immediately; only an actual image file
  // is handled (AC4), and never inside a text control.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      const file = clipboardImageFromDataTransfer(e.clipboardData as DataTransfer | null);
      if (!file) return; // text pastes: silent
      e.preventDefault();
      onFile(file);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onFile]);

  // Keep the SPA in place — unconditional while the Scan tab is shown (R2).
  useEffect(() => {
    function block(e: DragEvent) {
      e.preventDefault();
    }
    document.addEventListener("dragover", block);
    document.addEventListener("drop", block);
    return () => {
      document.removeEventListener("dragover", block);
      document.removeEventListener("drop", block);
    };
  }, []);

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0] ?? null;
      e.target.value = ""; // AC5 — same file must fire `change` again
      onFile(f);
    },
    [onFile]
  );

  const busyLabel = "Decoding…";
  const idleLabel = status ?? "";

  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Choose image…
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onPasteClick}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Paste
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPick}
          aria-hidden
        />
      </div>

      {/* Always mounted: a live region removed from the DOM never announces its
       * first change — reserve empty text at idle (Round-2, AC13). */}
      <p
        role="status"
        aria-live="polite"
        className="min-h-[1.25rem] text-xs leading-5 text-slate-600"
      >
        {busy ? busyLabel : idleLabel || "\u00a0"}
      </p>
    </div>
  );
}

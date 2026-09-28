import { useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import {
  deriveBadge,
  derivePrimaryAction,
  describeCameraIssue,
  type BadgeTone,
  type CameraIssue,
  type CameraStatus,
} from "../utils/cameraStatus";
import { ImageScanControl } from "./ImageScanControl";

type QRScannerProps = {
  /** Stream state — never inferred from `paused` (that is user intent). */
  status: CameraStatus;
  issue: CameraIssue;
  /** True whenever the camera is not meant to be running: user-paused, or the
   *  Create tab being active. */
  paused: boolean;
  onScan: (detectedCodes: Array<{ rawValue: string }>) => void;
  onError: (err: unknown) => void;
  deviceConstraints: { facingMode: "environment" };
  /** Primary button and its space shortcut; App derives the move from `status`. */
  onPrimaryAction: () => void;
  /** Ref callback for the frame that holds the library's `<video>`. */
  attachFrame: (el: HTMLElement | null) => void;
  /** Image path — owned by App, presented here so drag & drop lands on the frame (R2). */
  imageBusy: boolean;
  imageStatus: string | null;
  onImageFile: (file: File | null) => void;
  onImagePasteClick: () => void;
};

/** Emerald is the success signal and belongs to a running feed alone; the other
 *  tones stay off it. Each tone is paired with a text label in the pill, so the
 *  colour is never the only thing carrying the state. */
const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  live: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  pending: "bg-slate-200 text-slate-700",
  unavailable: "bg-red-100 text-red-800",
};

/**
 * What the frame says when there is no feed to show. A camera that is off is
 * not a failure, so only a real issue borrows the issue copy.
 */
function statePanelCopy(
  status: CameraStatus,
  issue: CameraIssue
): { headline: string; hint: string } {
  if (issue) return describeCameraIssue(issue);
  if (status === "requesting") {
    return {
      headline: "Starting the camera…",
      hint: "Your browser may ask for permission to use it.",
    };
  }
  return {
    headline: "Camera is off",
    hint: "Press Start Scanning, or drop a QR image anywhere in this frame.",
  };
}

export function QRScanner({
  status,
  issue,
  paused,
  onScan,
  onError,
  deviceConstraints,
  onPrimaryAction,
  attachFrame,
  imageBusy,
  imageStatus,
  onImageFile,
  onImagePasteClick,
}: QRScannerProps) {
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const badge = deriveBadge(status, paused);
  const action = derivePrimaryAction(status, paused);
  const panel = statePanelCopy(status, issue);
  // The library only owns a stream while it is mounted, so it is mounted for the
  // states that want one: `unavailable` must not silently re-request, and `idle`
  // must not prompt before the user asks.
  const showFeed = status === "requesting" || status === "live";

  function enter(e: React.DragEvent) {
    e.preventDefault();
    if (imageBusy) return;
    dragDepth.current++;
    setDragActive(true);
  }
  function over(e: React.DragEvent) {
    e.preventDefault();
    if (imageBusy) return;
    e.dataTransfer.dropEffect = "copy";
  }
  function leave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }
  function drop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (imageBusy) return;
    onImageFile(e.dataTransfer.files[0] ?? null);
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Camera</h2>
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${BADGE_TONE_CLASS[badge.tone]}`}
          >
            {badge.label}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div
          ref={attachFrame}
          onDragEnter={enter}
          onDragOver={over}
          onDragLeave={leave}
          onDrop={drop}
          className={`relative w-full aspect-square max-w-[400px] mx-auto overflow-hidden rounded-lg ring-offset-2 transition ${
            status === "live" ? "bg-black" : "border border-slate-200 bg-slate-100"
          } ${dragActive ? "ring-4 ring-emerald-400 ring-offset-slate-50" : "ring-0"}`}
        >
          {showFeed && (
            <Scanner
              onScan={onScan}
              onError={onError}
              constraints={deviceConstraints}
              paused={paused}
              components={{
                finder: false,
                onOff: true,
                torch: true,
                zoom: true,
              }}
              classNames={{
                container: "w-full h-full",
                video: "w-full h-full object-cover",
              }}
            />
          )}
          {status !== "live" && (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-slate-100 p-6 text-center">
              <p className="text-sm font-semibold text-slate-700">
                {panel.headline}
              </p>
              <p className="max-w-[30ch] text-xs text-slate-500">
                {panel.hint}
              </p>
            </div>
          )}
          <div className="absolute inset-0 pointer-events-none z-10">
            <div className="absolute top-[12%] left-[12%] w-8 h-8 border-l-4 border-t-4 border-emerald-500 rounded-tl-lg" />
            <div className="absolute top-[12%] right-[12%] w-8 h-8 border-r-4 border-t-4 border-emerald-500 rounded-tr-lg" />
            <div className="absolute bottom-[12%] left-[12%] w-8 h-8 border-l-4 border-b-4 border-emerald-500 rounded-bl-lg" />
            <div className="absolute bottom-[12%] right-[12%] w-8 h-8 border-r-4 border-b-4 border-emerald-500 rounded-br-lg" />
            {/* Motion must never assert a camera that is not running, so the
                sweep is bound to liveness rather than to being mounted. */}
            <div
              className="absolute left-[12%] right-[12%] h-0.5 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-[scan_2s_ease-in-out_infinite] motion-reduce:animate-none"
              style={{
                animationPlayState:
                  status === "live" && !paused ? "running" : "paused",
              }}
            />
          </div>
        </div>
        <div className="mt-3 flex justify-center">
          <button
            onClick={action.kind === "none" ? undefined : onPrimaryAction}
            disabled={action.kind === "none"}
            className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
              action.kind === "pause"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-emerald-700 hover:bg-emerald-800"
            }`}
          >
            {action.label}
          </button>
        </div>
        <ImageScanControl
          busy={imageBusy}
          status={imageStatus}
          onFile={onImageFile}
          onPasteClick={onImagePasteClick}
        />
      </div>
    </section>
  );
}

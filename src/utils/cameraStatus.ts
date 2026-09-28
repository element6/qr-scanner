/**
 * Camera status derivation.
 *
 * Pure module: no DOM access, no React, no side effects. Everything the badge,
 * the primary button and the empty-state panel say about the camera is decided
 * here, so the rules can be unit-tested without a camera.
 *
 * The defect this replaces derived the UI from user intent (`!paused`), which
 * made a machine with no webcam paint exactly the same first screen as a
 * machine with a working camera. Status is now stream state; intent (`paused`)
 * only ever refines it.
 */

export type CameraStatus = "idle" | "requesting" | "live" | "unavailable";

export type CameraIssue = "denied" | "not-found" | "insecure" | "unknown" | null;

/** Visual tone of the status pill. Only `live` may use the emerald signal. */
export type BadgeTone = "live" | "paused" | "pending" | "unavailable";

/**
 * Error *names* that mean the camera failed to start.
 *
 * This is the raw-`DOMException` half of the whitelist; `CAMERA_FAILURE_KINDS`
 * below is the wrapper half. `Scanner`'s `onError` is a firehose that also
 * carries decode, worker and frame errors, so only the two whitelists together
 * may move camera state. Exported so the whitelist itself is testable rather
 * than implied by a function body.
 */
export const CAMERA_FAILURE_NAMES = [
  "NotAllowedError",
  "SecurityError",
  "NotFoundError",
  "OverconstrainedError",
  "DevicesNotFoundError",
] as const;

export type CameraFailureName = (typeof CAMERA_FAILURE_NAMES)[number];

/**
 * `kind` values of the wrapper `Scanner`'s `onError` actually hands us.
 *
 * The library does not re-throw the `DOMException`: `createScannerError` wraps
 * every cause in `{ kind, message, cause }` (its `IScannerError`, declared in
 * `node_modules/@yudiel/react-qr-scanner/dist/types/IScannerError.d.ts` as
 * `ScannerErrorKind`). A wrapper has no `name`, so the `DOMException`-name path
 * alone classified a denied retry as *not* a camera failure and left the badge
 * on "Starting…" with no retry forever.
 *
 * The vocabulary is restated here rather than imported so this module stays
 * pure and free of the scanner runtime; the tuple is exhaustive over
 * `ScannerErrorKind`, and `cameraStatus.test.ts` pins it against the installed
 * declaration file.
 *
 * Only the kinds `createScannerError`'s `NAME_TO_KIND` table can produce from a
 * camera-start method are listed. `type-error`, `aborted`, `unsupported` and
 * `unknown` are deliberately absent: the same wrapper is also the firehose for
 * decode, worker, zoom and frame failures (`onError(createScannerError(err))`
 * inside the detection loop), and those may not move camera state.
 */
export const CAMERA_FAILURE_KINDS = [
  "permission-denied",
  "security",
  "no-camera",
  "overconstrained",
  "in-use",
  "insecure-context",
] as const;

export type CameraFailureKind = (typeof CAMERA_FAILURE_KINDS)[number];

/**
 * Either shape of a camera-start failure, once recognised: a wrapper `kind` or
 * a `DOMException` `name`. The two vocabularies are disjoint.
 */
export type CameraFailureSignal = CameraFailureKind | CameraFailureName;

/**
 * Wrapper `kind` → issue, for every kind that may move camera state.
 *
 * `in-use` (the camera is held by another application or tab) is a camera
 * failure but has no dedicated issue in the taxonomy, so it takes the `unknown`
 * headline; a retry after the other holder exits is the fix either way.
 */
export const CAMERA_FAILURE_KIND_ISSUE: Record<
  CameraFailureKind,
  Exclude<CameraIssue, null>
> = {
  "permission-denied": "denied",
  security: "denied",
  "no-camera": "not-found",
  overconstrained: "not-found",
  "in-use": "unknown",
  "insecure-context": "insecure",
};

/**
 * The status pill. Tone `live` (emerald) is reserved for a feed that is
 * genuinely running: `live` + `paused` is the normal post-scan state, not a
 * success, and must never wear the same colour as an active camera.
 *
 * Every tone carries a text label, so colour never encodes state on its own.
 */
export function deriveBadge(
  status: CameraStatus,
  paused: boolean
): { label: string; tone: BadgeTone } {
  if (status === "live") {
    return paused
      ? { label: "Paused", tone: "paused" }
      : { label: "Scanning", tone: "live" };
  }
  if (status === "requesting") {
    return { label: "Starting…", tone: "pending" };
  }
  if (status === "unavailable") {
    return { label: "Camera unavailable", tone: "unavailable" };
  }
  return { label: "Paused", tone: "paused" };
}

export type PrimaryActionKind = "start" | "pause" | "retry" | "none";

/**
 * What the primary button offers next.
 *
 * `unavailable` is checked first and can never fall through to "Start
 * Scanning": a camera that failed to open must offer a retry, never the action
 * that silently did nothing the first time.
 */
export function derivePrimaryAction(
  status: CameraStatus,
  paused: boolean
): { label: string; kind: PrimaryActionKind } {
  if (status === "unavailable") {
    return { label: "Try again", kind: "retry" };
  }
  if (status === "requesting") {
    return { label: "Starting…", kind: "none" };
  }
  if (status === "live" && !paused) {
    return { label: "Pause Scanning", kind: "pause" };
  }
  return { label: "Start Scanning", kind: "start" };
}

/**
 * Plain-language headline and next step for a camera that is not running.
 * Deliberately short and non-technical: no exception names, no error codes.
 */
export function describeCameraIssue(
  issue: Exclude<CameraIssue, null>
): { headline: string; hint: string } {
  switch (issue) {
    case "denied":
      return {
        headline: "Your browser is blocking the camera.",
        hint: "Allow camera access in the address bar, then try again — or decode an image instead.",
      };
    case "not-found":
      return {
        headline: "No camera found on this device.",
        hint: "Decode a QR or barcode from an image instead.",
      };
    case "insecure":
      return {
        headline: "The camera needs a secure (HTTPS) connection.",
        hint: "Decode from an image instead.",
      };
    default:
      return {
        headline: "The camera could not be started.",
        hint: "Try again, or decode from an image instead.",
      };
  }
}

/** Maps a browser error name onto the issue the panel explains. */
export function classifyCameraError(
  err: unknown
): Exclude<CameraIssue, null> {
  const kind = readScannerErrorKind(err);
  if (kind !== null && isCameraFailureKind(kind)) {
    return CAMERA_FAILURE_KIND_ISSUE[kind];
  }
  const name = readErrorName(err);
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "denied";
  }
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  ) {
    return "not-found";
  }
  return "unknown";
}

/**
 * The firehose guard: is this payload actually about the camera?
 *
 * True for either shape `Scanner` can hand `onError`: a `DOMException` (or any
 * object) whose `name` is whitelisted, or its own `{ kind, message, cause }`
 * wrapper whose `kind` is. A plain `Error` — a decode, worker or frame failure
 * from the scanner loop — is false, and callers must not let it move camera
 * state.
 */
export function isCameraFailure(err: unknown): boolean {
  return readCameraFailureKind(err) !== null;
}

/** True iff the track is attached to a running source. */
export function isLiveTrack(
  track: MediaStreamTrack | null | undefined
): boolean {
  return track?.readyState === "live";
}

/**
 * `name` is a string on `DOMException` and `Error` alike, and is the only thing
 * both branches of this module need. Reading it defensively keeps a thrown
 * string or null from crashing the status observer.
 */
function readErrorName(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const name = (err as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

/**
 * The single question both `isCameraFailure` and `classifyCameraError` ask, so
 * the guard and the classifier can never disagree about what a payload is.
 *
 * Accepts either shape the library can hand `onError`:
 *
 * 1. the raw `DOMException` / `Error` path, matched on `name`; and
 * 2. the `{ kind, message, cause }` wrapper, matched on `kind`.
 *
 * `kind` is tested before `name` because the wrapper — unlike a `DOMException`
 * — has no `name`, and a payload carrying both would be a wrapper.
 */
function readCameraFailureKind(err: unknown): CameraFailureSignal | null {
  const kind = readScannerErrorKind(err);
  if (kind !== null) {
    return isCameraFailureKind(kind) ? kind : null;
  }
  const name = readErrorName(err);
  if (name !== null && (CAMERA_FAILURE_NAMES as readonly string[]).includes(name)) {
    return name as CameraFailureName;
  }
  return null;
}

/** Narrows a wrapper `kind` to the kinds that may move camera state. */
function isCameraFailureKind(kind: string): kind is CameraFailureKind {
  return (CAMERA_FAILURE_KINDS as readonly string[]).includes(kind);
}

/**
 * The wrapper's `kind`, or null when the payload is not a scanner wrapper.
 *
 * A `DOMException` has no `kind`, so this returns null for the raw shape and
 * the name path stays in charge of it.
 */
function readScannerErrorKind(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const kind = (err as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

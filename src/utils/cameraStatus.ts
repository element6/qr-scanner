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
 * Error names that mean the *camera* failed to start.
 *
 * `Scanner`'s `onError` is a firehose: it also carries decode, worker and frame
 * errors. Only these names may move camera state. Exported so the whitelist
 * itself is testable rather than implied by a function body.
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
 * True only for a `DOMException`, or any object whose `name` is in the
 * whitelist. A plain `Error` — a decode, worker or frame failure from the
 * scanner loop — is false, and callers must not let it move camera state.
 */
export function isCameraFailure(err: unknown): boolean {
  const name = readErrorName(err);
  return (
    name !== null && (CAMERA_FAILURE_NAMES as readonly string[]).includes(name)
  );
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

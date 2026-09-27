/**
 * Owns camera *stream* state: whether a feed is actually running, and why it
 * is not.
 *
 * The library exposes no stream-ready event — `Scanner` only has
 * `onScan`/`onError` — so liveness is observed from the `<video>` the library
 * renders inside the container whose ref we are handed (`attachFrame`). That
 * keeps this hook free of any state the library cannot report, and the UI is
 * never asked to infer a working camera from `paused`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyCameraError,
  isCameraFailure,
  isLiveTrack,
  type CameraIssue,
  type CameraStatus,
} from "../utils/cameraStatus";

/**
 * Liveness poll. Fast enough that a granted stream feels immediate, cheap
 * enough to leave running while the camera is on. A rAF loop would burn a frame
 * budget per second for a reading that changes at most a few times per session.
 */
const POLL_INTERVAL_MS = 150;

/** Result of asking whether any camera exists. `unknown` means "could not tell",
 *  which is never treated as an absent device. */
type DeviceProbe = "some" | "none" | "unknown";

export type UseCameraStatus = {
  status: CameraStatus;
  issue: CameraIssue;
  /** Idle → requesting. Called when the user starts the camera. */
  beginRequest: () => void;
  /** Unavailable → requesting. Same move, reached from a failed camera. */
  retry: () => void;
  /** Single entry point for the library's `onError` firehose. */
  handleCameraError: (err: unknown) => void;
  /** Ref callback for the element that contains the library's `<video>`. */
  attachFrame: (el: HTMLElement | null) => void;
};

export function useCameraStatus(): UseCameraStatus {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [issue, setIssue] = useState<CameraIssue>(null);

  const frameRef = useRef<HTMLElement | null>(null);
  /** Mirror of `status` for poll ticks and DOM listeners, which must read the
   *  current value without being torn down and rebuilt on every transition. */
  const statusRef = useRef<CameraStatus>("idle");
  /** Set once the current request has seen a live track, so a late error
   *  payload cannot demote a feed that already proved itself. */
  const liveSeenRef = useRef(false);
  /** Keeps the track `ended` event and a poll tick from asserting the same
   *  failure twice. */
  const endingRef = useRef(false);
  /** The track we are currently bound to, and how to unbind from it. */
  const observedTrackRef = useRef<MediaStreamTrack | null>(null);
  const detachTrackRef = useRef<(() => void) | null>(null);

  /**
   * Every transition goes through here so `statusRef` is never a render behind
   * the value a poll tick or a DOM listener is about to read.
   */
  const updateStatus = useCallback(
    (next: CameraStatus, nextIssue: CameraIssue) => {
      statusRef.current = next;
      setStatus(next);
      setIssue(nextIssue);
    },
    []
  );

  const attachFrame = useCallback((el: HTMLElement | null) => {
    frameRef.current = el;
  }, []);

  const detachTrackListeners = useCallback(() => {
    detachTrackRef.current?.();
    detachTrackRef.current = null;
    observedTrackRef.current = null;
  }, []);

  /**
   * The track that was feeding us is gone for good: hardware that disappeared,
   * or a `stop()` nobody asked for. `enumerateDevices` decides whether a camera
   * still exists, so "unplugged" and "failed" are told apart in the copy.
   */
  const assertEnded = useCallback(async () => {
    if (endingRef.current) return;
    if (statusRef.current !== "live") return;
    endingRef.current = true;
    const probe = await probeVideoInputs();
    // A retry may have started while the probe was in flight; that request owns
    // the state now.
    if (statusRef.current !== "live") return;
    updateStatus("unavailable", probe === "none" ? "not-found" : "unknown");
  }, [updateStatus]);

  /**
   * Bind to whichever track is currently attached.
   *
   * `mute` is deliberately not handled: it is often transient and often
   * precedes `ended`, so the only event that may take a live camera down is
   * `ended` — and only for a track that is *still attached* to the video. The
   * library's own `paused` teardown nulls `srcObject` and then stops every
   * track, so a pause would otherwise look exactly like a camera failing.
   */
  const ensureTrackListeners = useCallback(() => {
    const track = readAttachedTrack(frameRef.current);
    if (track === observedTrackRef.current) return;

    detachTrackListeners();
    if (!track) return;

    observedTrackRef.current = track;
    const onEnded = () => {
      if (readAttachedTrack(frameRef.current) !== track) return;
      void assertEnded();
    };
    track.addEventListener("ended", onEnded);
    detachTrackRef.current = () => track.removeEventListener("ended", onEnded);
  }, [assertEnded, detachTrackListeners]);

  /**
   * One observation pass. A tab that is hidden suspends every reading: nothing
   * is asserted until it is visible again and a fresh observation is taken.
   */
  const pollTick = useCallback(() => {
    if (typeof document !== "undefined" && document.hidden) return;

    const current = statusRef.current;
    if (current !== "requesting" && current !== "live") return;

    const video = readVideoElement(frameRef.current);
    const track = readAttachedTrack(frameRef.current);

    if (isLiveTrack(track)) {
      ensureTrackListeners();
      if (current === "requesting") {
        liveSeenRef.current = true;
        updateStatus("live", null);
      }
      return;
    }

    // While requesting, some browsers attach the stream before the track object
    // reports `live`; painted pixels on a mounted video are equally conclusive.
    if (
      current === "requesting" &&
      video &&
      video.readyState >= 2 &&
      video.videoWidth > 0
    ) {
      liveSeenRef.current = true;
      updateStatus("live", null);
      return;
    }

    // Only a positively `ended` track that is still attached may fail the feed.
    // A detached or absent track is a teardown or a remount, which proves
    // nothing about the camera.
    if (current === "live" && track && track.readyState === "ended") {
      void assertEnded();
    }
  }, [assertEnded, ensureTrackListeners, updateStatus]);

  // Poll only while something is pending or running. The interval and the
  // listener are always removed, so React 19 StrictMode's double-mount cannot
  // leave a second observer running or flap state.
  useEffect(() => {
    if (status !== "requesting" && status !== "live") return;

    const id = window.setInterval(pollTick, POLL_INTERVAL_MS);
    // Observe immediately: a fast grant must not wait a whole interval, and the
    // first reading after becoming visible must precede any assertion.
    pollTick();

    const onVisibilityChange = () => {
      if (!document.hidden) pollTick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [status, pollTick]);

  // Unmount (and StrictMode's simulated one) must not leave listeners on a
  // track that outlives this hook.
  useEffect(() => detachTrackListeners, [detachTrackListeners]);

  /**
   * Mount probe. It must never prompt: `enumerateDevices` lists device kinds
   * without permission, and `permissions.query` shows no dialog. Either API may
   * be missing or throw (Firefox rejects an unknown name, private modes hide
   * `permissions`); staying `idle` is the honest answer when we cannot tell.
   */
  useEffect(() => {
    let cancelled = false;

    const applyProbe = (probeIssue: Exclude<CameraIssue, null>) => {
      // Only a still-idle camera may be failed by a mount probe: a probe that
      // resolves after the user already pressed Start must not clobber it.
      if (cancelled || statusRef.current !== "idle") return;
      updateStatus("unavailable", probeIssue);
    };

    // Synchronous and decisive: `getUserMedia` cannot work over plain HTTP, and
    // the library reports that as a plain `Error`, which is not a camera
    // failure payload and would otherwise leave the camera stuck "Starting…".
    if (typeof window !== "undefined" && !window.isSecureContext) {
      applyProbe("insecure");
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      const devices = await probeVideoInputs();
      if (devices === "none") applyProbe("not-found");
    })();

    void (async () => {
      try {
        const permissions = navigator.permissions;
        if (!permissions || typeof permissions.query !== "function") return;
        const result = await permissions.query({
          name: "camera" as PermissionName,
        });
        if (result.state === "denied") applyProbe("denied");
      } catch {
        // Unknown permission name (Firefox) — no conclusion to draw.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [updateStatus]);

  const startRequest = useCallback(() => {
    endingRef.current = false;
    liveSeenRef.current = false;
    detachTrackListeners();
    // `getUserMedia` cannot work over plain HTTP and rejects with a plain
    // `Error`, which `isCameraFailure` deliberately ignores — so entering
    // `requesting` here would strand the badge on "Starting…" with no retry.
    // The mount probe covers first paint; this covers every Start/retry after.
    if (typeof window !== "undefined" && !window.isSecureContext) {
      updateStatus("unavailable", "insecure");
      return;
    }
    updateStatus("requesting", null);
  }, [detachTrackListeners, updateStatus]);

  const beginRequest = useCallback(() => startRequest(), [startRequest]);
  const retry = useCallback(() => startRequest(), [startRequest]);

  /**
   * Whitelisted camera failure, arriving before any live track was seen, is the
   * only error that may fail a pending request. Decode, worker and frame errors
   * are logged by the caller and ignored here.
   */
  const handleCameraError = useCallback(
    (err: unknown) => {
      if (!isCameraFailure(err)) return;
      if (liveSeenRef.current) return;
      // An error that arrives while a feed is proven live is not ours to act
      // on: only the track ending may take a live camera down.
      if (statusRef.current !== "requesting") return;
      // Only a *live* attached track proves the camera opened. An `ended`
      // track stays listed by getVideoTracks(), so testing mere presence
      // swallowed genuine failures after a hot-unplug — leaving the badge on
      // "Starting…" with no retry.
      if (isLiveTrack(readAttachedTrack(frameRef.current))) return;

      endingRef.current = true;
      updateStatus("unavailable", classifyCameraError(err));
    },
    [updateStatus]
  );

  return { status, issue, beginRequest, retry, handleCameraError, attachFrame };
}

/** The `<video>` the library renders inside the frame we were given. */
function readVideoElement(frame: HTMLElement | null): HTMLVideoElement | null {
  if (!frame) return null;
  return frame.querySelector("video");
}

/**
 * The video's *current* track, or null when there is none.
 *
 * Null means "cannot assert", never "failed": the library nulls `srcObject`
 * before stopping tracks on `paused`, and a remount has no video at all.
 */
function readAttachedTrack(
  frame: HTMLElement | null
): MediaStreamTrack | null {
  const video = readVideoElement(frame);
  if (!video) return null;
  const stream = video.srcObject as MediaStream | null | undefined;
  if (!stream || typeof stream.getVideoTracks !== "function") return null;
  return stream.getVideoTracks()[0] ?? null;
}

/** Asks whether any camera exists without prompting for permission. */
async function probeVideoInputs(): Promise<DeviceProbe> {
  try {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== "function") {
      return "unknown";
    }
    const devices = await mediaDevices.enumerateDevices();
    return devices.some((device) => device.kind === "videoinput")
      ? "some"
      : "none";
  } catch {
    // Throwing here must never reject unhandled; it only means "unknown".
    return "unknown";
  }
}

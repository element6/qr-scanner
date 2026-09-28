/**
 * Render-level tests for the camera status hook's failure paths.
 *
 * Two defects are pinned here. Both stranded the badge on "Starting…" with no
 * retry ever offered, which is the failure the user actually sees:
 *
 * 1. The failure guard asked whether a track was *attached* rather than
 *    whether it was *live*. A hot-unplug leaves the track in the video's
 *    stream with `readyState === "ended"` — `getVideoTracks()` still lists it —
 *    so a genuine `NotFoundError` was swallowed and the request never resolved.
 * 2. `startRequest` — reached by both Start and Retry — never re-checked
 *    `window.isSecureContext`. Over plain HTTP `getUserMedia` rejects with a
 *    plain `Error`, which the firehose guard correctly ignores as a non-camera
 *    failure, so entering `requesting` there was a one-way door.
 *
 * jsdom's environment is adverse to this hook and is pinned per test rather
 * than trusted: `isSecureContext` is absent (falsy, so the insecure branches
 * would fire by accident) and, without visual mode, `document.hidden` is
 * `true` — and `pollTick` refuses to read a hidden tab, so nothing would ever
 * reach "live". `navigator.mediaDevices` and `navigator.permissions` are also
 * absent, which the hook tolerates by design ("unknown" is never "no camera").
 *
 * Written without JSX and without @testing-library/react to match
 * `Notification.test.ts`: the vitest include is `src/**\/*.test.ts` and neither
 * is a declared dependency.
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useCameraStatus, type UseCameraStatus } from "./useCameraStatus";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// Captured before any test overrides them, so `afterEach` restores jsdom's own
// state rather than a value this file invented.
const ORIGINAL_SECURE_CONTEXT = Object.getOwnPropertyDescriptor(
  window,
  "isSecureContext"
);
const ORIGINAL_HIDDEN = Object.getOwnPropertyDescriptor(document, "hidden");

let container: HTMLDivElement;
let root: Root;
/** Latest committed hook return value, refreshed on every render. */
let api!: UseCameraStatus;
/** The container the hook was handed through `attachFrame`. */
let frame: HTMLElement | null;

/**
 * Renders the hook and hands its `attachFrame` the container div, so the
 * library's `<video>` can be planted inside it imperatively. It deliberately
 * renders no video of its own — each test decides what the frame contains.
 */
function Harness() {
  const latest = useCameraStatus();
  api = latest;
  return createElement("div", {
    ref: (el: HTMLElement | null) => {
      frame = el;
      latest.attachFrame(el);
    },
  });
}

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    value,
    configurable: true,
    writable: true,
  });
}

function setHidden(value: boolean) {
  Object.defineProperty(document, "hidden", { value, configurable: true });
}

function restore(
  target: object,
  key: string,
  original: PropertyDescriptor | undefined
) {
  if (original) Object.defineProperty(target, key, original);
  else Reflect.deleteProperty(target, key);
}

/**
 * Minimal `MediaStreamTrack` stand-in. The hook only reads `readyState`
 * (through `isLiveTrack`) and subscribes to `ended`; the listener methods are
 * no-ops because no pinned case dispatches the event — `pollTick` and
 * `handleCameraError` are the observation paths under test. `stop()` is
 * present because the real library calls it during teardown.
 */
function makeTrack(readyState: MediaStreamTrackState) {
  return {
    readyState,
    stop() {},
    addEventListener() {},
    removeEventListener() {},
  };
}

/**
 * Plants the library's `<video>` inside the frame with a controlled
 * `srcObject`. jsdom has no media pipeline: `srcObject` is not implemented, and
 * the element reports `readyState === 0` / `videoWidth === 0`, so the
 * painted-pixels fallback in `pollTick` cannot promote a request to live on its
 * own — only a `"live"` track can.
 */
function attachVideo(track: ReturnType<typeof makeTrack>) {
  if (!frame) throw new Error("frame not attached: render the hook first");

  const video = document.createElement("video");
  Object.defineProperty(video, "srcObject", {
    value: { getVideoTracks: () => [track] },
    configurable: true,
    writable: true,
  });
  frame.appendChild(video);
  return video;
}

async function renderHook() {
  await act(async () => {
    root.render(createElement(Harness));
  });
  return api;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // The production case is a secure origin in a visible tab; jsdom defaults to
  // neither (see the docblock).
  setSecureContext(true);
  setHidden(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  restore(window, "isSecureContext", ORIGINAL_SECURE_CONTEXT);
  restore(document, "hidden", ORIGINAL_HIDDEN);
});

describe("useCameraStatus failure paths", () => {
  it("fails a request whose attached track has already ended", async () => {
    await renderHook();
    // The hot-unplug shape: an `ended` track that is still listed by the video.
    attachVideo(makeTrack("ended"));

    await act(async () => {
      api.beginRequest();
    });
    // The request did start; the bug is that nothing could ever end it.
    expect(api.status).toBe("requesting");

    await act(async () => {
      api.handleCameraError(
        new DOMException("no device", "NotFoundError")
      );
    });

    expect(api.status).toBe("unavailable");
    expect(api.issue).toBe("not-found");
  });

  it("keeps a live feed alive through a decode-side error", async () => {
    await renderHook();
    attachVideo(makeTrack("live"));

    await act(async () => {
      api.beginRequest();
    });
    // Real timers, not fake ones, to match the existing render tests (neither
    // Notification nor ScanHistory uses `vi.useFakeTimers`). The hook polls
    // once immediately and then every 150 ms, so this delay also covers one
    // interval tick rather than only the immediate observation.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(api.status).toBe("live");

    await act(async () => {
      api.handleCameraError(new Error("decode failed"));
    });

    // A proven feed may only be taken down by its track ending.
    expect(api.status).toBe("live");
    expect(api.issue).toBeNull();
  });

  it("reports an insecure origin from the mount probe", async () => {
    setSecureContext(false);

    await renderHook();

    expect(api.status).toBe("unavailable");
    expect(api.issue).toBe("insecure");
  });

  it("never enters requesting on Start or Retry over an insecure origin", async () => {
    setSecureContext(false);
    await renderHook();
    expect(api.status).toBe("unavailable");

    await act(async () => {
      api.retry();
    });
    expect(api.status).toBe("unavailable");
    expect(api.issue).toBe("insecure");

    await act(async () => {
      api.beginRequest();
    });
    expect(api.status).toBe("unavailable");
    expect(api.issue).toBe("insecure");
  });

  it("ignores a plain non-camera error while requesting", async () => {
    await renderHook();
    // Adversarial: a track *is* attached, so only the whitelist in
    // `isCameraFailure` can keep this error out of camera state.
    attachVideo(makeTrack("ended"));

    await act(async () => {
      api.beginRequest();
    });
    expect(api.status).toBe("requesting");

    await act(async () => {
      api.handleCameraError(new Error("frame decode failed"));
    });

    expect(api.status).toBe("requesting");
    expect(api.issue).toBeNull();
  });

  // The denied-retry loop: first paint is correct, Retry enters `requesting`,
  // and the library then reports the denial as *its own wrapper* — no `name`,
  // only `kind`. While only `DOMException` names were recognised, this payload
  // was treated as a non-camera error, so nothing could take the badge off
  // "Starting…" and the button stayed dead. `cause` is `{}` exactly as the
  // browser console showed it.
  it("fails a denied retry reported as the library's wrapper", async () => {
    await renderHook();
    // Adversarial: a track *is* attached but not live, so the failure guard
    // cannot pass on mere attachment either.
    attachVideo(makeTrack("ended"));

    await act(async () => {
      api.beginRequest();
    });
    expect(api.status).toBe("requesting");

    await act(async () => {
      api.handleCameraError({
        kind: "permission-denied",
        message: "Permission denied",
        cause: {},
      });
    });

    expect(api.status).toBe("unavailable");
    expect(api.issue).toBe("denied");
  });
});

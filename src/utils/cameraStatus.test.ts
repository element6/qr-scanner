/**
 * Behavioral tests for the pure camera-status rules in cameraStatus.ts
 * Uses Vitest for testing
 */

import { describe, it, expect } from "vitest";
import {
  CAMERA_FAILURE_NAMES,
  classifyCameraError,
  deriveBadge,
  derivePrimaryAction,
  describeCameraIssue,
  isCameraFailure,
  isLiveTrack,
  type BadgeTone,
  type CameraIssue,
  type CameraStatus,
  type PrimaryActionKind,
} from "./cameraStatus";

const STATUSES: CameraStatus[] = [
  "idle",
  "requesting",
  "live",
  "unavailable",
];
const PAUSED_STATES = [true, false];

describe("deriveBadge", () => {
  // The full status × paused matrix, so no cell is left to inference.
  const badgeCases: Array<[CameraStatus, boolean, string, BadgeTone]> = [
    ["idle", true, "Paused", "paused"],
    ["idle", false, "Paused", "paused"],
    ["requesting", true, "Starting…", "pending"],
    ["requesting", false, "Starting…", "pending"],
    ["live", true, "Paused", "paused"],
    ["live", false, "Scanning", "live"],
    ["unavailable", true, "Camera unavailable", "unavailable"],
    ["unavailable", false, "Camera unavailable", "unavailable"],
  ];

  for (const [status, paused, label, tone] of badgeCases) {
    it(`should render ${status} (paused: ${paused}) as "${label}"`, () => {
      expect(deriveBadge(status, paused)).toEqual({ label, tone });
    });
  }

  it("should reserve the live tone for a running feed", () => {
    for (const status of STATUSES) {
      for (const paused of PAUSED_STATES) {
        if (deriveBadge(status, paused).tone === "live") {
          expect(status).toBe("live");
          expect(paused).toBe(false);
        }
      }
    }
  });

  it("should never use the live tone for a paused live camera", () => {
    expect(deriveBadge("live", true).tone).not.toBe("live");
  });

  it("should always pair a tone with a readable label", () => {
    for (const status of STATUSES) {
      for (const paused of PAUSED_STATES) {
        expect(deriveBadge(status, paused).label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("derivePrimaryAction", () => {
  const actionCases: Array<
    [CameraStatus, boolean, string, PrimaryActionKind]
  > = [
    ["idle", true, "Start Scanning", "start"],
    ["idle", false, "Start Scanning", "start"],
    ["requesting", true, "Starting…", "none"],
    ["requesting", false, "Starting…", "none"],
    ["live", true, "Start Scanning", "start"],
    ["live", false, "Pause Scanning", "pause"],
    ["unavailable", true, "Try again", "retry"],
    ["unavailable", false, "Try again", "retry"],
  ];

  for (const [status, paused, label, kind] of actionCases) {
    it(`should offer "${label}" for ${status} (paused: ${paused})`, () => {
      expect(derivePrimaryAction(status, paused)).toEqual({ label, kind });
    });
  }

  it("should never offer Start Scanning while the camera is unavailable", () => {
    for (const paused of PAUSED_STATES) {
      const action = derivePrimaryAction("unavailable", paused);
      expect(action.label).not.toBe("Start Scanning");
      expect(action.kind).not.toBe("start");
    }
  });

  it("should not offer a clickable action while a request is pending", () => {
    for (const paused of PAUSED_STATES) {
      expect(derivePrimaryAction("requesting", paused).kind).toBe("none");
    }
  });
});

describe("classifyCameraError", () => {
  const cases: Array<[string, Exclude<CameraIssue, null>]> = [
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "not-found"],
    ["OverconstrainedError", "not-found"],
    ["DevicesNotFoundError", "not-found"],
    ["SomethingElseError", "unknown"],
  ];

  for (const [name, issue] of cases) {
    it(`should classify ${name} as ${issue}`, () => {
      expect(classifyCameraError(new DOMException("x", name))).toBe(issue);
    });
  }

  it("should classify a plain Error as unknown", () => {
    expect(classifyCameraError(new Error("decode failed"))).toBe("unknown");
  });

  it("should classify a non-error payload as unknown", () => {
    expect(classifyCameraError(null)).toBe("unknown");
    expect(classifyCameraError("boom")).toBe("unknown");
    expect(classifyCameraError({})).toBe("unknown");
  });
});

describe("isCameraFailure", () => {
  it("should treat a decode failure as not a camera failure", () => {
    // The firehose guard: the library's onError also carries decode, worker and
    // frame errors, and none of them may move camera state.
    expect(isCameraFailure(new Error("decode failed"))).toBe(false);
  });

  it("should treat a denied camera as a camera failure", () => {
    expect(isCameraFailure(new DOMException("x", "NotAllowedError"))).toBe(true);
  });

  for (const name of CAMERA_FAILURE_NAMES) {
    it(`should accept ${name} as a camera failure`, () => {
      expect(isCameraFailure({ name })).toBe(true);
    });
  }

  it("should reject payloads that are not error-like", () => {
    expect(isCameraFailure(null)).toBe(false);
    expect(isCameraFailure(undefined)).toBe(false);
    expect(isCameraFailure("NotAllowedError")).toBe(false);
    expect(isCameraFailure({})).toBe(false);
    expect(isCameraFailure({ name: 42 })).toBe(false);
  });

  it("should export the whitelist it checks against", () => {
    expect(CAMERA_FAILURE_NAMES).toContain("NotAllowedError");
    expect(CAMERA_FAILURE_NAMES).toContain("DevicesNotFoundError");
    expect(CAMERA_FAILURE_NAMES).not.toContain("Error");
  });
});

describe("describeCameraIssue", () => {
  const issues: Array<Exclude<CameraIssue, null>> = [
    "denied",
    "not-found",
    "insecure",
    "unknown",
  ];

  for (const issue of issues) {
    it(`should explain ${issue} in plain language`, () => {
      const { headline, hint } = describeCameraIssue(issue);
      expect(headline.length).toBeGreaterThan(0);
      expect(hint.length).toBeGreaterThan(0);
      // No exception names or codes leak into user-facing copy.
      expect(headline).not.toMatch(/Error|undefined|null/);
      expect(hint).not.toMatch(/Error|undefined|null/);
    });
  }

  it("should tell a blocked user how to unblock the camera", () => {
    expect(describeCameraIssue("denied").headline).toBe(
      "Your browser is blocking the camera."
    );
  });

  it("should offer the image path when there is no camera", () => {
    expect(describeCameraIssue("not-found").hint).toContain("image");
  });
});

describe("isLiveTrack", () => {
  it("should be true only for a live track", () => {
    expect(isLiveTrack({ readyState: "live" } as MediaStreamTrack)).toBe(true);
    expect(isLiveTrack({ readyState: "ended" } as MediaStreamTrack)).toBe(false);
  });

  it("should be false when there is no track", () => {
    expect(isLiveTrack(null)).toBe(false);
    expect(isLiveTrack(undefined)).toBe(false);
  });
});

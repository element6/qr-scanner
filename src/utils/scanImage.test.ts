import { describe, expect, it, vi } from "vitest";
import {
  MAX_IMAGE_BYTES,
  ZXING_WASM_PATH,
  describeOutcome,
  makeLocateFile,
  resolveWasmPath,
  scanImageFile,
  toOutcome,
  validateImageFile,
  type ScanOutcome,
} from "./scanImage";

const MB = 1024 * 1024;

function file(name: string, bytes = 1024, type = "image/png"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** Detector stub: records the sources it was called with. */
function detector(results: Array<{ rawValue: string }>) {
  const seen: unknown[] = [];
  const detect = vi.fn(async (source: unknown) => {
    seen.push(source);
    return results;
  });
  const factory = async () => ({ detect });
  return { detect, factory, seen };
}

describe("validateImageFile (R9)", () => {
  it("accepts a normal image", () => {
    expect(validateImageFile(file("a.png"))).toBeNull();
  });

  it("is silent on cancel (AC2)", () => {
    expect(validateImageFile(null)).toBeNull();
    expect(validateImageFile(undefined)).toBeNull();
  });

  it("rejects non-images by type and by extension fallback", () => {
    expect(validateImageFile(file("notes.txt", 1024, "text/plain"))?.kind).toBe(
      "not-image"
    );
    // Some drop paths hand over an empty type; the extension rescues it.
    expect(validateImageFile(file("shot.JPG", 1024, ""))).toBeNull();
    expect(validateImageFile(file("data.bin", 1024, ""))?.kind).toBe("not-image");
  });

  it("rejects the size cap before any decode work (AC3)", () => {
    const big = file("huge.png", 21 * MB);
    const failure = validateImageFile(big);
    expect(failure?.kind).toBe("too-large");
    if (failure?.kind === "too-large") expect(failure.bytes).toBe(big.size);
    expect(validateImageFile(file("edge.png", MAX_IMAGE_BYTES))).toBeNull();
  });

  it("rejects a zero-byte file", () => {
    expect(validateImageFile(file("empty.png", 0))?.kind).toBe("empty");
  });

  it("carries the name for display decisions without interpolating it", () => {
    const failure = validateImageFile(file("secret-name.txt", 1024, "text/plain"));
    expect(failure?.name).toBe("secret-name.txt");
    expect(describeOutcome(failure!)).not.toContain("secret-name");
  });
});

describe("toOutcome (R1, AC12)", () => {
  it("takes the first non-empty value and counts the results", () => {
    const o = toOutcome([{ rawValue: "" }, { rawValue: "B" }, { rawValue: "C" }], "x.png");
    expect(o).toEqual({ ok: true, value: "B", count: 3 });
  });

  it("treats all-empty results as not-found", () => {
    const o = toOutcome([{ rawValue: "" }], "x.png");
    expect(o).toEqual({ ok: false, kind: "not-found", name: "x.png" });
  });

  it("treats an empty result list as not-found", () => {
    expect(toOutcome([], "x.png").ok).toBe(false);
  });

  it("preserves an empty-looking payload that is not a string", () => {
    expect(toOutcome([{ rawValue: "0" }], "x.png")).toEqual({
      ok: true,
      value: "0",
      count: 1,
    });
  });
});

describe("describeOutcome (§7.7 normative copy)", () => {
  const cases: Array<[ScanOutcome, string]> = [
    [{ ok: true, value: "https://a.b", count: 1 }, "Scanned https://a.b"],
    [{ ok: false, kind: "not-image", name: "n" }, "That file isn't an image"],
    [
      { ok: false, kind: "too-large", name: "n", bytes: 21 * MB },
      "Image is too large (20 MB max)",
    ],
    [{ ok: false, kind: "empty", name: "n" }, "That file is empty"],
    [
      { ok: false, kind: "undecodable", name: "n" },
      "Couldn't read that image — try a PNG or JPEG",
    ],
    [{ ok: false, kind: "not-found", name: "n" }, "No code found in this image"],
    [
      { ok: false, kind: "decode-failed", name: "n" },
      "Scanner failed to start — reload the page",
    ],
  ];

  it.each(cases)("maps %s to the exact string", (outcome, expected) => {
    expect(describeOutcome(outcome)).toBe(expected);
  });

  it("maps every clipboard kind", () => {
    expect(describeOutcome({ kind: "clipboard-denied" })).toBe(
      "Clipboard blocked — allow it in browser settings, or choose a file"
    );
    expect(describeOutcome({ kind: "clipboard-unavailable" })).toBe(
      "Clipboard not available here — choose a file instead"
    );
    expect(describeOutcome({ kind: "clipboard-empty" })).toBe(
      "No image on the clipboard"
    );
  });

  it("keeps every message inside the copy budget (R7)", () => {
    for (const [outcome] of cases) {
      expect(describeOutcome(outcome).length).toBeLessThanOrEqual(72);
    }
  });
});

describe("scanImageFile (AC5, AC13)", () => {
  it("short-circuits validation before touching the detector", async () => {
    const { detect, factory, seen } = detector([{ rawValue: "X" }]);
    const outcome = await scanImageFile(file("notes.txt", 10, "text/plain"), factory);
    expect(outcome).toEqual({ ok: false, kind: "not-image", name: "notes.txt" });
    expect(detect).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it("returns the decoded value on the first pass", async () => {
    const { detect, factory } = detector([{ rawValue: "HELLO" }]);
    const outcome = await scanImageFile(file("a.png"), factory);
    expect(outcome).toEqual({ ok: true, value: "HELLO", count: 1 });
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("reports not-found without retrying when no bitmap exists", async () => {
    const { detect, factory } = detector([]);
    const outcome = await scanImageFile(file("a.png"), factory);
    expect(outcome).toEqual({ ok: false, kind: "not-found", name: "a.png" });
    // No createImageBitmap in jsdom → source is the file itself, single pass.
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("classifies a detect() throw as undecodable (§7.6)", async () => {
    const detect = vi.fn(async () => {
      throw new Error("engine choked on this image");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await scanImageFile(file("a.png"), async () => ({ detect }));
      expect(outcome).toEqual({ ok: false, kind: "undecodable", name: "a.png" });
      expect(detect).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("classifies a construction throw as decode-failed (AC9)", async () => {
    const makeDetector = vi.fn(async () => {
      throw new Error("wasm failed to load");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outcome = await scanImageFile(file("a.png"), makeDetector);
      expect(outcome).toEqual({ ok: false, kind: "decode-failed", name: "a.png" });
      // The engine never came up, so nothing was ever handed to it.
      expect(makeDetector).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("never leaks a bitmap handle: close is called once per decode", async () => {
    const close = vi.fn();
    const bitmap = { width: 800, height: 600, close };
    vi.stubGlobal("createImageBitmap", async () => bitmap);
    const { detect, factory } = detector([{ rawValue: "Y" }]);
    try {
      const outcome = await scanImageFile(file("a.png"), factory);
      expect(outcome.ok).toBe(true);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("releases the bitmap before the full-resolution retry", async () => {
    const close = vi.fn();
    const bitmap = { width: 2048, height: 1536, close };
    vi.stubGlobal("createImageBitmap", async () => bitmap);
    const { detect, factory, seen } = detector([]);
    try {
      const f = file("a.png");
      const outcome = await scanImageFile(f, factory);
      expect(outcome).toEqual({ ok: false, kind: "not-found", name: "a.png" });
      expect(detect).toHaveBeenCalledTimes(2);
      expect(close).toHaveBeenCalledTimes(1);
      expect(seen[1]).toBe(f); // second pass decodes the original file
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the retry above the pixel budget (bounded worst case)", async () => {
    // 9000x9000 > MAX_SIDE → resize path: first stub call is the natural
    // bitmap, second is the downscaled one. 81 MP > 40 MP budget → no retry.
    const natural = { width: 9000, height: 9000, close: vi.fn() };
    const downscaled = { width: 2048, height: 2048, close: vi.fn() };
    let calls = 0;
    vi.stubGlobal("createImageBitmap", async () => (++calls === 1 ? natural : downscaled));
    const { detect, factory } = detector([]);
    try {
      const outcome = await scanImageFile(file("big.png", 5 * MB), factory);
      expect(outcome).toEqual({ ok: false, kind: "not-found", name: "big.png" });
      expect(detect).toHaveBeenCalledTimes(1); // budget skipped the second pass
      expect(detect.mock.calls[0][0]).toBe(downscaled); // detector saw the small copy
      expect(natural.close).toHaveBeenCalledTimes(1);
      expect(downscaled.close).toHaveBeenCalledTimes(1); // closed in `finally`
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("classifies an un-rasterizable file as undecodable", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("unsupported encoding");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { detect, factory } = detector([{ rawValue: "X" }]);
      const outcome = await scanImageFile(file("broken.png"), factory);
      expect(outcome).toEqual({ ok: false, kind: "undecodable", name: "broken.png" });
      expect(detect).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
    }
  });
});

describe("offline wasm resolution (PWA)", () => {
  it("serves the reader binary from the app itself, under the deploy base", () => {
    // The regression this guards: the upstream default fetches this file from
    // jsDelivr, which makes image scanning the only feature that dies offline.
    expect(resolveWasmPath("zxing_reader.wasm", "/qr-scanner/")).toBe(
      `/qr-scanner/${ZXING_WASM_PATH}`
    );
    expect(resolveWasmPath("zxing_reader.wasm", "/")).toBe(`/${ZXING_WASM_PATH}`);
  });

  it("keeps the CDN fallback for variants that are not vendored", () => {
    // Only the reader is shipped; a writer/full request must still resolve
    // rather than 404 against our own origin.
    expect(resolveWasmPath("zxing_writer.wasm", "/qr-scanner/")).toContain(
      "zxing-wasm@2.2.4/dist/writer/zxing_writer.wasm"
    );
    // An unrecognised name is passed through untouched.
    expect(resolveWasmPath("something-else.js", "/qr-scanner/")).toBe(
      "something-else.js"
    );
  });

  it("exposes locateFile bound to a single base", () => {
    const locate = makeLocateFile("/qr-scanner/");
    expect(locate("zxing_reader.wasm")).toBe(`/qr-scanner/${ZXING_WASM_PATH}`);
  });
});

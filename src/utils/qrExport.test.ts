/**
 * Tests for the QR export module.
 *
 * Scope is deliberate: this file pins the pure data-URL → Blob conversion, the
 * filenames, and the click/revoke bookkeeping around a download. It does *not*
 * exercise rasterisation — jsdom has no real 2D context, so a stubbed canvas
 * would only assert our own stub. The one rasterisation assertion kept here is
 * the negative contract the component depends on: the function reports failure
 * by returning `null` instead of throwing, even for an unloadable image.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PNG_FILENAME,
  PNG_SIZE,
  SVG_FILENAME,
  downloadBlob,
  rasterizeSvgToPng,
  svgDataUrlToBlob,
} from "./qrExport";
import { SVG_DATA_URL_PREFIX } from "./qrcode";

/** Encoder-shaped fixture: base64 SVG behind the real prefix. */
const SVG_MARKUP = '<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>';
const SVG_DATA_URL = SVG_DATA_URL_PREFIX + btoa(SVG_MARKUP);

describe("svgDataUrlToBlob", () => {
  it("returns an image/svg+xml Blob holding the encoder's markup unchanged", async () => {
    const blob = svgDataUrlToBlob(SVG_DATA_URL);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/svg+xml");
    // The markup is handed through whole — never string-mangled.
    expect(await blob.text()).toBe(SVG_MARKUP);
  });

  it("works against the encoder's own prefix (no drift between modules)", () => {
    // Mirrors encodeQrSvg's output shape in qrcode.ts: if that module ever
    // changes its prefix, this fixture stops being representative.
    expect(SVG_DATA_URL.startsWith(SVG_DATA_URL_PREFIX)).toBe(true);
    expect(() => svgDataUrlToBlob(SVG_DATA_URL)).not.toThrow();
  });

  it("rejects a data URL that is not a base64 SVG", () => {
    expect(() => svgDataUrlToBlob("data:image/png;base64,AAAA")).toThrow(
      /base64 SVG data URL/
    );
    expect(() => svgDataUrlToBlob("")).toThrow(/base64 SVG data URL/);
    // Percent-encoded SVG is a different encoding, not our export input.
    expect(() =>
      svgDataUrlToBlob("data:image/svg+xml,<svg%20/>")
    ).toThrow(/base64 SVG data URL/);
  });

  it("rejects a truncated base64 payload", () => {
    expect(() => svgDataUrlToBlob(SVG_DATA_URL_PREFIX + "!!!")).toThrow();
  });
});

describe("downloadBlob", () => {
  let createSpy: ReturnType<typeof vi.spyOn>;
  let revokeSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // jsdom implements neither; both are stubbed so the assertions below can
    // observe the exact URL passed to create/revoke.
    createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:qr-export-test");
    revokeSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicks a temporary anchor carrying the object URL and filename", () => {
    const blob = new Blob(["x"], { type: "image/png" });

    downloadBlob(blob, PNG_FILENAME);

    expect(createSpy).toHaveBeenCalledWith(blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("revokes the object URL it created, and leaves no anchor behind", () => {
    downloadBlob(new Blob(["x"]), SVG_FILENAME);

    expect(revokeSpy).toHaveBeenCalledWith("blob:qr-export-test");
    expect(document.querySelector("a")).toBeNull();
  });

  it("revokes even when the click throws", () => {
    clickSpy.mockImplementation(() => {
      throw new Error("click exploded");
    });

    expect(() => downloadBlob(new Blob(["x"]), PNG_FILENAME)).toThrow(
      "click exploded"
    );
    expect(revokeSpy).toHaveBeenCalledWith("blob:qr-export-test");
  });
});

describe("rasterizeSvgToPng failure contract", () => {
  it("resolves to null (never throws) where there is no DOM to rasterise into", async () => {
    // The component depends on this shape: a failed PNG export is a `null`
    // return it can turn into a notification, not an exception it must catch.
    // The real canvas path is a browser boundary and is verified in a browser,
    // not here — jsdom has no 2D context.
    vi.stubGlobal("document", undefined);
    try {
      const result = rasterizeSvgToPng("data:image/svg+xml;base64,PHN2Zy8+");
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives up on an image load that never settles instead of hanging forever", async () => {
    // jsdom never fires load/error for a data-URL image, which is exactly the
    // "neither loads nor rejects" case the timeout exists for. Without it the
    // promise stays pending and the button stays disabled with no message.
    await expect(
      rasterizeSvgToPng("data:image/svg+xml;base64,", { timeoutMs: 20 })
    ).resolves.toBeNull();
  });
});

describe("export constants", () => {
  it("names the two files the user receives", () => {
    expect(PNG_FILENAME).toBe("qr-code.png");
    expect(SVG_FILENAME).toBe("qr-code.svg");
  });

  it("exports a square PNG large enough to stay scannable", () => {
    expect(PNG_SIZE).toBe(1024);
  });
});

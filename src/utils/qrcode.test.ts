/**
 * Behavioral tests for the pure encoder wrapper in qrcode.ts.
 * Uses Vitest; no DOM/jsdom needed beyond btoa (provided by jsdom in this
 * project's vitest config).
 */

import { describe, it, expect } from "vitest";
import {
  encodeQrSvg,
  utf8ByteLength,
  BYTE_MODE_MAX_BYTES,
  SVG_DATA_URL_PREFIX,
} from "./qrcode";

describe("utf8ByteLength", () => {
  it("counts ASCII one byte per character", () => {
    expect(utf8ByteLength("hello")).toBe(5);
  });

  it("counts multibyte characters, not JS code units", () => {
    expect(utf8ByteLength("🙂🙂")).toBe(8);
  });
});

describe("encodeQrSvg", () => {
  it("returns an ok no-op for empty input with no dataUrl", async () => {
    const result = await encodeQrSvg("");
    expect(result.ok).toBe(true);
    expect(result.dataUrl).toBeUndefined();
    expect(result.byteLength).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it("wraps rendered SVG as a base64 data URL with the correct prefix", async () => {
    const result = await encodeQrSvg("https://example.com");
    expect(result.ok).toBe(true);
    expect(result.dataUrl).toBeDefined();
    expect(result.dataUrl?.startsWith(SVG_DATA_URL_PREFIX)).toBe(true);
    expect(result.byteLength).toBe(19);
  });

  it("renders a 2,331-byte string (byte-mode capacity at EC M)", async () => {
    const text = "a".repeat(BYTE_MODE_MAX_BYTES);
    const result = await encodeQrSvg(text);
    expect(result.ok).toBe(true);
    expect(result.dataUrl).toBeDefined();
    expect(result.byteLength).toBe(BYTE_MODE_MAX_BYTES);
  });

  it("refuses a 2,953-byte mixed-case string in plain words", async () => {
    const text = "a".repeat(2953);
    const result = await encodeQrSvg(text);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("too-long");
    // The message no longer names the byte-mode limit (clarify: no mode/EC
    // jargon); the boundary itself stays pinned above and below.
    expect(result.message).toBe(
      "That is too long for one QR code. Purely numeric text fits the most — about 5,600 characters."
    );
  });

  it("renders a 5,000-digit numeric string (numeric mode exceeds byte capacity)", async () => {
    const text = "1".repeat(5000);
    const result = await encodeQrSvg(text);
    expect(result.ok).toBe(true);
    expect(result.dataUrl).toBeDefined();
    expect(result.byteLength).toBe(5000);
  });

  it("locks the numeric boundary at EC M: 5,596 digits fit, 5,597 are too long", async () => {
    expect((await encodeQrSvg("1".repeat(5596))).ok).toBe(true);
    const over = await encodeQrSvg("1".repeat(5597));
    expect(over.ok).toBe(false);
    expect(over.error).toBe("too-long");
    // Copy moved to plain words; the numeric figure the user is told now is
    // the numeric capacity (5,600 ≈ 5,596), not the byte-mode limit. Pinned
    // exactly here, at the boundary where the message is actually produced.
    expect(over.message).toBe(
      "That is too long for one QR code. Purely numeric text fits the most — about 5,600 characters."
    );
  });

  it("encodes emoji and counts its UTF-8 bytes", async () => {
    const result = await encodeQrSvg("🙂🙂");
    expect(result.ok).toBe(true);
    expect(result.byteLength).toBe(8);
  });

  it("produces pure-ASCII SVG markup safe for btoa", async () => {
    const result = await encodeQrSvg("https://example.com");
    expect(result.dataUrl).toBeDefined();
    // Decode the base64 back to the raw SVG string and assert Latin-1 purity.
    const raw = Buffer.from(
      result.dataUrl!.replace(SVG_DATA_URL_PREFIX, ""),
      "base64"
    ).toString("latin1");
    expect(raw.length).toBe(Buffer.byteLength(raw, "latin1"));
    expect(raw).toContain("<svg");
  });
});
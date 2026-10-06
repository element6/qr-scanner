import { describe, expect, it } from "vitest";

import { decodeBase32, encodeBase32 } from "./base32";

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);
const toAscii = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/**
 * jsdom hands the test file a `Uint8Array` from a different realm than the one
 * the module under test constructs, so `toEqual` on the typed arrays reports
 * "no visual difference" and fails. Compare the byte values, and assert the
 * return type separately.
 */
function expectBytes(result: ReturnType<typeof decodeBase32>, expected: string): void {
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.bytes)).toEqual(Array.from(ascii(expected)));
  }
}

describe("decodeBase32", () => {
  it("decodes the RFC 4648 vector MZXW6=== to 'foo'", () => {
    expectBytes(decodeBase32("MZXW6==="), "foo");
  });

  it("tolerates lower case input", () => {
    expectBytes(decodeBase32("mzxw6"), "foo");
    expectBytes(decodeBase32("MzXw6==="), "foo");
  });

  it("strips whitespace, including newlines and tabs", () => {
    expectBytes(decodeBase32(" mzxw 6 "), "foo");
    expectBytes(decodeBase32("MZ\nXW\t6"), "foo");
    expectBytes(decodeBase32("MZXW6===\n"), "foo");
  });

  it("treats trailing padding as optional", () => {
    expectBytes(decodeBase32("MZXW6"), "foo");
    expectBytes(decodeBase32("MZXW6YTBOI======"), "foobar");
  });

  it("rejects characters outside the RFC 4648 alphabet", () => {
    for (const bad of ["0", "1", "8", "9", "MZXW6!", "MZXW-6"]) {
      expect(decodeBase32(bad)).toEqual({ ok: false, error: "invalid base32 character" });
    }
  });

  it("rejects non-ASCII input", () => {
    expect(decodeBase32("MZXW6✓")).toEqual({ ok: false, error: "invalid base32 character" });
    expect(decodeBase32("секрет")).toEqual({ ok: false, error: "invalid base32 character" });
  });

  it("reports empty input, including padding-only input", () => {
    expect(decodeBase32("")).toEqual({ ok: false, error: "empty secret" });
    expect(decodeBase32("   ")).toEqual({ ok: false, error: "empty secret" });
    expect(decodeBase32("====")).toEqual({ ok: false, error: "empty secret" });
  });

  it("never throws on hostile input", () => {
    for (const bad of ["", "=", "\u0000", "MZXW6=AB", "🙂"]) {
      expect(() => decodeBase32(bad)).not.toThrow();
    }
  });
});

describe("encodeBase32", () => {
  it("matches the RFC 4648 test vectors without padding", () => {
    expect(encodeBase32(ascii(""))).toBe("");
    expect(encodeBase32(ascii("f"))).toBe("MY");
    expect(encodeBase32(ascii("fo"))).toBe("MZXQ");
    expect(encodeBase32(ascii("foo"))).toBe("MZXW6");
    expect(encodeBase32(ascii("foob"))).toBe("MZXW6YQ");
    expect(encodeBase32(ascii("fooba"))).toBe("MZXW6YTB");
    expect(encodeBase32(ascii("foobar"))).toBe("MZXW6YTBOI");
  });

  it("round-trips through decodeBase32", () => {
    for (const text of ["f", "foo", "foobar", "12345678901234567890"]) {
      const decoded = decodeBase32(encodeBase32(ascii(text)));
      expect(decoded.ok && toAscii(decoded.bytes)).toBe(text);
    }
  });

  it("emits uppercase only", () => {
    expect(encodeBase32(ascii("Hello, vault!"))).toMatch(/^[A-Z2-7]*$/);
  });
});

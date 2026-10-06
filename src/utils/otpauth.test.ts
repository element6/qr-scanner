/**
 * Behavioral tests for otpauth.ts — classification, strict parsing and
 * canonical round-tripping of `otpauth://` TOTP URIs.
 */

import { describe, it, expect } from "vitest";
import {
  scanKind,
  normalizeEntry,
  parseOtpauth,
  canonicalSecret,
  entryToUri,
  type OtpauthEntry,
  type ScanKind,
} from "./otpauth";

const SECRET = "JBSWY3DPEHPK3PXP";

describe("scanKind", () => {
  it("classifies plain text and URLs", () => {
    expect(scanKind("hello world")).toBe("text");
    expect(scanKind("not-a-url")).toBe("text");
    expect(scanKind("")).toBe("text");
    expect(scanKind("   ")).toBe("text");
    expect(scanKind("https://example.com")).toBe("url");
    expect(scanKind("http://localhost:3000/path?q=1")).toBe("url");
    expect(scanKind("ftp://example.com")).toBe("text");
  });

  it("classifies otpauth types by scheme and first path segment", () => {
    const kinds: Array<[string, ScanKind]> = [
      [`otpauth://totp/ACME:alice?secret=${SECRET}`, "otpauth-totp"],
      [`otpauth://hotp/ACME:alice?secret=${SECRET}&counter=0`, "otpauth-hotp"],
      [`otpauth://steam/alice?secret=${SECRET}`, "otpauth-other"],
      ["otpauth://", "otpauth-other"],
    ];
    for (const [value, expected] of kinds) {
      expect(scanKind(value)).toBe(expected);
    }
  });

  it("ignores surrounding whitespace and scheme case", () => {
    expect(scanKind(`  https://example.com  `)).toBe("url");
    expect(scanKind(`  hello  `)).toBe("text");
    expect(scanKind(`  otpauth://totp/ACME:alice?secret=${SECRET}  `)).toBe("otpauth-totp");
    expect(scanKind(`OTPAUTH://TOTP/ACME:alice?secret=${SECRET}`)).toBe("otpauth-totp");
    expect(scanKind(`OtPauth://HotP/ACME:alice?secret=${SECRET}`)).toBe("otpauth-hotp");
  });

  it("classifies real-world Google and Authy payloads", () => {
    expect(
      scanKind("otpauth://totp/Google:alice@gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=Google"),
    ).toBe("otpauth-totp");
    expect(
      scanKind(
        "otpauth://totp/Authy:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Authy&algorithm=SHA1&digits=6&period=30",
      ),
    ).toBe("otpauth-totp");
  });

  it("never throws on hostile input", () => {
    for (const value of ["%", "otpauth:", "otpauth://", "://", "otpauth://totp/%E0%A4%A"]) {
      expect(() => scanKind(value)).not.toThrow();
    }
    expect(() => scanKind(null as unknown as string)).not.toThrow();
  });
});

describe("parseOtpauth", () => {
  it("parses a full URI with every parameter", () => {
    expect(
      parseOtpauth(
        `otpauth://totp/ACME%20Co:alice@example.com?secret=${SECRET}&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60`,
      ),
    ).toEqual({
      ok: true,
      entry: {
        issuer: "ACME Co",
        account: "alice@example.com",
        secret: SECRET,
        algorithm: "SHA256",
        digits: 8,
        period: 60,
      },
    });
  });

  it("applies RFC 6238 defaults for a minimal URI", () => {
    expect(parseOtpauth(`otpauth://totp/ACME:alice?secret=${SECRET}`)).toEqual({
      ok: true,
      entry: {
        issuer: "ACME",
        account: "alice",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
    });
  });

  it("takes the issuer query param over the label prefix", () => {
    const result = parseOtpauth(
      `otpauth://totp/LabelIssuer:alice@example.com?secret=${SECRET}&issuer=QueryIssuer`,
    );
    expect(result).toEqual({
      ok: true,
      entry: {
        issuer: "QueryIssuer",
        account: "alice@example.com",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
    });
  });

  it("leaves issuer empty when the label has no prefix and no query param", () => {
    expect(parseOtpauth(`otpauth://totp/alice@example.com?secret=${SECRET}`)).toEqual({
      ok: true,
      entry: {
        issuer: "",
        account: "alice@example.com",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
    });
  });

  it("percent-decodes issuer and account", () => {
    expect(
      parseOtpauth(`otpauth://totp/ACME%20Co%3Ajohn%40example.com?secret=${SECRET}`),
    ).toEqual({
      ok: true,
      entry: {
        issuer: "ACME Co",
        account: "john@example.com",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
    });
  });

  it("accepts a lowercase scheme and type", () => {
    const result = parseOtpauth(`otpauth://totp/ACME:alice?secret=${SECRET}`);
    expect(result.ok).toBe(true);
  });

  it("accepts dashed and lowercase algorithm names", () => {
    for (const algorithm of ["sha-256", "SHA256", "Sha-256"]) {
      const result = parseOtpauth(`otpauth://totp/ACME:alice?secret=${SECRET}&algorithm=${algorithm}`);
      expect(result).toEqual({
        ok: true,
        entry: {
          issuer: "ACME",
          account: "alice",
          secret: SECRET,
          algorithm: "SHA256",
          digits: 6,
          period: 30,
        },
      });
    }
  });

  it("canonicalises a padded, mixed-case, spaced secret", () => {
    const result = parseOtpauth("otpauth://totp/ACME:alice?secret=jbswy3dp%20ehpk3pxp%3D%3D");
    expect(result).toEqual({
      ok: true,
      entry: {
        issuer: "ACME",
        account: "alice",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
    });
  });

  it("rejects hotp", () => {
    expect(parseOtpauth(`otpauth://hotp/ACME:alice?secret=${SECRET}&counter=0`)).toEqual({
      ok: false,
      error: "hotp-not-supported",
    });
  });

  it("rejects a missing or unusable secret", () => {
    expect(parseOtpauth("otpauth://totp/ACME:alice")).toEqual({
      ok: false,
      error: "missing secret",
    });
    expect(parseOtpauth("otpauth://totp/ACME:alice?secret=")).toEqual({
      ok: false,
      error: "missing secret",
    });
  });

  it("rejects secrets outside the RFC 4648 alphabet", () => {
    for (const bad of ["JBSWY3DPEHPK3PX0", "JBSWY3DPEHPK3PX1", "JBSWY3DPEHPK3PX8", "JBSWY3DPEHPK3PX9"]) {
      expect(parseOtpauth(`otpauth://totp/ACME:alice?secret=${bad}`)).toEqual({
        ok: false,
        error: "invalid secret alphabet",
      });
    }
  });

  it("rejects out-of-range period, digits and algorithm", () => {
    expect(parseOtpauth(`otpauth://totp/ACME:alice?secret=${SECRET}&period=0`)).toEqual({
      ok: false,
      error: "period out of range",
    });
    expect(parseOtpauth(`otpauth://totp/ACME:alice?secret=${SECRET}&period=301`)).toEqual({
      ok: false,
      error: "period out of range",
    });
    expect(parseOtpauth(`otpauth://totp/ACME:alice?secret=${SECRET}&digits=7`)).toEqual({
      ok: false,
      error: "digits must be 6 or 8",
    });
    expect(parseOtpauth(`otpauth://totp/ACME:alice?secret=${SECRET}&algorithm=MD5`)).toEqual({
      ok: false,
      error: "unsupported algorithm",
    });
  });

  it("rejects malformed URIs and unsupported types", () => {
    expect(parseOtpauth("garbage string")).toEqual({
      ok: false,
      error: "malformed otpauth uri",
    });
    expect(parseOtpauth("https://example.com")).toEqual({
      ok: false,
      error: "malformed otpauth uri",
    });
    expect(parseOtpauth(`otpauth://steam/alice?secret=${SECRET}`)).toEqual({
      ok: false,
      error: "unsupported type",
    });
    expect(parseOtpauth(`otpauth:///alice?secret=${SECRET}`)).toEqual({
      ok: false,
      error: "unsupported type",
    });
  });

  it("never throws on hostile input", () => {
    for (const value of ["", "%", "otpauth://totp/%E0%A4%A", "otpauth://totp/"]) {
      expect(() => parseOtpauth(value)).not.toThrow();
    }
  });
});

describe("normalizeEntry", () => {
  it("applies defaults and trims", () => {
    expect(normalizeEntry({ account: "  alice  ", secret: ` ${SECRET} ` })).toEqual({
      ok: true,
      entry: {
        issuer: "",
        account: "alice",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
    });
  });

  it("keeps an empty issuer but requires an account", () => {
    expect(normalizeEntry({ issuer: "", account: "alice", secret: SECRET })).toEqual({
      ok: true,
      entry: {
        issuer: "",
        account: "alice",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
    });
    expect(normalizeEntry({ account: "", secret: SECRET })).toEqual({
      ok: false,
      error: "missing account",
    });
    expect(normalizeEntry({ account: "   ", secret: SECRET })).toEqual({
      ok: false,
      error: "missing account",
    });
    expect(normalizeEntry({ secret: SECRET })).toEqual({ ok: false, error: "missing account" });
  });

  it("canonicalises mixed case, padding and internal whitespace in the secret", () => {
    for (const raw of ["jbswy3dpehpk3pxp==", "JBSW Y3DP EHPK 3PXP", " jbswy3dpehpk3pxp "]) {
      const result = normalizeEntry({ account: "alice", secret: raw });
      expect(result.ok && result.entry.secret).toBe(SECRET);
    }
  });

  it("accepts each supported algorithm spelling", () => {
    const cases: Array<[string, OtpauthEntry["algorithm"]]> = [
      ["SHA1", "SHA1"],
      ["sha1", "SHA1"],
      ["sha-1", "SHA1"],
      ["SHA-256", "SHA256"],
      ["sha512", "SHA512"],
    ];
    for (const [input, expected] of cases) {
      const result = normalizeEntry({ account: "alice", secret: SECRET, algorithm: input });
      expect(result.ok && result.entry.algorithm).toBe(expected);
    }
  });

  it("accepts numeric strings and numbers for digits and period", () => {
    const result = normalizeEntry({
      account: "alice",
      secret: SECRET,
      digits: "8",
      period: "60",
    });
    expect(result.ok && result.entry.digits).toBe(8);
    expect(result.ok && result.entry.period).toBe(60);
    expect(normalizeEntry({ account: "alice", secret: SECRET, digits: 8, period: 1 })).toEqual({
      ok: true,
      entry: {
        issuer: "",
        account: "alice",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 8,
        period: 1,
      },
    });
  });

  it("treats an empty form field as unset", () => {
    expect(normalizeEntry({ account: "alice", secret: SECRET, algorithm: "", digits: "", period: "" }))
      .toEqual({
        ok: true,
        entry: {
          issuer: "",
          account: "alice",
          secret: SECRET,
          algorithm: "SHA1",
          digits: 6,
          period: 30,
        },
      });
  });

  it("reports every rejection path", () => {
    const cases: Array<[Parameters<typeof normalizeEntry>[0], string]> = [
      [{ account: "alice" }, "missing secret"],
      [{ account: "alice", secret: "" }, "missing secret"],
      [{ account: "alice", secret: "===" }, "missing secret"],
      [{ account: "alice", secret: "JBSWY3DPEHPK3PX0" }, "invalid secret alphabet"],
      [{ account: "alice", secret: "JBSWY3DPEHPK3PXP1" }, "invalid secret alphabet"],
      [{ account: "alice", secret: "JBSWY3DPEHPK3PXP9" }, "invalid secret alphabet"],
      [{ account: "alice", secret: "JBSWY3DP" }, "invalid secret length"],
      [{ account: "alice", secret: SECRET, algorithm: "MD5" }, "unsupported algorithm"],
      [{ account: "alice", secret: SECRET, algorithm: "SHA3" }, "unsupported algorithm"],
      [{ account: "alice", secret: SECRET, digits: "7" }, "digits must be 6 or 8"],
      [{ account: "alice", secret: SECRET, digits: 7 }, "digits must be 6 or 8"],
      [{ account: "alice", secret: SECRET, digits: "6.0" }, "digits must be 6 or 8"],
      [{ account: "alice", secret: SECRET, period: "0" }, "period out of range"],
      [{ account: "alice", secret: SECRET, period: 301 }, "period out of range"],
      [{ account: "alice", secret: SECRET, period: -1 }, "period out of range"],
      [{ account: "alice", secret: SECRET, period: 30.5 }, "period out of range"],
      [{ account: "alice", secret: SECRET, period: "abc" }, "period out of range"],
    ];
    for (const [fields, error] of cases) {
      expect(normalizeEntry(fields)).toEqual({ ok: false, error });
    }
  });
});

describe("canonicalSecret", () => {
  it("uppercases and strips whitespace and padding without validating", () => {
    expect(canonicalSecret("jbswy3dpehpk3pxp==")).toBe(SECRET);
    expect(canonicalSecret("JBSW Y3DP\tEHPK\n3PXP")).toBe(SECRET);
    expect(canonicalSecret("====")).toBe("");
    expect(canonicalSecret("not!base32")).toBe("NOT!BASE32");
  });
});

describe("entryToUri", () => {
  it("always emits all five query params and a dashed-free algorithm", () => {
    const uri = entryToUri({
      issuer: "ACME Co",
      account: "alice@example.com",
      secret: SECRET,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    expect(uri).toBe(
      `otpauth://totp/ACME%20Co:alice%40example.com?secret=${SECRET}&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it("percent-encodes unicode and omits the label prefix for an empty issuer", () => {
    const withIssuer = entryToUri({
      issuer: "Café 🔐",
      account: "Ünïcode ✓",
      secret: SECRET,
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
    expect(withIssuer).toContain("otpauth://totp/Caf%C3%A9%20%F0%9F%94%90:%C3%9Cn%C3%AFcode%20%E2%9C%93?");
    expect(withIssuer).toContain("issuer=Caf%C3%A9%20%F0%9F%94%90");

    const withoutIssuer = entryToUri({
      issuer: "",
      account: "alice@example.com",
      secret: SECRET,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    expect(withoutIssuer).toBe(
      `otpauth://totp/alice%40example.com?secret=${SECRET}&issuer=&algorithm=SHA1&digits=6&period=30`,
    );
  });

  it("round-trips every fixture through parseOtpauth unchanged", () => {
    const fixtures: OtpauthEntry[] = [
      {
        issuer: "",
        account: "alice@example.com",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      },
      {
        issuer: "Café 🔐",
        account: "Ünïcode ✓",
        secret: "MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43U",
        algorithm: "SHA512",
        digits: 8,
        period: 60,
      },
      {
        issuer: "ACME Co",
        account: "alice:admin",
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        algorithm: "SHA256",
        digits: 6,
        period: 1,
      },
      {
        issuer: "Big Corp & Sons + Co",
        account: "bob?x=1#frag/../",
        secret: SECRET,
        algorithm: "SHA1",
        digits: 8,
        period: 300,
      },
    ];

    for (const entry of fixtures) {
      expect(parseOtpauth(entryToUri(entry))).toEqual({ ok: true, entry });
    }
  });
});

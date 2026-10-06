import { describe, expect, it } from "vitest";

import { generateTotp, totpStep } from "./totp";
import type { TotpAlgorithm } from "./totp";

/**
 * RFC 6238 Appendix B uses a DIFFERENT secret length per algorithm; reusing the
 * 20-byte SHA-1 secret for SHA-256/512 is the classic way these tests fail.
 * Base32 values below were cross-checked with node's crypto and python's
 * base64.b32encode (padding stripped, since decodeBase32 tolerates no padding).
 */
const SECRETS: Record<TotpAlgorithm, string> = {
  SHA1: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", // ASCII "12345678901234567890"
  SHA256: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA", // ASCII "...9012" x2
  SHA512:
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA",
};

/** [time (s), SHA1, SHA256, SHA512] — RFC 6238 Appendix B, 8 digits, period 30. */
const RFC_VECTORS: Array<[number, string, string, string]> = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"],
];

const ALGORITHMS: TotpAlgorithm[] = ["SHA1", "SHA256", "SHA512"];

async function code(
  algorithm: TotpAlgorithm,
  timeSeconds: number,
  digits: 6 | 8 = 8,
  period = 30,
): Promise<string | undefined> {
  const result = await generateTotp({
    secret: SECRETS[algorithm],
    algorithm,
    digits,
    period,
    timeMs: timeSeconds * 1000,
  });
  return result.ok ? result.code : undefined;
}

describe("totpStep", () => {
  it("floors the step at exact boundaries", () => {
    expect(totpStep(0, 30)).toBe(0n);
    expect(totpStep(29_999, 30)).toBe(0n);
    expect(totpStep(30_000, 30)).toBe(1n);
    expect(totpStep(59_999, 30)).toBe(1n);
    expect(totpStep(60_000, 30)).toBe(2n);
  });

  it("honours non-30s periods", () => {
    expect(totpStep(59_000, 60)).toBe(0n);
    expect(totpStep(60_000, 60)).toBe(1n);
    expect(totpStep(60_000, 1)).toBe(60n);
  });

  it("stays exact past 2^31 seconds", () => {
    // 20_000_000_000 > 2^31 (2_147_483_648): number bit-ops would wrap here.
    expect(totpStep(20_000_000_000_000, 30)).toBe(666_666_666n);
    expect(totpStep(20_000_000_000_000, 30) * 30n).toBe(19_999_999_980n);
  });
});

describe("generateTotp — RFC 6238 Appendix B", () => {
  for (let i = 0; i < RFC_VECTORS.length; i += 1) {
    const [timeSeconds, sha1, sha256, sha512] = RFC_VECTORS[i];
    const expected: Record<TotpAlgorithm, string> = { SHA1: sha1, SHA256: sha256, SHA512: sha512 };
    for (const algorithm of ALGORITHMS) {
      it(`${algorithm} at T=${timeSeconds} → ${expected[algorithm]}`, async () => {
        await expect(code(algorithm, timeSeconds)).resolves.toBe(expected[algorithm]);
      });
    }
  }

  it("truncates to 6 digits", async () => {
    await expect(code("SHA1", 59, 6)).resolves.toBe("287082");
    await expect(code("SHA256", 59, 6)).resolves.toBe("119246");
  });

  it("accepts padded, lower-case secrets", async () => {
    const padded = `${SECRETS.SHA1}====`;
    const result = await generateTotp({
      secret: ` ${padded.toLowerCase()} `,
      algorithm: "SHA1",
      digits: 8,
      period: 30,
      timeMs: 59_000,
    });
    expect(result).toEqual({ ok: true, code: "94287082", stepEndsAtMs: 60_000 });
  });
});

describe("generateTotp — results and errors", () => {
  it("reports the step end for the UI countdown", async () => {
    await expect(
      generateTotp({
        secret: SECRETS.SHA1,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        timeMs: 1_234_567_890_000,
      }),
    ).resolves.toEqual({ ok: true, code: "005924", stepEndsAtMs: 1_234_567_920_000 });
  });

  it("keeps stepEndsAtMs exact past 2^31 seconds", async () => {
    const result = await generateTotp({
      secret: SECRETS.SHA1,
      algorithm: "SHA1",
      digits: 8,
      period: 30,
      timeMs: 20_000_000_000_000,
    });
    // step 666666666 → (666666667 * 30) * 1000
    expect(result.ok && result.stepEndsAtMs).toBe(20_000_000_010_000);
  });

  it("propagates base32 errors", async () => {
    await expect(
      generateTotp({
        secret: "0123456789",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        timeMs: 0,
      }),
    ).resolves.toEqual({ ok: false, error: "invalid base32 character" });

    await expect(
      generateTotp({ secret: "", algorithm: "SHA1", digits: 6, period: 30, timeMs: 0 }),
    ).resolves.toEqual({ ok: false, error: "empty secret" });
  });

  it("rejects a non-positive period", async () => {
    for (const period of [0, -30, Number.NaN]) {
      await expect(
        generateTotp({
          secret: SECRETS.SHA1,
          algorithm: "SHA1",
          digits: 6,
          period,
          timeMs: 59_000,
        }),
      ).resolves.toEqual({ ok: false, error: "invalid period" });
    }
  });

  it("reports webcrypto unavailable instead of throwing", async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
    try {
      await expect(
        generateTotp({
          secret: SECRETS.SHA1,
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          timeMs: 59_000,
        }),
      ).resolves.toEqual({ ok: false, error: "webcrypto unavailable" });
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });

  it("never throws on hostile input", async () => {
    await expect(
      generateTotp({
        secret: "MZXW6",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        timeMs: Number.NaN,
      }),
    ).resolves.toBeDefined();
  });
});

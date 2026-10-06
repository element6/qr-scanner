/**
 * RFC 6238 TOTP over WebCrypto, hand-rolled to keep the zero-dependency rule.
 *
 * Pure module: no DOM, no storage, no timers — the caller supplies `timeMs`, so
 * codes are deterministic and testable against the RFC vectors.
 */

import { decodeBase32 } from "./base32";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export type TotpResult =
  | { ok: true; code: string; stepEndsAtMs: number }
  | { ok: false; error: string };

/** WebCrypto hash names, mapped from the otpauth-style algorithm labels. */
const HASH_NAME: Record<TotpAlgorithm, string> = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

/** Precomputed so the modulo never depends on float `10 ** digits`. */
const MODULUS: Record<6 | 8, number> = { 6: 1_000_000, 8: 100_000_000 };

/**
 * Computes the TOTP counter (RFC 6238 step) for a wall-clock time.
 *
 * BigInt, not `Math.floor(t / 1000 / period)`: the counter is a 64-bit value and
 * past 2038 the seconds value exceeds 32-bit bit-ops, so `<<` based math would
 * produce the wrong code for no visible reason. Truncating division of
 * non-negative BigInts is exactly the required floor.
 *
 * @param timeMs - Unix time in milliseconds
 * @param period - step size in seconds; must be a positive integer
 * @returns the counter `floor(timeMs / 1000 / period)`
 *
 * @example
 * ```ts
 * totpStep(59_000, 30)          // 1n
 * totpStep(60_000, 30)          // 2n (exact boundary rolls over)
 * totpStep(20_000_000_000_000, 30) // 666666666n
 * ```
 */
export function totpStep(timeMs: number, period: number): bigint {
  const step = Math.trunc(period);
  // `generateTotp` rejects a bad period before calling this; returning 0n here
  // keeps the exported helper total instead of throwing a BigInt division error.
  if (!Number.isFinite(step) || step < 1 || !Number.isFinite(timeMs)) {
    return 0n;
  }
  return BigInt(Math.floor(timeMs / 1000)) / BigInt(step);
}

/**
 * Generates the TOTP code for a secret at a given instant.
 *
 * counter (8-byte big-endian) → HMAC-SHA{1,256,512} keyed with the raw secret →
 * RFC 4226 §5.3 dynamic truncation → modulo 10^digits, zero-padded.
 *
 * `stepEndsAtMs` is the wall-clock expiry of this code, which the UI uses to
 * drive the countdown ring without re-deriving the period from the step.
 *
 * @param p - secret, algorithm, digits, period and the time to evaluate at
 * @returns the zero-padded code plus its expiry, or an error string
 *
 * @example
 * ```ts
 * await generateTotp({
 *   secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
 *   algorithm: "SHA1",
 *   digits: 8,
 *   period: 30,
 *   timeMs: 59_000,
 * }); // { ok: true, code: "94287082", stepEndsAtMs: 60000 }
 * ```
 */
export async function generateTotp(p: {
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  timeMs: number;
}): Promise<TotpResult> {
  const period = Math.trunc(p.period);
  if (!Number.isFinite(period) || period < 1) {
    return { ok: false, error: "invalid period" };
  }

  const decoded = decodeBase32(p.secret);
  if (!decoded.ok) {
    return { ok: false, error: decoded.error };
  }

  const hashName = HASH_NAME[p.algorithm];
  if (hashName === undefined) {
    return { ok: false, error: "unsupported algorithm" };
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return { ok: false, error: "webcrypto unavailable" };
  }

  const step = totpStep(p.timeMs, period);

  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, step);

  let mac: Uint8Array;
  try {
    const key = await subtle.importKey(
      "raw",
      // Copy: the decode result is typed `Uint8Array<ArrayBufferLike>`, which is
      // not assignable to WebCrypto's `BufferSource` (`ArrayBuffer`-backed only).
      Uint8Array.from(decoded.bytes),
      { name: "HMAC", hash: { name: hashName } },
      false,
      ["sign"],
    );
    mac = new Uint8Array(await subtle.sign("HMAC", key, counter));
  } catch {
    // A rejected key or a runtime without HMAC must surface as a value, not an
    // exception: callers render an error row instead of crashing the vault tab.
    return { ok: false, error: "webcrypto unavailable" };
  }

  // Dynamic truncation: the low nibble of the last byte picks the 4-byte window,
  // whose top bit is masked off to stay a positive 31-bit integer.
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  const code = String(binary % MODULUS[p.digits]).padStart(p.digits, "0");
  const stepEndsAtMs = Number((step + 1n) * BigInt(period) * 1000n);

  return { ok: true, code, stepEndsAtMs };
}

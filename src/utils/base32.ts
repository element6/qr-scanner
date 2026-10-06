/**
 * RFC 4648 base32 (alphabet A-Z2-7) encoding and decoding.
 *
 * Hand-rolled rather than pulled from a dependency: the 2FA vault runs on
 * WebCrypto only, and a base32 codec is ~40 lines. This is the single
 * implementation in the codebase — nothing else decodes base32 secrets.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * A normalized secret contains only alphabet characters. Validating BEFORE
 * decoding keeps the per-character lookup total: a stray character would
 * otherwise decode to index -1 and silently corrupt every downstream byte.
 */
const NORMALIZED = /^[A-Z2-7]*$/;

export type Base32DecodeResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

/**
 * Decodes an RFC 4648 base32 secret into raw bytes.
 *
 * Whitespace is removed and the input is uppercased first, because secrets are
 * pasted from authenticator UIs that group them ("GEZD GNBV ...") and users
 * type them in lower case. Trailing "=" padding is optional. Never throws:
 * failures are values the caller branches on.
 *
 * The leftover partial group is discarded, matching the standard's rule that
 * unused trailing bits are zero. Note this means a non-multiple-of-8 input is
 * accepted (padding is not required), which is what real otpauth URIs contain.
 *
 * @param input - base32 text, any case, whitespace and padding tolerated
 * @returns the decoded bytes, or an error string describing the first problem
 *
 * @example
 * ```ts
 * decodeBase32("MZXW6===") // { ok: true, bytes: <66 6f 6f> } ("foo")
 * decodeBase32("mzxw 6")   // { ok: true, bytes: <66 6f 6f> }
 * decodeBase32("")         // { ok: false, error: "empty secret" }
 * decodeBase32("0189")     // { ok: false, error: "invalid base32 character" }
 * ```
 */
export function decodeBase32(input: string): Base32DecodeResult {
  const normalized = input.replace(/\s/g, "").toUpperCase().replace(/=+$/, "");

  if (normalized.length === 0) {
    return { ok: false, error: "empty secret" };
  }
  if (!NORMALIZED.test(normalized)) {
    return { ok: false, error: "invalid base32 character" };
  }

  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    buffer = (buffer << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      // Keep only the unconsumed low bits: without this the accumulator grows
      // past 32 bits on long secrets and JS bit-ops silently wrap.
      buffer &= (1 << bits) - 1;
    }
  }

  return { ok: true, bytes: Uint8Array.from(bytes) };
}

/**
 * Encodes raw bytes as unpadded, uppercase base32.
 *
 * No padding is emitted because the decoder here (and otpauth URIs generally)
 * treats "=" as optional; round-tripping is unaffected.
 *
 * @param bytes - the raw bytes to encode
 * @returns the base32 text, uppercase, without "=" padding
 *
 * @example
 * ```ts
 * encodeBase32(new Uint8Array([]))                        // ""
 * encodeBase32(new TextEncoder().encode("foo"))           // "MZXW6"
 * encodeBase32(new TextEncoder().encode("foobar"))        // "MZXW6YTBOI"
 * ```
 */
export function encodeBase32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >>> bits) & 31];
    }
  }

  if (bits > 0) {
    out += ALPHABET[(buffer << (5 - bits)) & 31];
  }

  return out;
}

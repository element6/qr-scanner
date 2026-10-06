/**
 * Vault crypto — every cryptographic operation the offline 2FA vault needs.
 *
 * Layer split, mirroring `qrExport.ts`:
 *
 * - Pure byte helpers: `b64`, `unb64`, `randomB64`, `canonicalAad`.
 * - Key derivation: `derivePinVek` (PBKDF2) and `derivePrfVek` (HKDF over a
 *   WebAuthn PRF output).
 * - Authenticated encryption: `aesGcmEncrypt` / `aesGcmDecrypt`, wrapped by
 *   the three AAD builders `pinWrapAad`, `prfWrapAad`, `entriesAad`.
 *
 * Three security properties this file exists to enforce, each with the code
 * that enforces it:
 *
 * 1. The record header (version, vaultId, kdf, prfSalt) is *authenticated*.
 *    It is fed to AES-GCM as AAD — never stored as plaintext alongside the
 *    ciphertext it is supposed to protect — so a tampered version, a swapped
 *    vaultId or a downgraded iteration count fails the tag check loudly
 *    instead of decrypting to garbage.
 * 2. PIN and PRF wraps carry *per-context* AAD (`context: "pin"` vs
 *    `context: "prf"`). The PIN AAD commits to the KDF parameters, the PRF
 *    AAD commits to the PRF salt; neither commits to the other's, so the PRF
 *    path never inherits the PIN's KDF parameters and the two AES-GCM keys
 *    are not interchangeable across contexts.
 * 3. Every entry lives in ONE AES-GCM blob (`entriesAad`). There is no
 *    per-entry ciphertext to reorder or substitute: any splice is a tag
 *    failure on the single blob.
 *
 * WebCrypto only — no new dependency, no server, no plaintext key material
 * kept anywhere. Bytes in, base64 out; this module never touches localStorage
 * (the storage record lives in a companion module).
 */

/** PBKDF2 iteration count for the PIN path. Deliberately slow to derive. */
export const KDF_ITERATIONS = 600_000;

/** Digest used by both PBKDF2 (PIN path) and HKDF (PRF path). */
export const KDF_HASH = "SHA-256" as const;

/** Standard (padded) base64 string. */
export type B64 = string;

/** PBKDF2/HKDF output length in bytes — one AES-256 key. */
const VEKM_BYTES = 32;

/** AES-GCM nonce length in bytes. 96 bits is the value GCM is specified for. */
const GCM_IV_BYTES = 12;

/** AES-GCM authentication tag length in bits, passed explicitly (never defaulted). */
const GCM_TAG_BITS = 128;

/**
 * HKDF `info` — domain separation for the PRF path.
 *
 * Without it the raw PRF output would be usable as an AES key by anything else
 * that can read the same authenticator output, and any future PRF-derived
 * secret would collide with this one. Versioned so a change of construction is
 * a new string rather than a silent break of existing vaults.
 */
const PRF_HKDF_INFO = "qr2fa/prf-kek v1";

const textEncoder = new TextEncoder();

/**
 * Hand a byte array to WebCrypto.
 *
 * `BufferSource` demands an `ArrayBuffer`-backed view, while a bare
 * `Uint8Array` in this module's signatures is `ArrayBufferLike` — the compiler
 * cannot rule out a `SharedArrayBuffer` backing, which WebCrypto refuses. No
 * array reaching this module is shared-backed (they come from
 * `getRandomValues`, `TextEncoder`, `atob`, or the caller's own buffer), so the
 * narrowing is sound.
 *
 * It is a cast over the same view, never a copy: `byteOffset`/`byteLength` are
 * preserved (so a subarray stays a subarray) and entry plaintext is not
 * duplicated in memory.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as BufferSource;
}

/**
 * Canonical base64 alphabet, padded, no whitespace.
 *
 * Padding is *required* on input (see `unb64`): one canonical encoding per byte
 * string means a header field cannot be re-encoded into a second valid AAD.
 */
const B64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** Chunk size for `String.fromCharCode`, kept under the argument-count limit. */
const BIN_CHUNK = 0x8000;

/**
 * Encode bytes as standard padded base64.
 *
 * @example
 * b64(new Uint8Array([0, 255])); // "AP8="
 */
export function b64(bytes: Uint8Array): B64 {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BIN_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BIN_CHUNK));
  }
  return btoa(binary);
}

/**
 * Decode standard padded base64 to bytes.
 *
 * Returns `null` instead of throwing on *any* malformed input: this runs on
 * bytes read back from storage, where a corrupt record must degrade to "cannot
 * decrypt", never to an exception that skips a security check further up.
 * Unpadded input is rejected as non-canonical even though RFC 4648 permits it —
 * `b64` always pads, so accepting a second spelling would only widen the set of
 * accepted AAD/IV/ciphertext encodings.
 *
 * @example
 * unb64("AP8=");   // Uint8Array [0, 255]
 * unb64("!!!!"); // null
 */
export function unb64(s: B64): Uint8Array | null {
  if (typeof s !== "string" || s.length % 4 !== 0 || !B64_PATTERN.test(s)) {
    return null;
  }
  try {
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    // `atob` is stricter than the pattern above in some engines (e.g. it
    // rejects a padded payload whose final quantum encodes no bits).
    return null;
  }
}

/**
 * Cryptographically random bytes, base64-encoded. Used for IVs and salts.
 *
 * @example
 * randomB64(12).length; // 16 — 12 bytes plus padding
 */
export function randomB64(nBytes: number): B64 {
  return b64(crypto.getRandomValues(new Uint8Array(nBytes)));
}

/**
 * Serialise one JSON value with keys sorted lexicographically and no
 * whitespace — the canonical form behind `canonicalAad`.
 *
 * Hand-written rather than `JSON.stringify(value, replacer)`: a replacer can
 * reorder arrays but not object keys, so stringifying would leave the encoding
 * at the mercy of property insertion order and `{a,b}` and `{b,a}` would
 * produce different AAD for the same logical header.
 *
 * An `undefined` value, a non-finite number or a non-JSON type throws instead
 * of being dropped or coerced: `JSON.stringify` would silently omit
 * `{ iterations: undefined }` and turn `NaN` into `null`, both of which encode
 * a *different* header as the same bytes — exactly the collision AAD must not
 * have.
 */
function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("canonicalAad: non-finite number");
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`canonicalAad: unsupported value type ${typeof value}`);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value instanceof Uint8Array) {
    throw new TypeError("canonicalAad: pass bytes as base64, not Uint8Array");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const body = entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(",");
  return `{${body}}`;
}

/**
 * Deterministic UTF-8 bytes for an AAD payload.
 *
 * @example
 * canonicalAad({ b: 1, a: 2 }); // same bytes as canonicalAad({ a: 2, b: 1 })
 */
export function canonicalAad(parts: Record<string, unknown>): Uint8Array {
  return textEncoder.encode(canonicalJson(parts));
}

/**
 * Derive the PIN-wrapped vault encryption key.
 *
 * @throws {Error} when `saltB64` is not canonical base64 — a malformed salt
 * would otherwise silently derive from *some* other salt, producing a vault
 * that opens with the wrong PIN material. PIN *strength* is not checked here;
 * the caller validates the PIN before deriving.
 *
 * @example
 * const salt = randomB64(16);
 * const vek = await derivePinVek("1234", salt); // 32 bytes
 */
export async function derivePinVek(
  pin: string,
  saltB64: B64,
  iterations: number = KDF_ITERATIONS
): Promise<Uint8Array> {
  const salt = unb64(saltB64);
  if (salt === null) {
    throw new Error("derivePinVek: salt is not canonical base64");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    asBufferSource(textEncoder.encode(pin)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: asBufferSource(salt), iterations, hash: KDF_HASH },
    material,
    VEKM_BYTES * 8
  );
  return new Uint8Array(bits);
}

/**
 * Derive the PRF-wrapped vault encryption key from a WebAuthn PRF output.
 *
 * HKDF rather than using `prfOutput` directly: it domain-separates this use
 * (`PRF_HKDF_INFO`) from any other consumer of the same authenticator secret
 * and from the PIN path, and it mixes in `prfSaltB64` so a re-enrolment with a
 * new salt yields a new key from the same authenticator.
 *
 * @throws {Error} when `prfSaltB64` is not canonical base64. Treating a
 * malformed salt as HKDF's "absent salt" (all-zero) mode would be a silent
 * downgrade to a derivation the header did not ask for.
 *
 * @example
 * const vek = await derivePrfVek(prfOutput32Bytes, randomB64(32));
 */
export async function derivePrfVek(
  prfOutput: Uint8Array,
  prfSaltB64: B64
): Promise<Uint8Array> {
  const salt = unb64(prfSaltB64);
  if (salt === null) {
    throw new Error("derivePrfVek: prfSalt is not canonical base64");
  }
  const material = await crypto.subtle.importKey("raw", asBufferSource(prfOutput), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: KDF_HASH,
      salt: asBufferSource(salt),
      info: asBufferSource(textEncoder.encode(PRF_HKDF_INFO)),
    },
    material,
    VEKM_BYTES * 8
  );
  return new Uint8Array(bits);
}

/**
 * AAD for the PIN-wrapped key: commits to the whole `kdf` block, so lowering
 * `iterations` or swapping the salt breaks the tag instead of downgrading the
 * vault.
 *
 * @example
 * const aad = pinWrapAad({ version: 1, vaultId, kdf });
 */
export function pinWrapAad(v: {
  version: number;
  vaultId: string;
  kdf: { alg: string; hash: string; iterations: number; saltB64: string };
}): Uint8Array {
  return canonicalAad({
    version: v.version,
    vaultId: v.vaultId,
    context: "pin",
    kdf: {
      alg: v.kdf.alg,
      hash: v.kdf.hash,
      iterations: v.kdf.iterations,
      saltB64: v.kdf.saltB64,
    },
  });
}

/**
 * AAD for the PRF-wrapped key: commits only to `prfSaltB64`.
 *
 * It deliberately excludes `kdf`: the PRF path must keep working, unchanged,
 * when the PIN's KDF parameters are raised, and must not be coupled to them.
 *
 * @example
 * const aad = prfWrapAad({ version: 1, vaultId, prfSaltB64 });
 */
export function prfWrapAad(v: {
  version: number;
  vaultId: string;
  prfSaltB64: string;
}): Uint8Array {
  return canonicalAad({
    version: v.version,
    vaultId: v.vaultId,
    context: "prf",
    prfSaltB64: v.prfSaltB64,
  });
}

/**
 * AAD for the single entries blob. One blob with one AAD means individual
 * entries cannot be reordered, duplicated or substituted.
 *
 * @example
 * const aad = entriesAad({ version: 1, vaultId });
 */
export function entriesAad(v: { version: number; vaultId: string }): Uint8Array {
  return canonicalAad({
    version: v.version,
    vaultId: v.vaultId,
    context: "entries",
  });
}

/**
 * AES-GCM-256 encrypt with a fresh random IV and a 128-bit tag.
 *
 * A new IV per call is not a nicety: reusing an IV under the same key leaks
 * plaintext and forges tags, so the caller cannot supply one.
 *
 * @example
 * const { ivB64, ctB64 } = await aesGcmEncrypt(vek, bytes, aad);
 */
export async function aesGcmEncrypt(
  keyVek: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array
): Promise<{ ivB64: B64; ctB64: B64 }> {
  const key = await crypto.subtle.importKey("raw", asBufferSource(keyVek), "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: asBufferSource(aad), tagLength: GCM_TAG_BITS },
    key,
    asBufferSource(plaintext)
  );
  return { ivB64: b64(iv), ctB64: b64(new Uint8Array(ct)) };
}

/**
 * AES-GCM-256 decrypt.
 *
 * Returns `null` for every failure — wrong key, tampered ciphertext, wrong or
 * missing AAD, malformed base64, bad key length. The causes are deliberately
 * indistinguishable: telling a caller "wrong AAD" vs "wrong key" is a decryption
 * oracle, and this runs on attacker-supplied records.
 *
 * @example
 * const plaintext = await aesGcmDecrypt(vek, ivB64, ctB64, aad);
 */
export async function aesGcmDecrypt(
  keyVek: Uint8Array,
  ivB64: B64,
  ctB64: B64,
  aad: Uint8Array
): Promise<Uint8Array | null> {
  try {
    const iv = unb64(ivB64);
    const ct = unb64(ctB64);
    if (iv === null || ct === null) {
      return null;
    }
    const key = await crypto.subtle.importKey("raw", asBufferSource(keyVek), "AES-GCM", false, [
      "decrypt",
    ]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(iv),
        additionalData: asBufferSource(aad),
        tagLength: GCM_TAG_BITS,
      },
      key,
      asBufferSource(ct)
    );
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

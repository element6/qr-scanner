/**
 * Tests for the vault crypto module.
 *
 * Scope is deliberate: this file pins the *security properties*, not the
 * implementation. The tamper matrix (wrong key, flipped ciphertext bit, wrong
 * or missing AAD field, cross-context AAD) is the point of the module — a
 * regression there is a silent vault compromise, so every one of those cases
 * asserts `null` rather than a thrown error.
 *
 * Iteration counts are overridden to 1000 wherever a derivation is not the
 * thing under test. The exported default (`KDF_ITERATIONS`) is never weakened:
 * one assertion below pins it to 600_000.
 */

import { describe, it, expect } from "vitest";
import {
  KDF_HASH,
  KDF_ITERATIONS,
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64,
  canonicalAad,
  derivePinVek,
  derivePrfVek,
  entriesAad,
  pinWrapAad,
  prfWrapAad,
  randomB64,
  unb64,
} from "./vaultCrypto";

/** Fast iterations: only for tests that re-derive. The default is pinned below. */
const FAST_ITERATIONS = 1000;

/** A stable, structurally realistic header for AAD tests. */
const VAULT_ID = "vault-0000-1111-2222";
const PIN_SALT = b64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]));
const PRF_SALT = b64(new Uint8Array(32).fill(0xab));

/** A 32-byte stand-in for a WebAuthn PRF output. */
const PRF_OUTPUT = new Uint8Array(32).map((_, i) => i * 7 + 3);
const OTHER_PRF_OUTPUT = new Uint8Array(32).map((_, i) => i * 7 + 4);

/** Every byte value, so round-trips cannot pass on UTF-8-safe data alone. */
const ALL_BYTES = new Uint8Array(256).map((_, i) => i);

const PIN_KDF = {
  alg: "PBKDF2",
  hash: KDF_HASH,
  iterations: KDF_ITERATIONS,
  saltB64: PIN_SALT,
};

/** Flip a single bit in one byte, leaving the rest of the buffer intact. */
function flipBit(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] ^= 0x01;
  return copy;
}

describe("b64 / unb64", () => {
  it("round-trips arbitrary bytes, including every value 0x00..0xFF", () => {
    expect(unb64(b64(ALL_BYTES))).toEqual(ALL_BYTES);
  });

  it("round-trips the empty input", () => {
    expect(b64(new Uint8Array(0))).toBe("");
    expect(unb64("")).toEqual(new Uint8Array(0));
  });

  it("emits padded standard base64", () => {
    expect(b64(new Uint8Array([0, 255]))).toBe("AP8=");
    expect(b64(new Uint8Array([1, 2, 3]))).toBe("AQID");
    // base64url would have produced "-_8=": the standard alphabet is required
    // because these strings are AAD/IV fields, not URLs.
    expect(b64(new Uint8Array([251, 255]))).toBe("+/8=");
  });

  it("returns null for malformed input instead of throwing", () => {
    const malformed = [
      "!!!!",
      "aGVsbG8", // unpadded: not canonical
      "AB=C", // interior padding
      "A===", // over-padded
      "AAAA=", // length not a multiple of 4
      "aGVs bG8=", // whitespace
      "-_-_", // base64url alphabet
      "AP8=AP8=", // trailing garbage after a full quantum
    ];
    for (const input of malformed) {
      expect(() => unb64(input)).not.toThrow();
      expect(unb64(input)).toBeNull();
    }
  });
});

describe("randomB64", () => {
  it("returns the requested number of random bytes, differently each call", () => {
    const first = unb64(randomB64(16));
    const second = unb64(randomB64(16));
    expect(first).not.toBeNull();
    expect(first?.length).toBe(16);
    expect(second).not.toBeNull();
    expect(b64(first as Uint8Array)).not.toBe(b64(second as Uint8Array));
  });
});

describe("canonicalAad", () => {
  it("is independent of key insertion order", () => {
    const ab = canonicalAad({ a: 1, b: "two" });
    const ba = canonicalAad({ b: "two", a: 1 });
    expect(b64(ab)).toBe(b64(ba));
    // Sorted, unquoted-whitespace JSON — the exact bytes are the contract.
    expect(new TextDecoder().decode(ab)).toBe('{"a":1,"b":"two"}');
  });

  it("sorts nested objects too, at every depth", () => {
    const one = canonicalAad({ kdf: { saltB64: "s", hash: "SHA-256", iterations: 1 } });
    const two = canonicalAad({ kdf: { iterations: 1, hash: "SHA-256", saltB64: "s" } });
    expect(b64(one)).toBe(b64(two));
    expect(new TextDecoder().decode(one)).toBe(
      '{"kdf":{"hash":"SHA-256","iterations":1,"saltB64":"s"}}'
    );
  });

  it("distinguishes different values and nested-vs-flat shapes", () => {
    expect(b64(canonicalAad({ a: 1 }))).not.toBe(b64(canonicalAad({ a: 2 })));
    expect(b64(canonicalAad({ a: "1" }))).not.toBe(b64(canonicalAad({ a: 1 })));
    expect(b64(canonicalAad({ a: { b: 1 } }))).not.toBe(b64(canonicalAad({ a: 1 })));
    expect(b64(canonicalAad({ a: [1, 2] }))).not.toBe(b64(canonicalAad({ a: [2, 1] })));
  });

  it("keeps array order significant and encodes unicode as UTF-8", () => {
    expect(b64(canonicalAad({ a: [1, 2] }))).toBe(
      b64(new TextEncoder().encode('{"a":[1,2]}'))
    );
    expect(new TextDecoder().decode(canonicalAad({ v: "é" }))).toBe('{"v":"é"}');
  });

  it("throws on values JSON would silently rewrite", () => {
    // `JSON.stringify` drops an undefined property and turns NaN into null,
    // which would give two different headers the same AAD bytes.
    expect(() => canonicalAad({ a: undefined })).toThrow(TypeError);
    expect(() => canonicalAad({ iterations: Number.NaN })).toThrow(TypeError);
  });
});

describe("derivePinVek", () => {
  it("pins the exported PBKDF2 defaults at 600_000 / SHA-256", () => {
    expect(KDF_ITERATIONS).toBe(600_000);
    expect(KDF_HASH).toBe("SHA-256");
  });

  it("derives 32 bytes, deterministically for the same (pin, salt, iterations)", async () => {
    const a = await derivePinVek("1234", PIN_SALT, FAST_ITERATIONS);
    const b = await derivePinVek("1234", PIN_SALT, FAST_ITERATIONS);
    expect(a.length).toBe(32);
    expect(b64(a)).toBe(b64(b));
  });

  it("changes when the pin, the salt or the iteration count changes", async () => {
    const base = await derivePinVek("1234", PIN_SALT, FAST_ITERATIONS);
    const otherPin = await derivePinVek("1235", PIN_SALT, FAST_ITERATIONS);
    const otherSalt = await derivePinVek("1234", randomB64(16), FAST_ITERATIONS);
    const otherIterations = await derivePinVek("1234", PIN_SALT, FAST_ITERATIONS + 1);
    expect(b64(otherPin)).not.toBe(b64(base));
    expect(b64(otherSalt)).not.toBe(b64(base));
    expect(b64(otherIterations)).not.toBe(b64(base));
  });

  it("rejects a malformed salt loudly", async () => {
    await expect(derivePinVek("1234", "not base64!", FAST_ITERATIONS)).rejects.toThrow(
      /salt/
    );
  });
});

describe("derivePrfVek", () => {
  it("derives 32 bytes, deterministically for the same (prfOutput, salt)", async () => {
    const a = await derivePrfVek(PRF_OUTPUT, PRF_SALT);
    const b = await derivePrfVek(PRF_OUTPUT, PRF_SALT);
    expect(a.length).toBe(32);
    expect(b64(a)).toBe(b64(b));
  });

  it("changes when the PRF output, the salt or the info string changes", async () => {
    const base = await derivePrfVek(PRF_OUTPUT, PRF_SALT);
    expect(b64(await derivePrfVek(OTHER_PRF_OUTPUT, PRF_SALT))).not.toBe(b64(base));
    expect(b64(await derivePrfVek(PRF_OUTPUT, randomB64(32)))).not.toBe(b64(base));
    // Domain separation: the raw PRF output must never be the key itself, nor
    // reachable by HKDF-ing with different (or absent) info.
    expect(b64(base)).not.toBe(b64(PRF_OUTPUT));
    const rawHkdf = await crypto.subtle.importKey("raw", PRF_OUTPUT, "HKDF", false, [
      "deriveBits",
    ]);
    const withoutInfo = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          // Same bytes as PRF_SALT, but constructed here so the view is
          // ArrayBuffer-backed and usable as a WebCrypto BufferSource.
          salt: new Uint8Array(32).fill(0xab),
          info: new Uint8Array(0),
        },
        rawHkdf,
        256
      )
    );
    expect(b64(base)).not.toBe(b64(withoutInfo));
  });

  it("rejects a malformed PRF salt loudly", async () => {
    await expect(derivePrfVek(PRF_OUTPUT, "!!!!")).rejects.toThrow(/prfSalt/);
  });
});

describe("aesGcmEncrypt / aesGcmDecrypt", () => {
  it("round-trips plaintext with the same key and AAD", async () => {
    const key = await derivePinVek("1234", PIN_SALT, FAST_ITERATIONS);
    const aad = entriesAad({ version: 1, vaultId: VAULT_ID });
    const plaintext = new TextEncoder().encode('{"entries":[]}');
    const { ivB64, ctB64 } = await aesGcmEncrypt(key, plaintext, aad);
    const out = await aesGcmDecrypt(key, ivB64, ctB64, aad);
    // Bytes are compared as base64, never by `toEqual` on typed arrays:
    // `TextEncoder` output in this jsdom environment is a foreign-realm
    // Uint8Array, so a deep-equal fails on prototype identity even when every
    // byte matches. `b64` is also exactly what the caller stores.
    expect(out === null ? null : b64(out)).toBe(b64(plaintext));
  });

  it("round-trips non-UTF8 bytes (0x00..0xFF) unchanged", async () => {
    const key = await derivePrfVek(PRF_OUTPUT, PRF_SALT);
    const aad = entriesAad({ version: 1, vaultId: VAULT_ID });
    const { ivB64, ctB64 } = await aesGcmEncrypt(key, ALL_BYTES, aad);
    const out = await aesGcmDecrypt(key, ivB64, ctB64, aad);
    expect(out).toEqual(ALL_BYTES);
    expect(Array.from(out ?? [])).toEqual(Array.from({ length: 256 }, (_, i) => i));
  });

  it("round-trips an empty plaintext (tag-only ciphertext)", async () => {
    const key = await derivePrfVek(PRF_OUTPUT, PRF_SALT);
    const aad = entriesAad({ version: 1, vaultId: VAULT_ID });
    const { ctB64 } = await aesGcmEncrypt(key, new Uint8Array(0), aad);
    // Empty plaintext still yields the 16-byte GCM tag, never a 0-byte blob.
    expect(unb64(ctB64)?.length).toBe(16);
    const { ivB64, ctB64: ct } = await aesGcmEncrypt(key, new Uint8Array(0), aad);
    expect(await aesGcmDecrypt(key, ivB64, ct, aad)).toEqual(new Uint8Array(0));
  });

  it("uses a fresh 12-byte IV per call, so ciphertexts differ", async () => {
    const key = await derivePrfVek(PRF_OUTPUT, PRF_SALT);
    const aad = entriesAad({ version: 1, vaultId: VAULT_ID });
    const plaintext = new TextEncoder().encode("same plaintext");
    const first = await aesGcmEncrypt(key, plaintext, aad);
    const second = await aesGcmEncrypt(key, plaintext, aad);
    expect(first.ivB64).not.toBe(second.ivB64);
    expect(first.ctB64).not.toBe(second.ctB64);
    expect(unb64(first.ivB64)?.length).toBe(12);
    expect(unb64(second.ivB64)?.length).toBe(12);
  });
});

describe("tamper matrix — every failure is null, never a throw", () => {
  /** Shared fixture: one PIN-derived wrap and one PRF-derived wrap. */
  async function fixture() {
    const pinVek = await derivePinVek("1234", PIN_SALT, FAST_ITERATIONS);
    const prfVek = await derivePrfVek(PRF_OUTPUT, PRF_SALT);
    const pinAad = pinWrapAad({ version: 1, vaultId: VAULT_ID, kdf: PIN_KDF });
    const prfAad = prfWrapAad({ version: 1, vaultId: VAULT_ID, prfSaltB64: PRF_SALT });
    const payload = new TextEncoder().encode("vault-key-material");
    const pin = await aesGcmEncrypt(pinVek, payload, pinAad);
    const prf = await aesGcmEncrypt(prfVek, payload, prfAad);
    return { pinVek, prfVek, pinAad, prfAad, payload, pin, prf };
  }

  it("flipping one bit of the ciphertext yields null", async () => {
    const { pinVek, pinAad, pin } = await fixture();
    const bytes = unb64(pin.ctB64) as Uint8Array;
    const tampered = b64(flipBit(bytes, Math.floor(bytes.length / 2)));
    await expect(aesGcmDecrypt(pinVek, pin.ivB64, tampered, pinAad)).resolves.toBeNull();
  });

  it("flipping one bit of the IV yields null", async () => {
    const { pinVek, pinAad, pin } = await fixture();
    const iv = flipBit(unb64(pin.ivB64) as Uint8Array, 0);
    await expect(aesGcmDecrypt(pinVek, b64(iv), pin.ctB64, pinAad)).resolves.toBeNull();
  });

  it("truncating the ciphertext (stripping the tag) yields null", async () => {
    const { pinVek, pinAad, pin } = await fixture();
    const bytes = unb64(pin.ctB64) as Uint8Array;
    const truncated = b64(bytes.slice(0, bytes.length - 16));
    await expect(
      aesGcmDecrypt(pinVek, pin.ivB64, truncated, pinAad)
    ).resolves.toBeNull();
  });

  it("using the wrong key yields null", async () => {
    const { pinVek, prfVek, pinAad, pin } = await fixture();
    // A different PIN, and the other derivation path's key: both refuse.
    const wrongPin = await derivePinVek("9999", PIN_SALT, FAST_ITERATIONS);
    await expect(
      aesGcmDecrypt(wrongPin, pin.ivB64, pin.ctB64, pinAad)
    ).resolves.toBeNull();
    await expect(
      aesGcmDecrypt(prfVek, pin.ivB64, pin.ctB64, pinAad)
    ).resolves.toBeNull();
    void pinVek;
  });

  it("using different AAD over intact ciphertext yields null", async () => {
    const { pinVek, pinAad, prfAad, pin } = await fixture();
    // Same key, correct iv+ct, but the PRF context's AAD — a caller that mixed
    // up the two paths must not get a plaintext.
    await expect(
      aesGcmDecrypt(pinVek, pin.ivB64, pin.ctB64, prfAad)
    ).resolves.toBeNull();
    // AAD with one field removed, and with one field added.
    const missingVaultId = canonicalAad({ version: 1, context: "pin", kdf: PIN_KDF });
    const extraField = canonicalAad({
      version: 1,
      vaultId: VAULT_ID,
      context: "pin",
      kdf: PIN_KDF,
      downgrade: true,
    });
    await expect(
      aesGcmDecrypt(pinVek, pin.ivB64, pin.ctB64, missingVaultId)
    ).resolves.toBeNull();
    await expect(
      aesGcmDecrypt(pinVek, pin.ivB64, pin.ctB64, extraField)
    ).resolves.toBeNull();
    await expect(
      aesGcmDecrypt(pinVek, pin.ivB64, pin.ctB64, new Uint8Array(0))
    ).resolves.toBeNull();
    expect(b64(pinAad)).not.toBe(b64(prfAad));
  });

  it("rejects malformed base64 iv/ct as null, without throwing", async () => {
    const { pinVek, pinAad, pin } = await fixture();
    await expect(
      aesGcmDecrypt(pinVek, "not base64!", pin.ctB64, pinAad)
    ).resolves.toBeNull();
    await expect(
      aesGcmDecrypt(pinVek, pin.ivB64, "!!!!", pinAad)
    ).resolves.toBeNull();
    await expect(aesGcmDecrypt(pinVek, "", "", pinAad)).resolves.toBeNull();
  });

  it("keeps BOTH wraps independently decryptable (no coupling)", async () => {
    const { pinVek, prfVek, pinAad, prfAad, payload, pin, prf } = await fixture();
    const pinOut = await aesGcmDecrypt(pinVek, pin.ivB64, pin.ctB64, pinAad);
    const prfOut = await aesGcmDecrypt(prfVek, prf.ivB64, prf.ctB64, prfAad);
    expect(pinOut === null ? null : b64(pinOut)).toBe(b64(payload));
    expect(prfOut === null ? null : b64(prfOut)).toBe(b64(payload));
    // Cross-context: PRF's ciphertext under the PIN's AAD (and vice versa)
    // fails, so the two paths are not interchangeable.
    await expect(
      aesGcmDecrypt(pinVek, pin.ivB64, pin.ctB64, prfAad)
    ).resolves.toBeNull();
    await expect(
      aesGcmDecrypt(prfVek, prf.ivB64, prf.ctB64, pinAad)
    ).resolves.toBeNull();
  });
});

describe("AAD contexts", () => {
  const header = { version: 1, vaultId: VAULT_ID };

  it("are pairwise distinct for the same vault", () => {
    const pin = pinWrapAad({ ...header, kdf: PIN_KDF });
    const prf = prfWrapAad({ ...header, prfSaltB64: PRF_SALT });
    const entries = entriesAad(header);
    const all = [b64(pin), b64(prf), b64(entries)];
    expect(new Set(all).size).toBe(3);
  });

  it("changes the PIN AAD when kdf.iterations changes (downgrade detection)", () => {
    const strong = pinWrapAad({
      ...header,
      kdf: { ...PIN_KDF, iterations: KDF_ITERATIONS },
    });
    const downgraded = pinWrapAad({
      ...header,
      kdf: { ...PIN_KDF, iterations: 1000 },
    });
    const differentSalt = pinWrapAad({
      ...header,
      kdf: { ...PIN_KDF, saltB64: randomB64(16) },
    });
    const differentAlg = pinWrapAad({ ...header, kdf: { ...PIN_KDF, alg: "scrypt" } });
    expect(b64(downgraded)).not.toBe(b64(strong));
    expect(b64(differentSalt)).not.toBe(b64(strong));
    expect(b64(differentAlg)).not.toBe(b64(strong));
  });

  it("does NOT change the PRF AAD when kdf.iterations changes (PRF decoupled)", () => {
    const before = prfWrapAad({ ...header, prfSaltB64: PRF_SALT });
    // The PRF AAD has no kdf input at all: varying the PIN's parameters cannot
    // move it, so raising iterations never invalidates the PRF wrap.
    const afterRaisingIterations = prfWrapAad({ ...header, prfSaltB64: PRF_SALT });
    expect(b64(before)).toBe(b64(afterRaisingIterations));
    const withDifferentPrfSalt = prfWrapAad({ ...header, prfSaltB64: randomB64(32) });
    expect(b64(withDifferentPrfSalt)).not.toBe(b64(before));
    // And the PIN AAD is what the iterations live in.
    expect(
      b64(pinWrapAad({ ...header, kdf: { ...PIN_KDF, iterations: 1000 } }))
    ).not.toBe(b64(pinWrapAad({ ...header, kdf: PIN_KDF })));
  });

  it("changes when version or vaultId changes (header is authenticated)", () => {
    const base = entriesAad(header);
    expect(b64(entriesAad({ version: 2, vaultId: VAULT_ID }))).not.toBe(b64(base));
    expect(b64(entriesAad({ version: 1, vaultId: "other" }))).not.toBe(b64(base));
    expect(
      b64(pinWrapAad({ version: 2, vaultId: VAULT_ID, kdf: PIN_KDF }))
    ).not.toBe(b64(pinWrapAad({ version: 1, vaultId: VAULT_ID, kdf: PIN_KDF })));
    expect(
      b64(prfWrapAad({ version: 1, vaultId: "other", prfSaltB64: PRF_SALT }))
    ).not.toBe(b64(prfWrapAad({ version: 1, vaultId: VAULT_ID, prfSaltB64: PRF_SALT })));
  });

  it("round-trips the entries blob through one encrypted envelope", async () => {
    const vek = await derivePinVek("1234", PIN_SALT, FAST_ITERATIONS);
    const aad = entriesAad({ version: 1, vaultId: VAULT_ID });
    const entries = new TextEncoder().encode(
      JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }])
    );
    const { ivB64, ctB64 } = await aesGcmEncrypt(vek, entries, aad);
    // Reordering entries means re-encrypting the whole blob: there is no
    // per-entry ciphertext to permute, and a swapped blob fails the tag.
    const swapped = await aesGcmEncrypt(vek, flipBit(entries, 0), aad);
    const out = await aesGcmDecrypt(vek, ivB64, ctB64, aad);
    expect(out === null ? null : b64(out)).toBe(b64(entries));
    await expect(
      aesGcmDecrypt(vek, ivB64, swapped.ctB64, aad)
    ).resolves.toBeNull();
  });
});


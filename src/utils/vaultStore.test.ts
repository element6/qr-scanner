import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOCK_OFFSET_KEY,
  CREDENTIAL_ID_KEY,
  createVaultRecord,
  HISTORY_MIGRATED_KEY,
  VAULT_PENDING_KEY,
  VAULT_SUPERSEDED_KEY,
  MAX_IMPORT_ITERATIONS,
  MAX_VAULT_ENTRIES,
  MIN_IMPORT_ITERATIONS,
  normalizeVaultRecord,
  readVaultRecord,
  VAULT_STORAGE_KEY,
  writeVaultRecord,
  type VaultRecord,
  type VaultWrap,
} from "./vaultStore";

/** A structurally valid wrap; contents are never decoded by this module. */
const WRAP: VaultWrap = { ivB64: "AAAAAAAAAAAAAAAA", ctB64: "BBBBBBBB" };
const PRF = { saltB64: "CCCCCCCC", ...WRAP };

/** Valid record builder; each test overrides only the field under test. */
function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    vaultId: "0123456789abcdef0123456789abcdef",
    revision: 3,
    kdf: {
      alg: "PBKDF2",
      hash: "SHA-256",
      iterations: 600_000,
      saltB64: "DDDDDDDD",
    },
    prf: { ...PRF },
    pin: { ...WRAP },
    entriesIvB64: "AAAAAAAAAAAAAAAA",
    entriesCtB64: "BBBBBBBB",
    lastSeenTime: 1_700_000_000_000,
    ...overrides,
  };
}

/** Normalizes `validRecord()` with overrides, asserting success. */
function normalizeOk(overrides: Record<string, unknown> = {}): VaultRecord {
  const result = normalizeVaultRecord(validRecord(overrides));
  if (!result.ok) {
    throw new Error(`expected valid record, got error: ${result.error}`);
  }
  return result.record;
}

beforeEach(() => {
  (globalThis as unknown as { localStorage?: Storage }).localStorage?.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * jsdom 30 under Node 26 exposes no usable `window.localStorage` here (Node's own
 * global requires `--localstorage-file`), so install an in-memory Storage with
 * the same observable semantics. Skipped whenever a real implementation exists,
 * so these tests still exercise jsdom's storage wherever it is available.
 */
function installMemoryStorage(): void {
  if (typeof localStorage !== "undefined") {
    return;
  }
  const data = new Map<string, string>();
  const storage = {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(index: number): string | null {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(String(key), String(value));
    },
  } as Storage;
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      writable: true,
      configurable: true,
    });
  } catch {
    // A non-configurable global (some test runners) still allows plain assignment.
    (globalThis as unknown as { localStorage: Storage }).localStorage = storage;
  }
}

installMemoryStorage();

describe("constants", () => {
  it("exposes the documented vault storage keys and bounds", () => {
    expect(VAULT_STORAGE_KEY).toBe("qr2fa.vault.v1");
    expect(CLOCK_OFFSET_KEY).toBe("qr2fa.clockOffset");
    expect(HISTORY_MIGRATED_KEY).toBe("qr2fa.historyMigrated");
    expect(MAX_VAULT_ENTRIES).toBe(200);
    expect(MIN_IMPORT_ITERATIONS).toBe(10_000);
    expect(MAX_IMPORT_ITERATIONS).toBe(10_000_000);
  });

  it("keeps the staged-import keys distinct from the primary record key", () => {
    // WHY: a duplicate spelling of any of these keys is a silent data-loss bug —
    // a staged record written over the primary one destroys the vault the user
    // can still unlock.
    const keys = [VAULT_PENDING_KEY, VAULT_SUPERSEDED_KEY, CREDENTIAL_ID_KEY];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(VAULT_STORAGE_KEY);
    expect(VAULT_PENDING_KEY).toBe("qr2fa.vaultPending.v1");
    expect(VAULT_SUPERSEDED_KEY).toBe("qr2fa.vaultSuperseded.v1");
    expect(CREDENTIAL_ID_KEY).toBe("qr2fa.credentialId.v1");
  });
});

describe("canonical base64", () => {
  it("rejects a padding-bit variant that decodes to the same bytes", () => {
    // "AA==" and "AB==" both decode to byte 0x00 but are different AAD strings,
    // so the second spelling must not validate.
    const kdf = { alg: "PBKDF2", hash: "SHA-256", iterations: 600_000 };
    expect(normalizeVaultRecord(validRecord({ kdf: { ...kdf, saltB64: "AA==" } })).ok).toBe(true);
    expect(normalizeVaultRecord(validRecord({ kdf: { ...kdf, saltB64: "AB==" } })).ok).toBe(false);
  });
});

describe("normalizeVaultRecord", () => {
  it("accepts a full record with both wraps", () => {
    const result = normalizeVaultRecord(validRecord());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.prf).toEqual(PRF);
      expect(result.record.pin).toEqual(WRAP);
      expect(result.record.kdf).toEqual({
        alg: "PBKDF2",
        hash: "SHA-256",
        iterations: 600_000,
        saltB64: "DDDDDDDD",
      });
    }
  });

  it("accepts a PIN-only record", () => {
    const result = normalizeVaultRecord(validRecord({ prf: null }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.prf).toBeNull();
      expect(result.record.pin).toEqual(WRAP);
    }
  });

  it("accepts a PRF-only record", () => {
    const result = normalizeVaultRecord(validRecord({ pin: null }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.prf).toEqual(PRF);
      expect(result.record.pin).toBeNull();
    }
  });

  it("accepts the iteration bounds themselves", () => {
    expect(normalizeVaultRecord(
      validRecord({
        kdf: { alg: "PBKDF2", hash: "SHA-256", iterations: MIN_IMPORT_ITERATIONS, saltB64: "DDDDDDDD" },
      })
    ).ok).toBe(true);
    expect(normalizeVaultRecord(
      validRecord({
        kdf: { alg: "PBKDF2", hash: "SHA-256", iterations: MAX_IMPORT_ITERATIONS, saltB64: "DDDDDDDD" },
      })
    ).ok).toBe(true);
  });

  it("rejects a wrong version", () => {
    expect(normalizeVaultRecord(validRecord({ version: 2 }))).toEqual({
      ok: false,
      error: "invalid version",
    });
    expect(normalizeVaultRecord(validRecord({ version: "1" })).ok).toBe(false);
  });

  it("rejects an empty vaultId", () => {
    expect(normalizeVaultRecord(validRecord({ vaultId: "" }))).toEqual({
      ok: false,
      error: "invalid vaultId",
    });
  });

  it("rejects a vaultId longer than 128 chars", () => {
    expect(normalizeVaultRecord(validRecord({ vaultId: "a".repeat(129) })).ok).toBe(false);
    expect(normalizeVaultRecord(validRecord({ vaultId: "a".repeat(128) })).ok).toBe(true);
  });

  it("rejects revision 0 and non-integer revisions", () => {
    expect(normalizeVaultRecord(validRecord({ revision: 0 }))).toEqual({
      ok: false,
      error: "invalid revision",
    });
    expect(normalizeVaultRecord(validRecord({ revision: 1.5 })).ok).toBe(false);
    expect(normalizeVaultRecord(validRecord({ revision: "3" })).ok).toBe(false);
  });

  it("rejects out-of-range iteration counts", () => {
    const kdf = (iterations: unknown) => ({
      alg: "PBKDF2",
      hash: "SHA-256",
      iterations,
      saltB64: "DDDDDDDD",
    });
    expect(normalizeVaultRecord(validRecord({ kdf: kdf(9_999) }))).toEqual({
      ok: false,
      error: "invalid kdf iterations",
    });
    expect(normalizeVaultRecord(validRecord({ kdf: kdf(10_000_001) }))).toEqual({
      ok: false,
      error: "invalid kdf iterations",
    });
    expect(normalizeVaultRecord(validRecord({ kdf: kdf(600_000.5) })).ok).toBe(false);
  });

  it("rejects a missing or malformed kdf", () => {
    expect(normalizeVaultRecord(validRecord({ kdf: undefined }))).toEqual({
      ok: false,
      error: "invalid kdf",
    });
    expect(normalizeVaultRecord(validRecord({ kdf: null })).ok).toBe(false);
    expect(normalizeVaultRecord(validRecord({
      kdf: { alg: "scrypt", hash: "SHA-256", iterations: 600_000, saltB64: "DDDDDDDD" },
    })).ok).toBe(false);
    expect(normalizeVaultRecord(validRecord({
      kdf: { alg: "PBKDF2", hash: "SHA-1", iterations: 600_000, saltB64: "DDDDDDDD" },
    })).ok).toBe(false);
    expect(normalizeVaultRecord(validRecord({
      kdf: { alg: "PBKDF2", hash: "SHA-256", iterations: 600_000, saltB64: "" },
    })).ok).toBe(false);
    expect(normalizeVaultRecord(validRecord({
      kdf: { alg: "PBKDF2", hash: "SHA-256", iterations: 600_000, saltB64: "A".repeat(260) },
    })).ok).toBe(false);
  });

  it("rejects a record with both wraps null", () => {
    expect(normalizeVaultRecord(validRecord({ prf: null, pin: null }))).toEqual({
      ok: false,
      error: "no key wrap",
    });
  });

  it("rejects malformed base64 in every base64 field", () => {
    const cases: Array<Record<string, unknown>> = [
      { entriesIvB64: "AA?A" },
      { entriesIvB64: "AAA" }, // not a multiple of 4
      { entriesIvB64: "" },
      { entriesIvB64: "AAAA=" }, // interior/misplaced padding
      { entriesCtB64: "!!!!" },
      { entriesCtB64: "AAA" },
      { pin: { ivB64: "AAAA", ctB64: "AA-A" } },
      { pin: { ivB64: "AAA", ctB64: "AAAA" } },
      { prf: { saltB64: "AA?A", ivB64: "AAAA", ctB64: "AAAA" } },
      { prf: { saltB64: "AAAA", ivB64: "AAAA", ctB64: "AAA" } },
    ];
    for (const override of cases) {
      expect(normalizeVaultRecord(validRecord(override)).ok, JSON.stringify(override)).toBe(false);
    }
  });

  it("rejects a non-numeric or negative lastSeenTime", () => {
    expect(normalizeVaultRecord(validRecord({ lastSeenTime: "1700000000000" }))).toEqual({
      ok: false,
      error: "invalid lastSeenTime",
    });
    expect(normalizeVaultRecord(validRecord({ lastSeenTime: -1 })).ok).toBe(false);
    expect(normalizeVaultRecord(validRecord({ lastSeenTime: 1.5 })).ok).toBe(false);
  });

  it("rejects non-object garbage", () => {
    for (const garbage of ["string", ["array"], null, undefined, 42, true]) {
      const result = normalizeVaultRecord(garbage);
      expect(result.ok, String(garbage)).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("not an object");
      }
    }
  });
});

describe("readVaultRecord", () => {
  it("returns null when the key is absent", () => {
    expect(readVaultRecord()).toBeNull();
  });

  it("returns null and warns on corrupt JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(VAULT_STORAGE_KEY, "{not json");

    expect(readVaultRecord()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns the record for valid stored JSON", () => {
    const record = { ...validRecord() };
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));

    expect(readVaultRecord()).toEqual(record);
  });

  it("returns null for junk under the key and does not delete the key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify({ nonsense: true }));

    expect(readVaultRecord()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).not.toBeNull();
  });
});

describe("writeVaultRecord", () => {
  it("allows the first write with baseRevision 0 when nothing is stored", () => {
    const next: VaultRecord = { ...normalizeOk(), revision: 1 };

    expect(writeVaultRecord(next, 0)).toEqual({ ok: true, revision: 1 });
    expect(readVaultRecord()).toEqual(next);
  });

  it("writes when baseRevision matches the stored revision", () => {
    const stored = normalizeOk({ revision: 3 });
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(stored));
    const next: VaultRecord = { ...stored, revision: 4, lastSeenTime: 1_800_000_000_000 };

    expect(writeVaultRecord(next, 3)).toEqual({ ok: true, revision: 4 });
    expect(readVaultRecord()).toEqual(next);
  });

  it("refuses a stale base revision and leaves the stored value unchanged", () => {
    const stored = normalizeOk({ revision: 5 });
    const rawStored = JSON.stringify(stored);
    localStorage.setItem(VAULT_STORAGE_KEY, rawStored);
    const next: VaultRecord = { ...stored, revision: 4 };

    expect(writeVaultRecord(next, 3)).toEqual({ ok: false, reason: "stale-revision" });
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBe(rawStored);
  });

  it("refuses a write against a non-empty store when baseRevision is 0", () => {
    const stored = normalizeOk({ revision: 1 });
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(stored));

    expect(writeVaultRecord({ ...stored, revision: 1 }, 0)).toEqual({
      ok: false,
      reason: "stale-revision",
    });
  });

  it("reports storage-unavailable when setItem throws, keeping the prior value", () => {
    const stored = normalizeOk({ revision: 2 });
    const rawStored = JSON.stringify(stored);
    localStorage.setItem(VAULT_STORAGE_KEY, rawStored);

    // Spy on the instance, not `Storage.prototype`: the shim above is a plain
    // object, and the `Storage` global is not guaranteed to exist.
    const setItem = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });

    const next: VaultRecord = { ...stored, revision: 3 };
    expect(writeVaultRecord(next, 2)).toEqual({ ok: false, reason: "storage-unavailable" });

    setItem.mockRestore();
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBe(rawStored);
  });
});

describe("createVaultRecord", () => {
  it("builds a revision-1 record with the live KDF defaults", () => {
    const before = Date.now();
    const record = createVaultRecord({
      kdfSaltB64: "DDDDDDDD",
      prf: { ...PRF },
      pin: { ...WRAP },
      entriesIvB64: "AAAAAAAAAAAAAAAA",
      entriesCtB64: "BBBBBBBB",
    });
    const after = Date.now();

    expect(record.version).toBe(1);
    expect(record.revision).toBe(1);
    expect(record.kdf).toEqual({
      alg: "PBKDF2",
      hash: "SHA-256",
      iterations: 600_000,
      saltB64: "DDDDDDDD",
    });
    expect(record.vaultId).toMatch(/^[0-9a-f]{32}$/);
    expect(record.lastSeenTime).toBeGreaterThanOrEqual(before);
    expect(record.lastSeenTime).toBeLessThanOrEqual(after);
    expect(normalizeVaultRecord(record).ok).toBe(true);
  });

  it("generates a unique vaultId per call", () => {
    const params = {
      kdfSaltB64: "DDDDDDDD",
      prf: null,
      pin: { ...WRAP },
      entriesIvB64: "AAAAAAAAAAAAAAAA",
      entriesCtB64: "BBBBBBBB",
    };
    const ids = new Set(Array.from({ length: 25 }, () => createVaultRecord(params).vaultId));

    expect(ids.size).toBe(25);
  });
});

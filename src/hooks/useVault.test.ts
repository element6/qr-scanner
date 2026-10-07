/**
 * Behaviour tests for the vault state hook.
 *
 * The hook is the only place that holds an unwrapped vault key, so these tests
 * are written against observable outcomes (phase, entries, error text, what is
 * on disk) rather than internals — the key itself is deliberately unreachable.
 *
 * Two environment concessions, both inherited from the sibling suites:
 *
 * - jsdom 30 under Node 26 has no usable `localStorage`, so an in-memory
 *   `Storage` is installed when (and only when) the real one is absent.
 * - There is no `@testing-library/react` in this repo and no new dependency may
 *   be added, so the harness is `react-dom/client` + `act`, matching
 *   `useCameraStatus.test.ts`.
 *
 * Most scenarios seed a record directly with low KDF iterations. `createVault`
 * itself is exercised through the hook, but a 600k-iteration PBKDF2 per attempt
 * would make the delay-escalation tests minutes long for no extra coverage.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_LOCK_MS, useVault, type UseVault } from "./useVault";
import type { FailureReason, WebAuthnPort } from "../utils/webauthn";
import { makePrfSalt } from "../utils/webauthn";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64,
  derivePinVek,
  derivePrfVek,
  entriesAad,
  pinWrapAad,
  prfWrapAad,
  randomB64,
  unb64,
} from "../utils/vaultCrypto";
import {
  CLOCK_OFFSET_KEY,
  CREDENTIAL_ID_KEY,
  MAX_VAULT_ENTRIES,
  VAULT_PENDING_KEY,
  VAULT_STORAGE_KEY,
  VAULT_SUPERSEDED_KEY,
  createVaultRecord,
  readVaultRecord,
  writeVaultRecord,
  type VaultRecord,
  type VaultWrap,
} from "../utils/vaultStore";
import { entryToUri, type OtpauthEntry } from "../utils/otpauth";
import { buildExportJson } from "../utils/exportFormat";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** jsdom 30 / Node 26 exposes no usable localStorage; see `vaultStore.test.ts`. */
function installMemoryStorage(): void {
  if (typeof localStorage !== "undefined") return;
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
    (globalThis as unknown as { localStorage: Storage }).localStorage = storage;
  }
}

installMemoryStorage();

const textEncoder = new TextEncoder();

/** Stable PRF output: create and unlock must derive the same key from it. */
const PRF_OUTPUT = new Uint8Array(32).fill(7);
const CREDENTIAL_ID = "credential-1";



/** Fully controllable WebAuthn port; every call is recorded. */
class FakePort implements WebAuthnPort {
  supported: boolean;
  registerResult: { ok: true; credentialIdB64: string } | { ok: false; reason: FailureReason };
  getResult: { ok: true; prfOutput: Uint8Array } | { ok: false; reason: FailureReason };
  registerCalls = 0;
  getCalls = 0;

  constructor(opts: {
    supported?: boolean;
    registerResult?: FakePort["registerResult"];
    getResult?: FakePort["getResult"];
  } = {}) {
    this.supported = opts.supported ?? true;
    this.registerResult = opts.registerResult ?? { ok: true, credentialIdB64: CREDENTIAL_ID };
    this.getResult = opts.getResult ?? { ok: true, prfOutput: PRF_OUTPUT };
  }

  async isSupported(): Promise<boolean> {
    return this.supported;
  }

  async register(): Promise<FakePort["registerResult"]> {
    this.registerCalls += 1;
    return this.registerResult;
  }

  async get(): Promise<FakePort["getResult"]> {
    this.getCalls += 1;
    return this.getResult;
  }
}

function entry(over: Partial<OtpauthEntry> = {}): OtpauthEntry {
  return {
    issuer: "GitHub",
    account: "dev@example.com",
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    ...over,
  };
}

/** A second, distinct valid base32 secret. */
const SECRET_2 = "KRSXG5CTMVRXEZLU";
/** A third, distinct valid base32 secret. */
const SECRET_3 = "MFRGGZDFMZTWQ2LK";

function bytes32(): Uint8Array {
  return unb64(randomB64(32)) as Uint8Array;
}

/** Minimal entries blob for a given record header. */
async function sealEntries(
  vaultKey: Uint8Array,
  header: { version: number; vaultId: string },
  entries: OtpauthEntry[]
): Promise<VaultWrap> {
  return aesGcmEncrypt(
    vaultKey,
    textEncoder.encode(JSON.stringify({ uris: entries.map(entryToUri) })),
    entriesAad(header)
  );
}

/**
 * Write a complete, structurally valid vault directly to storage.
 *
 * @returns The vault key, so a test can construct variations (wrong entries
 * key, tampered blob) that the hook must reject rather than trust.
 */
async function seedVault(opts: {
  pin?: string;
  prf?: boolean;
  iterations?: number;
  entries?: OtpauthEntry[];
  vaultKey?: Uint8Array;
} = {}): Promise<{ vaultKey: Uint8Array; record: VaultRecord }> {
  // 10_000 is the floor `normalizeVaultRecord` accepts; going lower would make
  // every seeded record read back as `null` rather than as a fast test fixture.
  const iterations = opts.iterations ?? 10_000;
  const draft = createVaultRecord({
    kdfSaltB64: b64(bytes32().subarray(0, 16)),
    prf: null,
    pin: null,
    entriesIvB64: "",
    entriesCtB64: "",
  });
  draft.kdf = { ...draft.kdf, iterations };
  const vaultKey = opts.vaultKey ?? bytes32();
  const entries = opts.entries ?? [];

  let pin: VaultWrap | null = null;
  if (opts.pin !== undefined) {
    const vek = await derivePinVek(opts.pin, draft.kdf.saltB64, iterations);
    pin = await aesGcmEncrypt(
      vek,
      vaultKey,
      pinWrapAad({
        version: draft.version,
        vaultId: draft.vaultId,
        kdf: draft.kdf,
      })
    );
  }

  let prf: ({ saltB64: string } & VaultWrap) | null = null;
  if (opts.prf === true) {
    const saltB64 = b64(makePrfSalt());
    const vek = await derivePrfVek(PRF_OUTPUT, saltB64);
    prf = {
      saltB64,
      ...(await aesGcmEncrypt(
        vek,
        vaultKey,
        prfWrapAad({ version: draft.version, vaultId: draft.vaultId, prfSaltB64: saltB64 })
      )),
    };
  }

  const sealed = await sealEntries(vaultKey, draft, entries);
  const record: VaultRecord = {
    ...draft,
    prf,
    pin,
    entriesIvB64: sealed.ivB64,
    entriesCtB64: sealed.ctB64,
  };
  const outcome = writeVaultRecord(record, 0);
  if (!outcome.ok) throw new Error(`seed write failed: ${outcome.reason}`);
  if (prf !== null) localStorage.setItem(CREDENTIAL_ID_KEY, CREDENTIAL_ID);
  return { vaultKey, record };
}

let holder: { current: UseVault | null } = { current: null };
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Probe({ port }: { port: WebAuthnPort }): null {
  holder.current = useVault(port);
  return null;
}

function mount(port: WebAuthnPort): void {
  holder = { current: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(createElement(Probe, { port }));
  });
}

function vault(): UseVault {
  if (holder.current === null) throw new Error("hook not mounted");
  return holder.current;
}

/** Run an async hook action inside `act`, returning its result. */
async function run<T>(fn: (v: UseVault) => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await fn(vault());
  });
  return result;
}

function unmount(): void {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  holder = { current: null };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("boot", () => {
  it("starts in setup with no record and exposes no entries", () => {
    mount(new FakePort());
    expect(vault().phase).toBe("setup");
    expect(vault().entries).toEqual([]);
    expect(vault().hasPin).toBe(false);
    expect(vault().prfRegistered).toBe(false);
    expect(vault().clockOffset).toBe(0);
    expect(vault().retryAfterMs).toBe(0);
  });

  it("starts locked with an existing record, entries withheld", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    expect(vault().phase).toBe("locked");
    expect(vault().entries).toEqual([]);
    expect(vault().hasPin).toBe(true);
  });
});

describe("createVault", () => {
  it("creates a PIN vault and lands unlocked with no entries", async () => {
    mount(new FakePort());
    const result = await run((v) => v.createVault({ mode: "pin", pin: "123456" }));
    expect(result).toEqual({ ok: true });
    expect(vault().phase).toBe("unlocked");
    expect(vault().entries).toEqual([]);
    expect(vault().hasPin).toBe(true);
    expect(vault().prfRegistered).toBe(false);
    expect(readVaultRecord()?.pin).not.toBeNull();
  });

  it("accepts an 8-digit PIN", async () => {
    mount(new FakePort());
    const result = await run((v) => v.createVault({ mode: "pin", pin: "12345678" }));
    expect(result).toEqual({ ok: true });
  });

  it("rejects PIN lengths outside 6-8 digits", async () => {
    mount(new FakePort());
    for (const pin of ["12345", "123456789", "abcdef", ""]) {
      const result = await run((v) => v.createVault({ mode: "pin", pin }));
      expect(result).toEqual({ ok: false, error: "pin must be 6–8 digits" });
    }
    expect(vault().phase).toBe("setup");
    expect(readVaultRecord()).toBeNull();
  });

  it("creates a PRF vault only after register AND a key-producing get", async () => {
    const port = new FakePort();
    mount(port);
    const result = await run((v) => v.createVault({ mode: "prf" }));
    expect(result).toEqual({ ok: true });
    expect(port.registerCalls).toBe(1);
    expect(port.getCalls).toBe(1);
    expect(vault().prfRegistered).toBe(true);
    expect(vault().hasPin).toBe(false);
    expect(localStorage.getItem(CREDENTIAL_ID_KEY)).toBe(CREDENTIAL_ID);
  });

  it("does not persist a credential id when get provides no key", async () => {
    const port = new FakePort({ getResult: { ok: false, reason: "no-prf" } });
    mount(port);
    const result = await run((v) => v.createVault({ mode: "prf" }));
    expect(result).toEqual({ ok: false, error: "this passkey can't produce a key on this device" });
    expect(localStorage.getItem(CREDENTIAL_ID_KEY)).toBeNull();
    expect(readVaultRecord()).toBeNull();
  });

  it("reports each get() failure reason with its own setup message", async () => {
    const expected: Array<[FailureReason, string]> = [
      ["unavailable", "fingerprint unavailable on this device"],
      ["not-allowed", "passkey verification was cancelled"],
      ["no-prf", "this passkey can't produce a key on this device"],
      ["error", "passkey verification failed"],
    ];
    for (const [reason, message] of expected) {
      unmount();
      localStorage.clear();
      mount(new FakePort({ getResult: { ok: false, reason } }));
      const result = await run((v) => v.createVault({ mode: "prf" }));
      expect(result).toEqual({ ok: false, error: message });
      expect(localStorage.getItem(CREDENTIAL_ID_KEY)).toBeNull();
      expect(readVaultRecord()).toBeNull();
    }
  });

  it("reports a register-time no-prf without promising a PIN at setup", async () => {
    mount(new FakePort({ registerResult: { ok: false, reason: "no-prf" } }));
    const result = await run((v) => v.createVault({ mode: "prf" }));
    expect(result).toEqual({ ok: false, error: "this passkey can't produce a key on this device" });
    expect(readVaultRecord()).toBeNull();
  });

  it("wraps the key twice in prf+pin mode", async () => {
    mount(new FakePort());
    const result = await run((v) => v.createVault({ mode: "prf+pin", pin: "123456" }));
    expect(result).toEqual({ ok: true });
    const record = readVaultRecord();
    expect(record?.pin).not.toBeNull();
    expect(record?.prf).not.toBeNull();
    expect(vault().hasPin).toBe(true);
    expect(vault().prfRegistered).toBe(true);
  });

  it("rejects PRF modes when the port reports no support", async () => {
    const port = new FakePort({ supported: false });
    mount(port);
    for (const mode of ["prf", "prf+pin"] as const) {
      const result = await run((v) => v.createVault({ mode, pin: "123456" }));
      expect(result).toEqual({ ok: false, error: "fingerprint unavailable on this device" });
    }
    expect(port.registerCalls).toBe(0);
  });
});

describe("unlockWithPin", () => {
  it("unlocks with the right PIN and loads stored entries in order", async () => {
    const first = entry();
    const second = entry({ issuer: "GitLab", account: "ops@example.com", secret: SECRET_2 });
    await seedVault({ pin: "123456", entries: [first, second] });
    mount(new FakePort());
    const result = await run((v) => v.unlockWithPin("123456"));
    expect(result).toEqual({ ok: true });
    expect(vault().phase).toBe("unlocked");
    expect(vault().entries.map((e) => e.issuer)).toEqual(["GitHub", "GitLab"]);
  });

  it("reports wrong-pin for a bad PIN and stays locked", async () => {
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    const result = await run((v) => v.unlockWithPin("999999"));
    expect(result).toEqual({ ok: false, reason: "wrong-pin" });
    expect(vault().phase).toBe("locked");
    expect(vault().entries).toEqual([]);
  });

  it("escalates to a delay at the fifth failure, ticks down, and resets on success", async () => {
    vi.useFakeTimers();
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await run((v) => v.unlockWithPin("000000"));
      expect(result).toEqual({ ok: false, reason: "wrong-pin" });
    }
    expect(vault().retryAfterMs).toBe(0);

    const fifth = await run((v) => v.unlockWithPin("000000"));
    expect(fifth).toEqual({ ok: false, reason: "wrong-pin" });
    expect(vault().retryAfterMs).toBeGreaterThan(0);

    const blocked = await run((v) => v.unlockWithPin("123456"));
    expect(blocked).toEqual({ ok: false, reason: "delay" });

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(vault().retryAfterMs).toBe(0);

    const unlocked = await run((v) => v.unlockWithPin("123456"));
    expect(unlocked).toEqual({ ok: true });
    expect(vault().retryAfterMs).toBe(0);
  });

  it("reports corrupt when the record has no PIN wrap", async () => {
    await seedVault({ prf: true });
    mount(new FakePort());
    const result = await run((v) => v.unlockWithPin("123456"));
    expect(result).toEqual({ ok: false, reason: "corrupt" });
  });
});

describe("unlockWithBiometric", () => {
  it("unlocks with the registered credential", async () => {
    await seedVault({ prf: true, entries: [entry()] });
    mount(new FakePort());
    const result = await run((v) => v.unlockWithBiometric());
    expect(result).toEqual({ ok: true });
    expect(vault().phase).toBe("unlocked");
    expect(vault().entries).toHaveLength(1);
  });

  it("reports no-biometric-credential when the vault has no PRF wrap", async () => {
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    const result = await run((v) => v.unlockWithBiometric());
    expect(result).toEqual({ ok: false, reason: "no-biometric-credential" });
  });

  it("reports no-biometric-credential when get returns no-prf (never 'fingerprint failed')", async () => {
    await seedVault({ prf: true, pin: "123456" });
    mount(new FakePort({ getResult: { ok: false, reason: "no-prf" } }));
    const result = await run((v) => v.unlockWithBiometric());
    expect(result).toEqual({ ok: false, reason: "no-biometric-credential" });
    expect(vault().error).toBeNull();
  });

  it("reports unavailable when the port is unsupported", async () => {
    await seedVault({ prf: true });
    mount(new FakePort({ supported: false }));
    const result = await run((v) => v.unlockWithBiometric());
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports unavailable when get says unavailable", async () => {
    await seedVault({ prf: true });
    mount(new FakePort({ getResult: { ok: false, reason: "unavailable" } }));
    const result = await run((v) => v.unlockWithBiometric());
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports corrupt when the entries blob is not under the unwrapped key", async () => {
    const { record } = await seedVault({ prf: true, entries: [entry()] });
    // Re-seal the entries under an unrelated key: the PRF unwrap still succeeds,
    // so this can only be caught by the entries tag check.
    const sealed = await sealEntries(bytes32(), record, [entry()]);
    localStorage.setItem(
      VAULT_STORAGE_KEY,
      JSON.stringify({
        ...record,
        entriesIvB64: sealed.ivB64,
        entriesCtB64: sealed.ctB64,
      })
    );

    mount(new FakePort());
    const result = await run((v) => v.unlockWithBiometric());
    expect(result).toEqual({ ok: false, reason: "corrupt" });
    expect(vault().phase).toBe("locked");
  });
});

describe("key layering", () => {
  it("cannot decrypt the entries blob with the PIN-derived key", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const record = readVaultRecord() as VaultRecord;
    const pinVek = await derivePinVek("123456", record.kdf.saltB64, record.kdf.iterations);
    // The entries blob is sealed under the vaultKey, not the PIN KEK: using the
    // KEK on it must fail the tag check rather than yield the URIs.
    const misuse = await aesGcmDecrypt(
      pinVek,
      record.entriesIvB64,
      record.entriesCtB64,
      entriesAad({ version: record.version, vaultId: record.vaultId })
    );
    expect(misuse).toBeNull();
  });
});

describe("saveEntry", () => {
  it("adds a new entry", async () => {
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const result = await run((v) => v.saveEntry(entryToUri(entry())));
    expect(result).toEqual({ ok: true, outcome: "added" });
    expect(vault().entries).toHaveLength(1);
    // Survives a re-read from disk.
    expect(readVaultRecord()?.entriesCtB64).not.toBeUndefined();
  });

  it("reports a duplicate for the same canonical secret", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const result = await run((v) => v.saveEntry(entryToUri(entry({ secret: "jbswy3dp ehpk3pxp" }))));
    expect(result).toEqual({ ok: true, outcome: "duplicate" });
    expect(vault().entries).toHaveLength(1);
  });

  it("returns a conflict for a same-name different-secret entry", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const result = await run((v) => v.saveEntry(entryToUri(entry({ secret: SECRET_2 }))));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected conflict");
    expect(result.error).toBe("account already exists with a different secret");
    expect(result.conflict?.existing.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(vault().entries).toHaveLength(1);
  });

  it("replaces in place when replace is set", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const result = await run((v) => v.saveEntry(entryToUri(entry({ secret: SECRET_2 })), { replace: true }));
    expect(result).toEqual({ ok: true, outcome: "replaced" });
    expect(vault().entries).toHaveLength(1);
    expect(vault().entries[0].secret).toBe(SECRET_2);
  });

  it("fails loudly when storage moved on in another tab", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const current = readVaultRecord() as VaultRecord;
    localStorage.setItem(
      VAULT_STORAGE_KEY,
      JSON.stringify({ ...current, revision: current.revision + 5 })
    );

    const result = await run((v) =>
      v.saveEntry(entryToUri(entry({ account: "other@example.com", secret: SECRET_2 })))
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected stale");
    expect(result.error).toContain("another tab");
    expect(vault().error).toContain("another tab");
  });

  it("refuses to save while locked", async () => {
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    const result = await run((v) => v.saveEntry(entryToUri(entry())));
    expect(result).toEqual({ ok: false, error: "vault locked" });
  });
});

describe("removeEntry", () => {
  it("removes by canonical secret and rewrites the blob", async () => {
    await seedVault({ pin: "123456", entries: [entry(), entry({ issuer: "GitLab", secret: SECRET_2 })] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const result = await run((v) => v.removeEntry("jbswy3dpehpk3pxp"));
    expect(result).toEqual({ ok: true });
    expect(vault().entries.map((e) => e.issuer)).toEqual(["GitLab"]);
  });
});

describe("export and import (unlocked)", () => {
  it("round-trips entries through export and import", async () => {
    await seedVault({ pin: "123456", entries: [entry(), entry({ issuer: "GitLab", secret: SECRET_2 })] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));
    const exported = await run((v) => v.exportVault("correct horse battery"));
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error("export failed");

    // A second device with an unrelated, empty vault.
    unmount();
    localStorage.clear();
    await seedVault({ pin: "654321" });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("654321"));

    const imported = await run((v) => v.importUnlocked(exported.json, "correct horse battery"));
    expect(imported).toEqual({ ok: true, added: 2, replaced: 0, duplicates: 0 });
    expect(vault().entries).toHaveLength(2);
  });

  it("stages conflicts, then applies the user's choices in one write", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const built = await buildExportJson([entry({ secret: SECRET_2 })], "correct horse battery");
    if (!built.ok) throw new Error("build failed");

    const first = await run((v) => v.importUnlocked(built.json, "correct horse battery"));
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("expected conflicts");
    expect(first.error).toBe("conflicts need choices");
    expect(first.needsChoices?.conflicts).toHaveLength(1);
    expect(vault().entries[0].secret).toBe("JBSWY3DPEHPK3PXP");

    const applied = await run((v) => v.importUnlocked(built.json, "correct horse battery", ["replace"]));
    expect(applied).toEqual({ ok: true, added: 0, replaced: 1, duplicates: 0 });
    expect(vault().entries[0].secret).toBe(SECRET_2);
  });

  it("rejects an import that would exceed the entry cap", async () => {
    const full: OtpauthEntry[] = [];
    for (let index = 0; index < MAX_VAULT_ENTRIES; index += 1) {
      full.push(entry({ account: `user${index}@example.com`, secret: "JBSWY3DPEHPK3PXP" }));
    }
    await seedVault({ pin: "123456", entries: full });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const built = await buildExportJson([entry({ issuer: "Extra", account: "extra@example.com" })], "correct horse battery");
    if (!built.ok) throw new Error("build failed");
    const imported = await run((v) => v.importUnlocked(built.json, "correct horse battery"));
    expect(imported).toEqual({ ok: false, error: "vault entry limit" });
    expect(vault().entries).toHaveLength(MAX_VAULT_ENTRIES);
  });

  it("refuses to export while locked", async () => {
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    const result = await run((v) => v.exportVault("correct horse battery"));
    expect(result).toEqual({ ok: false, error: "vault locked" });
  });
});

describe("importLocked", () => {
  it("stages, verifies, commits, and keeps a superseded copy until the next unlock", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    const primaryBefore = localStorage.getItem(VAULT_STORAGE_KEY) as string;

    const built = await buildExportJson(
      [entry({ issuer: "Imported", account: "new@example.com", secret: SECRET_2 })],
      "correct horse battery"
    );
    if (!built.ok) throw new Error("build failed");

    mount(new FakePort());
    const committed = await run((v) =>
      v.importLocked(built.json, "correct horse battery", { mode: "pin", pin: "654321" })
    );
    expect(committed).toEqual({ ok: true });
    expect(vault().phase).toBe("locked");
    expect(localStorage.getItem(VAULT_PENDING_KEY)).toBeNull();
    // The replaced record is kept verbatim as the recovery copy.
    expect(localStorage.getItem(VAULT_SUPERSEDED_KEY)).toBe(primaryBefore);
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).not.toBe(primaryBefore);

    // The new credential opens the imported vault; the old PIN does not.
    const oldPin = await run((v) => v.unlockWithPin("123456"));
    expect(oldPin).toEqual({ ok: false, reason: "wrong-pin" });
    const newPin = await run((v) => v.unlockWithPin("654321"));
    expect(newPin).toEqual({ ok: true });
    expect(vault().entries.map((e) => e.issuer)).toEqual(["Imported"]);
    // Cleanup happens on that first successful unlock.
    expect(localStorage.getItem(VAULT_SUPERSEDED_KEY)).toBeNull();
  });

  it("leaves the primary vault byte-identical when credential validation fails", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    const primaryBefore = localStorage.getItem(VAULT_STORAGE_KEY) as string;

    const built = await buildExportJson([entry()], "correct horse battery");
    if (!built.ok) throw new Error("build failed");

    // register succeeds, then get fails: step (b) rejects before any write.
    const port = new FakePort({ getResult: { ok: false, reason: "no-prf" } });
    mount(port);
    const result = await run((v) => v.importLocked(built.json, "correct horse battery", { mode: "prf" }));
    expect(result).toEqual({ ok: false, error: "this passkey can't produce a key here — use a PIN instead" });
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBe(primaryBefore);
    expect(localStorage.getItem(VAULT_PENDING_KEY)).toBeNull();
    expect(port.registerCalls).toBe(1);

    // And the old vault is still openable.
    const unlocked = await run((v) => v.unlockWithPin("123456"));
    expect(unlocked).toEqual({ ok: true });
  });

  it("reports a register-time no-prf at import with the actionable wording", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    const built = await buildExportJson([entry()], "correct horse battery");
    if (!built.ok) throw new Error("build failed");

    mount(new FakePort({ registerResult: { ok: false, reason: "no-prf" } }));
    const result = await run((v) => v.importLocked(built.json, "correct horse battery", { mode: "prf" }));
    expect(result).toEqual({ ok: false, error: "this passkey can't produce a key here — use a PIN instead" });
    expect(localStorage.getItem(VAULT_PENDING_KEY)).toBeNull();
  });

  it("rejects a bad PIN before touching storage", async () => {
    await seedVault({ pin: "123456" });
    const primaryBefore = localStorage.getItem(VAULT_STORAGE_KEY) as string;
    const built = await buildExportJson([entry()], "correct horse battery");
    if (!built.ok) throw new Error("build failed");

    mount(new FakePort());
    const result = await run((v) =>
      v.importLocked(built.json, "correct horse battery", { mode: "pin", pin: "123" })
    );
    expect(result).toEqual({ ok: false, error: "pin must be 6–8 digits" });
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).toBe(primaryBefore);
    expect(localStorage.getItem(VAULT_PENDING_KEY)).toBeNull();
  });

  it("keeps the FIRST superseded copy across repeated locked imports", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    const originalA = localStorage.getItem(VAULT_STORAGE_KEY) as string;

    const exportB = await buildExportJson(
      [entry({ issuer: "Bravo", account: "b@example.com", secret: SECRET_2 })],
      "correct horse battery"
    );
    const exportC = await buildExportJson(
      [entry({ issuer: "Charlie", account: "c@example.com", secret: SECRET_3 })],
      "correct horse battery"
    );
    if (!exportB.ok || !exportC.ok) throw new Error("build failed");

    mount(new FakePort());
    const first = await run((v) =>
      v.importLocked(exportB.json, "correct horse battery", { mode: "pin", pin: "654321" })
    );
    expect(first).toEqual({ ok: true });
    expect(localStorage.getItem(VAULT_SUPERSEDED_KEY)).toBe(originalA);

    // Second locked import before A was ever opened: the recovery copy must
    // still be A (the only copy of it), not B (which came from an export file).
    const second = await run((v) =>
      v.importLocked(exportC.json, "correct horse battery", { mode: "pin", pin: "777777" })
    );
    expect(second).toEqual({ ok: true });
    expect(localStorage.getItem(VAULT_SUPERSEDED_KEY)).toBe(originalA);
    expect(localStorage.getItem(VAULT_STORAGE_KEY)).not.toBe(originalA);

    const unlocked = await run((v) => v.unlockWithPin("777777"));
    expect(unlocked).toEqual({ ok: true });
    expect(vault().entries.map((e) => e.issuer)).toEqual(["Charlie"]);
  });
});

describe("lock and idle", () => {
  it("lock() clears entries from state and drops the key", async () => {
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));
    expect(vault().entries).toHaveLength(1);

    act(() => {
      vault().lock();
    });
    expect(vault().phase).toBe("locked");
    expect(vault().entries).toEqual([]);
    expect(vault().retryAfterMs).toBe(0);
  });

  it("auto-locks after IDLE_LOCK_MS of no input", async () => {
    vi.useFakeTimers();
    await seedVault({ pin: "123456", entries: [entry()] });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));
    expect(vault().phase).toBe("unlocked");

    await act(async () => {
      vi.advanceTimersByTime(IDLE_LOCK_MS + 1);
    });
    expect(vault().phase).toBe("locked");
    expect(vault().entries).toEqual([]);
  });

  it("keeps the vault open while input keeps arriving", async () => {
    vi.useFakeTimers();
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    for (let step = 0; step < 3; step += 1) {
      await act(async () => {
        vi.advanceTimersByTime(IDLE_LOCK_MS - 1_000);
        window.dispatchEvent(new Event("keydown"));
      });
    }
    expect(vault().phase).toBe("unlocked");
  });

  it("treats scrolling and touch as activity, so reading the list never locks the vault", async () => {
    vi.useFakeTimers();
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    for (const event of ["scroll", "touchmove"]) {
      await act(async () => {
        vi.advanceTimersByTime(IDLE_LOCK_MS - 1_000);
        window.dispatchEvent(new Event(event));
      });
      expect(vault().phase).toBe("unlocked");
    }
  });
});

describe("cross-tab and clock", () => {
  it("locks with an explanation when another tab changes the record", async () => {
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));

    const current = readVaultRecord() as VaultRecord;
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: VAULT_STORAGE_KEY,
          newValue: JSON.stringify({ ...current, revision: current.revision + 3 }),
        })
      );
    });
    expect(vault().phase).toBe("locked");
    expect(vault().entries).toEqual([]);
    expect(vault().error).toBe("vault changed in another tab");
  });

  it("persists a clamped clock offset and clears skew", async () => {
    // A watermark far in the past makes the unlock measure skew.
    await seedVault({ pin: "123456" });
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));
    expect(vault().clockSkew).toBe(false);

    act(() => {
      vault().setClockOffset(5_000);
    });
    expect(vault().clockOffset).toBe(5_000);
    expect(JSON.parse(localStorage.getItem(CLOCK_OFFSET_KEY) as string)).toBe(5_000);
    expect(vault().clockSkew).toBe(false);

    act(() => {
      vault().setClockOffset(999_999_999_999);
    });
    expect(vault().clockOffset).toBe(86_400_000);
  });

  it("surfaces clock skew measured at unlock, and clears it when the offset is touched", async () => {
    const { record } = await seedVault({ pin: "123456" });
    localStorage.setItem(
      VAULT_STORAGE_KEY,
      JSON.stringify({ ...record, lastSeenTime: Date.now() - 600_000 })
    );
    mount(new FakePort());
    await run((v) => v.unlockWithPin("123456"));
    expect(vault().clockSkew).toBe(true);

    act(() => {
      vault().setClockOffset(0);
    });
    expect(vault().clockSkew).toBe(false);
  });
});

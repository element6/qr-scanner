/**
 * Central state hook for the local 2FA vault.
 *
 * This is the integration layer: it is the only place that holds the unwrapped
 * `vaultKey`, sequences the WebAuthn/PRF ceremonies, and performs the
 * compare-and-swap writes that keep two tabs from destroying each other's
 * entries.
 *
 * Layering, which is load-bearing and worth stating once:
 *
 * - `vaultKey` is 32 random bytes, generated once at vault creation and never
 *   derived from anything the user knows.
 * - PIN/PRF wraps protect *that key* (AAD: `pinWrapAad` / `prfWrapAad`).
 * - The entries blob is encrypted *under the vaultKey* (AAD: `entriesAad`).
 *
 * Decrypting the entries blob with a PIN-derived key therefore fails by
 * construction, and a wrong PIN and a corrupted blob are indistinguishable on
 * the PIN path — which is the point.
 *
 * The unwrapped key lives in a ref local to this hook instance. It is never
 * returned, never put in React state, and is cleared by `lock()`, by the idle
 * timer and by unmount.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64,
  derivePinVek,
  derivePrfVek,
  entriesAad,
  pinWrapAad,
  prfWrapAad,
  unb64,
} from "../utils/vaultCrypto";
import { randomBytes } from "../utils/random";
import {
  CLOCK_OFFSET_KEY,
  CREDENTIAL_ID_KEY,
  MAX_VAULT_ENTRIES,
  VAULT_PENDING_KEY,
  VAULT_STORAGE_KEY,
  VAULT_SUPERSEDED_KEY,
  createVaultRecord,
  normalizeVaultRecord,
  readVaultRecord,
  writeVaultRecord,
  type VaultRecord,
  type VaultWrap,
} from "../utils/vaultStore";
import {
  canonicalSecret as canonicalize,
  entryToUri,
  parseOtpauth,
  type OtpauthEntry,
} from "../utils/otpauth";
import {
  applyImport,
  buildExportJson,
  parseExportJson,
  planImport,
  validateImportUris,
  type ConflictChoice,
  type MergePlan,
} from "../utils/exportFormat";
import {
  defaultWebAuthnPort,
  makePrfSalt,
  type WebAuthnPort,
} from "../utils/webauthn";

export type VaultPhase = "setup" | "locked" | "unlocked";
export type VaultBusy =
  | "creating"
  | "unlocking"
  | "saving"
  | "exporting"
  | "importing"
  | "migrating"
  | null;

/**
 * Outcome of a save attempt.
 *
 * `conflict` is only present on an identity or case-variant collision: the same
 * issuer/account already exists with a different secret, so silently appending
 * would create two codes the user cannot tell apart. The caller re-invokes with
 * `{ replace: true }` to overwrite.
 */
export type SaveResult =
  | { ok: true; outcome: "added" | "replaced" | "duplicate"; warning?: string }
  | {
      ok: false;
      error: string;
      conflict?: { existing: OtpauthEntry; incoming: OtpauthEntry };
    };

export interface UseVault {
  phase: VaultPhase;
  busy: VaultBusy;
  /** User-facing message; cleared whenever a new action starts. */
  error: string | null;
  /** `[]` unless unlocked, in stored order. */
  entries: OtpauthEntry[];
  hasPin: boolean;
  prfRegistered: boolean;
  /** Persisted `CLOCK_OFFSET_KEY`, default 0 (ms). */
  clockOffset: number;
  /** Measured once at unlock; cleared as soon as the offset is touched. */
  clockSkew: boolean;
  /** Remaining PIN delay in ms; 0 means no delay (see the escalating schedule). */
  retryAfterMs: number;
  unlockWithPin(pin: string): Promise<{ ok: true } | { ok: false; reason: "wrong-pin" | "corrupt" | "delay" }>;
  unlockWithBiometric(): Promise<
    { ok: true } | { ok: false; reason: "no-biometric-credential" | "unavailable" | "corrupt" }
  >;
  lock(): void;
  createVault(opts: {
    mode: "prf" | "prf+pin" | "pin";
    pin?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  saveEntry(uri: string, opts?: { replace?: boolean }): Promise<SaveResult>;
  removeEntry(canonicalSecret: string): Promise<{ ok: boolean }>;
  exportVault(password: string): Promise<{ ok: true; json: string } | { ok: false; error: string }>;
  importUnlocked(
    json: string,
    password: string,
    choices?: ConflictChoice[]
  ): Promise<
    | { ok: true; added: number; replaced: number; duplicates: number }
    | { ok: false; error: string; needsChoices?: MergePlan }
  >;
  importLocked(
    json: string,
    password: string,
    credential: { mode: "pin"; pin: string } | { mode: "prf" }
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  setClockOffset(ms: number): void;
}

/** Inactivity before the vault locks itself. */
export const IDLE_LOCK_MS = 120_000;

/** A PIN delay only starts at the fifth consecutive failure. */
const DELAY_START_FAILURES = 5;
/** Escalation step: 1s, 2s, 4s ... capped. */
const DELAY_BASE_MS = 1_000;
const DELAY_CAP_MS = 30_000;
/** Clock drift above this is worth telling the user about. */
const CLOCK_SKEW_THRESHOLD_MS = 120_000;
/** Bounds on a user-supplied clock correction: ±24h. */
const CLOCK_OFFSET_LIMIT_MS = 86_400_000;
const VAULT_KEY_BYTES = 32;
const KDF_SALT_BYTES = 16;
const CHALLENGE_BYTES = 32;
const PIN_RE = /^\d{6,8}$/;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** `"pin must be 6–8 digits"`, or null when the PIN is acceptable. */
function pinProblem(pin: string | undefined): string | null {
  return PIN_RE.test(String(pin ?? "")) ? null : "pin must be 6–8 digits";
}



function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can throw outright (sandboxed iframe / disabled cookies).
    return null;
  }
}

function writeKey(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do: an unremovable key is a stale artifact, not data loss.
  }
}

function readClockOffset(): number {
  const raw = readKey(CLOCK_OFFSET_KEY);
  if (raw === null) return 0;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isFinite(value) ? clampOffset(value) : 0;
  } catch {
    return 0;
  }
}

function clampOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-CLOCK_OFFSET_LIMIT_MS, Math.min(CLOCK_OFFSET_LIMIT_MS, ms));
}

function credentialId(): string | null {
  return readKey(CREDENTIAL_ID_KEY);
}

/** Serialized `{ uris: [...] }` payload that the entries blob encrypts. */
function entriesPlaintext(entries: OtpauthEntry[]): Uint8Array {
  return textEncoder.encode(JSON.stringify({ uris: entries.map(entryToUri) }));
}

/**
 * Decode an entries blob into entries, or null when it is unreadable.
 *
 * Null covers three distinct failures — bad tag, bad JSON, any invalid URI —
 * because the caller has nothing useful to do differently: the blob does not
 * authenticate as a vault's entries.
 */
function parseEntries(plain: Uint8Array): OtpauthEntry[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(textDecoder.decode(plain));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const uris = (payload as { uris?: unknown }).uris;
  if (!Array.isArray(uris) || !uris.every((uri): uri is string => typeof uri === "string")) {
    return null;
  }
  const entries: OtpauthEntry[] = [];
  for (const uri of uris) {
    const parsed = parseOtpauth(uri);
    if (!parsed.ok) return null;
    entries.push(parsed.entry);
  }
  return entries;
}

async function readEntries(vaultKey: Uint8Array, record: VaultRecord): Promise<OtpauthEntry[] | null> {
  const plain = await aesGcmDecrypt(
    vaultKey,
    record.entriesIvB64,
    record.entriesCtB64,
    entriesAad({ version: record.version, vaultId: record.vaultId })
  );
  return plain === null ? null : parseEntries(plain);
}

/** The header fields `pinWrapAad` commits to. */
function pinHeader(record: VaultRecord): {
  version: number;
  vaultId: string;
  kdf: { alg: string; hash: string; iterations: number; saltB64: string };
} {
  return {
    version: record.version,
    vaultId: record.vaultId,
    kdf: {
      alg: record.kdf.alg,
      hash: record.kdf.hash,
      iterations: record.kdf.iterations,
      saltB64: record.kdf.saltB64,
    },
  };
}

function prfHeader(record: VaultRecord, prfSaltB64: string): {
  version: number;
  vaultId: string;
  prfSaltB64: string;
} {
  return { version: record.version, vaultId: record.vaultId, prfSaltB64 };
}

/** Where the WebAuthn ceremony ran, so no-prf wording promises only what exists. */
type CeremonyContext = "setup" | "import";

function registerError(reason: "unavailable" | "not-allowed" | "no-prf" | "error", ctx: CeremonyContext): string {
  switch (reason) {
    case "unavailable":
      return "fingerprint unavailable on this device";
    case "not-allowed":
      return "fingerprint setup was cancelled";
    case "no-prf":
      // Never "your fingerprint failed": the passkey exists but produced no
      // key. Only the import flow can offer a PIN, so only import says so —
      // at setup there is no reachable pin-only path, and promising one would
      // be a false promise.
      return ctx === "import"
        ? "this passkey can't produce a key here — use a PIN instead"
        : "this passkey can't produce a key on this device";
    default:
      return "fingerprint setup failed";
  }
}

/**
 * Maps a `WebAuthnPort.get` failure reason to a user-facing string.
 *
 * Every reason gets its own honest message: collapsing them into one string is
 * what made a cancelled prompt look like a hardware failure. As with
 * `registerError`, the no-prf PIN promise holds only in the import context.
 */
function getVerifyError(reason: "unavailable" | "not-allowed" | "no-prf" | "error", ctx: CeremonyContext): string {
  switch (reason) {
    case "unavailable":
      return "fingerprint unavailable on this device";
    case "not-allowed":
      return "passkey verification was cancelled";
    case "no-prf":
      return ctx === "import"
        ? "this passkey can't produce a key here — use a PIN instead"
        : "this passkey can't produce a key on this device";
    default:
      return "passkey verification failed";
  }
}

function sameIdentity(a: OtpauthEntry, b: OtpauthEntry): boolean {
  return a.issuer === b.issuer && a.account === b.account;
}

function sameIdentityLoosely(a: OtpauthEntry, b: OtpauthEntry): boolean {
  return (
    a.issuer.toLowerCase() === b.issuer.toLowerCase() &&
    a.account.toLowerCase() === b.account.toLowerCase()
  );
}

/** Fresh wrap of `vaultKey` under `kek`, returned in the stored shape. */
function wrapKey(kek: Uint8Array, vaultKey: Uint8Array, aad: Uint8Array): Promise<VaultWrap> {
  return aesGcmEncrypt(kek, vaultKey, aad);
}

/**
 * The hook. Every call site shares one vault instance per mounted hook; two
 * hooks in the same document are two independent in-memory keys that reconcile
 * only through the `storage` event.
 *
 * @param port - WebAuthn port; injectable so tests never touch a real
 * authenticator.
 * @returns The vault state and its actions.
 *
 * @example
 * ```tsx
 * const vault = useVault();
 * if (vault.phase === "setup") {
 *   await vault.createVault({ mode: "prf+pin", pin });
 * }
 * const saved = await vault.saveEntry(uri);
 * if (!saved.ok && saved.conflict) await vault.saveEntry(uri, { replace: true });
 * ```
 */
export function useVault(port: WebAuthnPort = defaultWebAuthnPort): UseVault {
  // Read once, before first paint: booting through an effect would render one
  // frame of "setup" for a user who actually has a vault.
  const bootRef = useRef<{ phase: VaultPhase; hasPin: boolean; prfRegistered: boolean } | null>(null);
  if (bootRef.current === null) {
    const record = readVaultRecord();
    bootRef.current = {
      phase: record === null ? "setup" : "locked",
      hasPin: record?.pin != null,
      prfRegistered: record?.prf != null,
    };
  }

  const [phase, setPhase] = useState<VaultPhase>(bootRef.current.phase);
  const [busy, setBusy] = useState<VaultBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<OtpauthEntry[]>([]);
  const [hasPin, setHasPin] = useState(bootRef.current.hasPin);
  const [prfRegistered, setPrfRegistered] = useState(bootRef.current.prfRegistered);
  const [clockOffset, setClockOffsetState] = useState<number>(readClockOffset);
  const [clockSkew, setClockSkew] = useState(false);
  const [retryAfterMs, setRetryAfterMs] = useState(0);

  // WHY a ref: the unwrapped vault key must never be reachable from React state
  // (devtools, serialized props, error boundaries) or from a caller.
  const vaultKeyRef = useRef<Uint8Array | null>(null);
  const recordRef = useRef<VaultRecord | null>(null);
  const entriesRef = useRef<OtpauthEntry[]>([]);
  const phaseRef = useRef<VaultPhase>(bootRef.current.phase);
  const failCountRef = useRef(0);
  const delayRef = useRef<{ until: number; ms: number } | null>(null);

  const applyPhase = useCallback((next: VaultPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const applyEntries = useCallback((next: OtpauthEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const clearKey = useCallback(() => {
    vaultKeyRef.current = null;
    recordRef.current = null;
    applyEntries([]);
    setRetryAfterMs(0);
    delayRef.current = null;
    failCountRef.current = 0;
  }, [applyEntries]);

  const lock = useCallback(() => {
    clearKey();
    setBusy(null);
    setError(null);
    // A vault that does not exist cannot be "locked"; keeping "setup" avoids a
    // dead-end screen if a stray lock() fires before creation.
    applyPhase(readVaultRecord() === null ? "setup" : "locked");
  }, [applyPhase, clearKey]);

  // Unmount drops the only copy of the key. Without this, a navigated-away tab
  // would keep a usable key in a closure.
  useEffect(() => () => clearKey(), [clearKey]);

  /**
   * Shared post-unlock bookkeeping for both credentials.
   *
   * The CAS write only advances `lastSeenTime`/`revision`; the ciphertext is
   * untouched, so a stale revision costs the watermark update, never the vault.
   */
  const finishUnlock = useCallback(
    (record: VaultRecord, vaultKey: Uint8Array, unlocked: OtpauthEntry[]) => {
      vaultKeyRef.current = vaultKey;
      recordRef.current = record;
      const now = Date.now();
      const updated: VaultRecord = {
        ...record,
        revision: record.revision + 1,
        lastSeenTime: now,
      };
      const outcome = writeVaultRecord(updated, record.revision);
      if (outcome.ok) {
        recordRef.current = updated;
      } else if (outcome.reason === "stale-revision") {
        setError("changed in another tab — reload");
      } else {
        setError("could not update the vault — storage unavailable");
      }

      // Measured against the watermark we read, before we overwrite it.
      setClockSkew(Math.abs(now - record.lastSeenTime) > CLOCK_SKEW_THRESHOLD_MS);
      failCountRef.current = 0;
      delayRef.current = null;
      setRetryAfterMs(0);
      setHasPin(record.pin !== null);
      setPrfRegistered(record.prf !== null);
      applyEntries(unlocked);
      applyPhase("unlocked");

      // First successful unlock after a committed locked import: the recovery
      // copy has served its purpose.
      removeKey(VAULT_SUPERSEDED_KEY);
    },
    [applyEntries, applyPhase]
  );

  /** Count one PIN failure and arm the escalating delay once it applies. */
  const notePinFailure = useCallback(() => {
    failCountRef.current += 1;
    const failures = failCountRef.current;
    if (failures >= DELAY_START_FAILURES) {
      const ms = Math.min(DELAY_BASE_MS * 2 ** (failures - DELAY_START_FAILURES), DELAY_CAP_MS);
      delayRef.current = { until: Date.now() + ms, ms };
      setRetryAfterMs(ms);
    }
  }, []);

  // Ticks the visible countdown while a PIN delay is armed. Reading the
  // deadline from a ref (rather than from state) keeps the remaining time
  // honest even if several attempts land inside one tick.
  useEffect(() => {
    if (retryAfterMs <= 0) return;
    const id = setInterval(() => {
      const delay = delayRef.current;
      const remaining = delay === null ? 0 : Math.max(0, delay.until - Date.now());
      if (remaining <= 0) delayRef.current = null;
      setRetryAfterMs(remaining);
    }, 250);
    return () => clearInterval(id);
  }, [retryAfterMs]);

  const unlockWithPin = useCallback(
    async (pin: string): Promise<{ ok: true } | { ok: false; reason: "wrong-pin" | "corrupt" | "delay" }> => {
      setError(null);
      const delay = delayRef.current;
      if (delay !== null && Date.now() < delay.until) {
        setRetryAfterMs(delay.until - Date.now());
        return { ok: false, reason: "delay" };
      }

      const record = readVaultRecord();
      if (record === null || record.pin === null) return { ok: false, reason: "corrupt" };

      setBusy("unlocking");
      try {
        const pinVek = await derivePinVek(pin, record.kdf.saltB64, record.kdf.iterations);
        const vaultKey = await aesGcmDecrypt(
          pinVek,
          record.pin.ivB64,
          record.pin.ctB64,
          pinWrapAad(pinHeader(record))
        );
        // One failure message for both layers: telling an attacker whether the
        // PIN or the blob failed is an oracle, and telling a user is useless.
        if (vaultKey === null) {
          notePinFailure();
          return { ok: false, reason: "wrong-pin" };
        }
        const unlocked = await readEntries(vaultKey, record);
        if (unlocked === null) {
          notePinFailure();
          return { ok: false, reason: "wrong-pin" };
        }
        finishUnlock(record, vaultKey, unlocked);
        return { ok: true };
      } finally {
        setBusy(null);
      }
    },
    [finishUnlock, notePinFailure]
  );

  const unlockWithBiometric = useCallback(async (): Promise<
    { ok: true } | { ok: false; reason: "no-biometric-credential" | "unavailable" | "corrupt" }
  > => {
    setError(null);
    const record = readVaultRecord();
    const id = credentialId();
    if (record === null || record.prf === null || id === null) {
      return { ok: false, reason: "no-biometric-credential" };
    }
    const salt = unb64(record.prf.saltB64);
    if (salt === null) return { ok: false, reason: "corrupt" };

    let supported = false;
    try {
      supported = await port.isSupported();
    } catch {
      supported = false;
    }
    if (!supported) return { ok: false, reason: "unavailable" };

    setBusy("unlocking");
    try {
      const got = await port.get({
        challenge: randomBytes(CHALLENGE_BYTES),
        prfSalt: salt,
        credentialIdB64: id,
      });
      if (!got.ok) {
        if (got.reason === "unavailable") return { ok: false, reason: "unavailable" };
        // "no-prf" is not an error to show as "fingerprint failed": it means this
        // device cannot produce the key, so the UI offers the PIN instead.
        if (got.reason === "no-prf") return { ok: false, reason: "no-biometric-credential" };
        return { ok: false, reason: "unavailable" };
      }

      const prfVek = await derivePrfVek(got.prfOutput, record.prf.saltB64);
      const vaultKey = await aesGcmDecrypt(
        prfVek,
        record.prf.ivB64,
        record.prf.ctB64,
        prfWrapAad(prfHeader(record, record.prf.saltB64))
      );
      // Unlike the PIN path there is no secret to protect here, so a failure is
      // reported as what it is: this vault's data is unreadable.
      if (vaultKey === null) return { ok: false, reason: "corrupt" };
      const unlocked = await readEntries(vaultKey, record);
      if (unlocked === null) return { ok: false, reason: "corrupt" };

      // Biometric failures deliberately do not touch the PIN delay counter:
      // there is no low-entropy secret to brute-force, and a failed fingerprint
      // is usually the wrong finger.
      finishUnlock(record, vaultKey, unlocked);
      return { ok: true };
    } finally {
      setBusy(null);
    }
  }, [finishUnlock, port]);

  const createVault = useCallback(
    async (opts: {
      mode: "prf" | "prf+pin" | "pin";
      pin?: string;
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      setError(null);
      const wantsPin = opts.mode === "pin" || opts.mode === "prf+pin";
      const wantsPrf = opts.mode === "prf" || opts.mode === "prf+pin";
      const pin = String(opts.pin ?? "");
      if (wantsPin) {
        const problem = pinProblem(pin);
        if (problem !== null) return { ok: false, error: problem };
      }

      let supported = false;
      if (wantsPrf) {
        try {
          supported = await port.isSupported();
        } catch {
          supported = false;
        }
        if (!supported) return { ok: false, error: "fingerprint unavailable on this device" };
      }

      setBusy("creating");
      try {
        let newCredentialId: string | null = null;
        let prfSaltB64: string | null = null;
        let prfOutput: Uint8Array | null = null;

        if (wantsPrf) {
          const salt = makePrfSalt();
          prfSaltB64 = b64(salt);
          const registration = await port.register({
            challenge: randomBytes(CHALLENGE_BYTES),
            prfSalt: salt,
          });
          if (!registration.ok) return { ok: false, error: registerError(registration.reason, "setup") };
          // PRF capability counts only when `get` actually returns a key: an
          // authenticator can advertise the extension and still not emit one.
          const got = await port.get({
            challenge: randomBytes(CHALLENGE_BYTES),
            prfSalt: salt,
            credentialIdB64: registration.credentialIdB64,
          });
          if (!got.ok) {
            // The credential id is NOT persisted: a credential that cannot
            // produce a key must not be offered as an unlock method.
            return { ok: false, error: getVerifyError(got.reason, "setup") };
          }
          prfOutput = got.prfOutput;
          newCredentialId = registration.credentialIdB64;
        }

        // Build the record first so the AADs can commit to its real vaultId;
        // createVaultRecord mints the id internally.
        const draft = createVaultRecord({
          kdfSaltB64: randomB64Salt(),
          prf: null,
          pin: null,
          entriesIvB64: "",
          entriesCtB64: "",
        });
        const vaultKey = randomBytes(VAULT_KEY_BYTES);

        let prf: ({ saltB64: string } & VaultWrap) | null = null;
        if (prfOutput !== null && prfSaltB64 !== null) {
          const prfVek = await derivePrfVek(prfOutput, prfSaltB64);
          prf = {
            saltB64: prfSaltB64,
            ...(await wrapKey(prfVek, vaultKey, prfWrapAad(prfHeader(draft, prfSaltB64)))),
          };
        }

        let pinWrap: VaultWrap | null = null;
        if (wantsPin) {
          const pinVek = await derivePinVek(pin, draft.kdf.saltB64, draft.kdf.iterations);
          pinWrap = await wrapKey(pinVek, vaultKey, pinWrapAad(pinHeader(draft)));
        }

        const sealed = await aesGcmEncrypt(
          vaultKey,
          entriesPlaintext([]),
          entriesAad({ version: draft.version, vaultId: draft.vaultId })
        );
        const next: VaultRecord = {
          ...draft,
          prf,
          pin: pinWrap,
          entriesIvB64: sealed.ivB64,
          entriesCtB64: sealed.ctB64,
        };

        const outcome = writeVaultRecord(next, 0);
        if (!outcome.ok) {
          return {
            ok: false,
            error:
              outcome.reason === "stale-revision"
                ? "changed in another tab — reload"
                : "could not save the vault",
          };
        }
        if (newCredentialId !== null) writeKey(CREDENTIAL_ID_KEY, newCredentialId);

        vaultKeyRef.current = vaultKey;
        recordRef.current = next;
        setHasPin(wantsPin);
        setPrfRegistered(wantsPrf);
        setClockSkew(false);
        applyEntries([]);
        applyPhase("unlocked");
        return { ok: true };
      } finally {
        setBusy(null);
      }
    },
    [applyEntries, applyPhase, port]
  );

  const saveEntry = useCallback(
    async (uri: string, opts?: { replace?: boolean }): Promise<SaveResult> => {
      setError(null);
      const vaultKey = vaultKeyRef.current;
      const base = recordRef.current;
      if (phaseRef.current !== "unlocked" || vaultKey === null || base === null) {
        // Must setError: the panel stops the queue silently on any non-conflict
        // failure and reads `vault.error` as the reason.
        setError("vault locked");
        return { ok: false, error: "vault locked" };
      }

      const parsed = parseOtpauth(uri);
      if (!parsed.ok) {
        setError(parsed.error);
        return { ok: false, error: parsed.error };
      }
      const incoming = parsed.entry;
      const warning = parsed.warning;
      const incomingSecret = canonicalize(incoming.secret);
      const current = entriesRef.current;

      const duplicate = current.find((entry) => canonicalize(entry.secret) === incomingSecret);
      if (duplicate !== undefined && opts?.replace !== true) {
        return warning === undefined
          ? { ok: true, outcome: "duplicate" }
          : { ok: true, outcome: "duplicate", warning };
      }

      // Same name, different secret (exact first, then a case variant): the user
      // must choose, because both entries would render identically.
      const collision =
        current.find(
          (entry) => sameIdentity(entry, incoming) && canonicalize(entry.secret) !== incomingSecret
        ) ?? current.find((entry) => sameIdentityLoosely(entry, incoming));
      if (collision !== undefined && opts?.replace !== true) {
        return {
          ok: false,
          error: "account already exists with a different secret",
          conflict: { existing: collision, incoming },
        };
      }

      const target = collision ?? duplicate;
      const next = target === undefined
        ? [...current, incoming]
        : current.map((entry) => (entry === target ? incoming : entry));
      const outcome: "added" | "replaced" = target === undefined ? "added" : "replaced";

      setBusy("saving");
      try {
        const sealed = await aesGcmEncrypt(
          vaultKey,
          entriesPlaintext(next),
          entriesAad({ version: base.version, vaultId: base.vaultId })
        );
        const updated: VaultRecord = {
          ...base,
          revision: base.revision + 1,
          lastSeenTime: Date.now(),
          entriesIvB64: sealed.ivB64,
          entriesCtB64: sealed.ctB64,
        };
        // CAS against the revision *this tab believes*, so a foreign tab's write
        // is a loud stale-revision rather than a silent overwrite.
        const result = writeVaultRecord(updated, base.revision);
        if (!result.ok) {
          const message =
            result.reason === "stale-revision"
              ? "changed in another tab — reload"
              : "could not save — storage unavailable";
          setError(message);
          return { ok: false, error: message };
        }
        recordRef.current = updated;
        applyEntries(next);
        return warning === undefined ? { ok: true, outcome } : { ok: true, outcome, warning };
      } finally {
        setBusy(null);
      }
    },
    [applyEntries]
  );

  const removeEntry = useCallback(
    async (canonicalSecret: string): Promise<{ ok: boolean }> => {
      setError(null);
      const vaultKey = vaultKeyRef.current;
      const base = recordRef.current;
      if (phaseRef.current !== "unlocked" || vaultKey === null || base === null) {
        setError("vault locked");
        return { ok: false };
      }
      const wanted = canonicalize(canonicalSecret);
      const next = entriesRef.current.filter((entry) => canonicalize(entry.secret) !== wanted);

      setBusy("saving");
      try {
        const sealed = await aesGcmEncrypt(
          vaultKey,
          entriesPlaintext(next),
          entriesAad({ version: base.version, vaultId: base.vaultId })
        );
        const updated: VaultRecord = {
          ...base,
          revision: base.revision + 1,
          lastSeenTime: Date.now(),
          entriesIvB64: sealed.ivB64,
          entriesCtB64: sealed.ctB64,
        };
        const result = writeVaultRecord(updated, base.revision);
        if (!result.ok) {
          const message =
            result.reason === "stale-revision"
              ? "changed in another tab — reload"
              : "could not save — storage unavailable";
          setError(message);
          return { ok: false };
        }
        recordRef.current = updated;
        applyEntries(next);
        return { ok: true };
      } finally {
        setBusy(null);
      }
    },
    [applyEntries]
  );

  const exportVault = useCallback(
    async (password: string): Promise<{ ok: true; json: string } | { ok: false; error: string }> => {
      setError(null);
      // Export requires the entries, which only exist in memory while unlocked.
      if (phaseRef.current !== "unlocked") return { ok: false, error: "vault locked" };
      setBusy("exporting");
      try {
        const built = await buildExportJson(entriesRef.current, password);
        if (!built.ok) {
          setError(built.error);
          return { ok: false, error: built.error };
        }
        return { ok: true, json: built.json };
      } finally {
        setBusy(null);
      }
    },
    []
  );

  const importUnlocked = useCallback(
    async (
      json: string,
      password: string,
      choices?: ConflictChoice[]
    ): Promise<
      | { ok: true; added: number; replaced: number; duplicates: number }
      | { ok: false; error: string; needsChoices?: MergePlan }
    > => {
      setError(null);
      const vaultKey = vaultKeyRef.current;
      const base = recordRef.current;
      if (phaseRef.current !== "unlocked" || vaultKey === null || base === null) {
        return { ok: false, error: "vault locked" };
      }

      setBusy("importing");
      try {
        const opened = await parseExportJson(json, password);
        if (!opened.ok) return { ok: false, error: opened.error };
        const validated = validateImportUris(opened.uris);
        if (!validated.ok) return { ok: false, error: validated.error };

        const current = entriesRef.current;
        if (current.length + validated.entries.length > MAX_VAULT_ENTRIES) {
          return { ok: false, error: "vault entry limit" };
        }

        const plan = planImport(current, validated.entries);
        if (plan.conflicts.length > 0 && choices === undefined) {
          // No write until the user has answered: a half-merged vault is worse
          // than an unfinished import.
          return { ok: false, error: "conflicts need choices", needsChoices: plan };
        }
        const resolved = choices ?? [];
        if (resolved.length !== plan.conflicts.length) {
          return { ok: false, error: "conflicts need choices", needsChoices: plan };
        }

        const merged = applyImport(current, plan, resolved);
        const replaced = resolved.filter((choice) => choice === "replace").length;
        const keptBoth = resolved.filter((choice) => choice === "keep-both").length;
        const skipped = resolved.filter((choice) => choice === "skip").length;

        const sealed = await aesGcmEncrypt(
          vaultKey,
          entriesPlaintext(merged),
          entriesAad({ version: base.version, vaultId: base.vaultId })
        );
        const updated: VaultRecord = {
          ...base,
          revision: base.revision + 1,
          lastSeenTime: Date.now(),
          entriesIvB64: sealed.ivB64,
          entriesCtB64: sealed.ctB64,
        };
        // One atomic write for the whole merge.
        const result = writeVaultRecord(updated, base.revision);
        if (!result.ok) {
          const message =
            result.reason === "stale-revision"
              ? "changed in another tab — reload"
              : "could not save — storage unavailable";
          setError(message);
          return { ok: false, error: message };
        }
        recordRef.current = updated;
        applyEntries(merged);
        return {
          ok: true,
          added: plan.add.length + keptBoth,
          replaced,
          duplicates: plan.duplicates + skipped,
        };
      } finally {
        setBusy(null);
      }
    },
    [applyEntries]
  );

  const importLocked = useCallback(
    async (
      json: string,
      password: string,
      credential: { mode: "pin"; pin: string } | { mode: "prf" }
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      setError(null);
      if (phaseRef.current === "unlocked") {
        return { ok: false, error: "lock the vault before importing into it" };
      }

      // (b) Credential validation happens BEFORE any write, so a cancelled
      // fingerprint or a bad PIN leaves storage byte-identical.
      let pin: string | null = null;
      let prfSaltB64: string | null = null;
      let prfOutput: Uint8Array | null = null;
      let newCredentialId: string | null = null;

      if (credential.mode === "pin") {
        const problem = pinProblem(credential.pin);
        if (problem !== null) return { ok: false, error: problem };
        pin = credential.pin;
      } else {
        let supported = false;
        try {
          supported = await port.isSupported();
        } catch {
          supported = false;
        }
        if (!supported) return { ok: false, error: "fingerprint unavailable on this device" };
        const salt = makePrfSalt();
        const registration = await port.register({
          challenge: randomBytes(CHALLENGE_BYTES),
          prfSalt: salt,
        });
        if (!registration.ok) return { ok: false, error: registerError(registration.reason, "import") };
        const got = await port.get({
          challenge: randomBytes(CHALLENGE_BYTES),
          prfSalt: salt,
          credentialIdB64: registration.credentialIdB64,
        });
        if (!got.ok) return { ok: false, error: getVerifyError(got.reason, "import") };
        prfSaltB64 = b64(salt);
        prfOutput = got.prfOutput;
        newCredentialId = registration.credentialIdB64;
      }

      setBusy("migrating");
      try {
        // (a) Open and validate the file.
        const opened = await parseExportJson(json, password);
        if (!opened.ok) return { ok: false, error: opened.error };
        const validated = validateImportUris(opened.uris);
        if (!validated.ok) return { ok: false, error: validated.error };
        if (validated.entries.length > MAX_VAULT_ENTRIES) {
          return { ok: false, error: "vault entry limit" };
        }

        // (c) Build a FRESH record; the primary key is not touched yet.
        const draft = createVaultRecord({
          kdfSaltB64: randomB64Salt(),
          prf: null,
          pin: null,
          entriesIvB64: "",
          entriesCtB64: "",
        });
        const vaultKey = randomBytes(VAULT_KEY_BYTES);

        let prf: ({ saltB64: string } & VaultWrap) | null = null;
        if (prfOutput !== null && prfSaltB64 !== null) {
          const prfVek = await derivePrfVek(prfOutput, prfSaltB64);
          prf = {
            saltB64: prfSaltB64,
            ...(await wrapKey(prfVek, vaultKey, prfWrapAad(prfHeader(draft, prfSaltB64)))),
          };
        }
        let pinWrap: VaultWrap | null = null;
        if (pin !== null) {
          const pinVek = await derivePinVek(pin, draft.kdf.saltB64, draft.kdf.iterations);
          pinWrap = await wrapKey(pinVek, vaultKey, pinWrapAad(pinHeader(draft)));
        }
        const sealed = await aesGcmEncrypt(
          vaultKey,
          entriesPlaintext(validated.entries),
          entriesAad({ version: draft.version, vaultId: draft.vaultId })
        );
        const staged: VaultRecord = {
          ...draft,
          prf,
          pin: pinWrap,
          entriesIvB64: sealed.ivB64,
          entriesCtB64: sealed.ctB64,
        };

        if (!writeKey(VAULT_PENDING_KEY, JSON.stringify(staged))) {
          return { ok: false, error: "could not stage the import" };
        }

        // (d) Verify from the RAW staged bytes — the exact thing that would be
        // committed, re-normalized, re-derived and re-decrypted. This is the
        // anti-lockout rule: nothing is destroyed until this passes.
        const verified = await verifyStaged(pin, prfOutput, prfSaltB64);
        if (!verified) {
          removeKey(VAULT_PENDING_KEY);
          return { ok: false, error: "verification failed — existing vault untouched" };
        }

        // (e) Commit.
        const primaryRaw = readKey(VAULT_STORAGE_KEY);
        // WHY never clobber an existing recovery copy: a second locked import
        // before the first was opened would otherwise overwrite the original
        // vault's only copy. The record being replaced here came from a
        // previous import, so the user still holds the export file that
        // produced it; whatever VAULT_SUPERSEDED_KEY already holds may exist
        // nowhere else.
        const supersededRaw = readKey(VAULT_SUPERSEDED_KEY);
        if (
          primaryRaw !== null &&
          supersededRaw === null &&
          !writeKey(VAULT_SUPERSEDED_KEY, primaryRaw)
        ) {
          removeKey(VAULT_PENDING_KEY);
          return { ok: false, error: "verification failed — existing vault untouched" };
        }
        const stagedRaw = readKey(VAULT_PENDING_KEY);
        if (stagedRaw === null || !writeKey(VAULT_STORAGE_KEY, stagedRaw)) {
          removeKey(VAULT_PENDING_KEY);
          return { ok: false, error: "verification failed — existing vault untouched" };
        }
        removeKey(VAULT_PENDING_KEY);
        if (newCredentialId !== null) writeKey(CREDENTIAL_ID_KEY, newCredentialId);

        // (f) The vault stays locked; the caller unlocks with the new credential.
        const committed = readVaultRecord();
        setHasPin(committed?.pin != null);
        setPrfRegistered(committed?.prf != null);
        applyEntries([]);
        applyPhase(committed === null ? "setup" : "locked");
        return { ok: true };
      } finally {
        setBusy(null);
      }
    },
    [applyEntries, applyPhase, port]
  );

  const setClockOffset = useCallback((ms: number) => {
    const clamped = clampOffset(ms);
    writeKey(CLOCK_OFFSET_KEY, JSON.stringify(clamped));
    setClockOffsetState(clamped);
    // Touching the offset means the user has acknowledged the drift.
    setClockSkew(false);
  }, []);

  // Idle auto-lock. Armed only while unlocked, so a locked-out screen cannot be
  // re-locked by stray input.
  useEffect(() => {
    if (phase !== "unlocked") return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        clearKey();
        setBusy(null);
        setError(null);
        applyPhase("locked");
      }, IDLE_LOCK_MS);
    };
    arm();
    window.addEventListener("pointerdown", arm);
    window.addEventListener("keydown", arm);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
    };
  }, [applyPhase, clearKey, phase]);

  // Cross-tab reconciliation. Our own writes never fire `storage` in this
  // document, so any revision change here is foreign — and the simplest safe
  // response is to drop the key rather than keep serving entries another tab
  // has already replaced.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== VAULT_STORAGE_KEY) return;
      if (phaseRef.current !== "unlocked") return;
      let foreign: number | null = null;
      if (event.newValue !== null) {
        try {
          const parsed: unknown = JSON.parse(event.newValue);
          const candidate = (parsed as { revision?: unknown }).revision;
          foreign = typeof candidate === "number" ? candidate : null;
        } catch {
          foreign = null;
        }
      }
      if (foreign !== null && foreign === recordRef.current?.revision) return;
      clearKey();
      setBusy(null);
      applyPhase("locked");
      setError("vault changed in another tab");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [applyPhase, clearKey]);

  return {
    phase,
    busy,
    error,
    entries,
    hasPin,
    prfRegistered,
    clockOffset,
    clockSkew,
    retryAfterMs,
    unlockWithPin,
    unlockWithBiometric,
    lock,
    createVault,
    saveEntry,
    removeEntry,
    exportVault,
    importUnlocked,
    importLocked,
    setClockOffset,
  };
}

/** 16 random bytes, base64 — the PBKDF2 salt for a new vault. */
function randomB64Salt(): string {
  return b64(randomBytes(KDF_SALT_BYTES));
}

/**
 * Re-open the staged record exactly as a later unlock would: normalize the raw
 * JSON, derive the key from the *new* credential, and parse every URI.
 *
 * A failure here means the staged bytes are not a vault the new credential can
 * open, which is precisely the condition under which the primary record must be
 * left alone.
 */
async function verifyStaged(
  pin: string | null,
  prfOutput: Uint8Array | null,
  prfSaltB64: string | null
): Promise<boolean> {
  const raw = readKey(VAULT_PENDING_KEY);
  if (raw === null) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const normalized = normalizeVaultRecord(parsed);
  if (!normalized.ok) return false;
  const record = normalized.record;

  let vaultKey: Uint8Array | null = null;
  if (prfOutput !== null && prfSaltB64 !== null && record.prf !== null) {
    const prfVek = await derivePrfVek(prfOutput, record.prf.saltB64);
    vaultKey = await aesGcmDecrypt(
      prfVek,
      record.prf.ivB64,
      record.prf.ctB64,
      prfWrapAad(prfHeader(record, record.prf.saltB64))
    );
  } else if (pin !== null && record.pin !== null) {
    const pinVek = await derivePinVek(pin, record.kdf.saltB64, record.kdf.iterations);
    vaultKey = await aesGcmDecrypt(
      pinVek,
      record.pin.ivB64,
      record.pin.ctB64,
      pinWrapAad(pinHeader(record))
    );
  }
  if (vaultKey === null) return false;
  const entries = await readEntries(vaultKey, record);
  return entries !== null;
}

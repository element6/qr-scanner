/**
 * Structural persistence layer for the local 2FA vault.
 *
 * This module owns the vault's record shape, its structural validation, and the
 * only `localStorage` read/write path for the vault ciphertext. It is
 * deliberately crypto-free: it never encrypts, decrypts or derives anything, so
 * it can be reasoned about (and tested) without a KDF in play. `vaultCrypto.ts`
 * consumes these records; neither module reaches into the other's internals.
 *
 * Importing a record never mutates or deletes storage: an unreadable vault is
 * reported as `null` and left on disk, because discarding it would destroy
 * ciphertext the user may still be able to recover with the right passphrase.
 */

// WHY this import: canonical-base64 validation needs the one encoder this
// codebase uses; a second implementation here could drift from it. These are
// pure byte helpers, not crypto operations, and no cycle exists (`vaultCrypto`
// imports nothing).
import { b64, unb64 } from "./vaultCrypto";

/**
 * Storage key holding the single serialized `VaultRecord`.
 *
 * Exported (rather than kept private) because the migration, import/export and
 * reset paths must address the exact same key; a duplicated string literal is a
 * silent data-loss bug.
 */
export const VAULT_STORAGE_KEY = "qr2fa.vault.v1";

/**
 * Storage key holding the measured device clock offset (ms) between the local
 * clock and the authenticator's trusted time source.
 *
 * It lives here so this module remains the single registry of vault-related
 * storage keys, even though the value's lifecycle is owned by the TOTP code.
 */
export const CLOCK_OFFSET_KEY = "qr2fa.clockOffset";

/**
 * Storage key holding the flag that the pre-vault scan history was migrated
 * into the encrypted vault.
 *
 * Lives here for the same reason as `CLOCK_OFFSET_KEY`: one registry, so a
 * migration cannot run twice under two different spellings of the key.
 */
export const HISTORY_MIGRATED_KEY = "qr2fa.historyMigrated";

/**
 * Hard cap on stored vault entries.
 *
 * Enforced by the entry layer, not here: this module persists an opaque
 * ciphertext blob and cannot count the entries inside it.
 */
export const MAX_VAULT_ENTRIES = 200;

/**
 * Lower bound accepted for an imported vault's KDF iteration count.
 *
 * The live default is 600_000; these bounds exist to reject absurd or hostile
 * imports (a 1-iteration KDF, or a count that would hang the tab for minutes),
 * not to pin the current default.
 */
export const MIN_IMPORT_ITERATIONS = 10_000;

/**
 * Upper bound accepted for an imported vault's KDF iteration count.
 *
 * @see MIN_IMPORT_ITERATIONS
 */
export const MAX_IMPORT_ITERATIONS = 10_000_000;

/** KDF parameters a vault was sealed with. */
export interface VaultKdf {
  alg: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  saltB64: string;
}

/** An IV/ciphertext pair produced by an authenticated-encryption wrap. */
export interface VaultWrap {
  ivB64: string;
  ctB64: string;
}

/**
 * The persisted vault record.
 *
 * `revision` is the compare-and-swap token for `writeVaultRecord`, `lastSeenTime`
 * is the trusted-time watermark used to detect replay/clock rollback, and at
 * least one of `prf`/`pin` must be present — a record with no wrap can never be
 * opened, so it is rejected rather than stored.
 */
export interface VaultRecord {
  version: 1;
  vaultId: string;
  revision: number;
  kdf: VaultKdf;
  prf: ({ saltB64: string } & VaultWrap) | null;
  pin: VaultWrap | null;
  entriesIvB64: string;
  entriesCtB64: string;
  lastSeenTime: number;
}

/** Result of structurally validating an unknown value as a `VaultRecord`. */
export type NormalizeResult =
  | { ok: true; record: VaultRecord }
  | { ok: false; error: string };

/** Result of a compare-and-swap vault write. */
export type WriteOutcome =
  | { ok: true; revision: number }
  | { ok: false; reason: "stale-revision" | "storage-unavailable" };

/**
 * Structural base64 check: charset, block alignment, and canonical encoding.
 *
 * The alphabet/alignment pass is not enough on its own: base64 lets the final
 * quantum carry unused bits, so `"AB=="` and `"AA=="` decode to the same byte
 * while being *different strings*. Both are fed to AES-GCM as AAD, so accepting
 * the second spelling would let a record authenticate a header it does not
 * actually contain. Re-encoding and comparing rejects every such variant.
 *
 * Matching `^[A-Za-z0-9+/]*={0,2}$` also rejects interior padding, which `atob`
 * would otherwise tolerate.
 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

const MAX_VAULT_ID_LENGTH = 128;
const MAX_SALT_LENGTH = 256;

/** Default PBKDF2 cost for newly created vaults. */
const DEFAULT_KDF_ITERATIONS = 600_000;

/**
 * Validates a base64 field: non-empty, at most `maxLength` chars, aligned to a
 * 4-char block, inside the alphabet, and canonically encoded.
 */
function isBase64Field(value: unknown, maxLength: number): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    return false;
  }
  const bytes = unb64(value);
  return bytes !== null && b64(bytes) === value;
}

/** Validates an unbounded-length base64 field (`ivB64` / `ctB64`). */
function isUnboundedBase64Field(value: unknown): value is string {
  return isBase64Field(value, Number.MAX_SAFE_INTEGER);
}

/**
 * Validates a `{ ivB64, ctB64 }` wrap.
 */
function normalizeWrap(raw: unknown): VaultWrap | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (!isUnboundedBase64Field(rec.ivB64) || !isUnboundedBase64Field(rec.ctB64)) {
    return null;
  }
  return { ivB64: rec.ivB64, ctB64: rec.ctB64 };
}

/**
 * Strictly validates an unknown value as a `VaultRecord`.
 *
 * Rejects rather than repairs: a silently "fixed" vault would be a vault whose
 * KDF parameters or wrap contents differ from what the user sealed, and that
 * failure would only surface much later as an unopenable vault. Unknown extra
 * keys are ignored so a future version can add fields without this validator
 * destroying them on a round-trip.
 *
 * @param raw - Value as parsed from storage or an import file
 * @returns The reconstructed record, or a short lowercase reason
 *
 * @example
 * ```ts
 * normalizeVaultRecord({ version: 2 })   // { ok: false, error: "invalid version" }
 * normalizeVaultRecord(validRecord)      // { ok: true, record: validRecord }
 * ```
 */
export function normalizeVaultRecord(raw: unknown): NormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "not an object" };
  }
  const rec = raw as Record<string, unknown>;

  if (rec.version !== 1) {
    return { ok: false, error: "invalid version" };
  }

  if (
    typeof rec.vaultId !== "string" ||
    rec.vaultId.length === 0 ||
    rec.vaultId.length > MAX_VAULT_ID_LENGTH
  ) {
    return { ok: false, error: "invalid vaultId" };
  }

  if (!Number.isInteger(rec.revision) || (rec.revision as number) < 1) {
    return { ok: false, error: "invalid revision" };
  }

  const kdfRaw = rec.kdf;
  if (typeof kdfRaw !== "object" || kdfRaw === null || Array.isArray(kdfRaw)) {
    return { ok: false, error: "invalid kdf" };
  }
  const kdf = kdfRaw as Record<string, unknown>;
  if (kdf.alg !== "PBKDF2") {
    return { ok: false, error: "invalid kdf alg" };
  }
  if (kdf.hash !== "SHA-256") {
    return { ok: false, error: "invalid kdf hash" };
  }
  if (
    !Number.isInteger(kdf.iterations) ||
    (kdf.iterations as number) < MIN_IMPORT_ITERATIONS ||
    (kdf.iterations as number) > MAX_IMPORT_ITERATIONS
  ) {
    return { ok: false, error: "invalid kdf iterations" };
  }
  if (!isBase64Field(kdf.saltB64, MAX_SALT_LENGTH)) {
    return { ok: false, error: "invalid kdf salt" };
  }

  if (!isUnboundedBase64Field(rec.entriesIvB64)) {
    return { ok: false, error: "invalid entries iv" };
  }
  if (!isUnboundedBase64Field(rec.entriesCtB64)) {
    return { ok: false, error: "invalid entries ciphertext" };
  }

  if (!Number.isInteger(rec.lastSeenTime) || (rec.lastSeenTime as number) < 0) {
    return { ok: false, error: "invalid lastSeenTime" };
  }

  const prf = rec.prf === null ? null : normalizePrf(rec.prf);
  if (rec.prf !== null && prf === null) {
    return { ok: false, error: "invalid prf" };
  }
  const pin = rec.pin === null ? null : normalizeWrap(rec.pin);
  if (rec.pin !== null && pin === null) {
    return { ok: false, error: "invalid pin" };
  }

  // A record with no wrap is unopenable by construction; accepting it would let a
  // bug overwrite a recoverable vault with ciphertext nobody holds a key for.
  if (prf === null && pin === null) {
    return { ok: false, error: "no key wrap" };
  }

  return {
    ok: true,
    record: {
      version: 1,
      vaultId: rec.vaultId,
      revision: rec.revision as number,
      kdf: {
        alg: "PBKDF2",
        hash: "SHA-256",
        iterations: kdf.iterations as number,
        saltB64: kdf.saltB64,
      },
      prf,
      pin,
      entriesIvB64: rec.entriesIvB64,
      entriesCtB64: rec.entriesCtB64,
      lastSeenTime: rec.lastSeenTime as number,
    },
  };
}

/** Validates the PRF wrap, whose salt is per-key-material and length-capped. */
function normalizePrf(raw: unknown): ({ saltB64: string } & VaultWrap) | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  if (!isBase64Field(rec.saltB64, MAX_SALT_LENGTH)) {
    return null;
  }
  const wrap = normalizeWrap(raw);
  if (wrap === null) {
    return null;
  }
  return { saltB64: rec.saltB64, ivB64: wrap.ivB64, ctB64: wrap.ctB64 };
}

/**
 * Reads and validates the stored vault record.
 *
 * Every failure mode collapses to `null` so boot can proceed on a hostile or
 * corrupt profile. The stored bytes are never removed here: a record that fails
 * structural validation may still be a recoverable vault (`version` skew, a
 * hand-edited field), and only an explicit user action may destroy ciphertext.
 *
 * @returns The stored record, or `null` when absent, unparseable, or invalid
 *
 * @example
 * ```ts
 * localStorage.removeItem(VAULT_STORAGE_KEY);
 * readVaultRecord(); // null
 * ```
 */
export function readVaultRecord(): VaultRecord | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(VAULT_STORAGE_KEY);
  } catch {
    // Storage can throw outright (disabled cookies / sandboxed iframe). Treat it
    // as "no vault": nothing is readable, so there is nothing to report.
    return null;
  }
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // WHY: a corrupt record must not crash boot — the app must still load and
    // offer recovery/export instead of dying on a blocked error screen. The key
    // is deliberately left in place so that recovery is possible.
    console.warn(
      `[vaultStore] ${VAULT_STORAGE_KEY} is not valid JSON; ignoring (key left intact)`
    );
    return null;
  }

  const result = normalizeVaultRecord(parsed);
  if (!result.ok) {
    // WHY: as above — report and ignore, never delete.
    console.warn(
      `[vaultStore] ${VAULT_STORAGE_KEY} failed validation (${result.error}); ignoring (key left intact)`
    );
    return null;
  }
  return result.record;
}

/**
 * Writes `next` only if storage still holds `baseRevision`.
 *
 * Compare-and-swap keeps two tabs from silently overwriting each other's
 * entries. It is best-effort: `localStorage` offers no atomic
 * read-modify-write, so two tabs can interleave between the read and the write
 * and both win. That window is an accepted residual — a lost update, not a lost
 * vault, and the losing tab sees a stale revision on its next write.
 *
 * Caller contract: read the record (revision `baseRevision`), mutate, then pass
 * it back with `next.revision === baseRevision + 1`.
 *
 * @param next - The complete record to persist
 * @param baseRevision - The revision the caller read; 0 means "nothing stored"
 * @returns The new revision, or why nothing was written
 *
 * @example
 * ```ts
 * const current = readVaultRecord();
 * const base = current?.revision ?? 0;
 * writeVaultRecord({ ...current!, revision: base + 1 }, base); // { ok: true, revision: base + 1 }
 * writeVaultRecord(next, base);                                // { ok: false, reason: "stale-revision" }
 * ```
 */
export function writeVaultRecord(
  next: VaultRecord,
  baseRevision: number
): WriteOutcome {
  const storedRevision = readVaultRecord()?.revision ?? 0;
  if (storedRevision !== baseRevision) {
    return { ok: false, reason: "stale-revision" };
  }

  try {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded, or storage denied in private mode. `setItem` is atomic, so
    // the previous value is intact and the caller can keep its in-memory state.
    return { ok: false, reason: "storage-unavailable" };
  }
  return { ok: true, revision: next.revision };
}

/** Fresh 128-bit vault id, hex-encoded. */
function createVaultId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Builds the initial record for a brand-new vault.
 *
 * Crypto parameters are fixed here rather than passed in so that a caller cannot
 * accidentally create a vault with weaker KDF settings; the salt and wraps,
 * which are per-vault random values, are supplied by the caller.
 *
 * @param params - Pre-computed salt and key wraps for the new vault
 * @returns A `revision: 1` record, ready to write with `baseRevision: 0`
 *
 * @example
 * ```ts
 * const record = createVaultRecord({
 *   kdfSaltB64: "AAAA", prf: null, pin: { ivB64: "AAAA", ctB64: "AAAA" },
 *   entriesIvB64: "AAAA", entriesCtB64: "AAAA",
 * });
 * record.kdf.iterations; // 600_000
 * ```
 */
export function createVaultRecord(params: {
  kdfSaltB64: string;
  prf: ({ saltB64: string } & VaultWrap) | null;
  pin: VaultWrap | null;
  entriesIvB64: string;
  entriesCtB64: string;
}): VaultRecord {
  return {
    version: 1,
    vaultId: createVaultId(),
    revision: 1,
    kdf: {
      alg: "PBKDF2",
      hash: "SHA-256",
      iterations: DEFAULT_KDF_ITERATIONS,
      saltB64: params.kdfSaltB64,
    },
    prf: params.prf,
    pin: params.pin,
    entriesIvB64: params.entriesIvB64,
    entriesCtB64: params.entriesCtB64,
    lastSeenTime: Date.now(),
  };
}

/**
 * Storage key holding a *staged* vault record that has not replaced the primary
 * one yet.
 *
 * WHY a separate key: importing into a locked vault must build a full new record
 * — new vaultId, new wraps, the imported entries — without touching the primary
 * ciphertext, because a verification failure has to leave the existing vault
 * exactly as it was. The staged record lives here until verification passes.
 */
export const VAULT_PENDING_KEY = "qr2fa.vaultPending.v1";

/**
 * Storage key holding a verbatim copy of the record that a committed locked
 * import replaced.
 *
 * WHY raw and never parsed: this is the recovery blob written *before* the
 * primary key is overwritten. Parsing it would add a failure mode to the one
 * write that must not fail, so it is copied as the exact string found on disk
 * and deleted only once the new vault has unlocked successfully.
 */
export const VAULT_SUPERSEDED_KEY = "qr2fa.vaultSuperseded.v1";

/**
 * Storage key holding the base64 credential id of the PRF credential wrapping
 * the vault key.
 *
 * WHY outside the vault record: a device-local credential id is not part of the
 * vault's cryptographic header, so a vault file copied to another device must
 * still open with its PIN rather than being rejected as structurally corrupt.
 */
export const CREDENTIAL_ID_KEY = "qr2fa.credentialId.v1";

/**
 * Export/import format for the offline 2FA vault — the data-boundary module.
 *
 * Two halves, split by trust:
 *
 * 1. The wire format (`buildExportJson` / `parseExportJson`). The file is a
 *    plaintext header plus one AES-GCM-256 ciphertext. The header is visible by
 *    design (a user can read the format, version and KDF parameters without the
 *    password), and *every field that decides how the ciphertext is interpreted*
 *    is fed back as AAD — so a downgraded iteration count or a swapped
 *    salt/IV/cipher fails the tag check instead of decrypting to garbage. No
 *    issuer, account, secret or `otpauth://` URI ever appears outside the
 *    ciphertext.
 * 2. The merge plan (`validateImportUris` / `planImport` / `applyImport`).
 *    Validation is all-or-nothing, the plan is pure data, and `applyImport`
 *    returns one new array — the merge is atomic by construction, not by
 *    sequencing a series of writes.
 *
 * Errors are values (`{ ok: false, error }`) everywhere, because both entry
 * points face user-supplied bytes: a hostile file must degrade to a message,
 * never to an exception. The one throw is `applyImport`'s choices-length check,
 * documented at the call site as a programmer error.
 *
 * Cross-checked against `qrExport.ts` for house style; cryptography lives in
 * `vaultCrypto.ts`, entry rules in `otpauth.ts`, and both are used as-is.
 */

import {
  canonicalSecret,
  entryToUri,
  parseOtpauth,
  type OtpauthEntry,
} from "./otpauth";
import {
  KDF_ITERATIONS,
  aesGcmDecrypt,
  aesGcmEncrypt,
  canonicalAad,
  derivePinVek,
  randomB64,
} from "./vaultCrypto";
import { MAX_IMPORT_ITERATIONS, MIN_IMPORT_ITERATIONS } from "./vaultStore";

/** Magic string identifying a qr-scanner 2FA export. */
export const EXPORT_FORMAT = "qr-scanner-2fa-export";

/** Wire version of {@link ExportEnvelope}. */
export const EXPORT_VERSION = 1;

/**
 * Minimum export password length.
 *
 * Belt and braces: the UI validates too. Restated here so the format module is
 * safe to call directly (a caller that forgets the UI check cannot silently
 * emit a file encrypted under a one-character password).
 */
export const EXPORT_PASSWORD_MIN = 8;

/** Salt length in bytes for the export KDF. */
const EXPORT_SALT_BYTES = 16;

/** The whole exported file, header in clear plus one opaque ciphertext. */
export interface ExportEnvelope {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  app: "qr-scanner";
  exportedAt: string;
  kdf: {
    alg: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    saltB64: string;
  };
  cipher: "AES-GCM";
  ivB64: string;
  ctB64: string;
}

/**
 * The header fields bound into the AAD, in the exact shape the AAD is built
 * from. Extracted so build and parse cannot drift: both call this one function,
 * and a field that is authenticated on write is therefore authenticated on read.
 *
 * `exportedAt` is deliberately NOT included. It is cosmetic metadata — a user
 * may well open the JSON, notice a wrong timestamp, and fix it — and binding it
 * would turn that harmless edit into "wrong password or corrupted file" with no
 * way back. The security-relevant fields (format, version, cipher, the whole
 * kdf block) are all committed.
 */
function exportAad(header: {
  format: string;
  version: number;
  cipher: string;
  kdf: ExportEnvelope["kdf"];
}): Uint8Array {
  return canonicalAad({
    format: header.format,
    version: header.version,
    cipher: header.cipher,
    kdf: header.kdf,
  });
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** UTF-8 encode, for the plaintext payload. */
function utf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

/** True when `value` is a plain non-null object (not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Seal entries into an export file.
 *
 * The plaintext is `{"uris":[...]}` — canonical `otpauth://` URIs from
 * `entryToUri` — so a future importer can re-parse each URI through the same
 * validation path a scanned code uses, instead of trusting a re-serialised
 * struct.
 *
 * @param entries - Validated entries to export
 * @param password - Export password; must be at least {@link EXPORT_PASSWORD_MIN} characters
 * @param now - Clock override for deterministic tests; defaults to `new Date()`
 * @returns The pretty-printed JSON, or an error string
 *
 * @example
 * const built = await buildExportJson(entries, "correct horse battery");
 * if (built.ok) downloadBlob(built.json, "vault-export.json");
 */
export async function buildExportJson(
  entries: OtpauthEntry[],
  password: string,
  now?: Date
): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
  if (typeof password !== "string" || password.length < EXPORT_PASSWORD_MIN) {
    return { ok: false, error: "password too short" };
  }

  const kdf: ExportEnvelope["kdf"] = {
    alg: "PBKDF2",
    hash: "SHA-256",
    iterations: KDF_ITERATIONS,
    saltB64: randomB64(EXPORT_SALT_BYTES),
  };

  const { ivB64, ctB64 } = await aesGcmEncrypt(
    await derivePinVek(password, kdf.saltB64, kdf.iterations),
    utf8(JSON.stringify({ uris: entries.map(entryToUri) })),
    exportAad({ format: EXPORT_FORMAT, version: EXPORT_VERSION, cipher: "AES-GCM", kdf })
  );

  const envelope: ExportEnvelope = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    app: "qr-scanner",
    exportedAt: (now ?? new Date()).toISOString(),
    kdf,
    cipher: "AES-GCM",
    ivB64,
    ctB64,
  };

  // Two-space indent: the header is meant to be human-readable, and the only
  // opaque part is `ctB64`.
  return { ok: true, json: JSON.stringify(envelope, null, 2) };
}

/** Result of decrypting an export file: raw URIs, not yet validated entries. */
export type ParseExportResult =
  | { ok: true; uris: string[] }
  | { ok: false; error: string };

/**
 * Open an export file with a password.
 *
 * Cheap structural checks run before any KDF work, so a hostile file cannot buy
 * 600_000 PBKDF2 rounds with a malformed header — and, more importantly, so a
 * one-million-iteration header cannot be used to hang the tab: the count is
 * bounded *before* it is honoured.
 *
 * @param text - Raw file contents
 * @param password - Password the file was sealed with
 * @returns The raw URIs, or a message safe to show the user
 *
 * @example
 * const opened = await parseExportJson(fileText, password);
 * if (opened.ok) const checked = validateImportUris(opened.uris);
 */
export async function parseExportJson(
  text: string,
  password: string
): Promise<ParseExportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "not a valid export file" };
  }

  if (!isRecord(parsed)) return { ok: false, error: "not a valid export file" };
  if (parsed.format !== EXPORT_FORMAT) return { ok: false, error: "not a qr-scanner export" };
  if (parsed.version !== EXPORT_VERSION) return { ok: false, error: "unsupported export version" };
  if (parsed.cipher !== "AES-GCM") return { ok: false, error: "unsupported cipher" };

  const kdf = parsed.kdf;
  if (!isRecord(kdf)) return { ok: false, error: "unsupported kdf" };
  if (kdf.alg !== "PBKDF2" || kdf.hash !== "SHA-256") {
    return { ok: false, error: "unsupported kdf" };
  }
  if (
    typeof kdf.iterations !== "number" ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < MIN_IMPORT_ITERATIONS ||
    kdf.iterations > MAX_IMPORT_ITERATIONS
  ) {
    return { ok: false, error: "iterations out of range" };
  }
  if (
    typeof kdf.saltB64 !== "string" ||
    kdf.saltB64 === "" ||
    typeof parsed.ivB64 !== "string" ||
    parsed.ivB64 === "" ||
    typeof parsed.ctB64 !== "string" ||
    parsed.ctB64 === ""
  ) {
    return { ok: false, error: "malformed envelope" };
  }

  const header: ExportEnvelope["kdf"] = {
    alg: "PBKDF2",
    hash: "SHA-256",
    iterations: kdf.iterations,
    saltB64: kdf.saltB64,
  };

  let vek: Uint8Array;
  try {
    vek = await derivePinVek(password, header.saltB64, header.iterations);
  } catch {
    // A malformed salt: `derivePinVek` throws only for non-canonical base64.
    // The file is unusable, and the failure is indistinguishable from a bad
    // password on purpose.
    return { ok: false, error: "wrong password or corrupted file" };
  }

  const plaintext = await aesGcmDecrypt(
    vek,
    parsed.ivB64,
    parsed.ctB64,
    exportAad({ format: EXPORT_FORMAT, version: EXPORT_VERSION, cipher: "AES-GCM", kdf: header })
  );
  // Wrong password, tampered ciphertext and tampered authenticated header all
  // land here. One message for all three: distinguishing them is an oracle on
  // attacker-supplied files.
  if (plaintext === null) return { ok: false, error: "wrong password or corrupted file" };

  let payload: unknown;
  try {
    payload = JSON.parse(textDecoder.decode(plaintext));
  } catch {
    return { ok: false, error: "corrupted payload" };
  }

  if (!isRecord(payload) || !Array.isArray(payload.uris)) {
    return { ok: false, error: "corrupted payload" };
  }
  if (!payload.uris.every((uri): uri is string => typeof uri === "string")) {
    return { ok: false, error: "corrupted payload" };
  }

  return { ok: true, uris: payload.uris };
}

/**
 * Validate every URI of an import.
 *
 * All-or-nothing: the first failure ends the walk and no partial list is
 * returned, so a caller can never merge "the good half" of a corrupt file. An
 * empty file is rejected too — "imported nothing" reading as success would hide
 * a wrong-file selection.
 *
 * @param uris - Raw URIs from {@link parseExportJson}
 * @returns The parsed entries, or the first error with its index
 *
 * @example
 * const checked = validateImportUris(opened.uris);
 * if (!checked.ok) show(`Entry ${checked.index ?? "?"}: ${checked.error}`);
 */
export function validateImportUris(
  uris: string[]
): { ok: true; entries: OtpauthEntry[] } | { ok: false; error: string; index: number } | { ok: false; error: string } {
  if (uris.length === 0) return { ok: false, error: "empty import" };

  const entries: OtpauthEntry[] = [];
  for (let index = 0; index < uris.length; index += 1) {
    const parsed = parseOtpauth(uris[index]);
    if (!parsed.ok) return { ok: false, error: parsed.error, index };
    entries.push(parsed.entry);
  }
  return { ok: true, entries };
}

/** How the user resolved one {@link MergeConflict}. */
export type ConflictChoice = "replace" | "keep-both" | "skip";

/** One incoming entry that collides with an existing one. */
export interface MergeConflict {
  existing: OtpauthEntry;
  incoming: OtpauthEntry;
  /**
   * `identity` — issuer and account match exactly.
   * `case-variant` — they match case-insensitively but not exactly, e.g. an
   * existing "GitHub" against an imported "github". Kept distinct so the UI can
   * say *why* it is asking rather than presenting the same two names twice.
   */
  kind: "identity" | "case-variant";
}

/** What `planImport` decided, before any choice is made. */
export interface MergePlan {
  add: OtpauthEntry[];
  /** Count only: an incoming entry whose secret is already present, or a repeat within the import. */
  duplicates: number;
  /** Applied in this order; `choices` must line up with it. */
  conflicts: MergeConflict[];
}

/** Case-insensitive name key: issuer and account, trimmed. */
function nameKey(entry: OtpauthEntry): string {
  return `${entry.issuer.toLowerCase()}\u0000${entry.account.toLowerCase()}`;
}

/** Exact name key: distinguishes "GitHub" from "github". */
function exactNameKey(entry: OtpauthEntry): string {
  return `${entry.issuer}\u0000${entry.account}`;
}

/**
 * Pair incoming entries against what the vault already holds.
 *
 * Three buckets, decided in this order for each incoming entry:
 *
 * 1. Its canonical secret already exists — in `existing`, or in an earlier entry
 *    of `imported` — so it is a `duplicate`. Checked first: the same secret
 *    under a different name is the *same* authenticator, and offering to
 *    "replace GitHub with github" would just destroy the old label.
 * 2. Its exact name matches an existing entry with a different secret — an
 *    `identity` conflict.
 * 3. Its name matches case-insensitively but not exactly — a `case-variant`
 *    conflict, so the user can see both spellings before one is dropped.
 * 4. Otherwise it is an `add`.
 *
 * Pure: neither argument is read after the call, and the plan is plain data.
 *
 * @param existing - Entries already in the vault
 * @param imported - Entries just validated from a file
 * @returns The plan; `conflicts` order is the order `choices` is applied in
 *
 * @example
 * const plan = planImport(vault, checked.entries);
 * const merged = applyImport(vault, plan, plan.conflicts.map(() => "skip"));
 */
export function planImport(existing: OtpauthEntry[], imported: OtpauthEntry[]): MergePlan {
  const secrets = new Set(existing.map((entry) => canonicalSecret(entry.secret)));
  const exactNames = new Map<string, OtpauthEntry>();
  const foldedNames = new Map<string, OtpauthEntry>();
  for (const entry of existing) {
    // First writer wins: with two same-named existing entries, the earlier one
    // stays the conflict counterpart, so pairing is deterministic.
    if (!exactNames.has(exactNameKey(entry))) exactNames.set(exactNameKey(entry), entry);
    if (!foldedNames.has(nameKey(entry))) foldedNames.set(nameKey(entry), entry);
  }

  const add: OtpauthEntry[] = [];
  const conflicts: MergeConflict[] = [];
  let duplicates = 0;

  for (const entry of imported) {
    const secret = canonicalSecret(entry.secret);
    if (secrets.has(secret)) {
      duplicates += 1;
      continue;
    }

    const exact = exactNames.get(exactNameKey(entry));
    if (exact !== undefined) {
      conflicts.push({ existing: exact, incoming: entry, kind: "identity" });
      // Reserve the secret so a later file entry repeating it counts as a
      // duplicate rather than a second conflict on the same pair.
      secrets.add(secret);
      continue;
    }

    const folded = foldedNames.get(nameKey(entry));
    if (folded !== undefined) {
      conflicts.push({ existing: folded, incoming: entry, kind: "case-variant" });
      secrets.add(secret);
      continue;
    }

    secrets.add(secret);
    add.push(entry);
  }

  return { add, duplicates, conflicts };
}

/**
 * Resolve a plan into the next vault contents.
 *
 * `choices[i]` answers `plan.conflicts[i]`:
 *
 * - `replace` — the incoming entry takes the existing entry's slot, so vault
 *   order (and therefore the user's ordering) survives the merge.
 * - `keep-both` — the incoming entry is appended after the existing one. Both
 *   survive under their original names; no rename happens here, because
 *   canonicalisation is a display/save concern.
 * - `skip` — the incoming entry is dropped.
 *
 * The result is one array built in a single pass, so the merge is atomic by
 * construction: there is no intermediate state a caller could observe or a
 * crash could leave behind.
 *
 * @param existing - Entries already in the vault (never mutated)
 * @param plan - Plan from {@link planImport}
 * @param choices - One choice per conflict, in plan order
 * @returns A new array; `existing` and `plan` are untouched
 * @throws {Error} when `choices.length !== plan.conflicts.length`. That is a
 *   programmer error — the UI is responsible for collecting one answer per
 *   conflict — not a user error, and returning a value would let a mismatched
 *   pairing silently resolve the wrong conflict.
 *
 * @example
 * const merged = applyImport(vault, plan, ["replace", "keep-both"]);
 */
export function applyImport(
  existing: OtpauthEntry[],
  plan: MergePlan,
  choices: ConflictChoice[]
): OtpauthEntry[] {
  if (choices.length !== plan.conflicts.length) {
    throw new Error(
      `applyImport: expected ${plan.conflicts.length} choices, received ${choices.length}`
    );
  }

  // Replacements keyed by the *existing* entry object, so a later pass can swap
  // it in place while preserving position.
  const replacements = new Map<OtpauthEntry, OtpauthEntry>();
  const append: OtpauthEntry[] = [];

  for (let index = 0; index < plan.conflicts.length; index += 1) {
    const conflict = plan.conflicts[index];
    const choice = choices[index];
    if (choice === "skip") continue;
    if (choice === "replace") {
      replacements.set(conflict.existing, conflict.incoming);
      continue;
    }
    append.push(conflict.incoming);
  }

  return [
    ...existing.map((entry) => replacements.get(entry) ?? entry),
    ...append,
    ...plan.add,
  ];
}

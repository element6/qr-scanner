/**
 * Classification and strict parsing of scanned QR values, with `otpauth://`
 * TOTP URIs as the one OTP format the vault accepts.
 *
 * This module is the single validation path for 2FA entries: QR parsing and
 * every import route funnel through `normalizeEntry`, so no caller re-implements
 * — or string-mangles — the rules. Errors are returned as values, never thrown,
 * and nothing here touches storage, the DOM or crypto.
 */

import { decodeBase32 } from "./base32";
import { isValidUrl } from "./validators";

export type ScanKind = "text" | "url" | "otpauth-totp" | "otpauth-hotp" | "otpauth-other";

/** Scheme comparison is case-insensitive: QR payloads in the wild use both. */
const OTPAUTH_SCHEME_RE = /^otpauth:/i;

/** RFC 4648 base32 alphabet, uppercase: 0/1/8/9 are deliberately absent. */
const BASE32_RE = /^[A-Z2-7]+$/;

/** Secrets decoding to fewer bytes than this cannot carry a full HMAC key.
 *  Reported as a warning, not a rejection — providers do ship short ones. */
const MIN_SECRET_BYTES = 10;

const DEFAULT_PERIOD = 30;
const MIN_PERIOD = 1;
const MAX_PERIOD = 300;

/**
 * First path segment after an `otpauth:` scheme, lowercased.
 *
 * Read from the raw string rather than `URL.hostname` because the scheme is not
 * special: `new URL("otpauth:totp/x")` yields an empty hostname and folds the
 * type into the pathname, while `otpauthType` reports `totp` for both spellings.
 */
function otpauthType(value: string): string {
  const rest = value.replace(OTPAUTH_SCHEME_RE, "").replace(/^\/+/, "");
  const end = rest.search(/[/?#]/);
  return (end === -1 ? rest : rest.slice(0, end)).trim().toLowerCase();
}

/**
 * Classifies a scanned QR payload. Surrounding whitespace is ignored; the
 * `otpauth` branch only inspects the scheme and type, so a malformed OTP URI
 * still classifies (and is rejected later by `parseOtpauth`).
 *
 * @param value - The raw decoded QR string
 * @returns The payload kind, never throwing
 *
 * @example
 * ```ts
 * scanKind("https://example.com")                       // "url"
 * scanKind("hello world")                               // "text"
 * scanKind("otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP") // "otpauth-totp"
 * scanKind("otpauth://hotp/ACME:alice?secret=JBSWY3DPEHPK3PXP") // "otpauth-hotp"
 * scanKind("otpauth://steam/alice?secret=JBSWY3DPEHPK3PXP")     // "otpauth-other"
 * ```
 */
export function scanKind(value: string): ScanKind {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (OTPAUTH_SCHEME_RE.test(trimmed)) {
    const type = otpauthType(trimmed);
    if (type === "totp") return "otpauth-totp";
    if (type === "hotp") return "otpauth-hotp";
    return "otpauth-other";
  }

  return isValidUrl(trimmed) ? "url" : "text";
}

export interface OtpauthEntry {
  issuer: string;
  account: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 8;
  period: number;
}

/** `warning` is advisory: the entry is usable but worth telling the user. */
export type NormalizeResult =
  | { ok: true; entry: OtpauthEntry; warning?: string }
  | { ok: false; error: string };

/**
 * Canonical secret form: uppercase, with whitespace and `=` padding removed.
 * Deliberately unvalidated so callers can canonicalise before comparing.
 *
 * @param secret - Raw base32 secret
 * @returns The canonicalised secret
 *
 * @example
 * ```ts
 * canonicalSecret("jbswy3dp ehpk-3pxp==".replace("-", "")) // "JBSWY3DPEHPK3PXP"
 * ```
 */
export function canonicalSecret(secret: string): string {
  return String(secret ?? "")
    .toUpperCase()
    .replace(/[\s=]/g, "");
}

/**
 * Percent-decodes without throwing.
 *
 * Labels from QR payloads are not guaranteed to be well-formed percent
 * sequences, and a stray `%` must not turn a parse into an exception.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** An empty form field means "not provided", so it takes the default. */
function isAbsent(value: string | number | undefined): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && value.trim() === "";
}

/** Integer-or-null: rejects decimals, exponents and trailing junk rather than coercing. */
function parseInteger(value: string | number): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  const trimmed = value.trim();
  return /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : null;
}

function normalizeAlgorithm(raw: string): OtpauthEntry["algorithm"] | null {
  switch (raw.trim().toUpperCase().replace(/-/g, "")) {
    case "SHA1":
      return "SHA1";
    case "SHA256":
      return "SHA256";
    case "SHA512":
      return "SHA512";
    default:
      return null;
  }
}

/**
 * The single validation path for OTP entries: validates and canonicalises
 * caller-supplied fields, rejecting rather than coercing anything out of range.
 *
 * `undefined` (or an empty form field) selects the RFC 6238 defaults
 * SHA1/6/30; a present-but-unusable value is an error.
 *
 * @param fields - Raw fields, typically from a parsed URI or an import form
 * @returns `{ ok: true, entry }` or `{ ok: false, error }` with a short reason
 *
 * @example
 * ```ts
 * normalizeEntry({ account: "alice@example.com", secret: "jbswy3dpehpk3pxp==" })
 * // { ok: true, entry: { issuer: "", account: "alice@example.com",
 * //   secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 } }
 * normalizeEntry({ account: "alice", secret: "SHORT" })
 * // { ok: false, error: "invalid secret length" }
 * ```
 */
export function normalizeEntry(fields: {
  issuer?: string;
  account?: string;
  secret?: string;
  algorithm?: string;
  digits?: string | number;
  period?: string | number;
}): NormalizeResult {
  const account = typeof fields.account === "string" ? safeDecode(fields.account).trim() : "";
  if (account === "") return { ok: false, error: "missing account" };

  const secret = canonicalSecret(typeof fields.secret === "string" ? fields.secret : "");
  if (secret === "") return { ok: false, error: "missing secret" };
  if (!BASE32_RE.test(secret)) return { ok: false, error: "invalid secret alphabet" };
  // Base32 chars are not bytes: char count lies about key length. Decode once
  // and judge the real bytes; short keys warn rather than block.
  const decoded = decodeBase32(secret);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  const shortSecretWarning =
    decoded.bytes.length < MIN_SECRET_BYTES
      ? `This secret is ${decoded.bytes.length} bytes — shorter than the 10 bytes most authenticator keys use. Codes may still work, but a longer secret is stronger.`
      : null;

  let algorithm: OtpauthEntry["algorithm"] = "SHA1";
  if (!isAbsent(fields.algorithm)) {
    const normalized = normalizeAlgorithm(fields.algorithm as string);
    if (normalized === null) return { ok: false, error: "unsupported algorithm" };
    algorithm = normalized;
  }

  let digits: OtpauthEntry["digits"] = 6;
  if (!isAbsent(fields.digits)) {
    const parsed = parseInteger(fields.digits as string | number);
    if (parsed !== 6 && parsed !== 8) return { ok: false, error: "digits must be 6 or 8" };
    digits = parsed;
  }

  let period = DEFAULT_PERIOD;
  if (!isAbsent(fields.period)) {
    const parsed = parseInteger(fields.period as string | number);
    if (parsed === null || parsed < MIN_PERIOD || parsed > MAX_PERIOD) {
      return { ok: false, error: "period out of range" };
    }
    period = parsed;
  }

  const issuer = typeof fields.issuer === "string" ? safeDecode(fields.issuer).trim() : "";

  const entry: OtpauthEntry = { issuer, account, secret, algorithm, digits, period };
  return shortSecretWarning === null
    ? { ok: true, entry }
    : { ok: true, entry, warning: shortSecretWarning };
}

/**
 * Parses an `otpauth://` URI into a validated entry. Only `totp` is supported.
 *
 * The label is the pathname minus its leading `/`, percent-decoded; a `:`
 * separates the issuer prefix from the account. An `issuer` query parameter
 * takes precedence over that prefix, matching what Authenticator apps emit.
 *
 * @param uri - The scanned URI
 * @returns The same result shape as `normalizeEntry`
 *
 * @example
 * ```ts
 * parseOtpauth("otpauth://totp/ACME%20Co:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co")
 * // { ok: true, entry: { issuer: "ACME Co", account: "alice@example.com",
 * //   secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 } }
 * parseOtpauth("otpauth://hotp/ACME:alice?secret=JBSWY3DPEHPK3PXP&counter=1")
 * // { ok: false, error: "hotp-not-supported" }
 * ```
 */
export function parseOtpauth(uri: string): NormalizeResult {
  const trimmed = typeof uri === "string" ? uri.trim() : "";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "malformed otpauth uri" };
  }

  if (url.protocol.toLowerCase() !== "otpauth:") {
    return { ok: false, error: "malformed otpauth uri" };
  }

  const type = url.hostname.toLowerCase() || otpauthType(trimmed);
  if (type === "hotp") return { ok: false, error: "hotp-not-supported" };
  if (type !== "totp") return { ok: false, error: "unsupported type" };

  const rawLabel = url.pathname.replace(/^\//, "");
  if (rawLabel === "") return { ok: false, error: "malformed otpauth uri" };

  let label: string;
  try {
    label = decodeURIComponent(rawLabel);
  } catch {
    return { ok: false, error: "malformed otpauth uri" };
  }

  const queryIssuer = url.searchParams.get("issuer");
  const colon = label.indexOf(":");
  const issuer = queryIssuer !== null ? queryIssuer : colon === -1 ? "" : label.slice(0, colon);
  const account = colon === -1 ? label : label.slice(colon + 1);

  return normalizeEntry({
    issuer,
    account,
    secret: url.searchParams.get("secret") ?? undefined,
    algorithm: url.searchParams.get("algorithm") ?? undefined,
    digits: url.searchParams.get("digits") ?? undefined,
    period: url.searchParams.get("period") ?? undefined,
  });
}

/** Non-secret identity for an otpauth payload: issuer/account only.
 *
 *  Lives here, beside `parseOtpauth`, so exactly one function can hand an
 *  issuer/account pair to a view. The secret is dropped by construction — there
 *  is no field on the return type that could carry it. Callers that render a
 *  name for a scanned authenticator MUST go through this, never
 *  `parseOtpauth(...).entry` directly.
 *
 *  @param value - Raw scanned payload, not necessarily otpauth
 *  @returns Issuer/account when the payload parses, otherwise null
 */
export function otpauthIdentity(
  value: string
): { issuer: string; account: string } | null {
  const result = parseOtpauth(value);
  return result.ok ? { issuer: result.entry.issuer, account: result.entry.account } : null;
}

/**
 * Serialises an entry back to a canonical `otpauth://totp/` URI. All five query
 * parameters are always emitted so a round-trip through `parseOtpauth` is total.
 *
 * @param entry - A validated entry
 * @returns The canonical URI
 *
 * @example
 * ```ts
 * entryToUri({ issuer: "ACME", account: "alice", secret: "JBSWY3DPEHPK3PXP",
 *   algorithm: "SHA1", digits: 6, period: 30 })
 * // "otpauth://totp/ACME:alice?secret=JBSWY3DPEHPK3PXP&issuer=ACME&algorithm=SHA1&digits=6&period=30"
 * ```
 */
export function entryToUri(entry: OtpauthEntry): string {
  const label = entry.issuer
    ? `${encodeURIComponent(entry.issuer)}:${encodeURIComponent(entry.account)}`
    : encodeURIComponent(entry.account);

  const query = [
    `secret=${encodeURIComponent(entry.secret)}`,
    `issuer=${encodeURIComponent(entry.issuer)}`,
    `algorithm=${encodeURIComponent(entry.algorithm)}`,
    `digits=${entry.digits}`,
    `period=${entry.period}`,
  ].join("&");

  return `otpauth://totp/${label}?${query}`;
}

/**
 * WebAuthn access for the local 2FA vault, behind an injectable port.
 *
 * The vault key is derived from a PRF output produced by a platform
 * authenticator (fingerprint / Face ID / Windows Hello). All WebAuthn calls go
 * through `WebAuthnPort` because the test environment (jsdom) has neither
 * `navigator.credentials` nor `PublicKeyCredential`; tests swap in fakes, and
 * this module treats every absent API as an ordinary outcome rather than an
 * exception. Nothing exported here throws: every failure is a value, so a
 * caller cannot be surprised by a rejected promise.
 */

/** Failure reasons shared by `register` and `get`. */
type FailureReason = "unavailable" | "not-allowed" | "no-prf" | "error";

/**
 * WebAuthn operations the vault needs, with every dependency (navigator,
 * `PublicKeyCredential`) resolved at call time so a fake can be injected.
 */
export interface WebAuthnPort {
  /**
   * Reports whether this browser can produce PRF outputs.
   *
   * @returns true only when `PublicKeyCredential` exists, its
   * `isUserVerifyingPlatformAuthenticatorAvailable()` resolves true, the PRF
   * extension is advertised (best-effort static check on
   * `PublicKeyCredential.prototype.getClientExtensionResults`), and
   * `navigator.credentials` is present. Any missing API or rejection → false.
   *
   * @example
   * ```ts
   * if (await defaultWebAuthnPort.isSupported()) showFingerprintUnlock();
   * ```
   */
  isSupported(): Promise<boolean>;

  /**
   * Creates a discoverable platform credential with the PRF extension enabled.
   *
   * @param params.challenge - Server/client challenge bytes.
   * @param params.prfSalt - Salt for the PRF input (currently unused at
   * creation; the salt is supplied at `get` time).
   * @returns The base64 credential id on success, otherwise a reason:
   * `"unavailable"` (no WebAuthn API), `"not-allowed"` (user refused/aborted),
   * `"no-prf"` (authenticator created a credential but PRF is not enabled) or
   * `"error"` (anything else).
   *
   * @example
   * ```ts
   * const created = await defaultWebAuthnPort.register({ challenge, prfSalt });
   * if (created.ok) vault.credentialId = created.credentialIdB64;
   * ```
   */
  register(params: {
    challenge: Uint8Array;
    prfSalt: Uint8Array;
  }): Promise<
    { ok: true; credentialIdB64: string } | { ok: false; reason: "unavailable" | "not-allowed" | "no-prf" | "error" }
  >;

  /**
   * Gets a PRF output for the vault, by known credential id or discoverably.
   *
   * `"no-prf"` is deliberately distinct from an error: it is the signal that
   * this unlock cannot use PRF, which is what makes the PIN fallback possible.
   *
   * @param params.challenge - Server/client challenge bytes.
   * @param params.prfSalt - PRF input salt; the same salt must be reused to
   * re-derive the same vault key.
   * @param params.credentialIdB64 - Known credential id (base64). When
   * omitted, a discoverable credential is used.
   * @returns The PRF output bytes on success, otherwise a reason.
   *
   * @example
   * ```ts
   * const unlocked = await defaultWebAuthnPort.get({ challenge, prfSalt, credentialIdB64 });
   * if (unlocked.ok) return derivePrfVek(unlocked.prfOutput, salt);
   * if (unlocked.reason === "no-prf") return askForPin();
   * ```
   */
  get(params: {
    challenge: Uint8Array;
    prfSalt: Uint8Array;
    credentialIdB64?: string;
  }): Promise<{ ok: true; prfOutput: Uint8Array } | { ok: false; reason: "unavailable" | "not-allowed" | "no-prf" | "error" }>;
}

/** Relying-party name shown in the platform authenticator prompt. */
const RP_NAME = "QR Scanner";
/** Account name/display name for the vault's discoverable credential. */
const USER_NAME = "vault";
/** WebAuthn ceremony timeout, matching the vault's own unlock deadline. */
const TIMEOUT_MS = 60_000;
/** User handle length; WebAuthn requires 1..64 bytes, 32 matches a key size. */
const USER_ID_BYTES = 32;
/** PRF salt length; fixed so the derived vault key is stable across unlocks. */
const PRF_SALT_BYTES = 32;
/** Algorithms offered at creation: ES256 then RS256. */
const PUB_KEY_ALGS = [-7, -257] as const;

/**
 * Narrows caller-supplied bytes to the DOM's `BufferSource`.
 *
 * WHY the cast: TS 5.9 types a bare `Uint8Array` as `Uint8Array<ArrayBufferLike>`
 * while the DOM's `BufferSource` is `ArrayBufferView<ArrayBuffer>`. The two
 * differ only in a type parameter and the runtime object is identical, so this
 * is a type-level narrowing, not a copy.
 */
function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/**
 * Copies an unknown value into a fresh `Uint8Array` when it is a real buffer.
 *
 * Brand checks (not `instanceof`) are used because extension results may cross
 * a realm boundary. The copy is deliberate: a browser may hand back a view over
 * a buffer it later reuses or detaches.
 */
function toBytes(value: unknown): Uint8Array | null {
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer as ArrayBufferLike, view.byteOffset, view.byteLength));
    return copy;
  }
  if (Object.prototype.toString.call(value) === "[object ArrayBuffer]") {
    return new Uint8Array(value as ArrayBuffer).slice();
  }
  return null;
}

/** Random bytes for the user handle and PRF salts. */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** The subset of `CredentialsContainer` this port calls. */
interface CredentialsContainerLike {
  create(options: CredentialCreationOptions): Promise<unknown>;
  get(options: CredentialRequestOptions): Promise<unknown>;
}

/**
 * Resolves `navigator.credentials` structurally, since jsdom leaves it
 * undefined (and the DOM types claim it always exists).
 */
function getCredentialsContainer(): CredentialsContainerLike | undefined {
  const nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator;
  const candidate: unknown = nav?.credentials;
  if (typeof candidate !== "object" || candidate === null) {
    return undefined;
  }
  const methods = candidate as { create?: unknown; get?: unknown };
  if (typeof methods.create !== "function" || typeof methods.get !== "function") {
    return undefined;
  }
  return candidate as CredentialsContainerLike;
}

/** The static side of `PublicKeyCredential`, as far as this port depends on it. */
interface PublicKeyCredentialStatics {
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  prototype?: { getClientExtensionResults?: unknown };
}

/** Resolves the `PublicKeyCredential` constructor, which jsdom does not define. */
function getPublicKeyCredentialStatics(): PublicKeyCredentialStatics | undefined {
  const ctor: unknown = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  if (typeof ctor !== "function") {
    return undefined;
  }
  return ctor as unknown as PublicKeyCredentialStatics;
}

/** The shape of the `prf` entry in a `getClientExtensionResults()` map. */
interface PrfExtensionLike {
  enabled?: unknown;
  results?: unknown;
}

/**
 * Reads `getClientExtensionResults().prf`, or undefined when absent.
 *
 * Results are treated as `unknown` and narrowed here (rather than trusted to
 * the DOM types) because the value comes from the authenticator, not the
 * compiler, and older user agents return shapes the current lib does not model.
 */
function readPrf(extensionResults: unknown): PrfExtensionLike | undefined {
  if (typeof extensionResults !== "object" || extensionResults === null) {
    return undefined;
  }
  const prf = (extensionResults as { prf?: unknown }).prf;
  if (typeof prf !== "object" || prf === null) {
    return undefined;
  }
  return prf as PrfExtensionLike;
}

/** Reads `prf.results.first` as bytes, or null when it is not a buffer. */
function readPrfFirst(prf: PrfExtensionLike): Uint8Array | null {
  const results = prf.results;
  if (typeof results !== "object" || results === null) {
    return null;
  }
  return toBytes((results as { first?: unknown }).first);
}

/** `navigator.credentials.create`/`get` result, as far as this port reads it. */
interface PublicKeyCredentialLike {
  rawId?: unknown;
  getClientExtensionResults?: () => unknown;
}

/** Narrows a credential result to something carrying a raw id and extensions. */
function asPublicKeyCredential(value: unknown): PublicKeyCredentialLike | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as PublicKeyCredentialLike;
  if (typeof candidate.getClientExtensionResults !== "function") {
    return undefined;
  }
  return candidate;
}

/**
 * Maps a thrown authenticator error onto a failure reason.
 *
 * Abort/NotAllowed/SecurityError are the user-visible refusals (dismissed
 * prompt, denied permission, insecure context); everything else — including
 * NotSupportedError and NotReadableError — is an unexpected "error".
 */
function mapError(error: unknown): FailureReason {
  const name =
    typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  if (name === "AbortError" || name === "NotAllowedError" || name === "SecurityError") {
    return "not-allowed";
  }
  return "error";
}

/**
 * Reads `window.location.hostname` as the RP id, tolerating environments that
 * do not provide a location.
 */
function readRpId(): string | undefined {
  try {
    const hostname: unknown = typeof window === "undefined" ? undefined : window.location?.hostname;
    return typeof hostname === "string" && hostname.length > 0 ? hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * PRF input for `get`. The DOM lib (TS 5.9) models the newer `eval` /
 * `evalByCredential` shape, but the authenticators this vault targets take a
 * salt array; the cast at the call site is the only place that difference is
 * visible.
 */
interface PrfGetExtensionInput {
  prf: { salts: BufferSource[] };
}

/**
 * Creates a 32-byte PRF salt.
 *
 * @returns Fresh random bytes; reuse the same salt to re-derive the same key.
 *
 * @example
 * ```ts
 * const salt = makePrfSalt(); // 32 bytes
 * ```
 */
export function makePrfSalt(): Uint8Array {
  // No fallback to a non-cryptographic source: a predictable salt would
  // silently weaken every vault key derived from it, so failing loudly is the
  // only safe behaviour here.
  return randomBytes(PRF_SALT_BYTES);
}

/**
 * Encodes bytes as standard base64 (not base64url, despite the name, which the
 * contract fixes).
 *
 * @example
 * ```ts
 * b64u(new Uint8Array([1, 2, 3])); // "AQID"
 * ```
 */
export function b64u(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

/**
 * Decodes a standard-base64 credential id.
 *
 * @returns The bytes, or null when the input is not valid base64, so callers
 * can tell "no id stored" apart from "stored id is corrupt".
 *
 * @example
 * ```ts
 * unb64u("AQID"); // Uint8Array [1, 2, 3]
 * unb64u("!!!"); // null
 * ```
 */
export function unb64u(s: string): Uint8Array | null {
  if (typeof s !== "string" || s.length === 0) {
    return null;
  }
  try {
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Default port backed by the real WebAuthn API. Tests replace it with fakes.
 *
 * @example
 * ```ts
 * const port: WebAuthnPort = defaultWebAuthnPort;
 * ```
 */
export const defaultWebAuthnPort: WebAuthnPort = {
  async isSupported(): Promise<boolean> {
    try {
      if (!getCredentialsContainer()) {
        return false;
      }
      const statics = getPublicKeyCredentialStatics();
      if (!statics) {
        return false;
      }
      const check = statics.isUserVerifyingPlatformAuthenticatorAvailable;
      if (typeof check !== "function") {
        return false;
      }
      // Best-effort static PRF check: without this method no extension results
      // can ever be read, so PRF cannot work.
      if (typeof statics.prototype?.getClientExtensionResults !== "function") {
        return false;
      }
      const available = await check();
      return available === true;
    } catch {
      return false;
    }
  },

  async register(params: { challenge: Uint8Array; prfSalt: Uint8Array }) {
    if (!getCredentialsContainer() || !getPublicKeyCredentialStatics()) {
      return { ok: false, reason: "unavailable" } as const;
    }
    try {
      const credentials = getCredentialsContainer();
      if (!credentials) {
        return { ok: false, reason: "unavailable" } as const;
      }
      const created = await credentials.create({
        publicKey: {
          challenge: asBufferSource(params.challenge),
          rp: { name: RP_NAME },
          user: {
            id: asBufferSource(randomBytes(USER_ID_BYTES)),
            name: USER_NAME,
            displayName: USER_NAME,
          },
          pubKeyCredParams: PUB_KEY_ALGS.map((alg) => ({ type: "public-key" as const, alg })),
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "required",
            userVerification: "required",
          },
          extensions: { prf: {} },
          timeout: TIMEOUT_MS,
        },
      });

      const credential = asPublicKeyCredential(created);
      if (!credential) {
        // create() resolving null means the user dismissed the prompt.
        return { ok: false, reason: "not-allowed" } as const;
      }
      const rawId = toBytes(credential.rawId);
      if (!rawId) {
        return { ok: false, reason: "error" } as const;
      }
      const prf = readPrf(credential.getClientExtensionResults?.());
      if (!prf || prf.enabled !== true) {
        // Absent or not-enabled PRF: the credential exists but could never be
        // unlocked with PRF, so callers must not store it.
        return { ok: false, reason: "no-prf" } as const;
      }
      return { ok: true, credentialIdB64: b64u(rawId) } as const;
    } catch (error) {
      return { ok: false, reason: mapError(error) } as const;
    }
  },

  async get(params: { challenge: Uint8Array; prfSalt: Uint8Array; credentialIdB64?: string }) {
    if (!getCredentialsContainer() || !getPublicKeyCredentialStatics()) {
      return { ok: false, reason: "unavailable" } as const;
    }

    let allowCredentials: PublicKeyCredentialDescriptor[] | undefined;
    if (params.credentialIdB64) {
      const credentialId = unb64u(params.credentialIdB64);
      if (!credentialId) {
        // A stored-but-unreadable id is corruption, not an invitation to fall
        // back to a discoverable credential that might be a different vault.
        return { ok: false, reason: "error" } as const;
      }
      allowCredentials = [{ id: asBufferSource(credentialId), type: "public-key" }];
    }

    const extensions = {
      prf: { salts: [asBufferSource(params.prfSalt)] },
    } as unknown as AuthenticationExtensionsClientInputs;
    const rpId = readRpId();

    try {
      const credentials = getCredentialsContainer();
      if (!credentials) {
        return { ok: false, reason: "unavailable" } as const;
      }
      const assertion = await credentials.get({
        publicKey: {
          challenge: asBufferSource(params.challenge),
          ...(rpId ? { rpId } : {}),
          ...(allowCredentials ? { allowCredentials } : {}),
          userVerification: "required",
          extensions,
          timeout: TIMEOUT_MS,
        },
      });

      const credential = asPublicKeyCredential(assertion);
      if (!credential) {
        // get() resolving null means the user dismissed the prompt.
        return { ok: false, reason: "not-allowed" } as const;
      }
      const prf = readPrf(credential.getClientExtensionResults?.());
      if (!prf) {
        return { ok: false, reason: "no-prf" } as const;
      }
      const prfOutput = readPrfFirst(prf);
      if (!prfOutput) {
        // Distinct from an error on purpose: this is the "PRF unavailable at
        // unlock" path that lets the caller fall back to PIN.
        return { ok: false, reason: "no-prf" } as const;
      }
      return { ok: true, prfOutput } as const;
    } catch (error) {
      return { ok: false, reason: mapError(error) } as const;
    }
  },
};

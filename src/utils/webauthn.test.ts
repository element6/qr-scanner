/**
 * Tests for the WebAuthn port.
 *
 * jsdom has no WebAuthn at all (`navigator.credentials` and
 * `PublicKeyCredential` are both undefined), so the bare-environment tests pin
 * the graceful paths and every other test injects a fake navigator. The point
 * under test is the port's own decision logic — reason mapping, PRF presence
 * vs. PRF bytes, and request shaping — not the browser.
 *
 * Every test restores the globals it touched, so a fake navigator never leaks
 * into a sibling suite.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { b64u, defaultWebAuthnPort, makePrfSalt, unb64u } from "./webauthn";

/** Result of `getClientExtensionResults()` as the port reads it. */
type ExtensionResults = Record<string, unknown>;

/** Minimal stand-in for the `navigator.credentials.create/get` result. */
interface FakeCredential {
  rawId?: unknown;
  getClientExtensionResults: () => ExtensionResults;
}

/** The options objects the fake container received, captured for assertions. */
interface CapturedCalls {
  create: CredentialCreationOptions[];
  get: CredentialRequestOptions[];
}

const captured: CapturedCalls = { create: [], get: [] };

/** Last captured request options; throws when `get()` never ran. */
function lastGetPublicKey(): PublicKeyCredentialRequestOptions {
  const options = captured.get[captured.get.length - 1]?.publicKey;
  if (!options) throw new Error("navigator.credentials.get was not called");
  return options;
}

/** Puts a fake `navigator.credentials` in place, restoring it after the test. */
function stubCredentials(
  behavior: (options: CredentialCreationOptions | CredentialRequestOptions) => Promise<FakeCredential | null>,
): void {
  const create = (options: CredentialCreationOptions): Promise<unknown> => {
    captured.create.push(options);
    return behavior(options);
  };
  const get = (options: CredentialRequestOptions): Promise<unknown> => {
    captured.get.push(options);
    return behavior(options);
  };
  Object.defineProperty(navigator, "credentials", { value: { create, get }, configurable: true, writable: true });
}

/** Puts a fake `PublicKeyCredential` in place (`vi` restores it after each test). */
function stubPublicKeyCredential(options: { available?: boolean; rejects?: boolean } = {}): void {
  const { available = true, rejects = false } = options;
  class FakePublicKeyCredential {
    static isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> {
      return rejects
        ? Promise.reject(new DOMException("blocked by policy", "NotAllowedError"))
        : Promise.resolve(available);
    }

    getClientExtensionResults(): ExtensionResults {
      return {};
    }
  }
  vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
}

afterEach(() => {
  captured.create.length = 0;
  captured.get.length = 0;
  delete (navigator as { credentials?: unknown }).credentials;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isSupported", () => {
  it("returns false in bare jsdom without throwing", async () => {
    await expect(defaultWebAuthnPort.isSupported()).resolves.toBe(false);
  });

  it("returns false when PublicKeyCredential is missing but credentials exist", async () => {
    stubCredentials(async () => null);
    await expect(defaultWebAuthnPort.isSupported()).resolves.toBe(false);
  });

  it("returns false when the platform authenticator reports unavailable", async () => {
    stubCredentials(async () => null);
    stubPublicKeyCredential({ available: false });
    await expect(defaultWebAuthnPort.isSupported()).resolves.toBe(false);
  });

  it("returns false when the availability check rejects", async () => {
    stubCredentials(async () => null);
    stubPublicKeyCredential({ rejects: true });
    await expect(defaultWebAuthnPort.isSupported()).resolves.toBe(false);
  });

  it("returns true when the API, the authenticator and PRF are all present", async () => {
    stubCredentials(async () => null);
    stubPublicKeyCredential();
    await expect(defaultWebAuthnPort.isSupported()).resolves.toBe(true);
  });

  it("returns false when PublicKeyCredential cannot report extension results", async () => {
    stubCredentials(async () => null);
    const noExtensions = function NoExtensions(): void {};
    vi.stubGlobal("PublicKeyCredential", noExtensions);
    await expect(defaultWebAuthnPort.isSupported()).resolves.toBe(false);
  });
});

describe("register without WebAuthn", () => {
  it("reports unavailable rather than throwing", async () => {
    const result = await defaultWebAuthnPort.register({
      challenge: new Uint8Array([1]),
      prfSalt: new Uint8Array([2]),
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("get without WebAuthn", () => {
  it("reports unavailable rather than throwing", async () => {
    const result = await defaultWebAuthnPort.get({
      challenge: new Uint8Array([1]),
      prfSalt: new Uint8Array([2]),
      credentialIdB64: b64u(new Uint8Array([3, 4])),
    });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("register with a fake authenticator", () => {
  const challenge = new Uint8Array([10, 20, 30]);
  const prfSalt = new Uint8Array([40, 50, 60]);

  it("returns the base64 raw id and shapes the creation request", async () => {
    const rawId = new Uint8Array([1, 2, 3, 250]);
    stubPublicKeyCredential();
    stubCredentials(async () => ({ rawId: rawId.buffer, getClientExtensionResults: () => ({ prf: { enabled: true } }) }));

    const result = await defaultWebAuthnPort.register({ challenge, prfSalt });

    expect(result).toEqual({ ok: true, credentialIdB64: b64u(rawId) });
    const options = captured.create[0]?.publicKey;
    expect(options?.rp).toEqual({ name: "QR Scanner" });
    expect(options?.user.name).toBe("vault");
    expect(options?.user.displayName).toBe("vault");
    expect((options?.user.id as Uint8Array).length).toBe(32);
    expect(options?.pubKeyCredParams).toEqual([
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ]);
    expect(options?.authenticatorSelection).toEqual({
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    });
    expect(options?.timeout).toBe(60000);
    expect(options?.extensions).toHaveProperty("prf");
    expect(Array.from(options?.challenge as Uint8Array)).toEqual([10, 20, 30]);
  });

  it("generates a distinct user id per ceremony", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ rawId: new ArrayBuffer(8), getClientExtensionResults: () => ({ prf: { enabled: true } }) }));

    await defaultWebAuthnPort.register({ challenge, prfSalt });
    await defaultWebAuthnPort.register({ challenge, prfSalt });

    const first = captured.create[0]?.publicKey?.user.id as Uint8Array;
    const second = captured.create[1]?.publicKey?.user.id as Uint8Array;
    expect(b64u(first)).not.toBe(b64u(second));
  });

  it("maps a PRF-disabled credential to no-prf", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ rawId: new ArrayBuffer(8), getClientExtensionResults: () => ({ prf: { enabled: false } }) }));

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "no-prf" });
  });

  it("maps a missing PRF extension to no-prf", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ rawId: new ArrayBuffer(8), getClientExtensionResults: () => ({}) }));

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "no-prf" });
  });

  it("maps a user refusal to not-allowed", async () => {
    stubPublicKeyCredential();
    stubCredentials(() => Promise.reject(new DOMException("denied", "NotAllowedError")));

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "not-allowed" });
  });

  it("maps an abort to not-allowed", async () => {
    stubPublicKeyCredential();
    stubCredentials(() => Promise.reject(new DOMException("aborted", "AbortError")));

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "not-allowed" });
  });

  it("maps a security error to not-allowed", async () => {
    stubPublicKeyCredential();
    stubCredentials(() => Promise.reject(new DOMException("insecure", "SecurityError")));

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "not-allowed" });
  });

  it("maps an unsupported authenticator to error", async () => {
    stubPublicKeyCredential();
    stubCredentials(() => Promise.reject(new DOMException("no authenticator", "NotSupportedError")));

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("treats a non-Error rejection as error", async () => {
    stubPublicKeyCredential();
    stubCredentials(() => Promise.reject("boom"));

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("maps a dismissed prompt (null result) to not-allowed", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => null);

    await expect(defaultWebAuthnPort.register({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "not-allowed" });
  });
});

describe("get with a fake authenticator", () => {
  const challenge = new Uint8Array([7, 7, 7]);
  const prfSalt = new Uint8Array([9, 9, 9]);

  it("returns the exact PRF bytes from an ArrayBuffer result", async () => {
    const prfOutput = new Uint8Array([201, 202, 203, 204, 205]);
    stubPublicKeyCredential();
    stubCredentials(async () => ({
      getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: prfOutput.buffer } } }),
    }));

    const result = await defaultWebAuthnPort.get({ challenge, prfSalt });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.prfOutput).toBeInstanceOf(Uint8Array);
    expect(Array.from(result.prfOutput)).toEqual([201, 202, 203, 204, 205]);
    expect(result.prfOutput).not.toBe(prfOutput);
  });

  it("accepts a Uint8Array result and copies it", async () => {
    const prfOutput = new Uint8Array([1, 2, 3, 4]);
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } }) }));

    const result = await defaultWebAuthnPort.get({ challenge, prfSalt });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.prfOutput)).toEqual([1, 2, 3, 4]);
    expect(result.prfOutput).not.toBe(prfOutput);
  });

  it("maps a missing PRF extension to no-prf", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({}) }));

    await expect(defaultWebAuthnPort.get({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "no-prf" });
  });

  it("maps present-but-empty PRF results to no-prf", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({ prf: { enabled: true } }) }));

    await expect(defaultWebAuthnPort.get({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "no-prf" });
  });

  it("maps a PRF result that is not a buffer to no-prf", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: "not-bytes" } } }) }));

    await expect(defaultWebAuthnPort.get({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "no-prf" });
  });

  it("passes the decoded credential id and rpId when the id is known", async () => {
    const credentialId = new Uint8Array([5, 6, 7, 8]);
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array([1]) } } }) }));

    await defaultWebAuthnPort.get({ challenge, prfSalt, credentialIdB64: b64u(credentialId) });

    const options = captured.get[0]?.publicKey;
    expect(options?.allowCredentials).toHaveLength(1);
    expect(options?.allowCredentials?.[0]?.type).toBe("public-key");
    expect(Array.from(options?.allowCredentials?.[0]?.id as Uint8Array)).toEqual([5, 6, 7, 8]);
    expect(options?.rpId).toBe(window.location.hostname);
    expect(options?.userVerification).toBe("required");
    expect(options?.timeout).toBe(60000);
    expect(Array.from(options?.challenge as Uint8Array)).toEqual([7, 7, 7]);
  });

  it("omits allowCredentials for the discoverable flow", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array([1]) } } }) }));

    await defaultWebAuthnPort.get({ challenge, prfSalt });

    expect(lastGetPublicKey().allowCredentials).toBeUndefined();
  });

  it("passes the PRF salt as a salt array", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array([1]) } } }) }));

    await defaultWebAuthnPort.get({ challenge, prfSalt });

    const extensions = lastGetPublicKey().extensions as
      | { prf?: { salts?: unknown[] } }
      | undefined;
    const salts = extensions?.prf?.salts;
    expect(salts).toHaveLength(1);
    expect(Array.from(salts?.[0] as Uint8Array)).toEqual([9, 9, 9]);
  });

  it("maps a corrupt stored credential id to error", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array([1]) } } }) }));

    await expect(defaultWebAuthnPort.get({ challenge, prfSalt, credentialIdB64: "!!!" })).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    expect(captured.get).toHaveLength(0);
  });

  it("maps a user refusal to not-allowed", async () => {
    stubPublicKeyCredential();
    stubCredentials(() => Promise.reject(new DOMException("denied", "NotAllowedError")));

    await expect(defaultWebAuthnPort.get({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "not-allowed" });
  });

  it("maps a dismissed prompt (null result) to not-allowed", async () => {
    stubPublicKeyCredential();
    stubCredentials(async () => null);

    await expect(defaultWebAuthnPort.get({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "not-allowed" });
  });

  it("maps an unexpected failure to error", async () => {
    stubPublicKeyCredential();
    stubCredentials(() => Promise.reject(new DOMException("bad state", "InvalidStateError")));

    await expect(defaultWebAuthnPort.get({ challenge, prfSalt })).resolves.toEqual({ ok: false, reason: "error" });
  });
});

describe("makePrfSalt", () => {
  it("returns 32 bytes", () => {
    const salt = makePrfSalt();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(32);
  });

  it("returns different bytes on each call", () => {
    expect(b64u(makePrfSalt())).not.toBe(b64u(makePrfSalt()));
  });
});

describe("b64u / unb64u", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array(256);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = index;
    }
    const decoded = unb64u(b64u(bytes));
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded as Uint8Array)).toEqual(Array.from(bytes));
  });

  it("uses the standard (not url-safe) base64 alphabet", () => {
    expect(b64u(new Uint8Array([251, 239]))).toBe("++8=");
    expect(b64u(new Uint8Array([1, 2, 3]))).toBe("AQID");
  });

  it("returns null for malformed input", () => {
    expect(unb64u("!!!")).toBeNull();
    expect(unb64u("")).toBeNull();
    expect(unb64u("A")).toBeNull();
  });
});

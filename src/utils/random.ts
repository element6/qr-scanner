/**
 * Cryptographically secure random bytes, via the Web Crypto API.
 *
 * Shared by the WebAuthn port (user handle, PRF salts) and the vault hook
 * (per-record salts) — both previously carried byte-identical copies.
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
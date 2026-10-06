# Spec: Local 2FA authenticator vault
**Status:** Draft for review — 3 open questions (§12)
**Author:** agent (spec-anything)
**Date:** 2026-10-06
**App version:** qr-scanner 0.0.0 (worktree `feat/2fa-vault`; `otpauth`/`totp`/`base32`/`vaultCrypto`/`vaultStore`/`exportFormat`/`webauthn` and `useVault` landed and tested; App/tab wiring in progress)

---

## 1. Goal and non-goals

Add a third tab to the app: a **local 2FA authenticator vault**. Scanning an
`otpauth://` TOTP QR code — from the camera, an image file, or a paste — routes
the URI into the vault instead of scan history, so a one-time-password seed never
lands in `scannedData`, a history row, or the clipboard. The vault is unlocked by
fingerprint (WebAuthn PRF) where the device supports it, otherwise by a 6–8 digit
PIN, and shows live TOTP codes. Backup is a password-encrypted export file, and
the same file restores into a fresh browser — with no server involved at any
point.

**Non-goals:**

- **No HOTP support beyond rejection.** `otpauth-hotp` is classified and refused
  with a toast; counter-based codes have no correct client-only "next code" story.
- **No cloud sync, no account, no server.** The vault is one `localStorage` blob.
- **No settings page.** Vault controls live in the 2FA tab; there is nothing to
  configure elsewhere.
- **No new dependencies.** WebCrypto plus the existing stack only.
- **No multiple vaults.** One vault per browser profile, keyed by one storage key.

## 2. Scan interception contract

`scanKind(value)` (`src/utils/otpauth.ts:58`) returns one of five classes
(`src/utils/otpauth.ts:13`):

```ts
export type ScanKind = "text" | "url" | "otpauth-totp" | "otpauth-hotp" | "otpauth-other";
```

Routing of a decoded value:

| Class | Behaviour |
| --- | --- |
| `otpauth-totp` | Route to the vault **Save** flow. Hold the raw URI in a memory ref only. |
| `otpauth-hotp`, `otpauth-other` | Reject with a toast; the URI is not shown or stored. |
| `text`, `url` | Unchanged existing path. |

An `otpauth-totp` value **never** reaches: `addScan` (scan history), the
clipboard, `scannedData`, the aria-live region, a toast carrying the URI, or a
history row. The only announcement is the fixed string below.

`describeOutcome` (`src/utils/scanImage.ts:154`) is the sole source of the
user-facing sentence, and the otpauth cases are pinned:

- `otpauth-totp` → `"Authenticator code found"`
- `otpauth-hotp` / `otpauth-other` → `"Unsupported authenticator code type"`
- everything else → `Scanned <value>`

**History redaction.** Any stored history row whose value classifies as
`otpauth-totp` renders as `Authenticator code — hidden`. For such a row both
**copy** and **search** are suppressed: the value is not in the DOM and cannot be
matched by the history filter.

**Migration banner.** Until the flag is resolved, `ScanHistory` shows the banner
when the history contains authenticator rows (`src/components/ScanHistory.tsx:288`):

> `{n} authenticator code{s} found in scan history — move to 2FA vault or remove`

with two actions: **Move to 2FA vault** (aria-label "Move authenticator codes to
the 2FA vault") and **Remove from history** (aria-label "Remove authenticator
codes from scan history"). `qr2fa.historyMigrated`
(`HISTORY_MIGRATED_KEY`, `src/utils/vaultStore.ts:40`) is set **only on
resolution** — i.e. when the user moves the rows into the vault or removes them
from history. Dismissing or ignoring the banner does not set it, so the prompt
reappears on the next visit.

## 3. Vault record schema

Storage keys and bounds, copied verbatim from `src/utils/vaultStore.ts`:

```ts
export const VAULT_STORAGE_KEY = "qr2fa.vault.v1";
export const CLOCK_OFFSET_KEY = "qr2fa.clockOffset";
export const HISTORY_MIGRATED_KEY = "qr2fa.historyMigrated";
export const VAULT_PENDING_KEY = "qr2fa.vaultPending.v1";
export const VAULT_SUPERSEDED_KEY = "qr2fa.vaultSuperseded.v1";
export const CREDENTIAL_ID_KEY = "qr2fa.credentialId.v1";

export const MAX_VAULT_ENTRIES = 200;
export const MIN_IMPORT_ITERATIONS = 10_000;
export const MAX_IMPORT_ITERATIONS = 10_000_000;
```

The three last keys back the locked-screen import protocol (§8) and the PRF
credential-id bookmark (`CREDENTIAL_ID_KEY` is how a later `get` addresses the
same authenticator credential).

The PIN KDF is PBKDF2-SHA256 at `KDF_ITERATIONS = 600_000`
(`src/utils/vaultCrypto.ts:35`); the import bounds above reject a 1-iteration
KDF or a count that would hang the tab, without pinning the live default.

```ts
export interface VaultKdf {
  alg: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  saltB64: string;
}

export interface VaultWrap {
  ivB64: string;
  ctB64: string;
}

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
```

`revision` is the compare-and-swap token, `lastSeenTime` is the trusted-time
watermark, and at least one of `prf` / `pin` must be present — a record with no
wrap can never be opened and is rejected rather than stored.

**Entry shape** (`OtpauthEntry`, `src/utils/otpauth.ts:71`), produced by the
single validation path `normalizeEntry` / `parseOtpauth`:

```ts
export interface OtpauthEntry {
  issuer: string;
  account: string;
  secret: string;
  algorithm: "SHA1" | "SHA256" | "SHA512";
  digits: 6 | 8;
  period: number;
}
```

Secret and period bounds: RFC 4648 base32 (`A-Z2-7`), `MIN_SECRET_LENGTH = 16`,
`DEFAULT_PERIOD = 30`, `MIN_PERIOD = 1`, `MAX_PERIOD = 300`.

**AAD contexts** (`src/utils/vaultCrypto.ts`), all serialized by `canonicalAad`
— JSON with keys sorted lexicographically and no whitespace:

```ts
pinWrapAad({ version, vaultId, kdf })            // context: "pin"
prfWrapAad({ version, vaultId, prfSaltB64 })     // context: "prf"
entriesAad({ version, vaultId })                 // context: "entries"
```

The record header is authenticated, not merely stored: a tampered version, a
swapped `vaultId`, or a downgraded iteration count fails the GCM tag. The PIN AAD
commits to the KDF parameters and the PRF AAD to the PRF salt; neither commits to
the other's, so the two keys are not interchangeable across contexts. All entries
live in one blob, so a splice is a single tag failure.

## 4. Unlock flows

- **Fingerprint (PRF) is the default** on a PRF-capable device.
- **PIN (6–8 digits) is mandatory** where PRF is unavailable.
- A PRF-capable device **may opt into PIN** as a second wrap, via a discrete
  checkbox with the quantified warning: *"a PIN is weaker than a fingerprint"*.

**PRF capability counts only** when a `get` returns `prf.results.first` derived
with the **same stored ≥32-byte salt**. A `get` that returns no such output is
*not* a fingerprint failure: the vault falls back silently to PIN when a PIN wrap
exists, and otherwise offers the restore-from-backup path. The UI must never
render a "fingerprint failed" label for a missing PRF result.

**Escalating PIN delay** after 5 consecutive failures: 1 s doubling, capped at
30 s (`DELAY_START_FAILURES`, `DELAY_BASE_MS`, `DELAY_CAP_MS` in
`src/hooks/useVault.ts`). This is documented as **bypassable** — it runs
client-side and is a deterrent, not a boundary.

## 5. Auto-lock

The vault locks when:

1. the page **reloads** — the derived key is memory-only, never persisted;
2. the user **switches away** from the 2FA tab;
3. the tab is **idle for 120 s** (`IDLE_LOCK_MS = 120_000`,
   `src/hooks/useVault.ts:147`).

Auto-lock is a deterrent, not a boundary: while the device is unlocked and the
vault tab is open, the vault is open.

## 6. `useVault` API (frozen)

The hook (`src/hooks/useVault.ts`) is the only interface the UI uses; the frozen
surface is:

```ts
export type VaultPhase = "setup" | "locked" | "unlocked";

export interface UseVault {
  phase: VaultPhase;
  busy: VaultBusy;              // "creating" | "unlocking" | "saving" | "exporting" | "importing" | "migrating" | null
  error: string | null;
  entries: OtpauthEntry[];      // [] unless unlocked, stored order
  hasPin: boolean;
  prfRegistered: boolean;
  clockOffset: number;          // persisted CLOCK_OFFSET_KEY, default 0 (ms)
  clockSkew: boolean;           // measured once at unlock
  retryAfterMs: number;         // remaining PIN delay, 0 = none

  unlockWithPin(pin: string): Promise<{ ok: true } | { ok: false; reason: "wrong-pin" | "corrupt" | "delay" }>;
  unlockWithBiometric(): Promise<
    { ok: true } | { ok: false; reason: "no-biometric-credential" | "unavailable" | "corrupt" }
  >;
  lock(): void;
  createVault(opts: { mode: "prf" | "prf+pin" | "pin"; pin?: string }): Promise<{ ok: true } | { ok: false; error: string }>;
  saveEntry(uri: string, opts?: { replace?: boolean }): Promise<SaveOutcome>;   // added | replaced | duplicate | conflict
  removeEntry(canonicalSecret: string): Promise<{ ok: boolean }>;
  exportVault(password: string): Promise<{ ok: true; json: string } | { ok: false; error: string }>;
  importUnlocked(json: string, password: string, choices?: ConflictChoice[]): Promise<
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
```

`saveEntry` returns a conflict (rather than appending) when the same
issuer/account already exists with a different secret; the caller re-invokes with
`{ replace: true }` to overwrite.

## 7. Export and import

**Envelope** — verbatim from `src/utils/exportFormat.ts:45–77`:

```ts
export const EXPORT_FORMAT = "qr-scanner-2fa-export";
export const EXPORT_VERSION = 1;
export const EXPORT_PASSWORD_MIN = 8;

export interface ExportEnvelope {
  format: "qr-scanner-2fa-export";
  version: 1;
  app: "qr-scanner";
  exportedAt: string;
  kdf: { alg: "PBKDF2"; hash: "SHA-256"; iterations: number; saltB64: string };
  cipher: "AES-GCM";
  ivB64: string;
  ctB64: string;
}
```

**AAD** = `{ format, version, cipher, kdf }`. `exportedAt` is deliberately
excluded: it is cosmetic metadata, and binding it would turn a harmless timestamp
edit into "wrong password or corrupted file" with no way back. No issuer, account,
secret, or `otpauth://` URI ever appears outside the ciphertext.

**Export UX.** Password minimum 8 (`EXPORT_PASSWORD_MIN`, also enforced in the
format module so a caller that skips the UI check cannot emit a weak file), plus
a confirm field and a generate-strong-password option. The filename is
`qr-scanner-2fa-YYYY-MM-DD.qr2fa.json`.

**Import validation order** — format → version → cipher → kdf → iteration bounds
(`MIN_IMPORT_ITERATIONS` … `MAX_IMPORT_ITERATIONS`), **before any KDF work**, so a
hostile file is rejected cheaply. Entry validation is all-or-nothing: one bad URI
fails the whole file.

**Merge rules:**

- same `canonicalSecret` (`src/utils/otpauth.ts:94`) → **duplicate**, skipped;
- same issuer+account, different secret → **identity** conflict;
- names equal case-insensitively but not exactly, different secret →
  **case-variant** conflict, never silently deduped.

`ConflictChoice = "replace" | "keep-both" | "skip"` and
`MergeConflict.kind: "identity" | "case-variant"` (`src/utils/exportFormat.ts:308–320`).
The merge returns one new array and is committed with a **single atomic CAS
write**, not a sequence of writes.

## 8. Locked-screen import commit protocol (the anti-lockout rule)

When the user imports a file while the vault is locked, the new file must never
be able to brick the existing vault. The order is fixed:

1. **Decrypt in memory** with the supplied file password; touch no storage yet.
2. **Require a NEW credential**: a PIN (6–8 digits) or a fresh PRF registration.
   The credential that opens the *new* vault is chosen now, not inherited.
3. **Write the staged record** to `VAULT_PENDING_KEY` (`qr2fa.vaultPending.v1`).
4. **Verify** the new credential actually opens the staged record.
5. **Only then supersede**: raw-copy the current primary to
   `VAULT_SUPERSEDED_KEY` (`qr2fa.vaultSuperseded.v1`), then promote pending to
   primary.
6. **Remove `qr2fa.vaultSuperseded.v1`** after the first successful unlock of the
   new vault.

Failure at any step leaves the old record **byte-identical** — a wrong file
password or a failed verification aborts before any destructive write.

## 9. Concurrency

Writes use **compare-and-swap**: re-read the record, compare `revision`, write
only on a match.

**Accepted residual:** a microsecond compare-then-write race across tabs. Two
tabs can both pass the revision check before either writes; because the vault is a
single blob, the damage is bounded to one lost write rather than a torn record.

**Reconciliation:** after a successful write the hook listens for `storage`
events; a foreign revision change **locks the vault** rather than silently
continuing on stale entries.

## 10. Threat model summary

The 2FA vault is encrypted on this device with a key protected by your
fingerprint, or by a PIN if you choose one. Nothing is transmitted anywhere:
there is no account, no server, and no recovery — if you lose both your
fingerprint and your PIN, your only restore path is your password-protected
export file. Your export password is the weakest link in the backup: a short
password makes the file guessable offline, so the export offers a generated
strong password. The PIN delay after repeated failures is a speed bump, not a
lock: anyone with your unlocked device or your local storage data can bypass it.
Codes are cleared from the clipboard when the code rolls over, best-effort —
other apps may read them before then. The vault locks when you reload, switch
away from the 2FA tab, or leave it idle for two minutes, but while your device is
unlocked and the tab is open, so is your vault. Nothing in this app can protect
you from malware on an unlocked device.

## 11. Accepted residuals

- **Cross-tab race** — the microsecond compare-then-write window in §9.
- **OS clipboard exposure** — a copied code can be read by other apps before the
  best-effort clear on step roll.
- **Client-side PIN delay is bypassable** — it is a deterrent, not a lock.
- **Auto-lock is bypassable** — while the device is unlocked, another tab or app
  context can keep the session alive.

## 12. Open questions

1. **SHA-512 and 8-digit entries are untested against real authenticator apps.**
   The RFC 6238 vectors pass, but interoperability with the issuers that emit
   these variants has not been confirmed against a live app.
2. **Synced-passkey PRF behaviour across browsers is unverified.** Whether a
   passkey synced through a platform keychain reproduces the same PRF output on a
   second device — which would make the fingerprint path portable, or break it —
   is unmeasured here.
3. **Is `period > 300` a real-world need?** The parser rejects it as absurd; if
   legitimate issuers exist, the bound (not the design) is what should move.

## 13. Verification checklist

Automated, from the worktree root:

```
npm run typecheck && npm run test:run && npm run build && npm run check:wasm
```

Manual, one pass each:

- [ ] Scanning an `otpauth-totp` QR leaves **no history row** and puts nothing in the clipboard.
- [ ] The aria-live region shows **"Authenticator code found"** — never the URI.
- [ ] An exported `.qr2fa.json` greps clean of issuer/account/secret/`otpauth` outside the ciphertext.
- [ ] A **wrong export password** fails and leaves the existing vault intact.
- [ ] A **failed locked-screen import** leaves the old vault record byte-identical.

# align: 2fa ux fixes

## Brief

**Objective** — Fix three 2FA UX defects: scan history hides 2FA names, the idle
auto-lock is too long for the unlock flow, and vault card names truncate.

**Who** — Single user, this device, local-only vault data.

**Why now** — 2FA is usable end to end; three rough edges surfaced while using it.

**Done-when**
1. A 2FA history row shows issuer on line 1 and account on line 2, the account
   muted and small — same shape as the vault card. Unparseable rows keep the
   existing `Authenticator code — hidden` text.
2. `IDLE_LOCK_MS = 60_000`. The rearm listener set gains `scroll` and
   `touchmove` alongside `pointerdown`/`keydown`. Still no tab-switch or blur
   lock: only no-activity locks.
3. Vault card issuer and account wrap to ~2 lines instead of `truncate`.
4. The migration banner's copy says the URI sits in plaintext until the user
   acts, so the disk leak is understood rather than silent. No new write path:
   Move copies to the vault and deletes the row, Remove deletes it outright —
   both already verified to do so.
5. `handleMoveOtpauth` filters `isOtpauthKind`, matching Remove and the banner's
   own count. Today it filters `=== "otpauth-totp"` only, so a HOTP or
   `otpauth-other` row makes the banner promise N codes and Move deliver none,
   leaving the banner stuck.

**Wrong-if** — a seed reaches a rendered string; a legacy row stays readable-only-
as-secret on disk *without the banner saying so*; a long name still clips; the
banner counts codes Move will not move.

**Constraints**
- A seed is never rendered or logged.
- `parsedIdentity` (`src/components/ScanResult.tsx:24`) is the only parser path;
  it drops the secret by construction.
- `ScanHistory` keeps treating otpauth rows as non-actionable (`!otpauth` gates
  search and copy).
- No new dependencies. Existing tests stay green.

**Out of scope** — custom per-entry names, icons, emoji, vault schema or
migration, an edit UI, a tab-visibility lock, and any change to the
`TwoFactorPanel` save flow.

**Unknowns**
- Where history persistence lives — reducer or component-local. ~60% reducer;
  affects item 4's blast radius only.
- Whether the `qr2fa.historyMigrated` gate (`src/components/ScanHistory.tsx:15`)
  makes item 4 near-dead-code for most users. ~30%; resolved by one read.

**Assumptions**
- "Multiline" means `line-clamp-2` on both lines. 0.9 — if wrong, a class swap.
- The item 4 rewrite is idempotent and runs once, not per render. 0.85.

## Ledger

Open questions with confidence weights.

| Question | Weight | Cost of asking later |
| --- | --- | --- |
| Where does history persistence live? | 1.0 | **Resolved** — `useHistory.ts:22`, `useState` + explicit `saveToStorage` in mutators |
| Does `historyMigrated` make item 4 near-dead? | 1.0 | **Resolved** — no. Banner wired at `App.tsx:716-720`, gate hides the *banner*, rows persist |
| Where is the otpauth identity parsed? | 1.0 | **Resolved** — `parsedIdentity` (`ScanResult.tsx:24`), seed dropped by construction |
| Does Move delete the history row? | 1.0 | **Resolved** — yes, `App.tsx:520-526`, after save only |

None open.

## Decision Log

**Card identity fix** → multiline only → trimming is a CSS defect, and a
persisted displayName/icon is a schema change with migration and edit UI — a
different project → P(outcome: agreed) 0.95.

**Idle timeout** → 60s + add `scroll`/`touchmove` → at 60s a scroll-only user
locks mid-use, which the old listener set never handled → P(agrees) 0.85.

**History row shape** → two lines issuer/account → mirrors the card the user is
already looking at → P(agrees) 0.9.

**Legacy rows** → purge the URI, keep the row → pre-migration rows put the seed
in localStorage; the UI hid it but it sat on disk → P(agrees) 0.8.
**— GRADED WRONG.** Purging at render races `handleMoveOtpauth`: URI deleted
before the user can move it, `otpauthCount` hits 0 so the banner stops appearing,
code never reaches the vault — unrecoverable. Worse, `isValidHistoryItem` forces
the identity into `data`, so `isOtpauth(item.data)` re-parse fails, `canSearchWeb`
flips true and the row becomes web-searchable. Calibration: the "close the leak"
want was right, the mechanism was unexamined; inspect every existing flow a
proposed write path touches before proposing a new one.

**Legacy rows (revised)** → drop the purge, strengthen the banner → Move already
deletes after save (`App.tsx:520-526`), Remove deletes outright (`App.tsx:502-509`)
— the leak closes by the path that already exists → P(agrees) 0.9.

## Resolved Branches

- Card identity → multiline wrap only (high)
- Idle timeout → 60s, activity = pointer + key + scroll + touch (high)
- History row display → two-line issuer/account (high)
- Legacy otpauth rows → no purge; banner copy strengthened (high)
- Move filter bug → `isOtpauthKind`, matches banner count and Remove (high)

## Open Branches

None blocking. Both ledger rows resolve by inspection during implementation.

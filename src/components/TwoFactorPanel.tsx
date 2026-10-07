/**
 * The 2FA tab body: one component for all three vault phases.
 *
 * Security invariants this file owns:
 * - The raw seed (`OtpauthEntry.secret`) and any `otpauth://` URI are never
 *   written to rendered text, aria-labels, titles or data attributes. Entries
 *   render issuer/account plus the short-lived code only; Copy copies the code.
 * - PIN fields are uncontrolled (`ref`s, not React state) and are cleared the
 *   moment a submit reads them, so a PIN value never enters the serialized DOM.
 *   The PIN is passed to `createVault`/`unlockWithPin` and nowhere else.
 * - Clipboard auto-clear is best-effort by design: a denied `readText` still
 *   clears, because a stale code left on the clipboard is the larger risk. The
 *   clear is skipped only when a *successful* read shows the user copied
 *   something else in the meantime.
 *
 * The panel renders no dialogs. Export/import/backup dialogs are the App's, and
 * reach this component through the optional callbacks below; each button is
 * rendered only when its callback is supplied.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from "react";
import type { UseVault } from "../hooks/useVault";
import { canonicalSecret, type OtpauthEntry } from "../utils/otpauth";
import { generateTotp, type TotpResult } from "../utils/totp";
import { defaultWebAuthnPort } from "../utils/webauthn";

export interface TwoFactorPanelProps {
  vault: UseVault;
  /** Memory-only inbound codes awaiting save; never persisted by this panel. */
  pending: { uris: string[]; source: "scan" | "history" } | null;
  onPendingResolved: (result: "saved" | "dismissed") => void;
  /**
   * Parent-amended frozen props (recorded deviation): the App hosts the
   * dialogs, so the panel only raises the intent.
   */
  onImportBackup?: () => void;
  onExport?: () => void;
  onImport?: () => void;
}

/** TEMP (user-requested): force the PIN path in setup so the create-vault user
 *  flow can be verified on devices whose passkey emits no PRF key. Revert by
 *  deleting this constant and the five `!TEMP_PIN_ONLY` guards. */
export const TEMP_PIN_ONLY = true;

const PRIMARY_BUTTON =
  "min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500";
const SECONDARY_BUTTON =
  "min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const GHOST_BUTTON =
  "min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400";
const INPUT =
  "min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
const CARD = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm";
const LABEL = "block text-sm font-medium text-slate-700";
const HINT = "mt-1 text-xs text-slate-500";
const ALERT = "mt-2 text-sm text-rose-600";

/** PIN digits are drawn from this before they can reach the vault. */
const PIN_RE = /^\d{6,8}$/;

const PIN_FIELD_PROPS = {
  type: "password",
  inputMode: "numeric",
  autoComplete: "off",
  maxLength: 8,
  pattern: "[0-9]*",
} as const;

/** "123 456" / "1234 5678" — grouping is display only; Copy uses the raw code. */
function groupCode(code: string): string {
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}

function identity(entry: OtpauthEntry): { issuer: string; account: string } {
  // Deliberately drops `secret`: the returned object is safe to render.
  return { issuer: entry.issuer, account: entry.account };
}

function issuerLabel(entry: OtpauthEntry): string {
  return entry.issuer.trim() === "" ? "Unnamed" : entry.issuer;
}

/** Clears the clipboard only when it still holds `code`, or when the read is
 *  denied (best-effort: a stale code must not survive a denial). */
async function clearClipboardIfOurs(code: string): Promise<void> {
  try {
    const current = await navigator.clipboard.readText();
    if (current !== code) return;
  } catch {
    // Read denied — fall through and clear anyway.
  }
  try {
    await navigator.clipboard.writeText("");
  } catch {
    // Nothing else we can do; clearing is best-effort.
  }
}

export function TwoFactorPanel({
  vault,
  pending,
  onPendingResolved,
  onImportBackup,
  onExport,
  onImport,
}: TwoFactorPanelProps): JSX.Element {
  // "null" means the capability probe has not answered yet.
  const [biometricSupported, setBiometricSupported] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    defaultWebAuthnPort
      .isSupported()
      .then((ok) => {
        if (alive) setBiometricSupported(ok);
      })
      .catch(() => {
        if (alive) setBiometricSupported(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------------------------------------------------------- setup */

  const [alsoPin, setAlsoPin] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createPinRef = useRef<HTMLInputElement>(null);
  const createPinConfirmRef = useRef<HTMLInputElement>(null);
  const [showCreatePin, setShowCreatePin] = useState(false);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  const pinRequired = TEMP_PIN_ONLY || biometricSupported === false || alsoPin;

  const handleCreate = useCallback(async () => {
    setCreateError(null);
    if (pinRequired) {
      const pin = createPinRef.current?.value ?? "";
      const confirm = createPinConfirmRef.current?.value ?? "";
      if (!PIN_RE.test(pin)) {
        setCreateError("PIN must be 6–8 digits.");
        return;
      }
      if (pin !== confirm) {
        setCreateError("PINs do not match.");
        return;
      }
      // Cleared before the await so the value is out of the DOM for the whole
      // vault call; the local `pin` is the only remaining copy.
      if (createPinRef.current) createPinRef.current.value = "";
      if (createPinConfirmRef.current) createPinConfirmRef.current.value = "";
      const result = await vault.createVault({
        mode: TEMP_PIN_ONLY || biometricSupported === false ? "pin" : "prf+pin",
        pin,
      });
      if (!result.ok) setCreateError(result.error);
      return;
    }
    const result = await vault.createVault({ mode: "prf" });
    if (!result.ok) setCreateError(result.error);
  }, [biometricSupported, pinRequired, vault]);

  /* --------------------------------------------------------------- locked */

  const [biometricHidden, setBiometricHidden] = useState(false);
  const [unlockNotice, setUnlockNotice] = useState<string | null>(null);
  const [showUnlockPin, setShowUnlockPin] = useState(false);
  const unlockPinRef = useRef<HTMLInputElement>(null);

  /**
   * Local deadline for the PIN delay. The vault already owns the schedule; this
   * only renders it, recomputed from the value the vault reports and never by
   * re-calling `unlockWithPin` (which would reset the escalation).
   */
  const [delayUntil, setDelayUntil] = useState<number | null>(null);
  const [, setDelayTick] = useState(0);

  useEffect(() => {
    if (vault.retryAfterMs > 0) setDelayUntil(Date.now() + vault.retryAfterMs);
    else setDelayUntil(null);
  }, [vault.retryAfterMs]);

  useEffect(() => {
    if (delayUntil === null) return;
    const id = setInterval(() => setDelayTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [delayUntil]);

  const delayRemainingMs = delayUntil === null ? 0 : Math.max(0, delayUntil - Date.now());
  const delaySeconds = Math.ceil(delayRemainingMs / 1000);

  const handleBiometricUnlock = useCallback(async () => {
    setUnlockNotice(null);
    const result = await vault.unlockWithBiometric();
    if (result.ok) return;
    if (result.reason === "no-biometric-credential") {
      setBiometricHidden(true);
      return;
    }
    if (result.reason === "unavailable") {
      setUnlockNotice("Fingerprint unlock is unavailable right now");
      return;
    }
    setUnlockNotice("This vault could not be read. Restore it from an encrypted backup below.");
  }, [vault]);

  const handlePinUnlock = useCallback(async () => {
    if (delayRemainingMs > 0) return;
    setUnlockNotice(null);
    const pin = unlockPinRef.current?.value ?? "";
    if (!PIN_RE.test(pin)) {
      setUnlockNotice("Enter your 6–8 digit PIN");
      return;
    }
    if (unlockPinRef.current) unlockPinRef.current.value = "";
    const result = await vault.unlockWithPin(pin);
    if (result.ok) return;
    if (result.reason === "wrong-pin") setUnlockNotice("Incorrect PIN");
    else if (result.reason === "corrupt")
      setUnlockNotice("This vault could not be read. Restore it from an encrypted backup below.");
    // "delay": the vault updated retryAfterMs; the effect above drives the UI.
  }, [delayRemainingMs, vault]);

  /* ------------------------------------------------------------- unlocked */

  const [tick, setTick] = useState(0);
  const [rows, setRows] = useState<{ entry: OtpauthEntry; key: string; result: TotpResult }[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    existing: { issuer: string; account: string };
    incoming: { issuer: string; account: string };
  } | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [manualConflict, setManualConflict] = useState<{
    existing: { issuer: string; account: string };
    incoming: { issuer: string; account: string };
  } | null>(null);
  const [offsetDraft, setOffsetDraft] = useState(() => String(vault.clockOffset / 1000));

  const copiedTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const pendingQueueRef = useRef<string[] | null>(null);
  const conflictUriRef = useRef<string | null>(null);
  const manualUriRef = useRef<string | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);
  const manualDetailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setOffsetDraft(String(vault.clockOffset / 1000));
  }, [vault.clockOffset]);

  // One interval drives every row: per-row timers would drift apart and each
  // would be a separate render cascade.
  useEffect(() => {
    if (vault.phase !== "unlocked") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [vault.phase]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
      if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    },
    []
  );

  // `generateTotp` is async (WebCrypto), so codes are computed in an effect and
  // held in state. The 1s `tick` drives both the recompute and the countdown.
  useEffect(() => {
    if (vault.phase !== "unlocked") {
      setRows([]);
      return;
    }
    let alive = true;
    const compute = async () => {
      const timeMs = Date.now() + vault.clockOffset;
      const next = await Promise.all(
        vault.entries.map(async (entry) => ({
          entry,
          // React keys never reach the DOM, so the canonical secret is a safe,
          // stable row identity here.
          key: canonicalSecret(entry.secret),
          result: await generateTotp({
            secret: entry.secret,
            algorithm: entry.algorithm,
            digits: entry.digits,
            period: entry.period,
            timeMs,
          }),
        }))
      );
      if (alive) setRows(next);
    };
    void compute();
    return () => {
      alive = false;
    };
  }, [vault.entries, vault.clockOffset, vault.phase, tick]);

  const handleCopy = useCallback(async (key: string, code: string, stepEndsAtMs: number) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard writes can be denied; the row still shows "Copied" feedback
      // only on success below, so a failure leaves the label unchanged.
      return;
    }
    setCopiedKey(key);
    if (copiedTimerRef.current !== null) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1500);
    if (clearTimerRef.current !== null) clearTimeout(clearTimerRef.current);
    const remaining = Math.max(0, stepEndsAtMs - Date.now());
    clearTimerRef.current = window.setTimeout(() => {
      void clearClipboardIfOurs(code);
    }, remaining);
  }, []);

  const handleRemove = useCallback(
    async (entry: OtpauthEntry) => {
      await vault.removeEntry(canonicalSecret(entry.secret));
      setConfirmKey(null);
    },
    [vault]
  );

  /** Saves URIs in order; stops at the first conflict so the user can decide. */
  const runSaveQueue = useCallback(
    async (queue: string[]) => {
      const warnings: string[] = [];
      for (let i = 0; i < queue.length; i += 1) {
        const uri = queue[i];
        const result = await vault.saveEntry(uri);
        if (result.ok) {
          if (result.warning !== undefined) warnings.push(result.warning);
          continue;
        }
        if (result.conflict) {
          conflictUriRef.current = uri;
          pendingQueueRef.current = queue.slice(i + 1);
          setPendingConflict({
            existing: identity(result.conflict.existing),
            incoming: identity(result.conflict.incoming),
          });
          setPendingSaving(false);
          return;
        }
        // Non-conflict failure: vault.error carries the message; stop the run.
        pendingQueueRef.current = null;
        setPendingSaving(false);
        return;
      }
      pendingQueueRef.current = null;
      setPendingSaving(false);
      setSaveWarning(warnings.length > 0 ? [...new Set(warnings)].join(" ") : null);
      onPendingResolved("saved");
    },
    [onPendingResolved, vault]
  );

  const resolvePendingConflict = useCallback(
    async (replace: boolean) => {
      const uri = conflictUriRef.current;
      const rest = pendingQueueRef.current ?? [];
      conflictUriRef.current = null;
      pendingQueueRef.current = null;
      setPendingConflict(null);
      setPendingSaving(true);
      if (replace && uri !== null) await vault.saveEntry(uri, { replace: true });
      if (rest.length > 0) {
        await runSaveQueue(rest);
        return;
      }
      setPendingSaving(false);
      onPendingResolved("saved");
    },
    [onPendingResolved, runSaveQueue, vault]
  );

  const handleManualSave = useCallback(
    async (replace: boolean) => {
      setManualError(null);
      const rawUri = replace ? manualUriRef.current : manualInputRef.current?.value ?? "";
      const uri = rawUri ?? "";
      if (uri.trim() === "") {
        setManualError("Paste an otpauth:// link first.");
        return;
      }
      const result = await vault.saveEntry(uri, replace ? { replace: true } : undefined);
      if (result.ok) {
        manualUriRef.current = null;
        setManualConflict(null);
        if (manualInputRef.current) manualInputRef.current.value = "";
        if (manualDetailsRef.current) manualDetailsRef.current.open = false;
        return;
      }
      if (result.conflict) {
        manualUriRef.current = uri;
        setManualConflict({
          existing: identity(result.conflict.existing),
          incoming: identity(result.conflict.incoming),
        });
        return;
      }
      setManualError(result.error);
    },
    [vault]
  );

  /* ----------------------------------------------------------------- views */

  if (vault.phase === "setup") {
    const pendingNote =
      pending !== null && pending.uris.length > 0
        ? `${pending.uris.length} code${pending.uris.length === 1 ? "" : "s"} ready to save`
        : null;
    const creating = vault.busy === "creating";
    const submitDisabled =
      creating ||
      biometricSupported === null ||
      (!TEMP_PIN_ONLY && biometricSupported === true && !alsoPin && !acknowledged);

    return (
      <section id="panel-2fa" className={CARD} aria-labelledby="twofactor-setup-title">
        <h2 id="twofactor-setup-title" className="text-lg font-semibold text-slate-900">
          2FA codes
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Your authenticator codes are encrypted on this device and never leave it. Set up an unlock
          key to protect them.
        </p>
        {pendingNote && (
          <p className="mt-2 text-sm font-medium text-indigo-700" role="status">
            {pendingNote}
          </p>
        )}

        {biometricSupported === null && (
          <p className="mt-3 text-sm text-slate-500" role="status">
            Checking fingerprint support…
          </p>
        )}

        {/* TEMP: PIN-only setup, to verify the create-vault user flow. */}
        {TEMP_PIN_ONLY && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">
              Your PIN is the only key on this device.
            </p>
            <PinCreateFields
              pinRef={createPinRef}
              confirmRef={createPinConfirmRef}
              visible={showCreatePin}
              onToggleVisible={() => setShowCreatePin((v) => !v)}
            />
          </div>
        )}

        {!TEMP_PIN_ONLY && biometricSupported === true && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">Fingerprint unlock is available on this device.</p>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={alsoPin}
                onChange={(e) => setAlsoPin(e.target.checked)}
              />
              <span>
                Also unlock with a PIN (weaker than fingerprint — a PIN can be guessed off your
                screen)
              </span>
            </label>
            {!alsoPin && (
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  I understand: if I lose access to my fingerprint, only an encrypted backup can
                  restore my codes.
                </span>
              </label>
            )}
            {alsoPin && (
              <PinCreateFields
                pinRef={createPinRef}
                confirmRef={createPinConfirmRef}
                visible={showCreatePin}
                onToggleVisible={() => setShowCreatePin((v) => !v)}
              />
            )}
          </div>
        )}

        {!TEMP_PIN_ONLY && biometricSupported === false && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-700">
              This device has no fingerprint unlock — your PIN is the only key.
            </p>
            <PinCreateFields
              pinRef={createPinRef}
              confirmRef={createPinConfirmRef}
              visible={showCreatePin}
              onToggleVisible={() => setShowCreatePin((v) => !v)}
            />
          </div>
        )}

        <button
          type="button"
          className={`${PRIMARY_BUTTON} mt-4`}
          onClick={() => void handleCreate()}
          disabled={submitDisabled}
        >
          {creating ? "Creating…" : "Create vault"}
        </button>
        {creating && (
          <span className="ml-3 text-sm text-slate-500" role="status">
            Creating…
          </span>
        )}
        {createError && (
          <p className={ALERT} role="alert">
            {createError}
          </p>
        )}
      </section>
    );
  }

  if (vault.phase === "locked") {
    const unlocking = vault.busy === "unlocking";
    const delayActive = delayRemainingMs > 0;
    return (
      <section id="panel-2fa" className={CARD} aria-labelledby="twofactor-locked-title">
        <h2 id="twofactor-locked-title" className="text-lg font-semibold text-slate-900">
          2FA codes
        </h2>
        <p className="mt-1 text-sm text-slate-600">Unlock to see your codes.</p>

        {vault.prfRegistered && !biometricHidden && (
          <button
            type="button"
            className={`${PRIMARY_BUTTON} mt-4 w-full`}
            onClick={() => void handleBiometricUnlock()}
            disabled={unlocking}
          >
            Unlock with fingerprint
          </button>
        )}

        {unlocking && (
          <p className="mt-2 text-sm text-slate-500" role="status">
            Unlocking…
          </p>
        )}

        {vault.hasPin && (
          <div className="mt-4 space-y-2">
            <label className={LABEL} htmlFor="twofactor-unlock-pin">
              PIN
            </label>
            <div className="flex items-center gap-2">
              <input
                {...PIN_FIELD_PROPS}
                id="twofactor-unlock-pin"
                aria-label="PIN"
                ref={unlockPinRef}
                type={showUnlockPin ? "text" : "password"}
                className={INPUT}
              />
              <button
                type="button"
                className={GHOST_BUTTON}
                onClick={() => setShowUnlockPin((v) => !v)}
                aria-pressed={showUnlockPin}
              >
                {showUnlockPin ? "Hide" : "Show"}
              </button>
            </div>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              onClick={() => void handlePinUnlock()}
              disabled={unlocking || delayActive}
            >
              Unlock
            </button>
            {delayActive && (
              <p className="text-sm text-slate-600" role="status">
                Too many attempts. Try again in {delaySeconds}s.
              </p>
            )}
          </div>
        )}

        {unlockNotice && (
          <p className={ALERT} role="alert">
            {unlockNotice}
          </p>
        )}

        {!vault.prfRegistered && !vault.hasPin && (
          <p className="mt-4 text-sm text-slate-600">
            This vault has no unlock method available on this device. Restore it from an encrypted
            backup.
          </p>
        )}

        {onImportBackup && (
          <button type="button" className={`${SECONDARY_BUTTON} mt-4`} onClick={onImportBackup}>
            Import backup
          </button>
        )}
      </section>
    );
  }

  /* unlocked */
  const savingPending = pendingSaving || vault.busy === "saving";
  const exporting = vault.busy === "exporting";
  const importing = vault.busy === "importing";
  const empty = rows.length === 0;
  const shiftedNow = Date.now() + vault.clockOffset;

  return (
    <section id="panel-2fa" className={CARD} aria-labelledby="twofactor-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="twofactor-title" className="text-lg font-semibold text-slate-900">
          2FA
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {onExport && (
            <button type="button" className={SECONDARY_BUTTON} onClick={onExport} disabled={exporting}>
              Export
            </button>
          )}
          {onImport && (
            <button type="button" className={SECONDARY_BUTTON} onClick={onImport} disabled={importing}>
              Import
            </button>
          )}
          <button type="button" className={SECONDARY_BUTTON} onClick={() => vault.lock()}>
            Lock
          </button>
        </div>
      </div>

      {exporting && (
        <p className="mt-2 text-sm text-slate-500" role="status">
          Exporting…
        </p>
      )}
      {importing && (
        <p className="mt-2 text-sm text-slate-500" role="status">
          Importing…
        </p>
      )}

      {vault.clockSkew && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="status">
          <p className="text-sm text-amber-900">Device clock changed — codes may be wrong.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-sm font-medium text-amber-900" htmlFor="twofactor-clock-offset">
              Clock offset
            </label>
            <button
              type="button"
              className={GHOST_BUTTON}
              aria-label="Decrease clock offset by one second"
              onClick={() => vault.setClockOffset(vault.clockOffset - 1000)}
            >
              −
            </button>
            <input
              id="twofactor-clock-offset"
              aria-label="Clock offset in seconds"
              type="number"
              step="1"
              className={`${INPUT} w-24`}
              value={offsetDraft}
              onChange={(e) => {
                setOffsetDraft(e.target.value);
                const seconds = Number(e.target.value);
                if (Number.isFinite(seconds)) vault.setClockOffset(Math.round(seconds * 1000));
              }}
            />
            <button
              type="button"
              className={GHOST_BUTTON}
              aria-label="Increase clock offset by one second"
              onClick={() => vault.setClockOffset(vault.clockOffset + 1000)}
            >
              +
            </button>
            {vault.clockOffset !== 0 && (
              <span className="text-sm text-amber-900">
                Current offset {vault.clockOffset / 1000}s
                <button
                  type="button"
                  className={`${GHOST_BUTTON} ml-1`}
                  onClick={() => vault.setClockOffset(0)}
                >
                  Reset
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {!vault.clockSkew && vault.clockOffset !== 0 && (
        <p className="mt-3 text-sm text-slate-600">
          Clock offset {vault.clockOffset / 1000}s
          <button type="button" className={`${GHOST_BUTTON} ml-1`} onClick={() => vault.setClockOffset(0)}>
            Reset
          </button>
        </p>
      )}

      {pending !== null && pending.uris.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-sm font-medium text-indigo-900">
            {pending.uris.length} authenticator code{pending.uris.length === 1 ? "" : "s"} ready
          </p>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            onClick={() => {
              pendingQueueRef.current = pending.uris;
              setPendingSaving(true);
              void runSaveQueue(pending.uris);
            }}
            disabled={savingPending}
          >
            Save
          </button>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => onPendingResolved("dismissed")}>
            Dismiss
          </button>
        </div>
      )}

      {savingPending && (
        <p className="mt-2 text-sm text-slate-500" role="status">
          Saving…
        </p>
      )}

      {pendingConflict && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" role="alert">
          <p className="text-sm text-amber-900">
            {pendingConflict.incoming.issuer || "Unnamed"} (
            {pendingConflict.incoming.account || "no account"}) already exists with a different
            secret — Replace or Skip?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              onClick={() => void resolvePendingConflict(true)}
            >
              Replace
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => void resolvePendingConflict(false)}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {vault.error && (
        <p className={ALERT} role="alert">
          {vault.error}
        </p>
      )}

      {saveWarning && (
        <p className="mt-3 text-sm text-amber-700" role="status">
          {saveWarning}
        </p>
      )}

      {empty ? (
        <p className="mt-4 text-sm text-slate-600">No codes yet — scan a QR code to add one</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {rows.map(({ entry, key, result }) => {
            const code = result.ok ? result.code : null;
            const remainingSeconds = result.ok
              ? Math.max(0, Math.ceil((result.stepEndsAtMs - shiftedNow) / 1000))
              : 0;
            const fraction = result.ok
              ? Math.min(100, (remainingSeconds / entry.period) * 100)
              : 0;
            const isCopied = copiedKey === key;
            return (
              <li key={key} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium text-slate-900">{issuerLabel(entry)}</p>
                  {entry.account.trim() !== "" && (
                    <p className="break-words text-xs text-slate-500">{entry.account}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg tracking-wider text-slate-900" aria-live="off">
                    {code === null ? "—" : groupCode(code)}
                  </p>
                  <p className="text-xs text-slate-500" aria-live="off" aria-hidden="true">
                    {remainingSeconds}s
                  </p>
                  <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                    <div className="h-full bg-indigo-500" style={{ width: `${fraction}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    aria-label={`Copy code for ${issuerLabel(entry)}`}
                    onClick={() => {
                      if (code !== null && result.ok)
                        void handleCopy(key, code, result.stepEndsAtMs);
                    }}
                    disabled={code === null}
                  >
                    {isCopied ? "Copied" : "Copy"}
                  </button>
                  {confirmKey === key ? (
                    <span className="flex items-center gap-1">
                      <span className="text-sm text-slate-600">Delete this code?</span>
                      <button
                        type="button"
                        className={PRIMARY_BUTTON}
                        onClick={() => void handleRemove(entry)}
                      >
                        Yes, delete
                      </button>
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        onClick={() => setConfirmKey(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={GHOST_BUTTON}
                      aria-label={`Delete code for ${issuerLabel(entry)}`}
                      onClick={() => setConfirmKey(key)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <details ref={manualDetailsRef} className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-slate-600">Add manually</summary>
        <div className="mt-2 space-y-2">
          <label className={LABEL} htmlFor="twofactor-manual-uri">
            otpauth:// link
          </label>
          {/* Uncontrolled: a typed seed must not enter the serialized DOM. */}
          <input
            id="twofactor-manual-uri"
            aria-label="otpauth link"
            type="text"
            autoComplete="off"
            spellCheck={false}
            ref={manualInputRef}
            className={INPUT}
          />
          <button type="button" className={SECONDARY_BUTTON} onClick={() => void handleManualSave(false)}>
            Add code
          </button>
          {manualError && (
            <p className={ALERT} role="alert">
              {manualError}
            </p>
          )}
          {manualConflict && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" role="alert">
              <p className="text-sm text-amber-900">
                {manualConflict.incoming.issuer || "Unnamed"} (
                {manualConflict.incoming.account || "no account"}) already exists with a different
                secret — Replace or Skip?
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  onClick={() => void handleManualSave(true)}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  onClick={() => {
                    manualUriRef.current = null;
                    setManualConflict(null);
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

type PinCreateFieldsProps = {
  pinRef: RefObject<HTMLInputElement | null>;
  confirmRef: RefObject<HTMLInputElement | null>;
  visible: boolean;
  onToggleVisible: () => void;
};

/** Create-mode PIN pair. Uncontrolled on purpose: see the file header. */
function PinCreateFields({ pinRef, confirmRef, visible, onToggleVisible }: PinCreateFieldsProps): JSX.Element {
  return (
    <div className="space-y-2">
      <label className={LABEL} htmlFor="twofactor-create-pin">
        Create PIN (6–8 digits)
      </label>
      <div className="flex items-center gap-2">
        <input
          {...PIN_FIELD_PROPS}
          id="twofactor-create-pin"
          aria-label="Create PIN"
          ref={pinRef}
          type={visible ? "text" : "password"}
          className={INPUT}
        />
        <button type="button" className={GHOST_BUTTON} onClick={onToggleVisible} aria-pressed={visible}>
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <label className={LABEL} htmlFor="twofactor-confirm-pin">
        Confirm PIN
      </label>
      <input
        {...PIN_FIELD_PROPS}
        id="twofactor-confirm-pin"
        aria-label="Confirm PIN"
        ref={confirmRef}
        type={visible ? "text" : "password"}
        className={INPUT}
      />
      <p className={HINT}>Digits only. Nothing else can recover your codes if you forget this PIN.</p>
    </div>
  );
}

export default TwoFactorPanel;

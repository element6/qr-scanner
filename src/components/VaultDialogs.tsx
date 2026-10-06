/**
 * Export and import dialogs for the local 2FA vault.
 *
 * Both are thin, dumb front ends over `useVault`: they own form state, validate
 * what a form can validate (length, confirmation, digits), and hand raw bytes
 * to the hook. No cryptography, no parsing and no merge logic lives here — the
 * hook and `exportFormat.ts` already own those and are frozen.
 *
 * The one rule this file exists to keep: nothing that identifies a secret
 * reaches the DOM. Only `issuer · account` is ever rendered for an entry, and
 * password/PIN values live exclusively in controlled `<input value>` props,
 * which never appear in `innerHTML` or `textContent`.
 *
 * The dialog shell (overlay, `role="dialog"`, focus trap, Escape, focus
 * restore) mirrors `ClearConfirmModal.tsx`, which is the repo's established
 * modal pattern.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
  type ReactNode,
} from "react";
import type { UseVault } from "../hooks/useVault";
import {
  EXPORT_PASSWORD_MIN,
  type ConflictChoice,
  type MergePlan,
} from "../utils/exportFormat";
import { downloadBlob } from "../utils/qrExport";
import { defaultWebAuthnPort } from "../utils/webauthn";

/* ------------------------------------------------------------------ shared */

/** Focusable descendants, in DOM order; matches `ClearConfirmModal`. */
const FOCUSABLE_SELECTOR = "button, [href], input, select, textarea";

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500";

const LABEL_CLASS = "mb-1 block text-sm font-semibold text-slate-700";

const PRIMARY_BUTTON =
  "min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500";

const SECONDARY_BUTTON =
  "min-h-11 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500";

/** Password inputs are capped so a paste-bomb cannot wedge the KDF. */
const PASSWORD_MAX_LENGTH = 128;

type DialogShellProps = {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Overlay + focus contract shared by both dialogs. `inert` is not toggled here
 * (the App owns the background); the trap below is what keeps Tab inside.
 */
function DialogShell({ titleId, title, onClose, children }: DialogShellProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Captured before focus moves, so it is genuinely the opener.
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    return () => {
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (active === null || !root.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-800">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

/** Inline error, announced. Always `role="alert"` so it is spoken when it appears. */
function ErrorAlert({ message }: { message: string | null }): JSX.Element | null {
  if (message === null) return null;
  return (
    <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

/** Always mounted, so a screen reader announces the change rather than a new node. */
function BusyStatus({ busy, label }: { busy: boolean; label: string }): JSX.Element {
  return (
    <p role="status" className="mt-2 min-h-5 text-sm text-slate-500">
      {busy ? label : ""}
    </p>
  );
}

/**
 * Unambiguous alphabet: no `i`, `l`, `o`, `0`, `1`, so a hand-copied password
 * survives. 31 characters is deliberately not a divisor of 256 — the rejection
 * loop below removes the modulo bias instead of pretending it does not exist.
 */
const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

const GENERATED_GROUPS = 4;
const GENERATED_GROUP_LENGTH = 5;

/** ~20 base-31 characters (~99 bits) formatted as `xxxxx-xxxxx-xxxxx-xxxxx`. */
function generateStrongPassword(): string {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  const chars: string[] = [];
  const total = GENERATED_GROUPS * GENERATED_GROUP_LENGTH;
  while (chars.length < total) {
    const bytes = new Uint8Array(total - chars.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      chars.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]);
      if (chars.length === total) break;
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += GENERATED_GROUP_LENGTH) {
    groups.push(chars.slice(i, i + GENERATED_GROUP_LENGTH).join(""));
  }
  return groups.join("-");
}

/** Local calendar date — the download name should match the user's clock, not UTC. */
function localDateStamp(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function exportFilename(now?: Date): string {
  return `qr-scanner-2fa-${localDateStamp(now)}.qr2fa.json`;
}

/**
 * `Blob.text()` is the modern path; the FileReader branch keeps the dialog
 * working on the older jsdom/WebView combinations the repo still targets.
 */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsText(file);
  });
}

/* ------------------------------------------------------------------ export */

export type ExportDialogProps = {
  vault: UseVault;
  onClose: () => void;
};

/**
 * `vault` must be unlocked — App only opens this dialog in that phase, so the
 * dialog does not re-check and cannot leak a "locked" export path.
 */
export function ExportDialog({ vault, onClose }: ExportDialogProps): JSX.Element {
  const titleId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const revealId = useId();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const busy = vault.busy !== null;

  const onGenerate = useCallback(() => {
    const fresh = generateStrongPassword();
    setPassword(fresh);
    setConfirm(fresh);
    setGenerated(fresh);
    setCopied(false);
    setError(null);
  }, []);

  const onCopy = useCallback(async () => {
    if (generated === null) return;
    try {
      await navigator.clipboard?.writeText(generated);
      setCopied(true);
    } catch {
      // Clipboard permission denied: the box is selectable, so say nothing and
      // leave the user a manual path rather than a second failure message.
      setCopied(false);
    }
  }, [generated]);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      setError(null);
      if (password.length < EXPORT_PASSWORD_MIN) {
        setError(`Use at least ${EXPORT_PASSWORD_MIN} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("The two passwords do not match.");
        return;
      }
      const result = await vault.exportVault(password);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      downloadBlob(new Blob([result.json], { type: "application/json" }), exportFilename());
      // The generated password is revealed once; the download is that once.
      setGenerated(null);
      setDownloaded(true);
    },
    [busy, confirm, password, vault]
  );

  const inputType = showPasswords ? "text" : "password";

  return (
    <DialogShell titleId={titleId} title="Export vault" onClose={onClose}>
      {downloaded ? (
        <div className="space-y-4">
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Downloaded. Keep the file and its password somewhere safe — without
            both, the backup cannot be restored.
          </p>
          <button type="button" className={PRIMARY_BUTTON} onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <p className="text-sm text-slate-600">
            The file is encrypted with this password. It is the only way back in.
          </p>

          <div className="mt-4">
            <label className={LABEL_CLASS} htmlFor={passwordId}>
              Export password
            </label>
            <input
              id={passwordId}
              className={INPUT_CLASS}
              type={inputType}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className="mt-3">
            <label className={LABEL_CLASS} htmlFor={confirmId}>
              Confirm password
            </label>
            <input
              id={confirmId}
              className={INPUT_CLASS}
              type={inputType}
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
            />
            Show passwords
          </label>

          <button type="button" className={`${SECONDARY_BUTTON} mt-4`} onClick={onGenerate}>
            Generate strong password
          </button>

          {generated !== null ? (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <label className="mb-1 block text-xs font-semibold text-amber-900" htmlFor={revealId}>
                Your generated password — shown once
              </label>
              <div className="flex gap-2">
                {/* A `value` prop, never children: the password must not be text in the DOM. */}
                <input
                  id={revealId}
                  className={`${INPUT_CLASS} font-mono`}
                  type="text"
                  readOnly
                  value={generated}
                  onFocus={(e) => e.target.select()}
                />
                <button type="button" className={SECONDARY_BUTTON} onClick={onCopy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-900">
                Save this somewhere safe — it cannot be recovered.
              </p>
            </div>
          ) : null}

          <p className="mt-4 text-xs text-slate-500">
            A short password can be guessed offline. Use the generated password
            or another long passphrase.
          </p>

          <ErrorAlert message={error} />
          <BusyStatus busy={busy} label="Encrypting your backup…" />

          <div className="mt-5 flex gap-3">
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
              Export and download
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

/* ------------------------------------------------------------------ import */

export type ImportDialogProps = {
  vault: UseVault;
  mode: "locked" | "unlocked";
  onClose: () => void;
};

type ImportCounts = { added: number; replaced: number; duplicates: number };

const CHOICE_MEANINGS: Record<ConflictChoice, string> = {
  skip: "Leave your vault entry as it is.",
  replace: "Overwrite your entry with the incoming one.",
  "keep-both": "Add the incoming entry alongside yours.",
};

const CHOICE_LABELS: Record<ConflictChoice, string> = {
  skip: "Skip",
  replace: "Replace",
  "keep-both": "Keep both",
};

const CHOICE_ORDER: ConflictChoice[] = ["skip", "replace", "keep-both"];

const PIN_MIN = 6;
const PIN_MAX = 8;
const PIN_PATTERN = /^\d{6,8}$/;

/** Issuer and account only — never the secret, never the URI. */
function entryLabel(entry: { issuer: string; account: string }): string {
  if (entry.issuer.length === 0) return entry.account;
  return `${entry.issuer} · ${entry.account}`;
}

export function ImportDialog({ vault, mode, onClose }: ImportDialogProps): JSX.Element {
  const titleId = useId();
  const fileId = useId();
  const passwordId = useId();
  const pinId = useId();
  const pinConfirmId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [json, setJson] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [choices, setChoices] = useState<ConflictChoice[]>([]);
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [restored, setRestored] = useState(false);

  const [credentialMode, setCredentialMode] = useState<"pin" | "prf">("pin");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [prfSupported, setPrfSupported] = useState(false);

  const busy = vault.busy !== null;

  // Probed once, asynchronously: the fingerprint radio must not appear on a
  // device that cannot honour it.
  useEffect(() => {
    let alive = true;
    defaultWebAuthnPort
      .isSupported()
      .then((supported) => {
        if (alive) setPrfSupported(supported);
      })
      .catch(() => {
        if (alive) setPrfSupported(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const onPickFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    setError(null);
    setPlan(null);
    setCounts(null);
    setRestored(false);
    setFile(picked);
    setJson(null);
    if (picked === null) return;
    try {
      const text = await readFileText(picked);
      if (text.trim().length === 0) {
        setError("That file is empty.");
        return;
      }
      setJson(text);
    } catch {
      setError("Could not read that file.");
    }
  }, []);

  const submitUnlocked = useCallback(
    async (nextChoices: ConflictChoice[] | undefined) => {
      if (json === null) {
        setError("Choose a backup file first.");
        return;
      }
      if (password.length < EXPORT_PASSWORD_MIN) {
        setError(`Use the export password — at least ${EXPORT_PASSWORD_MIN} characters.`);
        return;
      }
      setError(null);
      const result = await vault.importUnlocked(json, password, nextChoices);
      if (!result.ok) {
        // A merge plan is a question, not a failure: render the conflicts and
        // keep the file and password exactly as they are.
        if (result.needsChoices) {
          setPlan(result.needsChoices);
          setChoices(result.needsChoices.conflicts.map(() => "skip"));
          return;
        }
        setError(result.error);
        return;
      }
      setPlan(null);
      setCounts({
        added: result.added,
        replaced: result.replaced,
        duplicates: result.duplicates,
      });
    },
    [json, password, vault]
  );

  const submitLocked = useCallback(async () => {
    if (json === null) {
      setError("Choose a backup file first.");
      return;
    }
    if (password.length < EXPORT_PASSWORD_MIN) {
      setError(`Use the export password — at least ${EXPORT_PASSWORD_MIN} characters.`);
      return;
    }
    if (credentialMode === "pin") {
      if (!PIN_PATTERN.test(pin)) {
        setError(`Choose a PIN of ${PIN_MIN}–${PIN_MAX} digits.`);
        return;
      }
      if (pin !== pinConfirm) {
        setError("The two PINs do not match.");
        return;
      }
    }
    setError(null);
    const credential =
      credentialMode === "pin" ? ({ mode: "pin", pin } as const) : ({ mode: "prf" } as const);
    const result = await vault.importLocked(json, password, credential);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRestored(true);
  }, [credentialMode, json, password, pin, pinConfirm, vault]);

  const onFormSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      if (mode === "locked") void submitLocked();
      else void submitUnlocked(undefined);
    },
    [busy, mode, submitLocked, submitUnlocked]
  );

  const title = mode === "locked" ? "Restore locked backup" : "Import backup";

  if (mode === "unlocked" && plan !== null) {
    return (
      <DialogShell titleId={titleId} title="Resolve conflicts" onClose={onClose}>
        <p className="text-sm text-slate-600">
          {plan.conflicts.length} entr{plan.conflicts.length === 1 ? "y" : "ies"} already
          exist in your vault. Choose what happens to each one.
        </p>

        <ul className="mt-4 space-y-4">
          {plan.conflicts.map((conflict, index) => (
            <li
              key={`${conflict.incoming.issuer}\u0000${conflict.incoming.account}\u0000${index}`}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <p className="text-sm text-slate-800">
                <span className="font-semibold">Existing:</span> {entryLabel(conflict.existing)}
              </p>
              <p className="text-sm text-slate-800">
                <span className="font-semibold">Incoming:</span> {entryLabel(conflict.incoming)}
              </p>
              {conflict.kind === "case-variant" ? (
                <p className="mt-1 text-xs text-slate-500">These differ only by letter case.</p>
              ) : null}
              <fieldset className="mt-2">
                <legend className="sr-only">
                  Conflict {index + 1}: {entryLabel(conflict.incoming)}
                </legend>
                <div className="space-y-1">
                  {CHOICE_ORDER.map((choice) => (
                    <label key={choice} className="flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`conflict-${index}`}
                        value={choice}
                        checked={choices[index] === choice}
                        onChange={() =>
                          setChoices((prev) => {
                            const next = [...prev];
                            next[index] = choice;
                            return next;
                          })
                        }
                      />
                      <span>
                        <span className="font-medium">{CHOICE_LABELS[choice]}</span>
                        <span className="block text-xs text-slate-500">{CHOICE_MEANINGS[choice]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          ))}
        </ul>

        <ErrorAlert message={error} />
        <BusyStatus busy={busy} label="Importing…" />

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={() => {
              setPlan(null);
              setError(null);
            }}
          >
            Back
          </button>
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={busy}
            onClick={() => void submitUnlocked(choices)}
          >
            Confirm import
          </button>
        </div>
      </DialogShell>
    );
  }

  const succeeded = mode === "locked" ? restored : counts !== null;

  return (
    <DialogShell titleId={titleId} title={title} onClose={onClose}>
      {succeeded ? (
        <div className="space-y-4">
          {mode === "locked" ? (
            <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Backup restored. Unlock with your new credential.
            </p>
          ) : (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <p className="font-semibold">Import complete.</p>
              <p className="mt-1">
                {counts?.added ?? 0} added · {counts?.replaced ?? 0} replaced ·{" "}
                {counts?.duplicates ?? 0} already present (skipped)
              </p>
            </div>
          )}
          <button type="button" className={PRIMARY_BUTTON} onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={onFormSubmit} noValidate>
          <div>
            <label className={LABEL_CLASS} htmlFor={fileId}>
              Backup file
            </label>
            <input
              id={fileId}
              className={INPUT_CLASS}
              type="file"
              accept=".json,.qr2fa.json,application/json"
              onChange={onPickFile}
            />
          </div>

          <div className="mt-3">
            <label className={LABEL_CLASS} htmlFor={passwordId}>
              Export password
            </label>
            <input
              id={passwordId}
              className={INPUT_CLASS}
              type="password"
              autoComplete="off"
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === "locked" ? (
            <fieldset className="mt-4 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-semibold text-slate-700">
                New unlock credential
              </legend>
              <p className="text-xs text-slate-500">
                Your old lock is replaced only after the backup is verified.
              </p>

              <div className="mt-3 space-y-1">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="credential-mode"
                    checked={credentialMode === "pin"}
                    onChange={() => setCredentialMode("pin")}
                  />
                  Set a PIN
                </label>
                {prfSupported ? (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="credential-mode"
                      checked={credentialMode === "prf"}
                      onChange={() => setCredentialMode("prf")}
                    />
                    Use fingerprint
                  </label>
                ) : null}
              </div>

              {credentialMode === "pin" ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className={LABEL_CLASS} htmlFor={pinId}>
                      New PIN ({PIN_MIN}–{PIN_MAX} digits)
                    </label>
                    <input
                      id={pinId}
                      className={INPUT_CLASS}
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={PIN_MAX}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLASS} htmlFor={pinConfirmId}>
                      Confirm PIN
                    </label>
                    <input
                      id={pinConfirmId}
                      className={INPUT_CLASS}
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={PIN_MAX}
                      value={pinConfirm}
                      onChange={(e) => setPinConfirm(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">
                  You will be asked for your fingerprint when you confirm.
                </p>
              )}
            </fieldset>
          ) : null}

          <ErrorAlert message={error} />
          <BusyStatus busy={busy} label="Restoring your backup…" />

          <div className="mt-5 flex gap-3">
            <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
              {mode === "locked" ? "Restore backup" : "Import"}
            </button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}

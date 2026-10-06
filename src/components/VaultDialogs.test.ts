/**
 * Render-level tests for the vault export/import dialogs.
 *
 * The boundary these tests protect is the same one `ScanResult.test.ts`
 * protects: no secret may reach the DOM. Entry identity is `issuer · account`
 * and nothing else, and password/PIN values must not survive as text in
 * `innerHTML` or `textContent`.
 *
 * Written without JSX and without @testing-library/react, matching
 * `ScanResult.test.ts`: the vitest include is `src/**\/*.test.ts` and neither is
 * a declared dependency.
 */

import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog, ImportDialog } from "./VaultDialogs";
import type { UseVault } from "../hooks/useVault";
import type { MergePlan } from "../utils/exportFormat";
import type { OtpauthEntry } from "../utils/otpauth";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Hoisted so `vi.mock` (which is lifted above imports) can close over it. */
const { isSupportedMock } = vi.hoisted(() => ({
  isSupportedMock: vi.fn(async () => true),
}));

vi.mock("../utils/webauthn", () => ({
  defaultWebAuthnPort: { isSupported: isSupportedMock },
}));

const SECRET = "JBSWY3DPCEHPX3ZX";
const EXPORT_PASSWORD = "correct horse battery staple";
const BACKUP_JSON = JSON.stringify({ format: "qr-scanner-2fa-export", version: 1 });

function entry(issuer: string, account: string): OtpauthEntry {
  return { issuer, account, secret: SECRET, algorithm: "SHA1", digits: 6, period: 30 };
}

function makeVault(overrides: Partial<UseVault> = {}): UseVault {
  return {
    phase: "unlocked",
    busy: null,
    error: null,
    entries: [],
    hasPin: false,
    prfRegistered: false,
    clockOffset: 0,
    clockSkew: false,
    retryAfterMs: 0,
    unlockWithPin: vi.fn(async () => ({ ok: true as const })),
    unlockWithBiometric: vi.fn(async () => ({ ok: true as const })),
    lock: vi.fn(),
    createVault: vi.fn(async () => ({ ok: true as const })),
    saveEntry: vi.fn(async () => ({ ok: true as const, outcome: "added" as const })),
    removeEntry: vi.fn(async () => ({ ok: true })),
    exportVault: vi.fn(async () => ({ ok: true as const, json: BACKUP_JSON })),
    importUnlocked: vi.fn(async () => ({ ok: true as const, added: 0, replaced: 0, duplicates: 0 })),
    importLocked: vi.fn(async () => ({ ok: true as const })),
    setClockOffset: vi.fn(),
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let downloads: string[];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  isSupportedMock.mockReset();
  isSupportedMock.mockResolvedValue(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  downloads = [];

  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock-export"),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    downloads.push(this.download);
  });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/* --------------------------------------------------------------- test utils */

async function mount(element: ReactElement): Promise<void> {
  await act(async () => {
    root.render(element);
  });
}

/** Flush pending microtasks (file reads, promise-returning hook calls). */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function inputByLabel(labelText: string): HTMLInputElement {
  const found = tryInputByLabel(labelText);
  if (found === null) throw new Error(`no input labelled "${labelText}"`);
  return found;
}

function tryInputByLabel(labelText: string): HTMLInputElement | null {
  for (const label of Array.from(container.querySelectorAll("label"))) {
    if ((label.textContent ?? "").trim().startsWith(labelText)) {
      const id = label.getAttribute("for");
      if (id !== null) {
        const byId = container.querySelector<HTMLInputElement>(`[id="${id}"]`);
        if (byId !== null) return byId;
      }
      const nested = label.querySelector<HTMLInputElement>("input");
      if (nested !== null) return nested;
    }
  }
  return null;
}

function buttonByText(text: string): HTMLButtonElement {
  for (const button of Array.from(container.querySelectorAll("button"))) {
    if ((button.textContent ?? "").trim() === text) return button;
  }
  throw new Error(`no button "${text}"`);
}

function tryButtonByText(text: string): HTMLButtonElement | null {
  for (const button of Array.from(container.querySelectorAll("button"))) {
    if ((button.textContent ?? "").trim() === text) return button;
  }
  return null;
}

async function setText(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

async function chooseFile(file: File): Promise<void> {
  const input = inputByLabel("Backup file");
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

async function submit(): Promise<void> {
  const form = container.querySelector("form");
  if (form === null) throw new Error("no form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
}

function localFilename(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `qr-scanner-2fa-${now.getFullYear()}-${month}-${day}.qr2fa.json`;
}

function alertText(): string | null {
  const node = container.querySelector('[role="alert"]');
  return node === null ? null : (node.textContent ?? "").trim();
}

function bodyHtml(): string {
  return container.innerHTML;
}

/* -------------------------------------------------------------------- export */

describe("ExportDialog", () => {
  it("rejects a password shorter than the minimum", async () => {
    const vault = makeVault();
    await mount(createElement(ExportDialog, { vault, onClose: vi.fn() }));

    await setText(inputByLabel("Export password"), "short");
    await setText(inputByLabel("Confirm password"), "short");
    await submit();

    expect(alertText()).toBe("Use at least 8 characters.");
    expect(vault.exportVault).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(0);
  });

  it("rejects a mismatched confirmation", async () => {
    const vault = makeVault();
    await mount(createElement(ExportDialog, { vault, onClose: vi.fn() }));

    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("Confirm password"), `${EXPORT_PASSWORD}!`);
    await submit();

    expect(alertText()).toBe("The two passwords do not match.");
    expect(vault.exportVault).not.toHaveBeenCalled();
  });

  it("generates a strong password into both fields and copies it", async () => {
    const vault = makeVault();
    await mount(createElement(ExportDialog, { vault, onClose: vi.fn() }));

    await click(buttonByText("Generate strong password"));

    const password = inputByLabel("Export password").value;
    const confirm = inputByLabel("Confirm password").value;
    expect(password).toBe(confirm);
    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(password).toMatch(/^[a-z2-9-]+$/);
    expect(password).not.toMatch(/[ilo01]/);
    expect(container.textContent).toContain("it cannot be recovered");

    await click(buttonByText("Copy"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(password);
    expect(buttonByText("Copied")).toBeDefined();
  });

  it("exports, downloads under the dated filename, and offers Done", async () => {
    const onClose = vi.fn();
    const vault = makeVault();
    await mount(createElement(ExportDialog, { vault, onClose }));

    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("Confirm password"), EXPORT_PASSWORD);
    await submit();

    expect(vault.exportVault).toHaveBeenCalledWith(EXPORT_PASSWORD);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual([localFilename()]);
    expect(container.textContent).toContain("Downloaded");

    await click(buttonByText("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the hook's error inline", async () => {
    const vault = makeVault({
      exportVault: vi.fn(async () => ({ ok: false as const, error: "password too short" })),
    });
    await mount(createElement(ExportDialog, { vault, onClose: vi.fn() }));

    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("Confirm password"), EXPORT_PASSWORD);
    await submit();

    expect(alertText()).toBe("password too short");
    expect(downloads).toHaveLength(0);
  });

  it("never puts a password or secret into the DOM text", async () => {
    const vault = makeVault();
    await mount(createElement(ExportDialog, { vault, onClose: vi.fn() }));

    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("Confirm password"), EXPORT_PASSWORD);
    await click(buttonByText("Generate strong password"));

    const html = bodyHtml();
    expect(html).not.toContain(EXPORT_PASSWORD);
    expect(html).not.toContain("secret=");
    expect(html).not.toContain("otpauth://");
  });

  it("disables submit while the vault is busy", async () => {
    const vault = makeVault({ busy: "exporting" });
    await mount(createElement(ExportDialog, { vault, onClose: vi.fn() }));

    expect(buttonByText("Export and download").disabled).toBe(true);
    expect(container.textContent).toContain("Encrypting your backup…");

    await submit();
    expect(vault.exportVault).not.toHaveBeenCalled();
  });

  it("closes without exporting on Cancel", async () => {
    const onClose = vi.fn();
    const vault = makeVault();
    await mount(createElement(ExportDialog, { vault, onClose }));

    await click(buttonByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vault.exportVault).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------ import unlocked */

describe("ImportDialog (unlocked)", () => {
  it("shows the merge counts after a clean import", async () => {
    const vault = makeVault({
      importUnlocked: vi.fn(async () => ({
        ok: true as const,
        added: 3,
        replaced: 1,
        duplicates: 2,
      })),
    });
    await mount(createElement(ImportDialog, { vault, mode: "unlocked", onClose: vi.fn() }));

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await submit();

    expect(vault.importUnlocked).toHaveBeenCalledWith(BACKUP_JSON, EXPORT_PASSWORD, undefined);
    const text = container.textContent ?? "";
    expect(text).toContain("3 added");
    expect(text).toContain("1 replaced");
    expect(text).toContain("2 already present");
  });

  it("asks for a choice per conflict with issuer and account only, Skip by default", async () => {
    const plan: MergePlan = {
      add: [],
      duplicates: 0,
      conflicts: [
        { existing: entry("GitHub", "alice@example.com"), incoming: entry("GitHub", "alice@example.com"), kind: "identity" },
        { existing: entry("ACME", "bob@example.com"), incoming: entry("acme", "bob@example.com"), kind: "case-variant" },
      ],
    };
    const importUnlocked = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: "conflicts", needsChoices: plan })
      .mockResolvedValueOnce({ ok: true as const, added: 0, replaced: 1, duplicates: 1 });
    const vault = makeVault({ importUnlocked });
    await mount(createElement(ImportDialog, { vault, mode: "unlocked", onClose: vi.fn() }));

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await submit();

    const text = container.textContent ?? "";
    expect(text).toContain("GitHub · alice@example.com");
    expect(text).toContain("ACME · bob@example.com");
    expect(text).toContain("acme · bob@example.com");
    expect(text).toContain("These differ only by letter case.");

    const html = bodyHtml();
    expect(html).not.toContain("otpauth://");
    expect(html).not.toContain(SECRET);

    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios).toHaveLength(6);
    expect(radios[0].checked).toBe(true);
    expect(radios[3].checked).toBe(true);

    // Change the second conflict to Replace; the array must line up with plan order.
    await click(radios[4]);
    await click(buttonByText("Confirm import"));
    await flush();

    expect(importUnlocked).toHaveBeenLastCalledWith(BACKUP_JSON, EXPORT_PASSWORD, [
      "skip",
      "replace",
    ]);
    expect(container.textContent).toContain("1 replaced");
  });

  it("returns to the file step on Back without losing the file or password", async () => {
    const plan: MergePlan = {
      add: [],
      duplicates: 0,
      conflicts: [
        { existing: entry("GitHub", "alice@example.com"), incoming: entry("GitHub", "alice@example.com"), kind: "identity" },
      ],
    };
    const vault = makeVault({
      importUnlocked: vi.fn(async () => ({ ok: false as const, error: "conflicts", needsChoices: plan })),
    });
    await mount(createElement(ImportDialog, { vault, mode: "unlocked", onClose: vi.fn() }));

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await submit();

    await click(buttonByText("Back"));

    expect(container.textContent).toContain("Backup file");
    expect(inputByLabel("Export password").value).toBe(EXPORT_PASSWORD);
  });

  it("renders a wrong-password error inline", async () => {
    const vault = makeVault({
      importUnlocked: vi.fn(async () => ({
        ok: false as const,
        error: "wrong password or corrupted file",
      })),
    });
    await mount(createElement(ImportDialog, { vault, mode: "unlocked", onClose: vi.fn() }));

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await submit();

    expect(alertText()).toBe("wrong password or corrupted file");
  });

  it("renders an unsupported-version error inline", async () => {
    const vault = makeVault({
      importUnlocked: vi.fn(async () => ({ ok: false as const, error: "unsupported export version" })),
    });
    await mount(createElement(ImportDialog, { vault, mode: "unlocked", onClose: vi.fn() }));

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await submit();

    expect(alertText()).toBe("unsupported export version");
  });

  it("reports an unreadable file instead of attempting an import", async () => {
    const vault = makeVault();
    await mount(createElement(ImportDialog, { vault, mode: "unlocked", onClose: vi.fn() }));

    await chooseFile(new File([], "empty.qr2fa.json", { type: "application/json" }));

    expect(alertText()).toBe("That file is empty.");
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await submit();
    expect(vault.importUnlocked).not.toHaveBeenCalled();
  });

  it("disables submit while busy and closes on Cancel", async () => {
    const onClose = vi.fn();
    const vault = makeVault({ busy: "importing" });
    await mount(createElement(ImportDialog, { vault, mode: "unlocked", onClose }));

    expect(buttonByText("Import").disabled).toBe(true);
    expect(container.textContent).toContain("Restoring your backup…");

    await click(buttonByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------- import locked */

describe("ImportDialog (locked)", () => {
  it("hides the fingerprint option when the platform cannot support it", async () => {
    isSupportedMock.mockResolvedValue(false);
    const vault = makeVault();
    await mount(createElement(ImportDialog, { vault, mode: "locked", onClose: vi.fn() }));
    await flush();

    expect(tryInputByLabel("Use fingerprint")).toBeNull();
    expect(tryInputByLabel("Set a PIN")).not.toBeNull();
  });

  it("offers the fingerprint option when supported and imports with {mode:'prf'}", async () => {
    isSupportedMock.mockResolvedValue(true);
    const importLocked = vi.fn(async () => ({ ok: true as const }));
    const vault = makeVault({ importLocked });
    await mount(createElement(ImportDialog, { vault, mode: "locked", onClose: vi.fn() }));
    await flush();

    const fingerprint = tryInputByLabel("Use fingerprint");
    expect(fingerprint).not.toBeNull();
    await click(fingerprint as HTMLInputElement);

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await submit();

    expect(importLocked).toHaveBeenCalledWith(BACKUP_JSON, EXPORT_PASSWORD, { mode: "prf" });
    expect(container.textContent).toContain("Backup restored. Unlock with your new credential.");
  });

  it("rejects a short or non-numeric PIN before calling the hook", async () => {
    isSupportedMock.mockResolvedValue(false);
    const vault = makeVault();
    await mount(createElement(ImportDialog, { vault, mode: "locked", onClose: vi.fn() }));
    await flush();

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("New PIN"), "123");
    await setText(inputByLabel("Confirm PIN"), "123");
    await submit();

    expect(alertText()).toBe("Choose a PIN of 6–8 digits.");
    expect(vault.importLocked).not.toHaveBeenCalled();
  });

  it("rejects a mismatched PIN confirmation", async () => {
    isSupportedMock.mockResolvedValue(false);
    const vault = makeVault();
    await mount(createElement(ImportDialog, { vault, mode: "locked", onClose: vi.fn() }));
    await flush();

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("New PIN"), "123456");
    await setText(inputByLabel("Confirm PIN"), "654321");
    await submit();

    expect(alertText()).toBe("The two PINs do not match.");
    expect(vault.importLocked).not.toHaveBeenCalled();
  });

  it("imports with {mode:'pin', pin} and shows the staged-commit copy", async () => {
    isSupportedMock.mockResolvedValue(false);
    const importLocked = vi.fn(async () => ({ ok: true as const }));
    const vault = makeVault({ importLocked });
    await mount(createElement(ImportDialog, { vault, mode: "locked", onClose: vi.fn() }));
    await flush();

    expect(container.textContent).toContain(
      "Your old lock is replaced only after the backup is verified."
    );

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("New PIN"), "123456");
    await setText(inputByLabel("Confirm PIN"), "123456");
    await submit();

    expect(importLocked).toHaveBeenCalledWith(BACKUP_JSON, EXPORT_PASSWORD, {
      mode: "pin",
      pin: "123456",
    });
    expect(container.textContent).toContain("Backup restored. Unlock with your new credential.");
    expect(bodyHtml()).not.toContain(SECRET);
    expect(bodyHtml()).not.toContain("otpauth://");
  });

  it("renders the hook's error inline and never shows entry data", async () => {
    isSupportedMock.mockResolvedValue(false);
    const vault = makeVault({
      importLocked: vi.fn(async () => ({ ok: false as const, error: "wrong password or corrupted file" })),
    });
    await mount(createElement(ImportDialog, { vault, mode: "locked", onClose: vi.fn() }));
    await flush();

    await chooseFile(new File([BACKUP_JSON], "backup.qr2fa.json", { type: "application/json" }));
    await setText(inputByLabel("Export password"), EXPORT_PASSWORD);
    await setText(inputByLabel("New PIN"), "123456");
    await setText(inputByLabel("Confirm PIN"), "123456");
    await submit();

    expect(alertText()).toBe("wrong password or corrupted file");
    expect(container.textContent).not.toContain("Backup restored");
    expect(bodyHtml()).not.toContain(SECRET);
  });
});

/**
 * Render-level tests for TwoFactorPanel.
 *
 * Written without JSX and without @testing-library/react, matching
 * `ScanResult.test.ts` / `ScanHistory.test.ts`: the vitest include is
 * `src/**\/*.test.ts` and neither is a declared dependency.
 *
 * Two invariants are asserted directly rather than inferred from a branch:
 *  - a raw seed / otpauth URI never reaches `container.innerHTML`;
 *  - a typed PIN never reaches it either (the PIN fields are uncontrolled and
 *    are cleared before the vault call resolves).
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TEMP_PIN_ONLY, TwoFactorPanel, type TwoFactorPanelProps } from "./TwoFactorPanel";
import type { UseVault } from "../hooks/useVault";
import { canonicalSecret, type OtpauthEntry } from "../utils/otpauth";
import { defaultWebAuthnPort } from "../utils/webauthn";

const totpMock = vi.hoisted(() => ({ code: "123456" }));

vi.mock("../utils/totp", () => ({
  generateTotp: () => ({ ok: true, code: totpMock.code, stepEndsAtMs: Date.now() + 12_000 }),
}));

const SECRET = "JBSWY3DPCEHPX3ZX";
const URI = `otpauth://totp/ACME:alice%40example.com?secret=${SECRET}`;

const ENTRY: OtpauthEntry = {
  issuer: "ACME",
  account: "alice@example.com",
  secret: SECRET,
  algorithm: "SHA1",
  digits: 6,
  period: 30,
};

function makeVault(overrides: Partial<UseVault> = {}): UseVault {
  const base: UseVault = {
    phase: "locked",
    busy: null,
    error: null,
    entries: [],
    hasPin: false,
    prfRegistered: false,
    clockOffset: 0,
    clockSkew: false,
    retryAfterMs: 0,
    unlockWithPin: vi.fn<UseVault["unlockWithPin"]>(async () => ({ ok: true })),
    unlockWithBiometric: vi.fn<UseVault["unlockWithBiometric"]>(async () => ({ ok: true })),
    lock: vi.fn<UseVault["lock"]>(() => {}),
    createVault: vi.fn<UseVault["createVault"]>(async () => ({ ok: true })),
    saveEntry: vi.fn<UseVault["saveEntry"]>(async () => ({ ok: true, outcome: "added" })),
    removeEntry: vi.fn<UseVault["removeEntry"]>(async () => ({ ok: true })),
    exportVault: vi.fn<UseVault["exportVault"]>(async () => ({ ok: true, json: "{}" })),
    importUnlocked: vi.fn<UseVault["importUnlocked"]>(async () => ({
      ok: true,
      added: 0,
      replaced: 0,
      duplicates: 0,
    })),
    importLocked: vi.fn<UseVault["importLocked"]>(async () => ({ ok: true })),
    setClockOffset: vi.fn<UseVault["setClockOffset"]>(() => {}),
  };
  return { ...base, ...overrides };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(defaultWebAuthnPort, "isSupported").mockResolvedValue(true);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => "") },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function render(overrides: Partial<TwoFactorPanelProps> = {}): Promise<TwoFactorPanelProps> {
  const props: TwoFactorPanelProps = {
    vault: makeVault(),
    pending: null,
    onPendingResolved: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root.render(createElement(TwoFactorPanel, props));
  });
  return props;
}

const text = (): string => container.textContent ?? "";
const buttons = (): HTMLButtonElement[] => Array.from(container.querySelectorAll("button"));
const buttonByText = (label: string): HTMLButtonElement | undefined =>
  buttons().find((b) => (b.textContent ?? "").trim() === label);
const buttonByLabel = (label: string): HTMLButtonElement | undefined =>
  buttons().find((b) => b.getAttribute("aria-label") === label);
const inputByLabel = (label: string): HTMLInputElement | undefined =>
  Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
    (i) => i.getAttribute("aria-label") === label
  );
const checkboxByText = (snippet: string): HTMLInputElement | undefined =>
  Array.from(container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")).find((cb) =>
    (cb.closest("label")?.textContent ?? "").includes(snippet)
  );

async function click(el: HTMLElement | undefined): Promise<void> {
  if (!el) throw new Error("expected element to exist");
  await act(async () => {
    el.click();
  });
}

/** React tracks input values on the DOM node; go through the native setter so
 *  a dispatched `input` event is not swallowed by the value tracker. */
async function setInputValue(input: HTMLInputElement | undefined, value: string): Promise<void> {
  if (!input) throw new Error("expected input to exist");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TwoFactorPanel setup", () => {
  it("shows a pending note when codes are waiting", async () => {
    await render({
      vault: makeVault({ phase: "setup" }),
      pending: { uris: [URI], source: "scan" },
    });
    expect(text()).toContain("1 code ready to save");
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("shows the capability probe while it is unresolved", async () => {
    let release: (value: boolean) => void = () => {};
    vi.mocked(defaultWebAuthnPort.isSupported).mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      })
    );
    await render({ vault: makeVault({ phase: "setup" }) });
    expect(text()).toContain("Checking fingerprint support…");
    await act(async () => {
      release(true);
    });
    expect(text()).not.toContain("Checking fingerprint support…");
  });

  it.skipIf(TEMP_PIN_ONLY)("requires the PRF-only acknowledgement before creating a fingerprint vault", async () => {
    const props = await render({ vault: makeVault({ phase: "setup" }) });
    expect(text()).toContain("Fingerprint unlock is available");
    expect(inputByLabel("Create PIN")).toBeUndefined();

    expect(buttonByText("Create vault")?.disabled).toBe(true);
    await click(checkboxByText("I understand"));
    expect(buttonByText("Create vault")?.disabled).toBe(false);

    await click(buttonByText("Create vault"));
    expect(props.vault.createVault).toHaveBeenCalledWith({ mode: "prf" });
  });

  it.skipIf(TEMP_PIN_ONLY)("validates opted-in PINs and creates prf+pin", async () => {
    const props = await render({ vault: makeVault({ phase: "setup" }) });
    await click(checkboxByText("Also unlock with a PIN"));

    const pin = inputByLabel("Create PIN");
    const confirm = inputByLabel("Confirm PIN");
    expect(pin?.type).toBe("password");
    expect(pin?.getAttribute("inputmode")).toBe("numeric");
    expect(pin?.getAttribute("autocomplete")).toBe("off");
    expect(pin?.maxLength).toBe(8);

    await setInputValue(pin, "12345");
    await setInputValue(confirm, "12345");
    await click(buttonByText("Create vault"));
    expect(text()).toContain("PIN must be 6–8 digits");
    expect(props.vault.createVault).not.toHaveBeenCalled();

    await setInputValue(pin, "123456");
    await setInputValue(confirm, "654321");
    await click(buttonByText("Create vault"));
    expect(text()).toContain("PINs do not match");
    expect(props.vault.createVault).not.toHaveBeenCalled();

    await setInputValue(pin, "123456");
    await setInputValue(confirm, "123456");
    await click(buttonByText("Create vault"));
    expect(props.vault.createVault).toHaveBeenCalledWith({ mode: "prf+pin", pin: "123456" });
    expect(container.innerHTML).not.toContain("123456");
  });

  it.skipIf(TEMP_PIN_ONLY)("makes a PIN mandatory when fingerprint unlock is unsupported", async () => {
    vi.mocked(defaultWebAuthnPort.isSupported).mockResolvedValue(false);
    const props = await render({ vault: makeVault({ phase: "setup" }) });
    expect(text()).toContain("This device has no fingerprint unlock");
    expect(checkboxByText("I understand")).toBeUndefined();

    await setInputValue(inputByLabel("Create PIN"), "135790");
    await setInputValue(inputByLabel("Confirm PIN"), "135790");
    await click(buttonByText("Create vault"));
    expect(props.vault.createVault).toHaveBeenCalledWith({ mode: "pin", pin: "135790" });
    expect(container.innerHTML).not.toContain("135790");
  });
});

describe("TwoFactorPanel locked", () => {
  it("hides the fingerprint button when no PRF credential is registered", async () => {
    await render({ vault: makeVault({ phase: "locked", prfRegistered: false, hasPin: true }) });
    expect(buttonByText("Unlock with fingerprint")).toBeUndefined();
    expect(inputByLabel("PIN")).toBeDefined();
  });

  it("reports a wrong PIN without echoing it", async () => {
    const vault = makeVault({ phase: "locked", hasPin: true });
    vi.mocked(vault.unlockWithPin).mockResolvedValue({ ok: false, reason: "wrong-pin" });
    await render({ vault });
    await setInputValue(inputByLabel("PIN"), "246810");
    await click(buttonByText("Unlock"));
    expect(text()).toContain("Incorrect PIN");
    expect(container.innerHTML).not.toContain("246810");
    expect(vault.unlockWithPin).toHaveBeenCalledWith("246810");
  });

  it("maps an unavailable biometric to fallback copy that never blames the fingerprint", async () => {
    const vault = makeVault({ phase: "locked", prfRegistered: true, hasPin: true });
    vi.mocked(vault.unlockWithBiometric).mockResolvedValue({ ok: false, reason: "unavailable" });
    await render({ vault });
    await click(buttonByText("Unlock with fingerprint"));
    expect(text()).toContain("Fingerprint unlock is unavailable right now");
    expect(text().toLowerCase()).not.toContain("failed");
    expect(text().toLowerCase()).not.toContain("rejected");
    expect(inputByLabel("PIN")).toBeDefined();
  });

  it("drops the fingerprint button when the credential is gone", async () => {
    const vault = makeVault({ phase: "locked", prfRegistered: true, hasPin: true });
    vi.mocked(vault.unlockWithBiometric).mockResolvedValue({
      ok: false,
      reason: "no-biometric-credential",
    });
    await render({ vault });
    await click(buttonByText("Unlock with fingerprint"));
    expect(buttonByText("Unlock with fingerprint")).toBeUndefined();
    expect(inputByLabel("PIN")).toBeDefined();
  });

  it("counts a PIN delay down locally and disables unlock", async () => {
    vi.useFakeTimers();
    const vault = makeVault({ phase: "locked", hasPin: true, retryAfterMs: 3000 });
    await render({ vault });
    expect(text()).toContain("Try again in 3s");
    expect(buttonByText("Unlock")?.disabled).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(text()).toContain("Try again in 2s");
    expect(buttonByText("Unlock")?.disabled).toBe(true);
    expect(vault.unlockWithPin).not.toHaveBeenCalled();
  });

  it("points a corrupt vault at the import backup affordance", async () => {
    const vault = makeVault({ phase: "locked", hasPin: true });
    vi.mocked(vault.unlockWithPin).mockResolvedValue({ ok: false, reason: "corrupt" });
    const onImportBackup = vi.fn();
    await render({ vault, onImportBackup });
    await setInputValue(inputByLabel("PIN"), "123456");
    await click(buttonByText("Unlock"));
    expect(text()).toContain("encrypted backup");
    await click(buttonByText("Import backup"));
    expect(onImportBackup).toHaveBeenCalledTimes(1);
  });

  it("offers restore guidance when no unlock method is available", async () => {
    await render({
      vault: makeVault({ phase: "locked", prfRegistered: false, hasPin: false }),
      onImportBackup: vi.fn(),
    });
    expect(text()).toContain("Restore it from an encrypted backup");
    expect(buttonByText("Import backup")).toBeDefined();
  });

  it("omits the import button when the parent supplies no handler", async () => {
    await render({ vault: makeVault({ phase: "locked", prfRegistered: false, hasPin: false }) });
    expect(buttonByText("Import backup")).toBeUndefined();
  });
});

describe("TwoFactorPanel unlocked", () => {
  it("renders grouped codes, never the secret, and copies the raw code", async () => {
    const vault = makeVault({ phase: "unlocked", entries: [ENTRY] });
    await render({ vault });
    expect(text()).toContain("ACME");
    expect(text()).toContain("alice@example.com");
    expect(text()).toContain("123 456");
    expect(text()).toContain("12s");
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(URI);

    await click(buttonByLabel("Copy code for ACME"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("123456");
    expect(buttonByText("Copied")).toBeDefined();
  });

  it("stays honest when empty", async () => {
    await render({ vault: makeVault({ phase: "unlocked", entries: [] }) });
    expect(text()).toContain("No codes yet — scan a QR code to add one");
  });

  it("requires confirmation before deleting a code", async () => {
    const removeEntry = vi.fn<UseVault["removeEntry"]>(async () => ({ ok: true }));
    const vault = makeVault({ phase: "unlocked", entries: [ENTRY], removeEntry });
    await render({ vault });
    expect(buttonByText("Yes, delete")).toBeUndefined();

    await click(buttonByLabel("Delete code for ACME"));
    expect(text()).toContain("Delete this code?");
    await click(buttonByText("Yes, delete"));
    expect(removeEntry).toHaveBeenCalledWith(canonicalSecret(SECRET));
  });

  it("saves every pending URI, then reports saved", async () => {
    const uris = [
      `otpauth://totp/A?secret=${SECRET}`,
      `otpauth://totp/B?secret=KRSXG5CTMVRXEZLU`,
    ];
    const saveEntry = vi.fn<UseVault["saveEntry"]>(async () => ({ ok: true, outcome: "added" }));
    const onPendingResolved = vi.fn();
    await render({
      vault: makeVault({ phase: "unlocked", saveEntry }),
      pending: { uris, source: "history" },
      onPendingResolved,
    });
    expect(text()).toContain("2 authenticator codes ready");

    await click(buttonByText("Save"));
    expect(saveEntry).toHaveBeenCalledTimes(2);
    expect(saveEntry).toHaveBeenNthCalledWith(1, uris[0]);
    expect(saveEntry).toHaveBeenNthCalledWith(2, uris[1]);
    expect(onPendingResolved).toHaveBeenCalledWith("saved");
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("dismisses pending codes", async () => {
    const onPendingResolved = vi.fn();
    await render({
      vault: makeVault({ phase: "unlocked" }),
      pending: { uris: [URI], source: "scan" },
      onPendingResolved,
    });
    await click(buttonByText("Dismiss"));
    expect(onPendingResolved).toHaveBeenCalledWith("dismissed");
  });

  it("surfaces a save conflict and replaces on request", async () => {
    const incoming: OtpauthEntry = { ...ENTRY, account: "bob@example.com" };
    const saveEntry = vi
      .fn<UseVault["saveEntry"]>()
      .mockResolvedValueOnce({
        ok: false,
        error: "conflict",
        conflict: { existing: ENTRY, incoming },
      })
      .mockResolvedValueOnce({ ok: true, outcome: "replaced" });
    const onPendingResolved = vi.fn();
    await render({
      vault: makeVault({ phase: "unlocked", saveEntry }),
      pending: { uris: [URI], source: "scan" },
      onPendingResolved,
    });

    await click(buttonByText("Save"));
    expect(text()).toContain("already exists with a different secret");
    expect(container.innerHTML).not.toContain(SECRET);

    await click(buttonByText("Replace"));
    expect(saveEntry).toHaveBeenNthCalledWith(2, URI, { replace: true });
    expect(onPendingResolved).toHaveBeenCalledWith("saved");
  });

  it("offers replace/skip for a manually pasted duplicate without leaking the URI", async () => {
    const incoming: OtpauthEntry = { ...ENTRY, account: "bob@example.com" };
    const saveEntry = vi
      .fn<UseVault["saveEntry"]>()
      .mockResolvedValueOnce({
        ok: false,
        error: "conflict",
        conflict: { existing: ENTRY, incoming },
      })
      .mockResolvedValueOnce({ ok: true, outcome: "replaced" });
    await render({ vault: makeVault({ phase: "unlocked", saveEntry }) });

    const field = inputByLabel("otpauth link");
    if (!field) throw new Error("expected manual field");
    field.value = URI;
    await click(buttonByText("Add code"));

    expect(saveEntry).toHaveBeenNthCalledWith(1, URI, undefined);
    expect(text()).toContain("already exists with a different secret");
    expect(container.innerHTML).not.toContain(SECRET);

    await click(buttonByText("Replace"));
    expect(saveEntry).toHaveBeenNthCalledWith(2, URI, { replace: true });
  });

  it("drives the clock offset through setClockOffset", async () => {
    const setClockOffset = vi.fn<UseVault["setClockOffset"]>(() => {});
    await render({ vault: makeVault({ phase: "unlocked", clockSkew: true, setClockOffset }) });
    expect(text()).toContain("Device clock changed — codes may be wrong.");

    await setInputValue(inputByLabel("Clock offset in seconds"), "5");
    expect(setClockOffset).toHaveBeenCalledWith(5000);

    await click(buttonByLabel("Increase clock offset by one second"));
    expect(setClockOffset).toHaveBeenCalledWith(1000);
  });

  it("locks and raises the parent's export/import intents", async () => {
    const lock = vi.fn<UseVault["lock"]>(() => {});
    const onExport = vi.fn();
    const onImport = vi.fn();
    await render({ vault: makeVault({ phase: "unlocked", lock }), onExport, onImport });

    await click(buttonByText("Export"));
    expect(onExport).toHaveBeenCalledTimes(1);
    await click(buttonByText("Import"));
    expect(onImport).toHaveBeenCalledTimes(1);
    await click(buttonByText("Lock"));
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it("keeps a vault error inline as an alert", async () => {
    await render({ vault: makeVault({ phase: "unlocked", error: "Could not save that code" }) });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Could not save that code");
  });
});

describe("TwoFactorPanel secret containment", () => {
  it("never renders the seed or URI in any phase", async () => {
    await render({
      vault: makeVault({ phase: "setup" }),
      pending: { uris: [URI], source: "scan" },
    });
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(URI);

    await render({ vault: makeVault({ phase: "locked", prfRegistered: true, hasPin: true }) });
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(URI);

    await render({
      vault: makeVault({ phase: "unlocked", entries: [ENTRY] }),
      pending: { uris: [URI], source: "scan" },
    });
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(URI);
  });
});

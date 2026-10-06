/**
 * Render-level tests for the ScanResult security boundary.
 *
 * An `otpauth://` value is the account's shared secret, so the component must
 * never place it in the DOM — not as text, not as an aria-label, not in any
 * attribute. These tests assert that absence directly (`textContent`,
 * `innerHTML`, and the full set of accessible names) rather than trusting the
 * branch, and pin the non-otpauth surface as unchanged.
 *
 * Written without JSX and without @testing-library/react, matching
 * `ScanHistory.test.ts`: the vitest include is `src/**\/*.test.ts` and neither
 * is a declared dependency.
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ScanResult } from "./ScanResult";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Realistic fixture: base32 secret, percent-encoded label, issuer query. */
const TOTP_SECRET = "JBSWY3DPCEHPX3ZX";
const TOTP_URI = `otpauth://totp/ACME%20Corp:alice%40example.com?secret=${TOTP_SECRET}&issuer=ACME%20Corp&algorithm=SHA1&digits=6&period=30`;
const HOTP_URI = `otpauth://hotp/ACME%20Corp:alice%40example.com?secret=${TOTP_SECRET}&issuer=ACME%20Corp&counter=1`;
const OTHER_URI = `otpauth://steam/alice?secret=${TOTP_SECRET}`;
const TOTP_ENTRY = { issuer: "ACME Corp", account: "alice@example.com" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type Props = {
  value: string;
  canOpen: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onScanAnother: () => void;
  kind?: "text" | "url" | "otpauth-totp" | "otpauth-hotp" | "otpauth-other";
  entry?: { issuer: string; account: string } | null;
  onSaveToVault?: () => void;
};

function render(overrides: Partial<Props> = {}): Props {
  const props: Props = {
    value: "hello world",
    canOpen: false,
    onCopy: () => {},
    onOpen: () => {},
    onScanAnother: () => {},
    ...overrides,
  };
  act(() => {
    root.render(createElement(ScanResult, props));
  });
  return props;
}

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"));
}

function buttonByLabel(label: string): HTMLButtonElement | undefined {
  return buttons().find((b) => b.getAttribute("aria-label") === label);
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return buttons().find((b) => (b.textContent ?? "").trim() === text);
}

/** Every accessible name in the subtree — the screen-reader surface. */
function labels(): string[] {
  return Array.from(container.querySelectorAll("[aria-label]")).map(
    (el) => el.getAttribute("aria-label") ?? "",
  );
}

/** The leak assertions every otpauth case must satisfy. */
function expectNoSecretLeak(raw: string, secret: string): void {
  expect(container.textContent ?? "").not.toContain(secret);
  expect(container.innerHTML).not.toContain(secret);
  expect(container.innerHTML).not.toContain(raw);
  expect(container.innerHTML).not.toContain("otpauth");
  for (const label of labels()) {
    expect(label).not.toContain(secret);
    expect(label).not.toContain("otpauth");
  }
  expect(buttons().some((b) => (b.getAttribute("aria-label") ?? "").startsWith("Copy"))).toBe(
    false,
  );
}

describe("ScanResult — non-otpauth surface (unchanged)", () => {
  it("renders the value and keeps the value in the copy button's accessible name", () => {
    const onCopy = vi.fn();
    render({ value: "hello world", onCopy });

    expect(container.textContent).toContain("hello world");
    const copy = buttonByLabel("Copy scan to clipboard: hello world");
    expect(copy).toBeTruthy();
    expect(copy?.textContent).toBe("Copy");

    act(() => copy?.click());
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it("offers Open URL only when canOpen is true", () => {
    const onOpen = vi.fn();
    render({ value: "https://example.com", canOpen: true, kind: "url", onOpen });
    const open = buttonByText("Open URL");
    expect(open).toBeTruthy();
    act(() => open?.click());
    expect(onOpen).toHaveBeenCalledTimes(1);

    render({ value: "https://example.com", canOpen: false, kind: "url" });
    expect(buttonByText("Open URL")).toBeUndefined();
  });
});

describe("ScanResult — otpauth-totp (secret never rendered)", () => {
  it("shows issuer and account and exposes the secret nowhere", () => {
    const onSaveToVault = vi.fn();
    render({
      value: TOTP_URI,
      kind: "otpauth-totp",
      entry: TOTP_ENTRY,
      onSaveToVault,
    });

    expectNoSecretLeak(TOTP_URI, TOTP_SECRET);
    expect(container.textContent).toContain("ACME Corp");
    expect(container.textContent).toContain("alice@example.com");
    expect(labels().sort()).toEqual(["Save to 2FA vault", "Scan another"]);
    expect(buttonByText("Open URL")).toBeUndefined();
  });

  it("calls onSaveToVault from the fixed-label primary action", () => {
    const onSaveToVault = vi.fn();
    const onScanAnother = vi.fn();
    render({
      value: TOTP_URI,
      kind: "otpauth-totp",
      entry: TOTP_ENTRY,
      onSaveToVault,
      onScanAnother,
    });

    const save = buttonByLabel("Save to 2FA vault");
    expect(save?.textContent).toBe("Save to 2FA vault");
    act(() => save?.click());
    expect(onSaveToVault).toHaveBeenCalledTimes(1);

    act(() => buttonByLabel("Scan another")?.click());
    expect(onScanAnother).toHaveBeenCalledTimes(1);
  });

  it("offers no save action without a handler, and still leaks nothing", () => {
    render({ value: TOTP_URI, kind: "otpauth-totp", entry: TOTP_ENTRY });

    expectNoSecretLeak(TOTP_URI, TOTP_SECRET);
    expect(buttonByText("Save to 2FA vault")).toBeUndefined();
    expect(container.textContent).toContain("ACME Corp");
    expect(labels()).toEqual(["Scan another"]);
  });

  it("omits the issuer line when the entry has no issuer", () => {
    render({
      value: TOTP_URI,
      kind: "otpauth-totp",
      entry: { issuer: "", account: "alice@example.com" },
    });

    expect(container.textContent).toContain("alice@example.com");
    expect(container.textContent).not.toContain("ACME Corp");
  });

  it("fail-closed: no kind prop still refuses to render the URI as text", () => {
    render({ value: TOTP_URI });

    expectNoSecretLeak(TOTP_URI, TOTP_SECRET);
    expect(container.textContent).toContain("alice@example.com");
  });

  it("fail-closed: an unparseable totp URI keeps the block empty of the value", () => {
    const malformed = "otpauth://totp/alice?secret=SHORT";
    render({ value: malformed });

    expect(container.textContent).not.toContain("SHORT");
    expect(container.innerHTML).not.toContain(malformed);
    expect(buttonByText("Save to 2FA vault")).toBeUndefined();
  });
});

describe("ScanResult — unsupported authenticator kinds", () => {
  it("hotp: shows the unsupported notice, never the value", () => {
    render({
      value: HOTP_URI,
      kind: "otpauth-hotp",
      entry: TOTP_ENTRY,
      onSaveToVault: vi.fn(),
    });

    expect(container.textContent).toContain("Unsupported authenticator code");
    expectNoSecretLeak(HOTP_URI, TOTP_SECRET);
    expect(buttonByText("Save to 2FA vault")).toBeUndefined();
  });

  it("other: same defensive block", () => {
    render({ value: OTHER_URI, kind: "otpauth-other", entry: TOTP_ENTRY });

    expect(container.textContent).toContain("Unsupported authenticator code");
    expectNoSecretLeak(OTHER_URI, TOTP_SECRET);
  });
});

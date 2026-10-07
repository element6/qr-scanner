/**
 * App-level reproduction — "pressing Save on the 2FA pending banner does
 * nothing visible".
 *
 * The panel's own unit tests pass (TwoFactorPanel.test.ts "saves every pending
 * URI, then reports saved"), so this file drives the REAL `<App/>` instead:
 * real `useVault` (no module mock on hooks), real jsdom localStorage, real
 * WebCrypto — only the camera scanner component is stubbed, because jsdom has
 * no camera and the camera is irrelevant to the save path.
 *
 * Production flow reproduced end-to-end:
 *   1. scan history seeded with 2 `otpauth://totp/` rows (memory-only pending
 *      never persists, so the history move is the app's own entry point),
 *   2. "Move to 2FA vault" → tab switch → vault setup view,
 *   3. PIN create path (`TEMP_PIN_ONLY`) → unlocked,
 *   4. banner "2 authenticator codes ready" with Save/Dismiss — the exact
 *      production symptom state,
 *   5. click Save.
 *
 * Reproduction criteria (what the report says must happen):
 *   - both accounts render as vault entry rows,
 *   - the pending banner is resolved and the history rows are moved out,
 *   - no unhandled rejection / console error.
 *
 * Instrumentation (no source edits): a MutationObserver timeline records every
 * DOM state commit around the Save click (did "Saving…" ever commit?), a
 * `Storage.prototype.setItem` log shows whether `saveEntry` reached its CAS
 * write, and window error/unhandledrejection listeners catch a rejected
 * `runSaveQueue` (`void runSaveQueue(...)` at TwoFactorPanel.tsx:744 would
 * swallow it).
 */
import { createElement, act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import App from "./App";
import { createHistoryItem } from "./utils/validators";
import { parseOtpauth, scanKind } from "./utils/otpauth";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The camera library cannot run under jsdom; it is outside the save path.
vi.mock("@yudiel/react-qr-scanner", () => ({ Scanner: () => null }));

const URI_A = "otpauth://totp/ACME:alice%40example.com?secret=JBSWY3DPCEHPX3ZX&issuer=ACME";
const URI_B = "otpauth://totp/ACME:bob%40example.com?secret=KRSXG5CTMVRXEZLU&issuer=ACME";

const VAULT_KEY = "qr2fa.vault.v1";
const HISTORY_KEY = "qrScanHistory";

let root: Root | null = null;
let baseTime = Date.now();

type Write = { key: string; at: number };
const storageWrites: Write[] = [];
const pageErrors: string[] = [];
const timeline: { at: number; state: string }[] = [];
let origSetItem: ((key: string, value: string) => void) | null = null;
let observer: MutationObserver | null = null;

function recordWrite(key: string): void {
  storageWrites.push({ key, at: Date.now() - baseTime });
}

/**
 * jsdom 30 / Node 26 exposes no usable `localStorage` (same reason as
 * `useVault.test.ts:61`) — install the same in-memory store, instrumented so
 * every write (notably the `writeVaultRecord` CAS) lands in `storageWrites`.
 */
function installInstrumentedStorage(): void {
  if (typeof localStorage !== "undefined" && localStorage !== null) {
    const orig = Storage.prototype.setItem as unknown as (
      key: string,
      value: string
    ) => void;
    origSetItem = orig;
    Storage.prototype.setItem = function (
      this: Storage,
      key: string,
      value: string
    ): void {
      recordWrite(key);
      orig.call(this, key, value);
    };
    return;
  }
  const data = new Map<string, string>();
  const storage = {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    key(index: number): string | null {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      recordWrite(String(key));
      data.set(String(key), String(value));
    },
  } as Storage;
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      writable: true,
      configurable: true,
    });
  } catch {
    (globalThis as unknown as { localStorage: Storage }).localStorage = storage;
  }
}

installInstrumentedStorage();

/** Everything a user could see, in one string — the timeline is made of these. */
function stateDescriptor(): string {
  const body = document.body;
  const txt = body.textContent ?? "";
  const statuses = Array.from(body.querySelectorAll('[role="status"]'))
    .map((el) => el.textContent)
    .join(" | ");
  const alerts = Array.from(body.querySelectorAll('[role="alert"]'))
    .map((el) => el.textContent)
    .join(" | ");
  return JSON.stringify({
    saving: txt.includes("Saving…"),
    banner: txt.includes("authenticator codes ready"),
    creating: txt.includes("Creating…"),
    alice: txt.includes("alice@example.com"),
    bob: txt.includes("bob@example.com"),
    statuses,
    alerts,
  });
}

function startTimeline(): void {
  timeline.length = 0;
  let last = stateDescriptor();
  timeline.push({ at: Date.now() - baseTime, state: last });
  observer = new MutationObserver(() => {
    const next = stateDescriptor();
    if (next !== last) {
      last = next;
      timeline.push({ at: Date.now() - baseTime, state: next });
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
}

function text(): string {
  return document.body.textContent ?? "";
}
function buttonByText(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === label
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`button "${label}" not found; body: ${text().slice(0, 600)}`);
  }
  return match;
}

function buttonByAriaLabel(label: string): HTMLButtonElement {
  const match = document.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`button aria-label "${label}" not found; body: ${text().slice(0, 600)}`);
  }
  return match;
}

/** Poll with real macrotask waits so React can flush inside `act`. */
async function waitFor(pred: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (pred()) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for: ${what}\nstate=${stateDescriptor()}\nbody=${text().slice(0, 800)}`
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

describe("App: 2FA pending banner → Save (integration, real useVault)", () => {
  beforeEach(() => {
    baseTime = Date.now();
    localStorage.clear();
    storageWrites.length = 0;
    pageErrors.length = 0;
    timeline.length = 0;

    window.addEventListener("unhandledrejection", (e) => {
      pageErrors.push(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`);
    });
    window.addEventListener("error", (e) => {
      pageErrors.push(`error: ${String((e as ErrorEvent).error ?? e.message)}`);
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      pageErrors.push(`console.error: ${args.map(String).join(" ")}`);
    });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      pageErrors.push(`console.warn: ${args.map(String).join(" ")}`);
    });
  });

  afterEach(async () => {
    observer?.disconnect();
    observer = null;
    if (origSetItem) Storage.prototype.setItem = origSetItem;
    await act(async () => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it(
    "Save persists both pending codes (banner resolves, rows render)",
    { timeout: 90_000 },
    async () => {
      // 1. Seed the app's own entry point: two otpauth rows in scan history.
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([createHistoryItem(URI_A), createHistoryItem(URI_B)])
      );

      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(createElement(App) as ReactElement);
      });

      // 2. History move → sets App `pending`, switches to the 2FA tab.
      const moveBtn = await (async () => {
        let found: HTMLButtonElement | null = null;
        await waitFor(() => {
          found = document.querySelector<HTMLButtonElement>(
            'button[aria-label="Move authenticator codes to the 2FA vault"]'
          );
          return found !== null;
        }, 10_000, "migration banner move button");
        return found as unknown as HTMLButtonElement;
      })();
      await act(async () => {
        moveBtn.click();
      });

      // 3. PIN setup path → unlocked.
      await waitFor(() => text().includes("Create PIN"), 10_000, "vault setup view");
      const pin = document.getElementById("twofactor-create-pin") as HTMLInputElement;
      const confirm = document.getElementById("twofactor-confirm-pin") as HTMLInputElement;
      pin.value = "123456";
      confirm.value = "123456";
      const createBtn = buttonByText("Create vault");
      await act(async () => {
        createBtn.click();
      });

      // 4. The exact production symptom state: unlocked + banner + Save/Dismiss.
      await waitFor(
        () => text().includes("2 authenticator codes ready"),
        60_000,
        "pending banner on unlocked panel"
      );
      expect(text()).toContain("No codes yet"); // list empty before save, as reported

      // 5. Instrumented Save click.
      startTimeline();
      const saveBtn = buttonByText("Save");
      const atClick = {
        saveDisabled: saveBtn.disabled,
        bodyState: stateDescriptor(),
        vaultWritesSoFar: storageWrites.filter((w) => w.key === VAULT_KEY).length,
      };
      const clickAt = Date.now() - baseTime;
      await act(async () => {
        saveBtn.click();
      });

      try {
        await waitFor(
          () => text().includes("alice@example.com") && text().includes("bob@example.com"),
          10_000,
          "both saved vault rows"
        );
      } finally {
        console.log(`[save-click snapshot] ${JSON.stringify(atClick)}`);
        console.log(
          `[storage writes since save] ${JSON.stringify(storageWrites.filter((w) => w.at >= clickAt))}`
        );
        console.log(`[timeline] ${JSON.stringify(timeline, null, 1)}`);
        console.log(`[page errors] ${JSON.stringify(pageErrors)}`);
        observer?.disconnect();
        observer = null;
      }

      // 6. Reproduction criteria.
      expect(text()).toContain("alice@example.com");
      expect(text()).toContain("bob@example.com");
      expect(text()).not.toContain("authenticator codes ready");
      expect(pageErrors).toEqual([]);
      expect(
        storageWrites.some((w) => w.key === VAULT_KEY && w.at >= clickAt),
        "saveEntry must reach the vault CAS write"
      ).toBe(true);
      // Move completed: history rows leave the plaintext store.
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")).toHaveLength(0);
    }
  );

  it(
    "legacy history row that fails strict parse: Save stops visibly (pre-fix: silent no-op)",
    { timeout: 90_000 },
    async () => {
      // Production-shaped trigger: legacy scan-history rows predate the 2FA vault.
      // `scanKind` only checks scheme+type (otpauth.ts:58-69) while `parseOtpauth`
      // validates label+secret (otpauth.ts:222-263), and App's history move
      // (App.tsx:482-489) gates on scanKind alone — so a row it rejects can enter
      // `pending` and reach saveEntry's parse path. Before 13002e3 (Oct 7 17:02)
      // that path returned `{ok:false}` WITHOUT setError, and TwoFactorPanel's
      // queue stops silently on non-conflict failures (reads vault.error) →
      // Save did nothing visible: banner stays, list empty, no error, no
      // "Saving…".
      const LEGACY = "otpauth://totp/ACME:alice"; // no secret — classifies, never parses
      expect(scanKind(LEGACY)).toBe("otpauth-totp");
      const parsed = parseOtpauth(LEGACY);
      expect(parsed.ok).toBe(false);
      const parseError = parsed.ok ? "" : parsed.error;

      localStorage.setItem(HISTORY_KEY, JSON.stringify([createHistoryItem(LEGACY)]));

      const container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root!.render(createElement(App) as ReactElement);
      });

      await waitFor(
        () =>
          document.querySelector(
            'button[aria-label="Move authenticator codes to the 2FA vault"]'
          ) !== null,
        10_000,
        "migration banner move button"
      );
      const moveBtn = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Move authenticator codes to the 2FA vault"]'
      )!;
      await act(async () => {
        moveBtn.click();
      });

      await waitFor(() => text().includes("Create PIN"), 10_000, "vault setup view");
      (document.getElementById("twofactor-create-pin") as HTMLInputElement).value = "123456";
      (document.getElementById("twofactor-confirm-pin") as HTMLInputElement).value = "123456";
      await act(async () => {
        buttonByText("Create vault").click();
      });
      await waitFor(
        () => text().includes("1 authenticator code ready"),
        60_000,
        "pending banner on unlocked panel"
      );

      startTimeline();
      const clickAt = Date.now() - baseTime;
      await act(async () => {
        buttonByText("Save").click();
      });

      try {
        await waitFor(
          () =>
            Array.from(document.querySelectorAll('[role="alert"]')).some((el) =>
              (el.textContent ?? "").includes(parseError)
            ),
          10_000,
          "vault.error alert carrying the parse error"
        );
      } finally {
        console.log(`[legacy timeline] ${JSON.stringify(timeline, null, 1)}`);
        console.log(`[legacy storage writes] ${JSON.stringify(storageWrites.filter((w) => w.at >= clickAt))}`);
        console.log(`[legacy page errors] ${JSON.stringify(pageErrors)}`);
        observer?.disconnect();
        observer = null;
      }

      // Post-13002e3: the stop is visible. Pre-fix this alert never rendered and
      // the DOM returned to an identical snapshot — the reported "Save does nothing".
      expect(
        Array.from(document.querySelectorAll('[role="alert"]')).some((el) =>
          (el.textContent ?? "").includes(parseError)
        ),
        `expected a role=alert containing "${parseError}"`
      ).toBe(true);
      // Symptom parity with the report: queue stopped, banner still up, list empty.
      expect(text()).toContain("1 authenticator code ready");
      expect(text()).toContain("No codes yet");
      expect(pageErrors).toEqual([]);
      // No entry may have been persisted for the unparseable URI.
      expect(storageWrites.some((w) => w.key === VAULT_KEY && w.at >= clickAt)).toBe(false);
    }
  );
});

/**
 * Focus-contract tests for the clear-history confirmation dialog.
 *
 * A visible overlay is not a dialog. `role="dialog"` was already present and
 * described nothing: focus stayed on the page behind, Tab walked into the
 * background controls, and Escape left focus on whichever history row happened
 * to be focused. Each test below pins one of the four keyboard behaviours the
 * fix adds:
 *
 * 1. focus enters the dialog on open (on Cancel, the safe first stop);
 * 2. Tab and Shift+Tab wrap inside it;
 * 3. Escape closes it through `onCancel`;
 * 4. closing hands focus back to the opener.
 *
 * Written without JSX and without @testing-library/react, matching
 * `ScanHistory.test.ts`: the vitest include is `src/**\/*.test.ts` and neither
 * is a declared dependency.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ClearConfirmModal } from "./ClearConfirmModal";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  // Stands in for the "Clear history" button in ScanHistory: mounted outside
  // the dialog and focused by the user before the dialog opens.
  opener = document.createElement("button");
  opener.textContent = "Clear history";
  document.body.appendChild(opener);
  opener.focus();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  opener.remove();
});

type Props = {
  show: boolean;
  historyCount?: number;
  onCancel?: () => void;
  onConfirm?: () => void;
};

async function render(props: Props) {
  await act(async () => {
    root.render(
      createElement(ClearConfirmModal, {
        show: props.show,
        historyCount: props.historyCount ?? 3,
        onCancel: props.onCancel ?? (() => {}),
        onConfirm: props.onConfirm ?? (() => {}),
      })
    );
  });
}

const dialog = () =>
  container.querySelector<HTMLElement>('[role="dialog"]');

const buttons = () =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button"));

const byText = (label: string) =>
  buttons().find((b) => b.textContent?.trim() === label) ?? null;

/** A real Tab keypress on the document, which is where the trap listens. */
function pressTab(shiftKey = false) {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true })
    );
  });
}

function pressEscape() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
}

describe("ClearConfirmModal focus contract", () => {
  it("renders nothing while closed", async () => {
    await render({ show: false });
    expect(dialog()).toBeNull();
  });

  it("describes itself as a modal dialog", async () => {
    await render({ show: true });
    const el = dialog();
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-modal")).toBe("true");
    expect(el?.getAttribute("aria-labelledby")).toBe("clear-history-title");
    expect(el?.querySelector("#clear-history-title")?.textContent).toBe(
      "Clear scan history?"
    );
  });

  it("moves focus to the first control, Cancel, when it opens", async () => {
    await render({ show: true });
    expect(document.activeElement).toBe(byText("Cancel"));
  });

  it("wraps Tab from the last control back to the first", async () => {
    await render({ show: true });
    const clearAll = byText("Clear All");
    act(() => clearAll?.focus());
    expect(document.activeElement).toBe(clearAll);

    pressTab();
    expect(document.activeElement).toBe(byText("Cancel"));
  });

  it("wraps Shift+Tab from the first control back to the last", async () => {
    await render({ show: true });
    expect(document.activeElement).toBe(byText("Cancel"));

    pressTab(true);
    expect(document.activeElement).toBe(byText("Clear All"));
  });

  it("pulls focus into the dialog if it is still on the page behind", async () => {
    await render({ show: true });
    // Adversarial: something outside the dialog holds focus again.
    act(() => opener.focus());
    expect(document.activeElement).toBe(opener);

    pressTab();
    expect(document.activeElement).toBe(byText("Cancel"));
  });

  it("closes on Escape through onCancel", async () => {
    const onCancel = vi.fn();
    await render({ show: true, onCancel });

    pressEscape();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the opener when it closes", async () => {
    await render({ show: true });
    expect(document.activeElement).toBe(byText("Cancel"));

    await render({ show: false });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("does not steal focus from the opener while closed", async () => {
    await render({ show: false });
    expect(document.activeElement).toBe(opener);
  });

  /**
   * `App` marks the background `inert` while this dialog is open, which is what
   * actually removes it from the tab order and the accessibility tree. That
   * wiring is `inert={showClearConfirm}` and nothing else, so what needs pinning
   * here is the attribute React 19 writes for those values: present (and empty,
   * i.e. boolean) when true, absent — not `inert="false"` — when false.
   */
  it("writes the boolean inert attribute only when active", async () => {
    const bg = document.createElement("div");
    document.body.appendChild(bg);
    const bgRoot = createRoot(bg);
    try {
      await act(async () => {
        bgRoot.render(createElement("div", { inert: true }, "behind"));
      });
      const on = bg.firstElementChild!;
      expect(on.hasAttribute("inert")).toBe(true);
      expect(on.getAttribute("inert")).toBe("");

      await act(async () => {
        bgRoot.render(createElement("div", { inert: false }, "behind"));
      });
      expect(bg.firstElementChild!.hasAttribute("inert")).toBe(false);
    } finally {
      act(() => bgRoot.unmount());
      bg.remove();
    }
  });

  // `App` passes `onCancel={() => setShowClearConfirm(false)}`, a new function
  // identity on every render, so the effect that owns the focus contract tears
  // down and re-runs whenever the page re-renders while this dialog is open.
  // The re-run must not yank focus back to Cancel (that would make the "Clear
  // All" button unreachable by keyboard), and the re-cleanup must not bounce
  // focus to the opener while the dialog is still open.
  it("keeps focus where the user put it across parent re-renders", async () => {
    await render({ show: true });
    const clearAll = byText("Clear All");
    act(() => clearAll?.focus());
    expect(document.activeElement).toBe(clearAll);

    // Same props, new `onCancel` identity: the parent re-rendered.
    await render({ show: true, onCancel: () => {} });

    expect(document.activeElement).toBe(clearAll);
    expect(dialog()).not.toBeNull();
  });
});

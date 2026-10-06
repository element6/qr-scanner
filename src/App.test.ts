/**
 * Failure 2 — the confirm dialog must not sit inside the inert region.
 *
 * `inert` applies to an element *and its whole subtree*, so a dialog rendered
 * inside the region marked inert is itself inert: it cannot take focus, and
 * Tab walks the page behind it (measured: `document.activeElement === BODY`
 * after open, 9/9 Tab stops outside the dialog). jsdom does not implement
 * inertness, so these tests assert the wiring that produces it.
 *
 * Two halves:
 *
 *  - **Rendered** — the same structure `App` renders (background wrapped in
 *    `inert`, dialog a sibling), proving the dialog keeps focus and that the
 *    opener, not a history row, gets it back.
 *  - **Authored** — `src/App.tsx` is read as source and the JSX nesting is
 *    compared, because that is the only place the arrangement is actually
 *    decided. If a later edit moves `<ClearConfirmModal>` back inside the
 *    wrapper, the rendered half would still pass while the real page regressed;
 *    this half is what catches that.
 */
import { createElement, act, type ReactElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ClearConfirmModal } from "./components/ClearConfirmModal";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

// `import.meta.url` is an http URL under jsdom, so resolve from the project
// root instead: vitest runs with the repo root as cwd.
const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

/** The `inert={…}` JSX attribute the page uses to hide the background. */
const INERT_ATTR = /inert=\{([^}]*)\}/g;
/** Any `inert` written as an attribute, value or not (`inert={x}`, `inert=""`). */
const INERT_ANYWHERE = /inert\s*=/g;

describe("App wiring: dialog sits outside the inert region", () => {
  it("marks exactly one wrapper inert, and it is not the dialog", () => {
    const matches = [...appSource.matchAll(INERT_ATTR)];
    expect(matches).toHaveLength(1);
    // The attribute value is the confirm-dialog flag, not a literal.
    expect(matches[0][1].trim()).toBe("showClearConfirm");
    // Exactly one attribute site: a second one would mean part of the page is
    // inert at the wrong time (a literal `inert` would be permanently inert).
    // Prose about inertness does not match, since this requires `=`.
    expect([...appSource.matchAll(INERT_ANYWHERE)]).toHaveLength(1);
  });

  it("renders the dialog after the inert wrapper closes", () => {
    const inertIndex = appSource.search(INERT_ATTR);
    expect(inertIndex).toBeGreaterThan(-1);
    const dialogIndex = appSource.indexOf("<ClearConfirmModal");
    expect(dialogIndex).toBeGreaterThan(inertIndex);

    // Walk the JSX from the `inert` attribute: its element's opening tag ends
    // at the first `>`, and its matching close must come *before* the dialog.
    const openTagEnd = appSource.indexOf(">", inertIndex);
    expect(openTagEnd).toBeGreaterThan(inertIndex);
    const wrapperClose = appSource.indexOf("\n      </div>", openTagEnd);
    expect(wrapperClose).toBeGreaterThan(openTagEnd);
    expect(dialogIndex).toBeGreaterThan(wrapperClose);
  });

  it("closes <main> last, with the dialog as its direct child", () => {
    const dialogIndex = appSource.indexOf("<ClearConfirmModal");
    const mainClose = appSource.lastIndexOf("</main>");
    expect(mainClose).toBeGreaterThan(dialogIndex);
    // Nothing between the dialog's end and `</main>` except whitespace.
    const dialogEnd = appSource.indexOf("/>", dialogIndex) + 2;
    expect(appSource.slice(dialogEnd, mainClose).trim()).toBe("");
  });
});

/**
 * The otpauth scan tail is the one place a TOTP URI could leak into rendered,
 * copied or stored state, so it is asserted at the source the same way the inert
 * nesting is: no App render harness exists (App needs camera + WebAuthn ports),
 * and the branch is pure wiring, which is exactly what a source read can pin.
 */
describe("App wiring: the otpauth scan tail never leaks the secret", () => {
  // The TOTP branch of `applyDetectedValue`, then its accepted (`parsed.ok`)
  // block: the region that must call no persisting, copying or announcing API.
  const totpStart = appSource.indexOf('if (kind === "otpauth-totp")');
  const hotpStart = appSource.indexOf('if (kind === "otpauth-hotp"');
  const totpBranch = appSource.slice(totpStart, hotpStart);
  const acceptedStart = totpBranch.indexOf("if (parsed.ok) {");
  const acceptedEnd = totpBranch.indexOf(
    "return;",
    totpBranch.indexOf('setActiveTab("2fa")')
  );
  const accepted = totpBranch.slice(acceptedStart, acceptedEnd);

  it("locates the TOTP branch and its accepted block", () => {
    expect(totpStart).toBeGreaterThan(-1);
    expect(hotpStart).toBeGreaterThan(totpStart);
    expect(acceptedStart).toBeGreaterThan(-1);
    expect(acceptedEnd).toBeGreaterThan(acceptedStart);
  });

  it("does not persist, copy or announce the raw URI", () => {
    for (const forbidden of [
      "addScan(",
      "copyToClipboard(",
      "setScannedData(",
      "notify(",
      "localStorage",
      "scannedData",
    ]) {
      expect(accepted).not.toContain(forbidden);
    }
  });

  it("routes the raw URI only into memory-only pending state, merging by URI", () => {
    // Merge, never replace: an in-flight pending must survive a new scan.
    expect(accepted).toContain("setPending((current) =>");
    expect(accepted).toContain("[...current.uris, value]");
    expect(accepted).toContain("source: current.source");
    // The no-pending branch is the only place source is set to "scan".
    expect(accepted).toContain('return { uris: [value], source: "scan" };');
    // The old replace-everything form must not come back.
    expect(accepted).not.toContain('setPending({ uris: [value], source: "scan" })');
    expect(accepted).toContain('setActiveTab("2fa")');
  });

  it("clears the otpauth dedupe ref when pending resolves, for either result", () => {
    const resolvedStart = appSource.indexOf(
      "const handlePendingResolved = useCallback("
    );
    const resolvedEnd = appSource.indexOf(
      "// Keyboard shortcuts using useKeyboardShortcuts hook"
    );
    expect(resolvedStart).toBeGreaterThan(-1);
    expect(resolvedEnd).toBeGreaterThan(resolvedStart);
    const resolved = appSource.slice(resolvedStart, resolvedEnd);
    expect(resolved).toContain("lastOtpauthRef.current = null;");
    // Unconditional: it is cleared before the saved-only early return, so a
    // dismiss also re-arms the ref.
    expect(resolved.indexOf("lastOtpauthRef.current = null;")).toBeLessThan(
      resolved.indexOf('if (result !== "saved"')
    );
  });

  it("rejects HOTP and other classes without touching scannedData", () => {
    const rejection = appSource.slice(
      hotpStart,
      // Search from hotpStart: an earlier `source === "camera"` guard (the
      // camera pause) also sits inside the TOTP block.
      appSource.indexOf('if (source === "camera")', hotpStart)
    );
    expect(rejection).toContain("UNSUPPORTED_OTP_MESSAGE");
    for (const forbidden of [
      "addScan(",
      "copyToClipboard(",
      "setScannedData(",
      "localStorage",
    ]) {
      expect(rejection).not.toContain(forbidden);
    }
  });

  it("guards the c shortcut against every otpauth class", () => {
    const keyIndex = appSource.indexOf('key: "c"');
    expect(keyIndex).toBeGreaterThan(-1);
    const handler = appSource.slice(keyIndex, keyIndex + 320);
    expect(handler).toContain("isOtpauthKind(scannedKind)");
  });
});

describe("ClearConfirmModal: focus escapes the inert background", () => {
  let container: HTMLDivElement;
  let root: Root;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

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

  /** App's arrangement: inert background region, dialog as its sibling. */
  function backgroundWith(show: boolean): ReactElement {
    return createElement(
      "div",
      { inert: show },
      createElement("div", null, createElement("button", null, "background"))
    );
  }

  it("leaves no ancestor of the dialog inert", () => {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          backgroundWith(true),
          createElement(ClearConfirmModal, {
            show: true,
            historyCount: 2,
            onCancel: () => {},
            onConfirm: () => {},
          })
        )
      )
    );

    // The background is inert…
    const inertRegion = document.querySelector("[inert]") as HTMLElement;
    expect(inertRegion).not.toBeNull();
    expect(inertRegion.hasAttribute("inert")).toBe(true);

    // …and the dialog is not: walk every ancestor of it.
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    for (let node: Node | null = dialog; node; node = node.parentNode) {
      if (node instanceof Element) {
        expect(node.hasAttribute("inert")).toBe(false);
      }
    }
    expect(inertRegion.contains(dialog)).toBe(false);
  });

  it("takes focus inside the dialog even though the opener is inert", () => {
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          backgroundWith(true),
          createElement(ClearConfirmModal, {
            show: true,
            historyCount: 2,
            onCancel: () => {},
            onConfirm: () => {},
          })
        )
      )
    );

    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).textContent).toBe("Cancel");
  });

  it("returns focus to the opener when the dialog closes", () => {
    const props = {
      historyCount: 2,
      onCancel: () => {},
      onConfirm: () => {},
    };
    act(() =>
      root.render(
        createElement(
          "div",
          null,
          backgroundWith(true),
          createElement(ClearConfirmModal, { ...props, show: true })
        )
      )
    );
    // Keep the assertion honest: focus really is inside the dialog first.
    expect(document.activeElement).not.toBe(opener);

    act(() =>
      root.render(
        createElement(
          "div",
          null,
          backgroundWith(false),
          createElement(ClearConfirmModal, { ...props, show: false })
        )
      )
    );

    // Back on the control that opened it — not a history row, not BODY.
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector("[inert]")).toBeNull();
  });
});

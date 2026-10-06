/**
 * Render-level tests for the Scan History row contract.
 *
 * Two user-visible rules are pinned here:
 *
 * 1. The expand toggle is offered **only** when the value is actually clipped
 *    at two lines. A two-line-or-shorter value has nothing to reveal, so a
 *    toggle there is a dead control (the reported bug).
 * 2. Once expanded, the toggle must not disappear — the content div drops
 *    `line-clamp-2`, so a naive `scrollHeight > clientHeight` re-measure would
 *    read "no overflow" and unmount the control under the user's cursor.
 *
 * jsdom performs no layout, so every element reports `scrollHeight ===
 * clientHeight === 0`. The prototype getters below stand in for layout: the
 * tests therefore prove the *gating logic and its state transitions*, not real
 * browser wrapping. Wrapping itself is Tailwind's `line-clamp-2`.
 *
 * Written without JSX and without @testing-library/react to match
 * `QrGenerator.test.ts`: the vitest include is `src/**\/*.test.ts` and neither
 * is a declared dependency.
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ScanHistory } from "./ScanHistory";
import { isValidUrl, type HistoryItem } from "../utils/validators";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const SHORT: HistoryItem = {
  id: "short",
  data: "hello",
  timestamp: "2026-01-01T00:00:00.000Z",
};
const LONG: HistoryItem = {
  id: "long",
  data: "x".repeat(400),
  timestamp: "2026-01-02T00:00:00.000Z",
};
const URL_ITEM: HistoryItem = {
  id: "url",
  data: "https://example.com/a",
  timestamp: "2026-01-03T00:00:00.000Z",
};

/** Stand-in for layout: when true, the measured content div is "clipped". */
let clipped = false;
/**
 * Emulates an engine that reports `scrollHeight === clientHeight` for a
 * `-webkit-line-clamp` box. The naive `scrollHeight - clientHeight` probe reads
 * zero there and hides the toggle for every clipped value.
 */
let hostileClamp = false;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  clipped = false;
  hostileClamp = false;

  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (hostileClamp && this.classList.contains("line-clamp-2")) {
        return this.clientHeight;
      }
      return clipped ? 60 : 40;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 40,
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
});

type Props = {
  history: HistoryItem[];
  expandedItems?: Set<string>;
  onToggleExpand?: (id: string) => void;
  onOpenUrl?: (data: string) => void;
  onSearchWeb?: (data: string) => void;
  onClearHistory?: () => void;
  showMigrationBanner?: boolean;
  onMoveOtpauth?: () => void;
  onRemoveOtpauth?: () => void;
};

async function render(props: Props) {
  await act(async () => {
    root.render(
      createElement(ScanHistory, {
        history: props.history,
        expandedItems: props.expandedItems ?? new Set<string>(),
        onCopyHistoryItem: () => {},
        onToggleExpand: props.onToggleExpand ?? (() => {}),
        onDeleteItem: () => {},
        onOpenUrl: props.onOpenUrl ?? (() => {}),
        onSearchWeb: props.onSearchWeb ?? (() => {}),
        onClearHistory: props.onClearHistory ?? (() => {}),
        isValidUrl,
        // Omitted when unset so the component's own `true` default is exercised.
        ...(props.showMigrationBanner === undefined
          ? {}
          : { showMigrationBanner: props.showMigrationBanner }),
        onMoveOtpauth: props.onMoveOtpauth,
        onRemoveOtpauth: props.onRemoveOtpauth,
      })
    );
  });
}

// Row action names are content-bearing (`Copy <value>`), so the verb is matched
// as a prefix; the verbs are distinct, so a prefix identifies one affordance.
const byLabel = (verb: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label^="${verb}"]`);

const byText = (label: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label
  );

const contentDiv = () =>
  container.querySelector<HTMLDivElement>(".line-clamp-2") ??
  container.querySelector<HTMLDivElement>(".break-words");

async function click(el: HTMLElement | null | undefined) {
  expect(el).toBeDefined();
  await act(async () => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("ScanHistory expand affordance", () => {
  it("hides the expand toggle when the value fits in two lines", async () => {
    clipped = false;
    await render({ history: [SHORT] });

    expect(byLabel("Expand")).toBeNull();
    expect(byLabel("Collapse")).toBeNull();
  });

  it("shows the expand toggle when the value is clipped", async () => {
    clipped = true;
    await render({ history: [SHORT] });

    expect(byLabel("Expand")).not.toBeNull();
  });

  it("keeps the toggle mounted after expanding (no re-measure collapse)", async () => {
    clipped = true;
    await render({ history: [SHORT] });
    expect(byLabel("Expand")).not.toBeNull();

    await render({ history: [SHORT], expandedItems: new Set([SHORT.id]) });

    // Still present, now labelled Collapse — and the clamp is gone.
    expect(byLabel("Collapse")).not.toBeNull();
    expect(container.querySelector(".line-clamp-2")).toBeNull();
    expect(contentDiv()?.textContent).toBe(SHORT.data);
  });

  it("reports the toggled id to the parent", async () => {
    clipped = true;
    const seen: string[] = [];
    await render({ history: [SHORT], onToggleExpand: (id) => seen.push(id) });

    await click(byLabel("Expand"));

    expect(seen).toEqual([SHORT.id]);
  });

  it("does not offer a toggle for an unclipped row alongside a clipped one", async () => {
    // Both rows are measured against the same mocked layout; the short one is
    // rendered alone to confirm the gate is per-row, not per-list.
    clipped = false;
    await render({ history: [SHORT, LONG] });
    expect(container.querySelectorAll('button[aria-label^="Expand"]').length).toBe(0);
  });

  it("keeps a Collapse control when a row mounts already expanded", async () => {
    // Reproduces the search-filter round trip: expanding a row, typing a query
    // that excludes it, then clearing the query remounts HistoryRow with
    // `expanded` already true. The toggle must survive that mount path.
    clipped = true;
    await render({ history: [SHORT], expandedItems: new Set([SHORT.id]) });

    expect(byLabel("Collapse")).not.toBeNull();
  });

  it("detects overflow even when a clamped box reports scrollHeight === clientHeight", async () => {
    // Pins the engine-independent measurement: a clamped box's scrollHeight is
    // never trusted, so the hostile-engine case still yields a toggle.
    hostileClamp = true;
    clipped = true;
    await render({ history: [SHORT] });

    expect(byLabel("Expand")).not.toBeNull();
  });

  it("still reports no overflow on the hostile engine when the value fits", async () => {
    hostileClamp = true;
    clipped = false;
    await render({ history: [SHORT] });

    expect(byLabel("Expand")).toBeNull();
  });
});

describe("ScanHistory row actions", () => {
  // The reported defect: every action name was built from a 24-character
  // prefix of the payload, so two rows sharing a prefix announced as the same
  // control ("Copy https://example.com/shar" twice) and a screen-reader user
  // could not tell them apart.
  it("gives rows with a shared payload prefix distinct action names", async () => {
    const collideA: HistoryItem = {
      id: "collide-a",
      data: "https://example.com/share/alpha",
      timestamp: "2026-01-04T00:00:00.000Z",
    };
    const collideB: HistoryItem = {
      id: "collide-b",
      data: "https://example.com/share/beta",
      timestamp: "2026-01-05T00:00:00.000Z",
    };
    await render({ history: [collideA, collideB] });

    // The prefix the defect truncated at, made explicit: both rows are
    // identical for well over 24 characters.
    expect(collideA.data.slice(0, 24)).toBe(collideB.data.slice(0, 24));

    const names = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Copy"]')
    ).map((b) => b.getAttribute("aria-label"));

    expect(names.length).toBe(2);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).not.toBe(names[1]);
    // Still content-bearing, still verb-first, and now ordinal-tagged.
    expect(names[0]).toMatch(/^Copy https:\/\/example\.com\/share\/(alpha|beta) \(row [12]\)$/);
    expect(names[1]).toMatch(/^Copy https:\/\/example\.com\/share\/(alpha|beta) \(row [12]\)$/);
  });

  it("keeps the ordinal visible after clipping a long payload", async () => {
    await render({ history: [LONG] });

    const copy = byLabel("Copy");
    expect(copy?.getAttribute("aria-label")).not.toBeNull();
    expect(copy?.getAttribute("aria-label")).toMatch(/ \(row 1\)$/);
  });

  it("offers Open URL only for values that are valid http(s) URLs", async () => {
    await render({ history: [SHORT, URL_ITEM] });

    const openButtons = container.querySelectorAll('button[aria-label^="Open"]');
    expect(openButtons.length).toBe(1);
  });

  it("opens the row's own URL, not the newest row's value", async () => {
    const opened: string[] = [];
    await render({
      history: [SHORT, URL_ITEM],
      onOpenUrl: (data) => opened.push(data),
    });

    await click(byLabel("Open"));

    expect(opened).toEqual([URL_ITEM.data]);
  });

  it("always offers Copy and Delete per row", async () => {
    await render({ history: [SHORT, URL_ITEM] });

    expect(container.querySelectorAll('button[aria-label^="Copy"]').length).toBe(2);
    expect(container.querySelectorAll('button[aria-label^="Delete"]').length).toBe(2);
  });

  it("offers Search with Google only for values that are not URLs", async () => {
    await render({ history: [SHORT, URL_ITEM] });

    // One of each across two rows: the two affordances are mutually exclusive,
    // so neither row can offer both.
    expect(
      container.querySelectorAll('button[aria-label^="Search with Google"]').length
    ).toBe(1);
    expect(container.querySelectorAll('button[aria-label^="Open"]').length).toBe(1);
  });

  it("searches the row's own non-URL value", async () => {
    const searched: string[] = [];
    await render({
      history: [SHORT, URL_ITEM],
      onSearchWeb: (data) => searched.push(data),
    });

    await click(byLabel("Search with Google for"));

    expect(searched).toEqual([SHORT.data]);
  });

  it("treats non-http schemes as searchable rather than openable", async () => {
    await render({
      history: [
        { id: "mail", data: "mailto:a@b.com", timestamp: "2026-01-04T00:00:00.000Z" },
      ],
    });

    expect(byLabel("Search with Google for")).not.toBeNull();
    expect(byLabel("Open")).toBeNull();
  });

  it("hides Search with Google for a whitespace-only value", async () => {
    // The scan pipeline rejects "" but not "   ", so this row is reachable and
    // must not render a button that opens an empty results page.
    await render({
      history: [{ id: "blank", data: "   ", timestamp: "2026-01-05T00:00:00.000Z" }],
    });

    expect(byLabel("Search with Google for")).toBeNull();
    expect(byLabel("Open")).toBeNull();
  });
});

describe("ScanHistory clear history", () => {
  it("hides Clear history when there is nothing to clear", async () => {
    await render({ history: [] });

    expect(byText("Clear history")).toBeUndefined();
    expect(container.textContent).toContain("No scan history yet.");
  });

  it("moves Clear history into this card and fires the handler", async () => {
    let cleared = 0;
    await render({ history: [SHORT], onClearHistory: () => (cleared += 1) });

    await click(byText("Clear history"));

    expect(cleared).toBe(1);
  });
});

const OTPAUTH_SECRET = "JBSWY3DPEHPK3PXP";
const OTPAUTH_URI = `otpauth://totp/Example:alice@example.com?secret=${OTPAUTH_SECRET}&issuer=Example`;
const OTPAUTH_ITEM: HistoryItem = {
  id: "otp",
  data: OTPAUTH_URI,
  timestamp: "2026-01-06T00:00:00.000Z",
};

describe("ScanHistory otpauth redaction", () => {
  it("shows the fixed text, drops the secret from DOM and every aria-label, and hides Copy", async () => {
    await render({ history: [OTPAUTH_ITEM] });

    expect(container.textContent).toContain("Authenticator code — hidden");
    expect(container.textContent).not.toContain(OTPAUTH_SECRET);
    expect(container.innerHTML).not.toContain(OTPAUTH_SECRET);

    const labelled = Array.from(container.querySelectorAll("[aria-label]"));
    expect(labelled.length).toBeGreaterThan(0);
    for (const el of labelled) {
      const label = el.getAttribute("aria-label") ?? "";
      expect(label).not.toContain(OTPAUTH_SECRET);
      expect(label).not.toContain("otpauth");
    }

    // Hidden, not disabled: no affordance on this row may copy the seed.
    expect(container.querySelectorAll('button[aria-label^="Copy"]').length).toBe(0);
    // Delete is unrelated to the secret and stays; its `title` is static, since
    // the aria-label must be the fixed redacted string on this row.
    expect(container.querySelectorAll('button[title="Delete"]').length).toBe(1);
  });

  it("leaves a non-otpauth row unchanged: value visible and Copy present", async () => {
    await render({ history: [SHORT] });

    expect(container.textContent).toContain(SHORT.data);
    expect(container.querySelectorAll('button[aria-label^="Copy"]').length).toBe(1);
  });

  it("offers no search action on an otpauth row, but still offers one elsewhere", async () => {
    // `title` is static on both kinds of row, so it identifies the affordance
    // even though an otpauth row's aria-label is the fixed redacted string.
    await render({ history: [OTPAUTH_ITEM] });
    expect(container.querySelectorAll('button[title="Search with Google"]').length).toBe(0);

    await render({ history: [SHORT] });
    expect(container.querySelectorAll('button[title="Search with Google"]').length).toBe(1);
  });
});

describe("ScanHistory migration banner", () => {
  const HOTP_ITEM: HistoryItem = {
    id: "otp2",
    data: "otpauth://hotp/Example:bob@example.com?secret=KRSXG5CTMVRXEZLU&counter=1",
    timestamp: "2026-01-07T00:00:00.000Z",
  };

  it("is absent when only non-otpauth rows exist", async () => {
    await render({ history: [SHORT, URL_ITEM] });

    expect(byText("Move to 2FA vault")).toBeUndefined();
    expect(container.textContent).not.toContain("authenticator code");
  });

  it("is hidden when showMigrationBanner is false", async () => {
    await render({ history: [OTPAUTH_ITEM], showMigrationBanner: false });

    expect(byText("Move to 2FA vault")).toBeUndefined();
    expect(container.textContent).not.toContain("authenticator code");
  });

  it("counts only otpauth rows and pluralizes honestly", async () => {
    await render({ history: [OTPAUTH_ITEM] });
    expect(container.textContent).toContain(
      "1 authenticator code found in scan history — move to 2FA vault or remove"
    );

    await render({ history: [OTPAUTH_ITEM, HOTP_ITEM, SHORT] });
    expect(container.textContent).toContain(
      "2 authenticator codes found in scan history — move to 2FA vault or remove"
    );
  });

  it("fires the move and remove callbacks", async () => {
    let moved = 0;
    let removed = 0;
    await render({
      history: [OTPAUTH_ITEM, HOTP_ITEM],
      onMoveOtpauth: () => (moved += 1),
      onRemoveOtpauth: () => (removed += 1),
    });

    await click(byText("Move to 2FA vault"));
    await click(byText("Remove from history"));

    expect(moved).toBe(1);
    expect(removed).toBe(1);
  });

  it("renders only the button whose callback was provided", async () => {
    await render({ history: [OTPAUTH_ITEM], onMoveOtpauth: () => {} });

    expect(byText("Move to 2FA vault")).toBeDefined();
    expect(byText("Remove from history")).toBeUndefined();
  });
});

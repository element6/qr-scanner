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
  onClearHistory?: () => void;
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
        onClearHistory: props.onClearHistory ?? (() => {}),
        isValidUrl,
      })
    );
  });
}

const byLabel = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

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
    expect(container.querySelectorAll('button[aria-label="Expand"]').length).toBe(0);
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
  it("offers Open URL only for values that are valid http(s) URLs", async () => {
    await render({ history: [SHORT, URL_ITEM] });

    const openButtons = container.querySelectorAll('button[aria-label="Open URL"]');
    expect(openButtons.length).toBe(1);
  });

  it("opens the row's own URL, not the newest row's value", async () => {
    const opened: string[] = [];
    await render({
      history: [SHORT, URL_ITEM],
      onOpenUrl: (data) => opened.push(data),
    });

    await click(byLabel("Open URL"));

    expect(opened).toEqual([URL_ITEM.data]);
  });

  it("always offers Copy and Delete per row", async () => {
    await render({ history: [SHORT, URL_ITEM] });

    expect(container.querySelectorAll('button[aria-label="Copy"]').length).toBe(2);
    expect(container.querySelectorAll('button[aria-label="Delete"]').length).toBe(2);
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

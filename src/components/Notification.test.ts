/**
 * Render-level tests for the Notification live region.
 *
 * Three rules are pinned here:
 *
 * 1. The live region is **always** mounted (`role="status"`,
 *    `aria-live="polite"`), even with no message — unmounting it drops the
 *    announcement before a screen reader can fire it.
 * 2. While empty it renders **no visible chrome** (`sr-only`). The old
 *    non-breaking-space placeholder kept a bordered, pale-green box on screen
 *    permanently, which read as a blank bar; `sr-only` is also absolutely
 *    positioned, so the empty node adds no `space-y-*` gap either.
 * 3. An error must not be painted as success green — it is the only remaining
 *    camera-failure surface after the Last Scan panel was removed.
 *
 * Written without JSX and without @testing-library/react to match
 * `QrGenerator.test.ts`: the vitest include is `src/**\/*.test.ts` and neither
 * is a declared dependency.
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Notification } from "./Notification";
import type { NotificationTone } from "../hooks/useClipboard";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

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

async function render(message: string, tone?: NotificationTone) {
  await act(async () => {
    root.render(createElement(Notification, { message, tone }));
  });
}

const region = () =>
  container.querySelector<HTMLDivElement>('[role="status"]');

describe("Notification live region", () => {
  it("keeps the live region mounted with no message", async () => {
    await render("");

    const el = region();
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-live")).toBe("polite");
  });

  it("shows no visible chrome while empty", async () => {
    await render("");

    const el = region()!;
    expect(el.className).toBe("sr-only");
    // None of the visible box utilities survive into the empty state.
    expect(el.className).not.toContain("border");
    expect(el.className).not.toContain("bg-");
    expect(el.className).not.toContain("px-4");
    expect(el.textContent).toBe("");
  });

  it("renders the message in the success tone by default", async () => {
    await render("Scan saved to history");

    const el = region()!;
    expect(el.textContent).toBe("Scan saved to history");
    expect(el.className).toContain("bg-emerald-50");
    expect(el.className).not.toContain("sr-only");
  });

  it("paints an error in the error tone, never success green", async () => {
    await render("Camera error: NotAllowedError", "error");

    const el = region()!;
    expect(el.textContent).toBe("Camera error: NotAllowedError");
    expect(el.className).toContain("bg-red-50");
    expect(el.className).not.toContain("emerald");
  });
});

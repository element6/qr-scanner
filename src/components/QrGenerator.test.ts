/**
 * Render-level tests for the QR preview retention rule.
 *
 * Pins the user-visible contract of spec §4.1 R5: a *failed* encode must keep
 * the previous valid code on screen (with the warning), and clearing the text
 * must clear the preview. The dangerous regression is clearing on `!result.ok`,
 * which would silently destroy R5 — that mutation fails test 3 below.
 *
 * Written without JSX and without @testing-library/react so it runs under the
 * existing `src/**\/*.test.ts` include with no new dependency: `react-dom` is
 * already a declared dependency, and React 19 exposes `act` from "react".
 */

import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QrGenerator } from "./QrGenerator";
import type { QrEncodeResult } from "../utils/qrcode";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const OK: QrEncodeResult = {
  ok: true,
  dataUrl: "data:image/svg+xml;base64,Zmlyc3Q=",
  byteLength: 5,
};
const SECOND: QrEncodeResult = {
  ok: true,
  dataUrl: "data:image/svg+xml;base64,c2Vjb25k",
  byteLength: 6,
};
const FAILED: QrEncodeResult = {
  ok: false,
  error: "too-long",
  message: "Too long to encode",
  byteLength: 9999,
};

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

async function render(props: {
  text: string;
  result: QrEncodeResult | null;
}) {
  await act(async () => {
    root.render(
      createElement(QrGenerator, {
        text: props.text,
        result: props.result,
        onChange: () => {},
        onCopy: () => {},
        onNotify: () => {},
      })
    );
  });
}

const img = () => container.querySelector("img");
const text = () => container.textContent ?? "";

describe("QrGenerator preview retention (spec §4.1 R5)", () => {
  it("shows the empty state and no preview when text is empty", async () => {
    await render({ text: "", result: null });

    expect(img()).toBeNull();
    // The guidance now lives in the input's placeholder; the preview panel
    // states what the empty region is for instead of repeating it (clarify).
    expect(container.querySelector("textarea")?.placeholder).toBe(
      "Enter text to generate a QR code."
    );
    expect(text()).not.toContain("Could not generate a code");
  });

  it("renders the current code while the encode succeeds", async () => {
    await render({ text: "hello", result: OK });

    expect(img()?.getAttribute("src")).toBe(OK.dataUrl);
    expect(text()).not.toContain("Could not generate a code");
  });

  it("keeps the previous valid code when a later encode fails (R5)", async () => {
    await render({ text: "hello", result: OK });
    await render({ text: "hello", result: FAILED });

    // The stale-but-valid code must survive, alongside the warning.
    expect(img()?.getAttribute("src")).toBe(OK.dataUrl);
    expect(text()).toContain("Could not generate a code");
    expect(text()).toContain("Too long to encode");
  });

  it("clears the retained code once the text is emptied", async () => {
    await render({ text: "hello", result: OK });
    await render({ text: "", result: OK });

    expect(img()).toBeNull();
    // The guidance now lives in the input's placeholder; the preview panel
    // states what the empty region is for instead of repeating it (clarify).
    expect(container.querySelector("textarea")?.placeholder).toBe(
      "Enter text to generate a QR code."
    );
  });

  it("replaces the retained code after a newer success", async () => {
    await render({ text: "hello", result: OK });
    await render({ text: "hello!", result: SECOND });
    await render({ text: "hello!", result: FAILED });

    // lastGood must track the most recent success, not the first one.
    expect(img()?.getAttribute("src")).toBe(SECOND.dataUrl);
    expect(text()).toContain("Could not generate a code");
  });
});

/**
 * The Create tab's exports. Only the boundary is asserted here: render-level
 * rasterising needs a real canvas, so the PNG behaviour checked is the failure
 * notification. That path is reachable honestly in jsdom (no 2D context) and
 * the test would also catch a regression that swallowed the error.
 */
describe("QrGenerator exports (create tab)", () => {
  // Accessible names come from the button text (no redundant aria-label), so
  // the lookup matches the same string a screen reader announces.
  const buttonByLabel = (label: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === label
    );

  async function renderWithNotify(
    text: string,
    result: QrEncodeResult | null,
    rasterize?: (svgDataUrl: string) => Promise<Blob | null>
  ) {
    const notify = vi.fn();
    await act(async () => {
      root.render(
        createElement(QrGenerator, {
          text,
          result,
          onChange: () => {},
          onCopy: () => {},
          onNotify: notify,
          rasterize,
        })
      );
    });
    return notify;
  }

  /** jsdom has no `URL.createObjectURL`, and a real download is never wanted. */
  let createUrl: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:qr-generator-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("offers both exports with accessible names once a code is rendered", async () => {
    await renderWithNotify("hello", OK);

    const saveImage = buttonByLabel("Save image");
    const saveSvg = buttonByLabel("Save SVG");
    expect(saveImage?.textContent).toBe("Save image");
    expect(saveSvg?.textContent).toBe("Save SVG");
    expect(saveImage?.disabled).toBe(false);
    expect(saveSvg?.disabled).toBe(false);
  });

  it("disables both exports and keeps Copy text as the only action when there is nothing to export", async () => {
    await renderWithNotify("", null);

    expect(buttonByLabel("Save image")?.disabled).toBe(true);
    expect(buttonByLabel("Save SVG")?.disabled).toBe(true);
    // `disabled={!text}` — the incumbent copy button is disabled too, and the
    // failure notification never fires for a dead control.
    expect(buttonByLabel("Copy text")?.disabled).toBe(true);
  });

  it("allows saving the retained code while an error card is showing", async () => {
    const notify = await renderWithNotify("hello", OK);
    await act(async () => {
      root.render(
        createElement(QrGenerator, {
          text: "hello",
          result: FAILED,
          onChange: () => {},
          onCopy: () => {},
          onNotify: notify,
        })
      );
    });

    // The retained code is what is on screen, so it stays exportable.
    expect(buttonByLabel("Save image")?.disabled).toBe(false);
    expect(buttonByLabel("Save SVG")?.disabled).toBe(false);
  });

  it("tells the user when the PNG could not be rasterised, without disabling SVG", async () => {
    // The rasteriser is injected because jsdom has no canvas; a stub canvas
    // would only assert our own stub. This is the branch that matters: null
    // must become a message, never a silently dead button.
    const notify = await renderWithNotify("hello", OK, async () => null);

    await act(async () => {
      buttonByLabel("Save image")?.click();
    });

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Could not save the image"),
      "error"
    );
    // The message must point at the export that still works...
    expect(notify.mock.calls[0][0]).toMatch(/Save SVG/);
    // ...and the SVG button must still be usable afterwards.
    expect(buttonByLabel("Save SVG")?.disabled).toBe(false);
  });

  it("downloads the SVG blob and reports nothing on success", async () => {
    const notify = await renderWithNotify("hello", OK);

    await act(async () => {
      buttonByLabel("Save SVG")?.click();
    });

    expect(createUrl).toHaveBeenCalledTimes(1);
    const blob = createUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/svg+xml");
    // A successful export is silent — the file itself is the feedback.
    expect(notify).not.toHaveBeenCalled();
  });

  it("says nothing went wrong when the PNG rasterises", async () => {
    const notify = await renderWithNotify("hello", OK, async () =>
      new Blob(["png"], { type: "image/png" })
    );

    await act(async () => {
      buttonByLabel("Save image")?.click();
    });

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    // The in-flight label must be gone again.
    expect(buttonByLabel("Save image")?.textContent).toBe("Save image");
  });
});

describe("QrGenerator size-limit disclosure (clarify: progressive disclosure)", () => {
  const toggle = () =>
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="About QR code size limits"]'
    );
  const help = () => container.querySelector("#qr-generator-size-help");

  it("keeps the size help out of the reading order until ? is activated", async () => {
    await render({ text: "hello", result: OK });

    // The always-visible footnote is gone: no mode/EC vocabulary in copy that
    // renders on every visit.
    expect(text()).not.toContain("error correction level");
    expect(text()).not.toContain("soft heads-up");

    expect(toggle()).not.toBeNull();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle()?.getAttribute("aria-controls")).toBe(
      "qr-generator-size-help"
    );
    expect(help()).toBeNull();

    await act(async () => {
      toggle()?.click();
    });

    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    // Pinned exactly: this is the approved wording, and it is the only place
    // the size limit is stated to the user.
    expect(help()?.textContent).toBe(
      "Long text may not fit in one QR code. Purely numeric text fits the most — about 5,600 characters."
    );
  });
});
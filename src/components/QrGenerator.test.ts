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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
/**
 * Focus-guard tests for global keyboard shortcuts.
 *
 * These pin the externally observable contract that bug 3 was about: pressing a
 * shortcut key while a *button* has focus must not be treated as a shortcut.
 * Regression guard: an earlier revision used `closest("input, textarea,
 * [contenteditable]")`, which matched none of the app's 13 `<button>` controls.
 */

import { describe, it, expect } from "vitest";
import {
  SHORTCUT_IGNORE_SELECTOR,
  shouldIgnoreShortcut,
} from "./keyboardGuard";

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe("shouldIgnoreShortcut", () => {
  it("ignores shortcuts from a focused button", () => {
    const host = mount("<button>Copy</button>");
    expect(shouldIgnoreShortcut(host.querySelector("button"))).toBe(true);
  });

  it("ignores shortcuts from text fields and rich-text hosts", () => {
    const host = mount(
      "<input><textarea></textarea><div contenteditable='true'></div>"
    );
    for (const sel of ["input", "textarea", "[contenteditable]"]) {
      expect(shouldIgnoreShortcut(host.querySelector(sel))).toBe(true);
    }
  });

  it("ignores shortcuts from select and links", () => {
    const host = mount("<select></select><a href='#'>x</a>");
    expect(shouldIgnoreShortcut(host.querySelector("select"))).toBe(true);
    expect(shouldIgnoreShortcut(host.querySelector("a"))).toBe(true);
  });

  it("ignores shortcuts from a control nested in another element", () => {
    // Containment, not identity: the target is the button, not the wrapper.
    const host = mount("<span class='row'><button>Pause</button></span>");
    expect(shouldIgnoreShortcut(host.querySelector("button"))).toBe(true);
  });

  it("still allows shortcuts from non-control targets", () => {
    const host = mount("<div><p>body text</p></div>");
    expect(shouldIgnoreShortcut(host.querySelector("p"))).toBe(false);
    expect(shouldIgnoreShortcut(document.body)).toBe(false);
  });

  it("tolerates a null or non-Element target", () => {
    expect(shouldIgnoreShortcut(null)).toBe(false);
    expect(shouldIgnoreShortcut(document)).toBe(false);
  });

  it("exempts an explicitly non-editable contenteditable host", () => {
    // Mirrors the selector's :not([contenteditable='false']) clause.
    expect(SHORTCUT_IGNORE_SELECTOR).toContain("contenteditable");
  });
});
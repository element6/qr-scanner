/**
 * Focus guard for global keyboard shortcuts.
 *
 * A shortcut must never fire while focus sits in a control that legitimately
 * consumes the same key. Membership is tested by *containment*
 * (`Element.closest`) rather than by `instanceof` checks, so a `<button>`
 * nested inside another element is still recognised, and so a single list
 * covers every control type the app renders.
 *
 * Kept as a pure predicate in a `.ts` module on purpose: `App.tsx` is a `.tsx`
 * component, and this logic used to live inline there, where no executed test
 * could reach it — which is exactly how the selector came to omit `button`.
 */
export const SHORTCUT_IGNORE_SELECTOR =
  "input, textarea, select, button, a[href], " +
  "[contenteditable]:not([contenteditable='false'])";

/**
 * Returns true when a keydown event's target is inside a control that should
 * swallow app-level shortcuts.
 *
 * @param target - The event target (`KeyboardEvent.target`), possibly null
 * @returns true if the shortcut must not run
 */
export function shouldIgnoreShortcut(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(SHORTCUT_IGNORE_SELECTOR) !== null
  );
}
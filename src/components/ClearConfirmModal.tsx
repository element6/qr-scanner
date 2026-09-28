import { useEffect, useRef } from "react";

type ClearConfirmModalProps = {
  show: boolean;
  historyCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Focusable descendants, in DOM order. Every control in this dialog is a
 *  `<button>`, so the list is short; the rest of the selector is there so a
 *  future control cannot silently fall outside the trap. */
const FOCUSABLE_SELECTOR = "button, [href], input, select, textarea";

function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * The destructive-action confirmation.
 *
 * A visible overlay is not a dialog. `role="dialog"` and `aria-modal="true"`
 * only *describe* one; the keyboard has to behave like it too, which is what
 * the effect below adds. Three things are load-bearing:
 *
 * 1. **Focus enters.** On open, the element that currently has focus (the
 *    opener — the history button that set `show`) is remembered, and the
 *    dialog's first control takes focus. Cancel is first because the first
 *    thing a keyboard user should reach in a destructive confirmation is the
 *    way out.
 * 2. **Focus stays.** Tab and Shift+Tab wrap between the dialog's first and
 *    last controls instead of walking into the page behind it.
 * 3. **Focus returns.** On close, focus goes back to the opener, so the user
 *    resumes at the button they pressed rather than at the top of the document.
 *
 * The background is additionally `inert` while this is open (see `App.tsx`),
 * which is what removes it from the tab order and the accessibility tree; the
 * wrap above covers focus that arrives from outside for any other reason.
 */
export function ClearConfirmModal({
  show,
  historyCount,
  onCancel,
  onConfirm,
}: ClearConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  /** The control to hand focus back to when this dialog closes. */
  const openerRef = useRef<HTMLElement | null>(null);
  /**
   * The keydown listener needs the *current* `onCancel`, but must not be
   * re-subscribed when the caller re-creates it. `App` passes an inline arrow,
   * so a new identity every render would otherwise tear the listener down and
   * re-run the focus work below on every parent render.
   */
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  /** Focus contract, keyed on visibility alone. */
  useEffect(() => {
    if (!show) return;

    // Captured before focus moves, so it is genuinely the opener.
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelRef.current?.focus();

    return () => {
      // The caller drops `inert` from the background in the commit that
      // unmounts this dialog, so the opener is focusable again by now.
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [show]);

  useEffect(() => {
    if (!show) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = focusableWithin(dialogRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const inside = active !== null && dialogRef.current?.contains(active);

      if (!inside) {
        // Focus is still on the page behind (or never entered): pull it in.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [show]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-history-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <h3 id="clear-history-title" className="text-lg font-semibold text-slate-800">
          Clear scan history?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          This will delete {historyCount} saved scan(s). This action
          cannot be undone.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="min-h-11 flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}

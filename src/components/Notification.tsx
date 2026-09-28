import type { NotificationTone } from "../hooks/useClipboard";

type NotificationProps = {
  message: string;
  tone?: NotificationTone;
  /**
   * Optional inline action (e.g. "Undo" after a destructive history delete).
   * Rendered inside the same live region, so the affordance is announced with
   * the message rather than appearing as an unlabelled stray button.
   */
  action?: { label: string; onClick: () => void };
};

const TONE_CLASSES: Record<NotificationTone, string> = {
  info: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-red-200 bg-red-50 text-red-700",
};

export function Notification({ message, tone = "info", action }: NotificationProps) {
  // The live region stays mounted even when empty: unmounting it would drop the
  // announcement before a screen reader can fire it (the ImageScanControl.tsx
  // pattern). While empty it is `sr-only` rather than a bordered box, so an idle
  // app shows no blank bar — the old non-breaking-space placeholder existed only
  // to give that always-visible box a height. `sr-only` is absolutely
  // positioned, so it also stops the empty node from consuming an extra
  // `space-y-*` gap above the history list.
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        message
          ? `rounded-lg border px-4 py-2 text-sm ${TONE_CLASSES[tone]}`
          : "sr-only"
      }
    >
      <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 break-words">{message}</span>
        {message && action && (
          <button
            type="button"
            onClick={action.onClick}
            className="text-sm font-semibold underline-offset-2 hover:underline"
          >
            {action.label}
          </button>
        )}
      </span>
    </div>
  );
}

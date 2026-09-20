import type { NotificationTone } from "../hooks/useClipboard";

type NotificationProps = {
  message: string;
  tone?: NotificationTone;
};

const TONE_CLASSES: Record<NotificationTone, string> = {
  info: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-red-200 bg-red-50 text-red-700",
};

export function Notification({ message, tone = "info" }: NotificationProps) {
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
      {message}
    </div>
  );
}

type NotificationProps = {
  message: string;
};

export function Notification({ message }: NotificationProps) {
  // Persistent live region: unmounting when empty would drop the announcement
  // before a screen reader can fire it (ImageScanControl.tsx:106-112 pattern).
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700"
    >
      {message || "\u00a0"}
    </div>
  );
}

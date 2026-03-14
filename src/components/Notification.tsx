type NotificationProps = {
  message: string;
};

export function Notification({ message }: NotificationProps) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
      {message}
    </div>
  );
}

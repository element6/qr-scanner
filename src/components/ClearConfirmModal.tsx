type ClearConfirmModalProps = {
  show: boolean;
  historyCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ClearConfirmModal({
  show,
  historyCount,
  onCancel,
  onConfirm,
}: ClearConfirmModalProps) {
  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-history-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="clear-history-title" className="text-lg font-semibold text-slate-800">
          Clear scan history?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          This will delete {historyCount} saved scan(s). This action
          cannot be undone.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
          >
            Clear All
          </button>
        </div>
      </div>
    </div>
  );
}

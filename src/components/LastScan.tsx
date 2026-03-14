type LastScanProps = {
  scannedData: string;
  error: string | null;
  onCopy: () => void;
  onOpenUrl: () => void;
  onClearHistory: () => void;
  isValidUrl: (value: string) => boolean;
};

export function LastScan({
  scannedData,
  error,
  onCopy,
  onOpenUrl,
  onClearHistory,
  isValidUrl,
}: LastScanProps) {
  const openUrlVisible = !!scannedData && isValidUrl(scannedData);

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Last Scan</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onClearHistory}
            className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-600"
          >
            Clear history
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : scannedData ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm break-words">
          <pre className="whitespace-pre-wrap">{scannedData}</pre>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">
          No QR code detected yet.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onCopy}
          disabled={!scannedData}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Copy to clipboard
        </button>
        {openUrlVisible && (
          <button
            onClick={onOpenUrl}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            Open URL
          </button>
        )}
      </div>
    </section>
  );
}

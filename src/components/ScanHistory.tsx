type HistoryItem = { data: string; timestamp: string };

type ScanHistoryProps = {
  history: HistoryItem[];
  expandedItems: Set<number>;
  onCopyHistoryItem: (data: string) => void;
  onToggleExpand: (index: number) => void;
};

export function ScanHistory({
  history,
  expandedItems,
  onCopyHistoryItem,
  onToggleExpand,
}: ScanHistoryProps) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">
          Scan History
        </h2>
        <span className="text-sm text-slate-500">
          {history.length} saved
        </span>
      </div>

      {history.length === 0 ? (
        <p className="text-sm text-slate-500">No scan history yet.</p>
      ) : (
        <div className="space-y-2">
          {history.map((item, index) => (
            <div
              key={`${item.timestamp}-${index}`}
              className="group w-full rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-indigo-400 hover:bg-white hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {new Date(item.timestamp).toLocaleString()}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleExpand(index)}
                    aria-label={expandedItems.has(index) ? "Collapse" : "Expand"}
                    className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                  >
                    <svg className={`w-4 h-4 transition-transform ${expandedItems.has(index) ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onCopyHistoryItem(item.data)}
                    aria-label={`Copy ${item.data}`}
                    className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className={`mt-1 text-sm text-slate-800 break-words ${expandedItems.has(index) ? "" : "line-clamp-2"}`}>
                {item.data}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

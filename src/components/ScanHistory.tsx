import { useState } from "react";

type HistoryItem = { data: string; timestamp: string };

type ScanHistoryProps = {
  history: HistoryItem[];
  expandedItems: Set<number>;
  onCopyHistoryItem: (data: string) => void;
  onToggleExpand: (index: number) => void;
  onDeleteItem: (index: number) => void;
};

export function ScanHistory({
  history,
  expandedItems,
  onCopyHistoryItem,
  onToggleExpand,
  onDeleteItem,
}: ScanHistoryProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredHistory = searchQuery
    ? history.filter((item) =>
        item.data.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : history;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">
          Scan History
        </h2>
        <span className="text-sm text-slate-500">
          {history.length} saved
        </span>
      </div>

      {history.length > 0 && (
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      {filteredHistory.length === 0 ? (
        <p className="text-sm text-slate-500">
          {searchQuery ? "No matching results found." : "No scan history yet."}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredHistory.map((item, index) => {
            const originalIndex = history.indexOf(item);
            return (
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
                      onClick={() => onToggleExpand(originalIndex)}
                      aria-label={expandedItems.has(originalIndex) ? "Collapse" : "Expand"}
                      className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                    >
                      <svg className={`w-4 h-4 transition-transform ${expandedItems.has(originalIndex) ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => onDeleteItem(originalIndex)}
                      aria-label="Delete"
                      className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
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
                <div className={`mt-1 text-sm text-slate-800 break-words ${expandedItems.has(originalIndex) ? "" : "line-clamp-2"}`}>
                  {item.data}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { HistoryItem } from "../utils/validators";

type ScanHistoryProps = {
  history: HistoryItem[];
  expandedItems: Set<string>;
  onCopyHistoryItem: (data: string) => void;
  onToggleExpand: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onOpenUrl: (data: string) => void;
  onClearHistory: () => void;
  isValidUrl: (value: string) => boolean;
};

type HistoryRowProps = {
  item: HistoryItem;
  expanded: boolean;
  isUrl: boolean;
  layoutEpoch: number;
  onCopyHistoryItem: (data: string) => void;
  onToggleExpand: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onOpenUrl: (data: string) => void;
};

const ICON_BUTTON = "p-1 text-slate-400 transition-colors";

/**
 * A single history row.
 *
 * Owns its own overflow measurement so the expand control is only offered when
 * the value is genuinely clipped: an item that renders in two lines or fewer
 * has nothing to reveal, and a toggle there is a dead control.
 */
function HistoryRow({
  item,
  expanded,
  isUrl,
  layoutEpoch,
  onCopyHistoryItem,
  onToggleExpand,
  onDeleteItem,
  onOpenUrl,
}: HistoryRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isClipped, setIsClipped] = useState(false);
  const contentId = `${item.id}-content`;

  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;

    // Read a clamped box's *clientHeight* against an unclamped box's
    // *scrollHeight* — never a clamped box's own scrollHeight. Some engines
    // report scrollHeight === clientHeight for a `-webkit-line-clamp` box,
    // which would hide the control for every clipped value; both readings here
    // are ordinary layout measurements. The clamp is toggled synchronously
    // inside this callback, so nothing paints in between and it cannot flash.
    const hadClamp = el.classList.contains("line-clamp-2");
    if (!hadClamp) el.classList.add("line-clamp-2");
    const clampedHeight = el.clientHeight;
    el.classList.remove("line-clamp-2");
    const fullHeight = el.scrollHeight;
    if (hadClamp) el.classList.add("line-clamp-2");

    // 1px tolerance absorbs sub-pixel line-height rounding.
    setIsClipped(fullHeight - clampedHeight > 1);
  }, []);

  // `layoutEpoch` is bumped by the single shared resize listener in
  // `ScanHistory`, so rows re-measure without each owning a window listener.
  useLayoutEffect(() => {
    measure();
  }, [measure, item.data, layoutEpoch]);

  return (
    <div className="group w-full rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-indigo-400 hover:bg-white hover:shadow-sm transition-all">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {new Date(item.timestamp).toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          {(isClipped || expanded) && (
            <button
              type="button"
              onClick={() => onToggleExpand(item.id)}
              aria-expanded={expanded}
              aria-controls={contentId}
              aria-label={expanded ? "Collapse" : "Expand"}
              title={expanded ? "Collapse" : "Expand"}
              className={`${ICON_BUTTON} hover:text-indigo-500`}
            >
              <svg className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
          {isUrl && (
            <button
              type="button"
              onClick={() => onOpenUrl(item.data)}
              aria-label="Open URL"
              title="Open URL"
              className={`${ICON_BUTTON} hover:text-emerald-600`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteItem(item.id)}
            aria-label="Delete"
            title="Delete"
            className={`${ICON_BUTTON} hover:text-red-500`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onCopyHistoryItem(item.data)}
            aria-label="Copy"
            title="Copy"
            className={`${ICON_BUTTON} hover:text-indigo-500`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref={contentRef}
        id={contentId}
        className={`mt-1 text-sm text-slate-800 break-words ${expanded ? "" : "line-clamp-2"}`}
      >
        {item.data}
      </div>
    </div>
  );
}

export function ScanHistory({
  history,
  expandedItems,
  onCopyHistoryItem,
  onToggleExpand,
  onDeleteItem,
  onOpenUrl,
  onClearHistory,
  isValidUrl,
}: ScanHistoryProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // One resize listener for the whole list: every row shares the same width, so
  // a single signal re-measures them all. Bumping a counter keeps the listener
  // count independent of history length.
  const [layoutEpoch, setLayoutEpoch] = useState(0);

  useLayoutEffect(() => {
    const onResize = () => setLayoutEpoch((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const filteredHistory = searchQuery
    ? history.filter((item) =>
        item.data.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : history;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-slate-800">
            Scan History
          </h2>
          <span className="text-sm text-slate-500">
            {history.length} saved
          </span>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-600"
          >
            Clear history
          </button>
        )}
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
          {filteredHistory.map((item) => (
            <HistoryRow
              key={item.id}
              item={item}
              expanded={expandedItems.has(item.id)}
              isUrl={isValidUrl(item.data)}
              layoutEpoch={layoutEpoch}
              onCopyHistoryItem={onCopyHistoryItem}
              onToggleExpand={onToggleExpand}
              onDeleteItem={onDeleteItem}
              onOpenUrl={onOpenUrl}
            />
          ))}
        </div>
      )}
    </section>
  );
}

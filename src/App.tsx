"use client";

import { useEffect, useMemo, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";

type HistoryItem = { data: string; timestamp: string };
const STORAGE_KEY = "qrScanHistory";
const MAX_HISTORY = 50;

const isValidUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export default function App() {
  const [scannedData, setScannedData] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [notification, setNotification] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as HistoryItem[];
      setHistory(parsed);
    } catch (err) {
      console.warn("Failed to parse scan history", err);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(""), 2200);
    return () => window.clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowClearConfirm(false);
    };
    if (showClearConfirm) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [showClearConfirm]);

  const persistHistory = (nextHistory: HistoryItem[]) => {
    setHistory(nextHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
  };

  const handleScan = (detectedCodes: Array<{ rawValue: string }>) => {
    if (!detectedCodes.length) return;

    const nextValue = detectedCodes[0].rawValue;
    if (!nextValue) return;

    if (nextValue === scannedData) return;

    setScannedData(nextValue);
    setPaused(true);
    setError(null);

    setHistory((prevHistory) => {
      const nextHistory = [
        { data: nextValue, timestamp: new Date().toISOString() },
        ...prevHistory,
      ].slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
      return nextHistory;
    });

    setNotification("Scan saved to history");
  };

  const handleError = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setError(message);
    setNotification("Camera error: " + message);
    console.error("Scanner error:", err);
  };

  const clearHistory = () => {
    setHistory([]);
    setNotification("History cleared");
    localStorage.removeItem(STORAGE_KEY);
  };

  const confirmClear = () => {
    clearHistory();
    setShowClearConfirm(false);
  };

  const copyToClipboard = async () => {
    if (!scannedData) return;
    try {
      await navigator.clipboard.writeText(scannedData);
      setNotification("Copied latest scan to clipboard");
    } catch (err) {
      console.error("Copy failed", err);
      setNotification("Copy failed");
    }
  };

  const openUrl = () => {
    if (isValidUrl(scannedData)) {
      window.open(scannedData, "_blank");
    }
  };

  const copyHistoryItem = async (data: string) => {
    try {
      await navigator.clipboard.writeText(data);
      setNotification("Copied history item");
    } catch {
      setNotification("Copy failed");
    }
  };

  const toggleExpand = (index: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const deviceConstraints = useMemo(
    () => ({ facingMode: "environment" as const }),
    []
  );

  const scannerRunning = !paused;
  const openUrlVisible = !!scannedData && isValidUrl(scannedData);

  const toggleScanner = () => {
    setError(null);
    setPaused((prev) => !prev);
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-slate-800">Code Scanner</h1>
        </header>

        {notification && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {notification}
          </div>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Camera</span>
              <span
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  scannerRunning
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {scannerRunning ? "Scanning" : "Paused"}
              </span>
            </div>
          </div>

          <div className="p-4">
            <div className="relative w-full aspect-square max-w-[400px] mx-auto bg-black overflow-hidden rounded-lg">
              <Scanner
                onScan={handleScan}
                onError={handleError}
                constraints={deviceConstraints}
                paused={paused}
                components={{
                  finder: false,
                  onOff: true,
                  torch: true,
                  zoom: true,
                }}
                classNames={{
                  container: "w-full h-full",
                  video: "w-full h-full object-cover",
                }}
              />
              {/* Custom Viewfinder Overlay with Corner Markers */}
              <div className="absolute inset-0 pointer-events-none z-10">
                {/* Top-left corner */}
                <div className="absolute top-[12%] left-[12%] w-8 h-8 border-l-4 border-t-4 border-emerald-500 rounded-tl-lg" />
                {/* Top-right corner */}
                <div className="absolute top-[12%] right-[12%] w-8 h-8 border-r-4 border-t-4 border-emerald-500 rounded-tr-lg" />
                {/* Bottom-left corner */}
                <div className="absolute bottom-[12%] left-[12%] w-8 h-8 border-l-4 border-b-4 border-emerald-500 rounded-bl-lg" />
                {/* Bottom-right corner */}
                <div className="absolute bottom-[12%] right-[12%] w-8 h-8 border-r-4 border-b-4 border-emerald-500 rounded-br-lg" />
                {/* Scan line */}
                <div className="absolute left-[12%] right-[12%] h-0.5 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-[scan_2s_ease-in-out_infinite]" />
              </div>
            </div>
            <div className="mt-3 flex justify-center">
              <button
                onClick={toggleScanner}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
                  scannerRunning
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-emerald-500 hover:bg-emerald-600"
                }`}
              >
                {scannerRunning ? "Pause Scanning" : "Start Scanning"}
              </button>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-800">Last Scan</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowClearConfirm(true)}
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
              onClick={copyToClipboard}
              disabled={!scannedData}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copy to clipboard
            </button>
            {openUrlVisible && (
              <button
                onClick={openUrl}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Open URL
              </button>
            )}
          </div>
        </section>

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
                        onClick={() => toggleExpand(index)}
                        aria-label={expandedItems.has(index) ? "Collapse" : "Expand"}
                        className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                      >
                        <svg className={`w-4 h-4 transition-transform ${expandedItems.has(index) ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => copyHistoryItem(item.data)}
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

        {showClearConfirm && (
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
                This will delete {history.length} saved scan(s). This action
                cannot be undone.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmClear}
                  className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

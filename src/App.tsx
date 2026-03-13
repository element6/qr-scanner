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
          <p className="text-sm text-slate-600">
            Point your camera to a QR code and store scan results in history.
          </p>
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
            <button
              onClick={toggleScanner}
              aria-pressed={scannerRunning}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition ${
                scannerRunning
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-emerald-500 hover:bg-emerald-600"
              }`}
            >
              {scannerRunning ? "Pause" : "Start"}
            </button>
          </div>

          <div className="aspect-video bg-black">
            <Scanner
              onScan={handleScan}
              onError={handleError}
              constraints={deviceConstraints}
              paused={paused}
              components={{
                finder: true,
                onOff: true,
                torch: true,
                zoom: true,
              }}
              classNames={{
                container: "w-full h-full",
                video: "w-full h-full",
              }}
            />
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-800">Last Scan</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPaused(false);
                  setError(null);
                  setNotification("Scanning resumed");
                }}
                className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
              >
                Scan again
              </button>
              <button
                onClick={clearHistory}
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
                <button
                  key={`${item.timestamp}-${index}`}
                  onClick={() => copyHistoryItem(item.data)}
                  className="w-full text-left rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-indigo-300 hover:bg-white"
                >
                  <div className="text-xs text-slate-500">
                    {new Date(item.timestamp).toLocaleString()}
                  </div>
                  <div className="mt-1 text-sm text-slate-800 line-clamp-2 break-words">
                    {item.data}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
